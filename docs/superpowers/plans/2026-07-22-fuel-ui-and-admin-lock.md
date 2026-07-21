# 給油UI簡素化と車両リスト管理者パスワード保護 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (1) 運転記録入力フォームから使われない給油チェックボックスを削除し、給油は「給油入力」タブのみで記録する運用にする。(2) 「車両リスト」画面を、ヘッダーの「管理者」チェックボックス+パスワード入力で保護し、未解除の間はタブ自体を非表示にする。

**Architecture:** (1)は`trip-entry.js`の既存フォーム・保存ロジックの削除のみで、新規state・新規ファイルは不要。(2)は馬券投票アプリ(`C:\Users\shar1\OneDrive\MCフォルダ\馬券投票アプリ\keiba-baren-v3.html`)と同じ方式(パスワードをJS内定数と比較、解除フラグを`sessionStorage`に保存)を踏襲し、`index.html`に静的なチェックボックス+オーバーレイHTML、`app.js`に制御ロジックを追加する。既存の`showView`/タブ切替の仕組みに乗せる形で実装する。

**Tech Stack:** 素のHTML/CSS/JS(フレームワーク・ビルドなし)。新規npm依存なし。

## Global Constraints

- 給油量(`fuelAdded`)は運転記録入力の保存時に一切触れない(dayDataオブジェクトにキー自体を含めない)。これにより「給油入力」で記録済みの給油量が、後から同じ日の運転記録を編集・再保存しても消えない。
- 「給油を後日記入」という文言は全箇所「給油入力」に統一する(`trip-entry.js`にのみ存在する文言で、他ファイルに参照はない)。
- 管理者パスワードは`anzen_kanri`。JSコード内に平文の定数として埋め込む、クライアント側のみの簡易な仕組み(馬券投票アプリと同じセキュリティ前提。サーバー側認証ではない)。
- 解除状態は`sessionStorage`に保存し、ブラウザ(タブ)を閉じると解除状態は消える。
- 「車両リスト」タブボタンは、未解除の間はナビゲーションから非表示(`hidden`属性)にする。ロックした時点で表示中の画面が「車両リスト」だった場合は「運転記録入力」タブに切り替える。
- CSS/JSを変更したファイルがある場合、`public/index.html`内の全アセットの`?v=`クエリを新しい値に一括更新する(house convention)。現在値は`20260721b`。

---

### Task 1: 運転記録入力の給油UI簡素化

**Files:**
- Modify: `public/trip-entry.js:4`(コメント)、`:18`(タブボタン文言)、`:40-52`(イベントリスナー登録)、`:126-134`(給油チェックボックスUI)、`:150`(給油フォーム見出し)、`:259-265`(dayData構築)、`:276`(コメント)
- Modify: `public/style.css:170`(`.fuel-field`ルールの削除)

**Interfaces:**
- Consumes: なし。
- Produces: なし(この画面内で完結する変更)。

- [ ] **Step 1: モード切替コメント・タブ文言を更新する**

`public/trip-entry.js:4`の以下を:

```javascript
let tripEntryMode = 'trip'; // 'trip'=運転記録入力 / 'fuel'=給油を後日記入
```

次のように置き換える:

```javascript
let tripEntryMode = 'trip'; // 'trip'=運転記録入力 / 'fuel'=給油入力
```

`public/trip-entry.js:18`の以下を:

```javascript
        <button type="button" class="segmented-btn ${tripEntryMode === 'fuel' ? 'active' : ''}" data-entry-mode="fuel">給油を後日記入</button>
```

次のように置き換える:

```javascript
        <button type="button" class="segmented-btn ${tripEntryMode === 'fuel' ? 'active' : ''}" data-entry-mode="fuel">給油入力</button>
```

- [ ] **Step 2: 給油チェックボックスのイベントリスナー登録を削除する**

`public/trip-entry.js:40-52`の以下を:

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
    document.getElementById('fuelEntryForm').addEventListener('submit', onFuelEntrySubmit);
  }
```

次のように置き換える:

```javascript
  if (tripEntryMode === 'trip') {
    document.getElementById('tripEntryForm').addEventListener('submit', onTripEntrySubmit);
    const vehicleSelect = document.querySelector('#tripEntryForm select[name="vehicleId"]');
    if (vehicleSelect) {
      vehicleSelect.addEventListener('change', () => { tripQrVehicleId = null; });
    }
  } else {
    document.getElementById('fuelEntryForm').addEventListener('submit', onFuelEntrySubmit);
  }
```

- [ ] **Step 3: 運転記録入力フォームから給油チェックボックスUIを削除する**

`public/trip-entry.js:121-134`の以下を(アルコールチェック欄と保存ボタンの間):

```javascript
      <div class="field">
        <label>アルコールチェック(mg/L)</label>
        <input type="text" name="alcoholCheck" inputmode="decimal" class="input-lg" placeholder="0">
      </div>

      <div class="field field-toggle">
        <label class="toggle-label">
          <input type="checkbox" id="fuelToggle"> 給油あり
        </label>
        <div class="field fuel-field" id="fuelField" hidden>
          <label>給油量(L)</label>
          <input type="text" name="fuelAdded" inputmode="decimal" class="input-lg" placeholder="例: 30.5">
        </div>
      </div>

      <button type="submit" class="btn btn-primary btn-block" ${(tripUsePrivateCar ? !privateVehicles.length : !companyVehicles.length) ? 'disabled' : ''}>この記録を保存</button>
```

次のように置き換える:

```javascript
      <div class="field">
        <label>アルコールチェック(mg/L)</label>
        <input type="text" name="alcoholCheck" inputmode="decimal" class="input-lg" placeholder="0">
      </div>

      <button type="submit" class="btn btn-primary btn-block" ${(tripUsePrivateCar ? !privateVehicles.length : !companyVehicles.length) ? 'disabled' : ''}>この記録を保存</button>
```

- [ ] **Step 4: 給油フォームの見出しを変更する**

`public/trip-entry.js:150`の以下を:

```javascript
      <h2>給油を後日記入</h2>
```

次のように置き換える:

```javascript
      <h2>給油入力</h2>
```

- [ ] **Step 5: 保存時に給油量を上書きしないようにする**

`public/trip-entry.js:259-265`の以下を:

```javascript
  const driver = String(fd.get('driver') || '').trim();
  const dayData = {
    meterReading: parseNumberOrNull(fd.get('meterReading')),
    destination: String(fd.get('destination') || '').trim(),
    driver,
    alcoholCheck: parseNumberOrNull(fd.get('alcoholCheck')),
    fuelAdded: document.getElementById('fuelToggle').checked ? parseNumberOrNull(fd.get('fuelAdded')) : null
  };
```

次のように置き換える:

```javascript
  const driver = String(fd.get('driver') || '').trim();
  const dayData = {
    meterReading: parseNumberOrNull(fd.get('meterReading')),
    destination: String(fd.get('destination') || '').trim(),
    driver,
    alcoholCheck: parseNumberOrNull(fd.get('alcoholCheck'))
  };
```

- [ ] **Step 6: コメントを更新する**

`public/trip-entry.js:276`の以下を:

```javascript
// ---------------- 給油の後日記入 ----------------
```

次のように置き換える:

```javascript
// ---------------- 給油入力 ----------------
```

- [ ] **Step 7: 不要になったCSSを削除する**

`public/style.css:170`の以下の行を削除する:

```css
.fuel-field { margin-top: 0.75rem; }
```

- [ ] **Step 8: 開発サーバーで動作確認する**

```bash
npm start
```

ブラウザ(またはPlaywrightの`browser_navigate`)で `http://localhost:5174` を開き、「運転記録入力」タブで以下を確認する:

1. フォーム内に「給油あり」チェックボックス・給油量入力欄が表示されないこと(アルコールチェック欄の直後が保存ボタンになっていること)。
2. モード切替タブの2つ目のボタンが「給油入力」という表示になっていること(以前の「給油を後日記入」ではない)。
3. 「給油入力」タブに切り替えると、見出しが「給油入力」になっていること。
4. 社有車を1件登録済みであることを確認し(車両リストが空の場合は「＋ 社有車を追加」で1件登録: 車両番号「品川500 あ 12-34」)、「給油入力」タブでその車両・当日の日付・給油量「30」を入力して保存し、成功メッセージが出ることを確認する。
5. 続けて「運転記録入力」タブに戻り、同じ車両・同じ日付で出庫時メーター「10000」・行先「本社」を入力して保存する(上書き確認ダイアログが出たら「OK」)。保存後、「運転月報」タブでその車両のその日の記録を開き、給油量が手順4で入力した「30」のまま消えていないことを確認する。

Expected: 上記1〜5がすべて確認できる。

- [ ] **Step 9: Commit**

```bash
git add public/trip-entry.js public/style.css
git commit -m "$(cat <<'EOF'
運転記録入力の給油チェックボックスを削除し、給油を後日記入を給油入力に改名する

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: 車両リストの管理者パスワード保護

**Files:**
- Modify: `public/index.html:12-14`(ヘッダー)、`:22-26`(オーバーレイ追加)
- Modify: `public/style.css:30-35`(`.app-header`)、末尾に追加(新規CSSブロック)
- Modify: `public/app.js:129-131`(タブボタンのクリックリスナー登録の直後に管理者ロック制御ロジックを追加)

**Interfaces:**
- Consumes: 既存の`showView(name)`関数(`app.js`)。
- Produces: なし(この機能に依存する他タスクはない)。

- [ ] **Step 1: ヘッダーに管理者チェックボックスを追加する**

`public/index.html:12-14`の以下を:

```html
<header class="app-header no-print">
  <h1>運転管理月報</h1>
</header>
```

次のように置き換える:

```html
<header class="app-header no-print">
  <h1>運転管理月報</h1>
  <label class="admin-toggle"><input type="checkbox" id="adminModeCheck"> 管理者</label>
</header>
```

- [ ] **Step 2: パスワード入力オーバーレイを追加する**

`public/index.html:22-26`の以下を:

```html
<main id="app">
  <section id="view-vehicles" class="view"></section>
  <section id="view-trip-entry" class="view"></section>
  <section id="view-report" class="view"></section>
</main>
```

次のように置き換える(オーバーレイのdivを`</main>`の直後に追加):

```html
<main id="app">
  <section id="view-vehicles" class="view"></section>
  <section id="view-trip-entry" class="view"></section>
  <section id="view-report" class="view"></section>
</main>

<div class="admin-pw-overlay no-print" id="adminPwOverlay" hidden>
  <div class="admin-pw-dialog">
    <h2>管理者パスワード</h2>
    <input type="password" id="adminPwInput" class="input-lg" placeholder="パスワード" autocomplete="off">
    <p class="status error" id="adminPwError"></p>
    <div class="form-actions">
      <button type="button" class="btn btn-primary" id="adminPwConfirmBtn">解除</button>
      <button type="button" class="btn btn-ghost" id="adminPwCancelBtn">キャンセル</button>
    </div>
  </div>
</div>
```

- [ ] **Step 3: ヘッダーをflexレイアウトにし、オーバーレイのCSSを追加する**

`public/style.css:30-34`の以下を:

```css
.app-header {
  background: var(--panel-bg);
  border-bottom: 1px solid var(--border);
  padding: 0.75rem 1.25rem;
}
```

次のように置き換える:

```css
.app-header {
  background: var(--panel-bg);
  border-bottom: 1px solid var(--border);
  padding: 0.75rem 1.25rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
```

`public/style.css`の末尾に以下を追加する:

```css

/* --- 管理者パスワード保護(車両リスト) --- */
.admin-toggle { display: flex; align-items: center; gap: 0.35rem; font-size: 0.85rem; color: var(--muted); cursor: pointer; }
.admin-toggle input { width: 18px; height: 18px; }

.admin-pw-overlay {
  position: fixed;
  inset: 0;
  z-index: 50;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
}
.admin-pw-overlay[hidden] { display: none; }
.admin-pw-dialog {
  background: var(--panel-bg);
  border-radius: 10px;
  padding: 1.5rem;
  max-width: 320px;
  width: 100%;
}
.admin-pw-dialog h2 { margin: 0 0 1rem; font-size: 1.05rem; text-align: center; }
.admin-pw-dialog input { text-align: center; letter-spacing: 0.15em; margin-bottom: 0.5rem; }
```

- [ ] **Step 4: 管理者ロック制御ロジックを追加する**

`public/app.js:129-131`の以下を:

```javascript
document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => showView(btn.dataset.view));
});
```

次のように置き換える(既存の3行の直後に新規ブロックを追加):

```javascript
document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => showView(btn.dataset.view));
});

// ---------------- 管理者パスワード保護(車両リスト) ----------------
const ADMIN_PASSWORD = 'anzen_kanri';
const ADMIN_UNLOCK_KEY = 'ug_admin_unlocked';

function isAdminUnlocked() {
  return sessionStorage.getItem(ADMIN_UNLOCK_KEY) === '1';
}

function setVehiclesTabVisible(visible) {
  const tabBtn = document.querySelector('.tab-btn[data-view="vehicles"]');
  tabBtn.hidden = !visible;
  if (!visible && document.body.dataset.view === 'vehicles') {
    showView('trip-entry');
  }
}

function openAdminPwOverlay() {
  document.getElementById('adminPwError').textContent = '';
  document.getElementById('adminPwInput').value = '';
  document.getElementById('adminPwOverlay').hidden = false;
  document.getElementById('adminPwInput').focus();
}

function closeAdminPwOverlay() {
  document.getElementById('adminPwOverlay').hidden = true;
}

function confirmAdminPassword() {
  const input = document.getElementById('adminPwInput');
  if (input.value === ADMIN_PASSWORD) {
    sessionStorage.setItem(ADMIN_UNLOCK_KEY, '1');
    closeAdminPwOverlay();
    setVehiclesTabVisible(true);
  } else {
    document.getElementById('adminPwError').textContent = 'パスワードが違います';
    input.value = '';
    input.focus();
  }
}

document.getElementById('adminModeCheck').addEventListener('change', (e) => {
  if (e.target.checked) {
    if (isAdminUnlocked()) {
      setVehiclesTabVisible(true);
      return;
    }
    e.target.checked = false;
    openAdminPwOverlay();
  } else {
    sessionStorage.removeItem(ADMIN_UNLOCK_KEY);
    setVehiclesTabVisible(false);
  }
});
document.getElementById('adminPwConfirmBtn').addEventListener('click', confirmAdminPassword);
document.getElementById('adminPwCancelBtn').addEventListener('click', () => {
  closeAdminPwOverlay();
  document.getElementById('adminModeCheck').checked = false;
});
document.getElementById('adminPwInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); confirmAdminPassword(); }
  if (e.key === 'Escape') { document.getElementById('adminPwCancelBtn').click(); }
});

setVehiclesTabVisible(isAdminUnlocked());
document.getElementById('adminModeCheck').checked = isAdminUnlocked();
```

- [ ] **Step 5: 開発サーバーで動作確認する**

```bash
npm start
```

ブラウザ(またはPlaywrightの`browser_navigate`)で `http://localhost:5174` を開き、以下を確認する(`sessionStorage`は新しいブラウザセッション/シークレットウィンドウで確認するとクリーンな状態から検証できる):

1. ページ読み込み直後、ナビゲーションに「車両リスト」タブが表示されていないこと(「運転記録入力」「運転月報」の2つのみ)。
2. ヘッダーの「管理者」チェックボックスをクリックすると、パスワード入力オーバーレイが表示されること。
3. 間違ったパスワード(例: 「test」)を入力して「解除」を押すと、「パスワードが違います」というエラーメッセージが表示され、オーバーレイは閉じないこと。
4. 正しいパスワード「anzen_kanri」を入力して「解除」を押す(またはEnterキー)と、オーバーレイが閉じ、ナビゲーションに「車両リスト」タブが表示され、そのタブが操作できること。
5. 「管理者」チェックボックスのチェックを外すと、即座に「車両リスト」タブが再び非表示になること。「車両リスト」タブを表示中にチェックを外した場合は、自動的に「運転記録入力」タブに切り替わること。
6. ページをリロードすると、手順5でロックした状態(「車両リスト」タブが非表示、チェックボックスOFF)に戻っていること(`sessionStorage`はリロードでは消えないため、手順4で解除した場合はリロード後も解除されたままであることも合わせて確認する)。
7. オーバーレイ表示中に「キャンセル」ボタン(またはEscapeキー)を押すと、オーバーレイが閉じ、チェックボックスもOFFに戻ること。

Expected: 上記1〜7がすべて確認できる。

- [ ] **Step 6: Commit**

```bash
git add public/index.html public/style.css public/app.js
git commit -m "$(cat <<'EOF'
車両リストをパスワードで保護し、管理者のみ操作・表示できるようにする

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: キャッシュ無効化のためのアセットバージョン更新

**Files:**
- Modify: `public/index.html`(全アセットの`?v=`クエリ)

**Interfaces:**
- Consumes: なし(Task 1〜2で変更した`trip-entry.js`・`style.css`・`app.js`・`index.html`自体が対象)。

- [ ] **Step 1: `?v=`クエリを一括更新する**

実行はリポジトリルート(`public/`の親ディレクトリ)で行う。

```bash
sed -i 's/?v=20260721b/?v=20260722a/g' public/index.html
```

- [ ] **Step 2: 置き換えを確認する**

```bash
grep -c "v=20260722a" public/index.html
```

Expected: `7`(7箇所すべて置き換わっている)。

- [ ] **Step 3: Commit**

```bash
git add public/index.html
git commit -m "$(cat <<'EOF'
給油UI簡素化と管理者パスワード保護の追加に伴いアセットのキャッシュバージョンを更新

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```
