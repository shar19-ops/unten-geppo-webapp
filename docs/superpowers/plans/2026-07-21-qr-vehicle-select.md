# QRコードによる車両自動選択 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 社有車リストの各車両にQRコードを発行できるようにし、社員がiPhoneでそのQRを読み取ると「運転記録入力」画面がその車両を自動選択した状態で開くようにする。

**Architecture:** 既存の車両マスタ(`storage.js`の`v.id`)をそのままQRの識別子として使い、`?vehicle=<id>`をURLに埋め込む。QR画像はビルド不要の単一ファイルライブラリを`public/vendor/qrcode/`に物理配置し、既存の`loadScriptOnce()`で必要な時だけ読み込む。URLパラメータの解釈は起動時の`app.js`で行い、`trip-entry.js`側の状態を書き換えることで車両選択を反映する。新規のデータモデル・サーバー側処理は一切追加しない。

**Tech Stack:** 素のHTML/CSS/JS(フレームワーク・ビルドなし)、`qrcode-generator`(vendor配置、SVG生成)、既存の`localStorage`ベースのデータ層。

## Global Constraints

- 新規npm依存を追加しない。ライブラリは`public/vendor/<name>/`に物理ファイルとして配置し、`loadScriptOnce()`経由で遅延読み込みする(既存のExcelJS/SheetJSと同じ方針)。
- QRが運ぶ情報は`${location.origin}${location.pathname}?vehicle=<車両ID>`のみ。車両IDは`storage.js`の既存`v.id`をそのまま使い、新しいデータモデルは追加しない。
- 私有車にはQRを発行しない(車両マスタに登録されないため対象外)。
- 社有車リストの管理者限定権限、および「給油登録」画面の改修は本計画のスコープ外(別プロジェクト)。
- CSS/JSを変更したファイルがある場合、`public/index.html`内の全アセットの`?v=`クエリを新しい値に一括更新する(house convention、`DEVLOG.md`記載)。現在値は`20260720j`。
- UIの文言・見た目は既存の`.panel` / `.btn` / `.btn-ghost` / `.btn-primary` / `.hint` / `.status`クラスとその配色変数(`--accent`等)に合わせる。

---

### Task 1: QRコード生成ライブラリのベンダー配置

**Files:**
- Create: `public/vendor/qrcode/qrcode.js`

**Interfaces:**
- Produces: ブラウザグローバル関数 `qrcode(typeNumber, errorCorrectionLevel)`。戻り値のオブジェクトは `.addData(text)`, `.make()`, `.createSvgTag(cellSize, margin)` を持つ(`createSvgTag`は`<svg>...</svg>`文字列を返す)。Task 2で `loadScriptOnce('vendor/qrcode/qrcode.js')` 後にこのグローバルを使用する。

- [ ] **Step 1: ライブラリを取得してベンダー配置する**

実行はリポジトリルート(`public/`の親ディレクトリ)で行う。

```bash
mkdir -p .tmp-qrgen && cd .tmp-qrgen && npm pack qrcode-generator@2.0.4 && tar xzf qrcode-generator-2.0.4.tgz && cd ..
mkdir -p public/vendor/qrcode
cp .tmp-qrgen/package/dist/qrcode.js public/vendor/qrcode/qrcode.js
rm -rf .tmp-qrgen
```

Expected: `public/vendor/qrcode/qrcode.js` が作成され、先頭付近に `// QR Code Generator for JavaScript` というコメントがある(MITライセンス、Kazuhiko Arase作)。

- [ ] **Step 2: Node上でライブラリが正しく動作することを確認する**

```bash
node -e "
const fs = require('fs');
const code = fs.readFileSync('public/vendor/qrcode/qrcode.js', 'utf8');
eval(code);
const qr = qrcode(0, 'M');
qr.addData('https://shar19-ops.github.io/unten-geppo-webapp/?vehicle=test123');
qr.make();
const svg = qr.createSvgTag(6, 8);
if (!svg.includes('<svg')) throw new Error('SVG generation failed');
console.log('OK: QR SVG length=' + svg.length);
"
```

Expected: `OK: QR SVG length=<数値>` が出力される(エラーなし)。

- [ ] **Step 3: Commit**

```bash
git add public/vendor/qrcode/qrcode.js
git commit -m "$(cat <<'EOF'
QRコード生成ライブラリ(qrcode-generator)をvendor配置

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: 社有車リストにQRコード表示・印刷機能を追加する

**Files:**
- Modify: `public/vehicles.js:1-6`(状態変数)、`:8-105`(`renderVehiclesView`)、`:112-126`(`vehicleRow`)
- Modify: `public/style.css`(266行目の印刷セクション手前にQR用CSSを追加)

**Interfaces:**
- Consumes: Task 1の `qrcode(typeNumber, errorCorrectionLevel)` グローバル(`loadScriptOnce('vendor/qrcode/qrcode.js')`経由)。既存の `loadVehicles()`(`storage.js`)、`loadScriptOnce()`(`app.js`)。
- Produces: URL形式 `${location.origin}${location.pathname}?vehicle=${vehicle.id}`(Task 3がこの `vehicle` パラメータ名を読み取る)。DOM要素: ボタン `.vehicle-qr-btn[data-id]`、パネル `#vehicleQrPanel`、ボタン `#qrPrintBtn` / `#qrCloseBtn`。

- [ ] **Step 1: 状態変数を追加する**

`public/vehicles.js:6` の直後に追加:

```javascript
let vehicleQrState = null; // null=非表示 / {vehicle, url, svg}=QRコード表示中
```

- [ ] **Step 2: 車両一覧の各行にQRボタンを追加する**

`public/vehicles.js:120-123` の `vehicleRow` 関数内、既存のボタン部分を以下に置き換える:

```javascript
      <td class="row-actions">
        <button class="btn btn-text vehicle-qr-btn" type="button" data-id="${v.id}">QRコード</button>
        <button class="btn btn-text vehicle-edit-btn" type="button" data-id="${v.id}">編集</button>
        <button class="btn btn-text btn-danger vehicle-delete-btn" type="button" data-id="${v.id}">削除</button>
      </td>
```

- [ ] **Step 3: QRパネルの描画関数を追加する**

`public/vehicles.js` の `vehicleRow` 関数の直後に新規関数を追加:

```javascript
function qrPanelHtml(state) {
  const { vehicle, url, svg } = state;
  return `
    <div class="panel qr-panel" id="vehicleQrPanel">
      <div class="panel-head no-print">
        <h2>QRコード: ${vehicle.plateNumber}</h2>
        <div class="panel-actions">
          <button class="btn btn-ghost" type="button" id="qrPrintBtn">印刷</button>
          <button class="btn btn-ghost" type="button" id="qrCloseBtn">閉じる</button>
        </div>
      </div>
      <div class="qr-print-area">
        <p class="qr-vehicle-label">${vehicle.plateNumber}${vehicle.nickname ? `(${vehicle.nickname})` : ''}</p>
        <div class="qr-image">${svg}</div>
        <p class="qr-url hint no-print">${url}</p>
      </div>
    </div>
  `;
}
```

- [ ] **Step 4: `renderVehiclesView`にQRパネルの表示・no-print切り替え・イベント登録を組み込む**

`public/vehicles.js:12-48` の `renderVehiclesView` を以下に置き換える(変更点: `panel-head`と`data-table`に`vehicleQrState`時の`no-print`を追加、QRパネルの挿入、QRボタン/印刷/閉じるのイベント登録を追加):

```javascript
function renderVehiclesView() {
  const root = document.getElementById('view-vehicles');
  const vehicles = loadVehicles();

  root.innerHTML = `
    <div class="panel">
      <div class="panel-head ${vehicleQrState ? 'no-print' : ''}">
        <h2>社有車リスト</h2>
        <div class="panel-actions">
          <input type="file" id="vehicleExcelInput" accept=".xlsx,.xls" hidden>
          <input type="file" id="vehicleJsonInput" accept=".json" hidden>
          <button class="btn btn-ghost" type="button" id="vehicleExcelImportBtn">Excelから取込</button>
          <button class="btn btn-ghost" type="button" id="vehicleExcelExportBtn">Excelへ出力</button>
          <button class="btn btn-ghost" type="button" id="vehicleJsonImportBtn">JSONから取込</button>
          <button class="btn btn-ghost" type="button" id="vehicleJsonExportBtn">JSONへ出力</button>
          <button class="btn btn-primary" type="button" id="vehicleAddBtn">＋ 車両を追加</button>
        </div>
      </div>

      ${vehicleFormState ? vehicleFormHtml(vehicleFormState) : ''}
      ${vehicleQrState ? qrPanelHtml(vehicleQrState) : ''}
      ${vehicleImportConflicts ? conflictPanelHtml(vehicleImportConflicts.conflicts) : ''}

      <table class="data-table ${vehicleQrState ? 'no-print' : ''}">
        <thead>
          <tr>
            <th>車両番号</th>
            <th>車種／名称</th>
            <th>事業所名</th>
            <th>既定の車両管理者</th>
            <th>状態</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${vehicles.length ? vehicles.map(vehicleRow).join('') : '<tr><td colspan="6" class="hint">まだ社有車が登録されていません。「＋ 車両を追加」またはExcel取込で登録してください。</td></tr>'}
        </tbody>
      </table>
      <p class="hint ${vehicleQrState ? 'no-print' : ''}">※ 私有車は運転記録入力画面でその都度自由入力します(このリストには登録されません)。</p>
      <p class="status ${vehicleStatusIsError ? 'error' : 'ok'} ${vehicleQrState ? 'no-print' : ''}">${vehicleStatusMessage}</p>
    </div>
  `;

  document.getElementById('vehicleAddBtn').addEventListener('click', () => {
    vehicleFormState = { active: true };
    renderVehiclesView();
  });
  document.getElementById('vehicleExcelImportBtn').addEventListener('click', async () => {
    await loadScriptOnce('vendor/sheetjs/xlsx.full.min.js');
    document.getElementById('vehicleExcelInput').click();
  });
  document.getElementById('vehicleExcelExportBtn').addEventListener('click', async () => {
    await loadScriptOnce('vendor/sheetjs/xlsx.full.min.js');
    exportVehiclesToExcel();
  });
  document.getElementById('vehicleJsonImportBtn').addEventListener('click', () => document.getElementById('vehicleJsonInput').click());
  document.getElementById('vehicleJsonExportBtn').addEventListener('click', async () => {
    const filename = await exportVehiclesToFile();
    setVehicleStatus(filename ? `書き出しました(${filename})` : '', false);
  });
  document.getElementById('vehicleExcelInput').addEventListener('change', onVehicleExcelSelected);
  document.getElementById('vehicleJsonInput').addEventListener('change', onVehicleJsonSelected);

  root.querySelectorAll('.vehicle-qr-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const vehicle = vehicles.find((x) => x.id === btn.dataset.id);
      await loadScriptOnce('vendor/qrcode/qrcode.js');
      const url = `${location.origin}${location.pathname}?vehicle=${encodeURIComponent(vehicle.id)}`;
      const qr = qrcode(0, 'M');
      qr.addData(url);
      qr.make();
      vehicleQrState = { vehicle, url, svg: qr.createSvgTag(6, 8) };
      renderVehiclesView();
    });
  });
  root.querySelectorAll('.vehicle-edit-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const v = vehicles.find((x) => x.id === btn.dataset.id);
      vehicleFormState = { ...v };
      renderVehiclesView();
    });
  });
  root.querySelectorAll('.vehicle-delete-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const v = vehicles.find((x) => x.id === btn.dataset.id);
      if (confirm(`「${v.plateNumber}」を削除します。よろしいですか?`)) {
        deleteVehicle(v.id);
        setVehicleStatus(`削除しました(${v.plateNumber})`, false);
        renderVehiclesView();
      }
    });
  });

  const form = document.getElementById('vehicleForm');
  if (form) {
    form.addEventListener('submit', onVehicleFormSubmit);
    document.getElementById('vehicleFormCancelBtn').addEventListener('click', () => {
      vehicleFormState = null;
      renderVehiclesView();
    });
  }

  if (vehicleQrState) {
    document.getElementById('qrPrintBtn').addEventListener('click', () => window.print());
    document.getElementById('qrCloseBtn').addEventListener('click', () => {
      vehicleQrState = null;
      renderVehiclesView();
    });
  }

  if (vehicleImportConflicts) {
    document.getElementById('conflictApplyBtn').addEventListener('click', applyVehicleConflictResolution);
    document.getElementById('conflictCancelBtn').addEventListener('click', () => {
      vehicleImportConflicts = null;
      setVehicleStatus('取込を取り消しました', false);
      renderVehiclesView();
    });
  }
}
```

- [ ] **Step 5: QRパネル用CSSを追加する**

`public/style.css:266` (`/* --- 印刷(A4・サンプルExcelの余白に合わせる) --- */` の直前)に追加:

```css
.qr-panel { text-align: center; }
.qr-vehicle-label { font-size: 1.1rem; font-weight: bold; margin: 0.5rem 0; }
.qr-image { display: flex; justify-content: center; margin: 0.75rem 0; }
.qr-url { word-break: break-all; }

```

- [ ] **Step 6: 開発サーバーで動作確認する**

```bash
npm start
```

ブラウザ(またはPlaywrightの`browser_navigate`)で `http://localhost:5174` を開き、以下を確認する:

1. 「社有車リスト」タブを開き、登録済み車両が1件以上あることを確認する(無ければ「＋ 車両を追加」で1件登録: 車両番号「品川500 あ 12-34」)。
2. 該当行の「QRコード」ボタンをクリックする。
3. 見出し「QRコード: 品川500 あ 12-34」のパネルが表示され、パネル内に`<svg>`のQR画像と、`http://localhost:5174/?vehicle=`で始まるURLテキストが表示されることを確認する。
4. 「閉じる」ボタンをクリックし、パネルが消えて元の一覧表示に戻ることを確認する。

Expected: 上記1〜4がすべてブラウザ上で確認できる。

- [ ] **Step 7: Commit**

```bash
git add public/vehicles.js public/style.css
git commit -m "$(cat <<'EOF'
社有車リストにQRコード表示・印刷機能を追加

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: QRコードのURLから運転記録入力の車両を自動選択する

**Files:**
- Modify: `public/trip-entry.js:1-7`(状態変数)、`:57-75`(`vehicleSelectFieldHtml`)、`:23-46`(`renderTripEntryView`のイベント登録部)
- Modify: `public/app.js:145`(末尾の`showView('trip-entry');`)

**Interfaces:**
- Consumes: Task 2で作られるURL形式 `?vehicle=<id>`。既存の `loadVehicles()`(`storage.js`)、`tripUsePrivateCar`・`tripStatusMessage`・`tripStatusIsError`(`trip-entry.js`)。
- Produces: 新規グローバル `tripQrVehicleId`(nullable string、QR経由で指定された車両ID)。

- [ ] **Step 1: 状態変数を追加する**

`public/trip-entry.js:6` (`let tripPendingChecklists = [];` の行)の直後に追加:

```javascript
let tripQrVehicleId = null; // QR経由で指定された車両ID(未指定/該当なしの場合はnull)
```

- [ ] **Step 2: 車両プルダウンでQR指定車両を自動選択する**

`public/trip-entry.js:57-75` の `vehicleSelectFieldHtml` 関数を以下に置き換える(変更点: `<option>`に`selected`属性を追加):

```javascript
function vehicleSelectFieldHtml(vehicles) {
  return `
    <div class="field">
      <label>車両</label>
      <div class="segmented">
        <button type="button" class="segmented-btn ${!tripUsePrivateCar ? 'active' : ''}" data-mode="company">社有車</button>
        <button type="button" class="segmented-btn ${tripUsePrivateCar ? 'active' : ''}" data-mode="private">私有車</button>
      </div>
      ${tripUsePrivateCar
        ? `<input type="text" name="privateCarLabel" class="input-lg" placeholder="車両名・ナンバーなど自由入力">`
        : vehicles.length
          ? `<select name="vehicleId" class="input-lg">
              ${vehicles.map((v) => `<option value="${v.id}" ${tripQrVehicleId === v.id ? 'selected' : ''}>${v.plateNumber}（${v.nickname || '車種未設定'}）</option>`).join('')}
            </select>`
          : `<p class="hint">社有車が未登録です。「社有車リスト」画面で登録するか、私有車として入力してください。</p>`
      }
    </div>
  `;
}
```

- [ ] **Step 3: 手動で車両・モードを変更したらQR指定を解除する**

`public/trip-entry.js:31-37` の以下のブロックを:

```javascript
  root.querySelectorAll('.segmented-btn[data-mode]').forEach((btn) => {
    btn.addEventListener('click', () => {
      tripUsePrivateCar = btn.dataset.mode === 'private';
      renderTripEntryView();
    });
  });
```

次のように置き換える:

```javascript
  root.querySelectorAll('.segmented-btn[data-mode]').forEach((btn) => {
    btn.addEventListener('click', () => {
      tripUsePrivateCar = btn.dataset.mode === 'private';
      tripQrVehicleId = null;
      renderTripEntryView();
    });
  });
```

`public/trip-entry.js:38-43` の以下のブロックを:

```javascript
  if (tripEntryMode === 'trip') {
    const fuelToggle = document.getElementById('fuelToggle');
    fuelToggle.addEventListener('change', () => {
      document.getElementById('fuelField').hidden = !fuelToggle.checked;
    });
    document.getElementById('tripEntryForm').addEventListener('submit', onTripEntrySubmit);
  } else {
```

次のように置き換える:

```javascript
  if (tripEntryMode === 'trip') {
    const fuelToggle = document.getElementById('fuelToggle');
    fuelToggle.addEventListener('change', () => {
      document.getElementById('fuelField').hidden = !fuelToggle.checked;
    });
    document.getElementById('tripEntryForm').addEventListener('submit', onTripEntrySubmit);
    const vehicleSelect = document.querySelector('#tripEntryForm select[name="vehicleId"]');
    if (vehicleSelect) {
      vehicleSelect.addEventListener('change', () => { tripQrVehicleId = null; });
    }
  } else {
```

- [ ] **Step 4: 起動時にURLの`?vehicle=`を読み取って反映する**

`public/app.js:145` の `showView('trip-entry');` を以下に置き換える:

```javascript
// QRコードからの起動処理(社有車の?vehicle=<id>を読み取り、運転記録入力へ車両自動選択で遷移する)
(function applyQrVehicleParam() {
  const params = new URLSearchParams(location.search);
  const qrVehicleId = params.get('vehicle');
  if (qrVehicleId) {
    const vehicles = loadVehicles().filter((v) => v.active !== false);
    const matched = vehicles.find((v) => v.id === qrVehicleId);
    tripUsePrivateCar = false;
    if (matched) {
      tripQrVehicleId = qrVehicleId;
    } else {
      tripStatusMessage = 'QRコードに対応する車両が見つかりませんでした。車両を選び直してください';
      tripStatusIsError = true;
    }
    history.replaceState(null, '', location.pathname);
  }
})();

showView('trip-entry');
```

- [ ] **Step 5: 開発サーバーで動作確認する(正常系)**

```bash
npm start
```

社有車リストで登録済み車両のID(ブラウザの開発者ツールで `localStorage.getItem('vehicles')` を確認するか、Task 2で表示したQRパネルのURL末尾)を1つ控える。ブラウザ(またはPlaywrightの`browser_navigate`)で `http://localhost:5174/?vehicle=<控えたID>` を開き、以下を確認する:

1. 「運転記録入力」タブが開いた状態で表示される。
2. 「車両」欄が「社有車」モードになっており、プルダウンに控えたIDの車両が選択済みであることを確認する。
3. アドレスバーが `http://localhost:5174/`(`?vehicle=`が付いていない状態)に戻っていることを確認する。

Expected: 上記1〜3がすべて確認できる。

- [ ] **Step 6: 開発サーバーで動作確認する(異常系: 存在しないID)**

ブラウザで `http://localhost:5174/?vehicle=not-exist-id` を開き、以下を確認する:

1. 「運転記録入力」タブが開いた状態で表示される。
2. 画面下部に赤字で「QRコードに対応する車両が見つかりませんでした。車両を選び直してください」と表示される。
3. 車両プルダウンは通常通り(先頭の車両など)選択可能な状態になっている。

Expected: 上記1〜3がすべて確認できる。

- [ ] **Step 7: Commit**

```bash
git add public/trip-entry.js public/app.js
git commit -m "$(cat <<'EOF'
QRコードのURLパラメータから運転記録入力の車両を自動選択する

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: キャッシュ無効化のためのアセットバージョン更新

**Files:**
- Modify: `public/index.html:9,28-33`

**Interfaces:**
- Consumes: なし(Task 1〜3で変更した `style.css` / `vehicles.js` / `trip-entry.js` / `app.js` が対象)。

- [ ] **Step 1: `?v=`クエリを一括更新する**

`public/index.html` 内のすべての `?v=20260720j` を `?v=20260721a` に置き換える(`style.css`・`storage.js`・`vehicles.js`・`trip-entry.js`・`report.js`・`xlsx-export.js`・`app.js`の7箇所)。

```bash
sed -i 's/?v=20260720j/?v=20260721a/g' public/index.html
```

- [ ] **Step 2: 置き換えを確認する**

```bash
grep -c "v=20260721a" public/index.html
```

Expected: `7`(7箇所すべて置き換わっている)。

- [ ] **Step 3: Commit**

```bash
git add public/index.html
git commit -m "$(cat <<'EOF'
QR自動選択機能の追加に伴いアセットのキャッシュバージョンを更新

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```
