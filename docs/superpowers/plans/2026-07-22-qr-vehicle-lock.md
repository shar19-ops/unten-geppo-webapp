# QRコード経由アクセス時の車両ロック Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** QRコードで車両が正常に特定できてアクセスした場合、運転記録入力・運転月報の両画面で、その車両以外を選べないようにする。

**Architecture:** 両画面とも、既存のグローバル変数`tripQrVehicleId`(`public/trip-entry.js`で定義済み)がセットされている場合、車両選択用の`<select>`(および運転記録入力の社有車/私有車切替ボタン)を描画せず、代わりに固定テキスト表示に置き換える。`tripQrVehicleId`がセットされていない場合の挙動は一切変更しない。

**Tech Stack:** 既存のvanilla JS(フレームワーク・ビルドなし)構成をそのまま維持する。

## Global Constraints

- 対象spec: `docs/superpowers/specs/2026-07-22-qr-vehicle-lock-design.md`
- ロック判定は`tripQrVehicleId`(`public/trip-entry.js`で`let`宣言済みのグローバル変数)がtruthyかどうかで行う。新しい変数は追加しない。
- ロック中は、運転記録入力・運転月報とも「車両を選ぶこと」だけを制限する。月選択・点検入力・Excel/JSON出力・取込など他の機能には一切手を加えない。
- 管理者パスワードの解除状態に関わらず、ロックは例外なく適用する(管理者向けの回避手段は作らない)。
- ロック解除用のUI(リンク・ボタン)は作らない。
- `tripQrVehicleId`に対応する車両が(削除等により)見つからない場合は、ロックをかけず通常の選択式にフォールバックする(車両が1台も無い状態にはしない)。
- 何かCSS/JSファイルを変更したら、最後のタスクで`public/index.html`内の全`?v=`を新しいバージョン文字列に一括更新する(既存の家訓)。現在のバージョンは`20260722c`。

---

### Task 1: 運転記録入力画面で車両選択を固定表示にする

**Files:**
- Modify: `public/trip-entry.js:59-79`(`vehicleSelectFieldHtml`関数)

**Interfaces:**
- Consumes: グローバル変数`tripQrVehicleId`(`public/trip-entry.js:8`で宣言済み、QR経由で特定された車両IDまたは`null`)。
- 変更なし: `vehicleSelectFieldHtml(companyVehicles, privateVehicles)`の呼び出し側・シグネチャ(`public/trip-entry.js`内の`tripFormHtml()`から呼ばれる)。

- [ ] **Step 1: `vehicleSelectFieldHtml`にロック時の固定表示を追加する**

`public/trip-entry.js`の59〜79行目、以下の関数全体を:

```js
function vehicleSelectFieldHtml(companyVehicles, privateVehicles) {
  const vehicles = tripUsePrivateCar ? privateVehicles : companyVehicles;
  const emptyHint = tripUsePrivateCar
    ? '私有車が未登録です。「車両リスト」画面で登録してください。'
    : '社有車が未登録です。「車両リスト」画面で登録してください。';
  return `
    <div class="field">
      <label>車両</label>
      <div class="segmented">
        <button type="button" class="segmented-btn ${!tripUsePrivateCar ? 'active' : ''}" data-mode="company">社有車</button>
        <button type="button" class="segmented-btn ${tripUsePrivateCar ? 'active' : ''}" data-mode="private">私有車</button>
      </div>
      ${vehicles.length
        ? `<select name="vehicleId" class="input-lg">
            ${vehicles.map((v) => `<option value="${escapeHtml(v.id)}" ${tripQrVehicleId === v.id ? 'selected' : ''}>${escapeHtml(v.plateNumber)}（${escapeHtml(v.nickname || '車種未設定')}）</option>`).join('')}
          </select>`
        : `<p class="hint">${emptyHint}</p>`
      }
    </div>
  `;
}
```

以下に置き換える:

```js
function vehicleSelectFieldHtml(companyVehicles, privateVehicles) {
  if (tripQrVehicleId) {
    const lockedVehicle = [...companyVehicles, ...privateVehicles].find((v) => v.id === tripQrVehicleId);
    if (lockedVehicle) {
      return `
        <div class="field">
          <label>車両</label>
          <p class="input-lg">${escapeHtml(lockedVehicle.plateNumber)}（${escapeHtml(lockedVehicle.nickname || '車種未設定')}）</p>
          <input type="hidden" name="vehicleId" value="${escapeHtml(lockedVehicle.id)}">
        </div>
      `;
    }
  }
  const vehicles = tripUsePrivateCar ? privateVehicles : companyVehicles;
  const emptyHint = tripUsePrivateCar
    ? '私有車が未登録です。「車両リスト」画面で登録してください。'
    : '社有車が未登録です。「車両リスト」画面で登録してください。';
  return `
    <div class="field">
      <label>車両</label>
      <div class="segmented">
        <button type="button" class="segmented-btn ${!tripUsePrivateCar ? 'active' : ''}" data-mode="company">社有車</button>
        <button type="button" class="segmented-btn ${tripUsePrivateCar ? 'active' : ''}" data-mode="private">私有車</button>
      </div>
      ${vehicles.length
        ? `<select name="vehicleId" class="input-lg">
            ${vehicles.map((v) => `<option value="${escapeHtml(v.id)}" ${tripQrVehicleId === v.id ? 'selected' : ''}>${escapeHtml(v.plateNumber)}（${escapeHtml(v.nickname || '車種未設定')}）</option>`).join('')}
          </select>`
        : `<p class="hint">${emptyHint}</p>`
      }
    </div>
  `;
}
```

**補足:** `renderTripEntryView()`(同ファイル10〜57行目)内の`document.querySelector('#tripEntryForm select[name="vehicleId"]')`は、ロック時に`<select>`が存在しないため`null`を返す。既存コードは`if (vehicleSelect) { ... }`で既にnullチェック済みのため、この部分は変更不要(エラーにならない)。同様に`.segmented-btn[data-mode]`もロック時は0件になるため`forEach`は何もせず安全に終わる。

- [ ] **Step 2: 動作確認(ブラウザ)**

`npm start`でローカルサーバーを起動し、ブラウザの開発者ツールコンソールで以下を実行する(実際に社有車が1台登録されている状態で行う。無ければ先に「車両リスト」から1台追加する):

```js
const v = loadVehicles()[0];
tripQrVehicleId = v.id;
tripUsePrivateCar = v.vehicleType === 'private';
renderTripEntryView();
document.querySelector('.tab-btn[data-view="trip-entry"]').click();
```

期待結果:
- 社有車/私有車の切替ボタンが表示されない
- 車両選択のプルダウンが表示されず、代わりに「(車両番号)（(車種名)）」という固定テキストが表示される
- ブラウザの開発者ツールでDOMを確認し、`<input type="hidden" name="vehicleId">`が存在し、値が`v.id`と一致すること

続けて、この状態のまま運転記録入力フォームに必要項目を入力して保存し、正しく`v.id`に対して記録が保存されること(`loadMonthlyLog(v.id, 年, 月)`で該当日のデータが入っていること)を確認する。

最後に、ロックを解除して通常表示に戻ることを確認する:

```js
tripQrVehicleId = null;
renderTripEntryView();
```

期待結果: 社有車/私有車の切替ボタンとプルダウンが元通り表示される。

- [ ] **Step 3: コミット**

```bash
git add public/trip-entry.js
git commit -m "QRコード経由アクセス時、運転記録入力の車両選択を固定表示にする"
```

---

### Task 2: 運転月報画面で車両選択を固定表示にする

**Files:**
- Modify: `public/report.js:10-28`(`reportVehicleOptions`関数)
- Modify: `public/report.js:81-83`(車両選択の`<select>`部分)
- Modify: `public/report.js:137-141`(`reportVehicleSelect`のイベントリスナー登録)

**Interfaces:**
- Consumes: グローバル変数`tripQrVehicleId`(`public/trip-entry.js:8`で宣言済み。`public/index.html`でtrip-entry.jsがreport.jsより先に読み込まれるため、report.js内で参照可能)。
- 変更なし: `reportVehicleOptions()`の戻り値の形(`{ref, label, vehicleId, privateCarLabel}`の配列)。

- [ ] **Step 1: `reportVehicleOptions`にロック時のフィルタを追加する**

`public/report.js`の10〜28行目、以下の関数全体を:

```js
function reportVehicleOptions() {
  const vehicles = loadVehicles().map((v) => ({
    ref: v.id,
    label: v.vehicleType === 'private'
      ? `${v.plateNumber}（${v.nickname ? `${v.nickname}・私有車` : '私有車'}）`
      : `${v.plateNumber}（${v.nickname || '車種未設定'}）`,
    vehicleId: v.id,
    privateCarLabel: null
  }));
  const registeredIds = new Set(vehicles.map((v) => v.ref));
  const privateRefs = new Map();
  loadLogIndex().forEach((e) => {
    if (e.privateCarLabel && !registeredIds.has(e.vehicleRef)) privateRefs.set(e.vehicleRef, e.privateCarLabel);
  });
  const legacyPrivateOptions = Array.from(privateRefs.entries()).map(([ref, label]) => ({
    ref, label: `${label}（私有車・未登録）`, vehicleId: null, privateCarLabel: label
  }));
  return [...vehicles, ...legacyPrivateOptions];
}
```

以下に置き換える:

```js
function reportVehicleOptions() {
  const vehicles = loadVehicles().map((v) => ({
    ref: v.id,
    label: v.vehicleType === 'private'
      ? `${v.plateNumber}（${v.nickname ? `${v.nickname}・私有車` : '私有車'}）`
      : `${v.plateNumber}（${v.nickname || '車種未設定'}）`,
    vehicleId: v.id,
    privateCarLabel: null
  }));
  const registeredIds = new Set(vehicles.map((v) => v.ref));
  const privateRefs = new Map();
  loadLogIndex().forEach((e) => {
    if (e.privateCarLabel && !registeredIds.has(e.vehicleRef)) privateRefs.set(e.vehicleRef, e.privateCarLabel);
  });
  const legacyPrivateOptions = Array.from(privateRefs.entries()).map(([ref, label]) => ({
    ref, label: `${label}（私有車・未登録）`, vehicleId: null, privateCarLabel: label
  }));
  const allOptions = [...vehicles, ...legacyPrivateOptions];
  if (tripQrVehicleId) {
    const locked = allOptions.filter((o) => o.ref === tripQrVehicleId);
    if (locked.length) return locked;
  }
  return allOptions;
}
```

- [ ] **Step 2: 車両選択の`<select>`をロック時は固定表示にする**

`public/report.js`の81〜83行目:

```js
          <select class="input-sm" id="reportVehicleSelect">
            ${options.map((o) => `<option value="${escapeHtml(o.ref)}" ${o.ref === reportSelectedRef ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}
          </select>
```

を、以下に置き換える:

```js
          ${tripQrVehicleId
            ? `<span class="input-sm">${escapeHtml(selectedOption.label)}</span>`
            : `<select class="input-sm" id="reportVehicleSelect">
                ${options.map((o) => `<option value="${escapeHtml(o.ref)}" ${o.ref === reportSelectedRef ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}
              </select>`
          }
```

- [ ] **Step 3: `reportVehicleSelect`のイベントリスナー登録をnullチェックする**

`public/report.js`の137〜141行目:

```js
  document.getElementById('reportVehicleSelect').addEventListener('change', (e) => {
    reportSelectedRef = e.target.value;
    reportImportConflicts = null;
    renderReportView();
  });
```

を、以下に置き換える:

```js
  const reportVehicleSelectEl = document.getElementById('reportVehicleSelect');
  if (reportVehicleSelectEl) {
    reportVehicleSelectEl.addEventListener('change', (e) => {
      reportSelectedRef = e.target.value;
      reportImportConflicts = null;
      renderReportView();
    });
  }
```

- [ ] **Step 4: 動作確認(ブラウザ)**

`npm start`でローカルサーバーを起動し、社有車が1台登録されている状態で、開発者ツールコンソールで以下を実行する:

```js
const v = loadVehicles()[0];
tripQrVehicleId = v.id;
document.querySelector('.tab-btn[data-view="report"]').click();
```

期待結果:
- 車両選択のプルダウン(`#reportVehicleSelect`)が表示されず、代わりに「(車両番号)（(車種名)）」という固定テキストが表示される
- 月選択のプルダウンは通常通り操作でき、月を切り替えても固定表示の車両は変わらないこと
- 「事業所名」「車両管理者」欄、点検入力、Excel/JSON出力・取込ボタンは通常通り表示・操作できること

続けて、ロックを解除して通常表示に戻ることを確認する:

```js
tripQrVehicleId = null;
renderReportView();
```

期待結果: 車両選択のプルダウンが元通り表示され、他の車両にも切り替えられる。

- [ ] **Step 5: コミット**

```bash
git add public/report.js
git commit -m "QRコード経由アクセス時、運転月報の車両選択を固定表示にする"
```

---

### Task 3: キャッシュバージョンの更新

**Files:**
- Modify: `public/index.html`

**Interfaces:**
- Consumes: なし(Task 1〜2で`public/trip-entry.js`・`public/report.js`が変更されたことを受けての、既存のキャッシュバスティング運用に従う作業)。

- [ ] **Step 1: バージョン文字列を一括更新する**

`public/index.html`内の`?v=20260722c`をすべて`?v=20260722d`に置き換える(`link`タグ1箇所+`script`タグ6箇所、計7箇所):

```bash
sed -i 's/?v=20260722c/?v=20260722d/g' public/index.html
```

- [ ] **Step 2: 置換件数を確認する**

```bash
grep -c "?v=20260722d" public/index.html
```

期待結果: `7`

- [ ] **Step 3: コミット**

```bash
git add public/index.html
git commit -m "QRコード経由アクセス時の車両ロック機能の追加に伴いアセットのキャッシュバージョンを更新"
```
