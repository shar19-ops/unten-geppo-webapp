# 運転記録入力の既存データ編集 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 運転記録入力画面で、選択中の車両・日付に既に記録があれば入力欄へ自動的に反映し、その場で修正して保存できるようにする。

**Architecture:** `trip-entry.js`に「現在選択中の日付/車両ID」を保持するモジュール変数を追加し、日付欄・車両選択の`change`イベントで再描画をトリガーする。再描画のたびに、選択中の車両・日付の組み合わせに既存データがあるかを調べ、あれば入力欄へ反映して注記を表示する。保存時の「上書きしますか?」確認は廃止する。

**Tech Stack:** 素のDOM操作(フレームワーク・ビルド無し)。既存の`public/storage.js`のデータアクセス関数(`loadMonthlyLog`/`vehicleRefFor`/`dayHasData`/`todayIso`)を利用する。

## Global Constraints

- 対象は運転記録入力欄(出庫時メーター指針・行先・運転者・アルコールチェック)のみ。給油入力欄(給油量)は変更しない。
- 車両・日付のいずれかを変更した瞬間(初回表示時の既定日付=今日を含む)に、既存データがあれば自動的に入力欄へ反映する。
- 既存データがある場合のみ、フォーム上部に「この日は既に入力済みです。内容を修正して保存できます」という注記を表示する。新規入力時は何も表示しない。
- 保存ボタンの文言(「この記録を保存」)は変えない。
- 保存時の「既に入力済みです。上書きしますか?」という確認ポップアップ(`confirm(...)`)は廃止する。`saveTripDay`のマージ挙動自体は変更しない。
- 保存成功後は、選択中の日付を今日の日付に、選択中の車両IDを未選択(一覧の先頭に従う)に戻す(既存の「保存後は今日に戻る」という挙動を維持する)。
- 運転月報画面(`report.js`)や、既存のExcel/JSON手動取込・競合解決機能への変更は行わない。
- QRコードで車両が固定されている場合の全体挙動は変更しない。QR固定車両であっても、既存データの自動反映・修正は同様に働く。
- 全てのコマンドは `C:\Users\shar1\unten-geppo-webapp\.claude\worktrees\qr-vehicle-select` (ブランチ `worktree-qr-vehicle-select`) で実行すること。コミット操作を含む全コマンドの直前・直後に `git rev-parse --show-toplevel` と `git branch --show-current` で確認する。
- 実際に稼働中のFirebase(車両マスタ・運転記録)には実データが入っている。動作確認で作るテスト用データは、必ず自分で名付けた識別可能な車両・日付のものに限定し、他人の実データには一切触れないこと。

---

### Task 1: trip-entry.js — 既存データの自動反映・修正機能

**Files:**
- Modify: `public/trip-entry.js`(全体。既存337行のうち複数箇所を変更)
- Test: `.superpowers/sdd/test-trip-entry-prefill.js`(Node.jsで実行する使い捨て検証スクリプト。コミット対象外 — `.superpowers/sdd/`はgit管理外)

**Interfaces:**
- Consumes: `public/storage.js`の`loadMonthlyLog(vehicleRef, year, month)`・`vehicleRefFor(vehicleId, privateCarLabel)`・`dayHasData(day)`・`todayIso()`・`escapeHtml(value)`(すべて既存、変更なし)
- Produces: `findExistingDayData(vehicleId, dateStr)` → 該当日のデータオブジェクト(存在すれば)または`null`。`tripSelectedDate`(現在選択中の日付文字列)・`tripSelectedVehicleId`(現在選択中の車両IDまたはnull)という2つのモジュール変数(このファイル内でのみ使用)

- [ ] **Step 1: `findExistingDayData`のテストを書く**

`.superpowers/sdd/test-trip-entry-prefill.js`を新規作成する:

```javascript
// findExistingDayDataの動作をNode.jsで実行して検証する使い捨てスクリプト。
// ブラウザのlocalStorage/fetchをスタブしてstorage.js→trip-entry.jsの順にevalし、
// 関数を直接呼ぶ(いずれのファイルもトップレベルでDOMに触れないため安全に評価できる)。
const fs = require('fs');
const path = require('path');
const assert = require('assert');

class LocalStorageStub {
  constructor() { this.store = new Map(); }
  getItem(k) { return this.store.has(k) ? this.store.get(k) : null; }
  setItem(k, v) { this.store.set(k, String(v)); }
  removeItem(k) { this.store.delete(k); }
}

global.localStorage = new LocalStorageStub();
global.crypto = { randomUUID: () => require('crypto').randomUUID() };
global.window = { crypto: global.crypto };
global.fetch = () => Promise.reject(new Error('fetch should not be called in this test'));

const storageSource = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'storage.js'), 'utf8');
// eslint-disable-next-line no-eval
eval(storageSource);
const tripEntrySource = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'trip-entry.js'), 'utf8');
// eslint-disable-next-line no-eval
eval(tripEntrySource);

function run() {
  // --- 車両ID・日付が未指定なら常にnull ---
  assert.strictEqual(findExistingDayData(null, '2026-07-23'), null);
  assert.strictEqual(findExistingDayData('veh-a', null), null);
  console.log('OK: findExistingDayData returns null when vehicleId/date missing');

  // --- その日にまだ何も入力されていなければnull ---
  assert.strictEqual(findExistingDayData('veh-a', '2026-07-23'), null);
  console.log('OK: findExistingDayData returns null when no data exists for that day');

  // --- 既存データがあればその内容を返す ---
  saveTripDay('veh-a', 2026, 7, 23, { meterReading: 12345, destination: '本社', driver: '田中', alcoholCheck: 0 }, { vehicleId: 'veh-a' });
  const found = findExistingDayData('veh-a', '2026-07-23');
  assert.ok(found, 'existing day data should be found');
  assert.strictEqual(found.meterReading, 12345);
  assert.strictEqual(found.destination, '本社');
  console.log('OK: findExistingDayData returns the existing day data');

  // --- 別の日付・別の車両では既存データとして検出されない ---
  assert.strictEqual(findExistingDayData('veh-a', '2026-07-24'), null);
  assert.strictEqual(findExistingDayData('veh-b', '2026-07-23'), null);
  console.log('OK: findExistingDayData is scoped to the specific vehicle+date');

  console.log('ALL TESTS PASSED');
}

run();
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `node .superpowers/sdd/test-trip-entry-prefill.js`
Expected: `findExistingDayData is not defined` のようなエラーで失敗する(まだ実装していないため)

- [ ] **Step 3: モジュール変数と`findExistingDayData`を追加する**

`public/trip-entry.js`の先頭付近、現在の内容(1-8行目):
```javascript
// 運転記録入力画面(iPhone優先)。データはstorage.js経由(saveTripDay/saveFuelOnly/loadMonthlyLog)。

let tripUsePrivateCar = false;
let tripEntryMode = 'trip'; // 'trip'=運転記録入力 / 'fuel'=給油入力
let tripStatusMessage = '';
let tripStatusIsError = false;
let tripPendingChecklists = []; // 保存直後に発生した点検イベントのキュー({listKey, headerNote, vehicleRef, year, month, day})
let tripQrVehicleId = null; // QR経由で指定された車両ID(未指定/該当なしの場合はnull)
```

置き換え後:
```javascript
// 運転記録入力画面(iPhone優先)。データはstorage.js経由(saveTripDay/saveFuelOnly/loadMonthlyLog)。

let tripUsePrivateCar = false;
let tripEntryMode = 'trip'; // 'trip'=運転記録入力 / 'fuel'=給油入力
let tripStatusMessage = '';
let tripStatusIsError = false;
let tripPendingChecklists = []; // 保存直後に発生した点検イベントのキュー({listKey, headerNote, vehicleRef, year, month, day})
let tripQrVehicleId = null; // QR経由で指定された車両ID(未指定/該当なしの場合はnull)
let tripSelectedDate = todayIso(); // 運転記録入力欄で現在選択中の日付
let tripSelectedVehicleId = null; // 運転記録入力欄で現在選択中の車両ID(未選択ならQRロック車両または一覧の先頭車両に従う)
```

次に、`vehicleSelectFieldHtml`関数の直前(現在59行目の直前)に、以下の関数を新規追加する:

```javascript
// 選択中の車両・日付の組み合わせに既に運転記録があれば、その内容を返す(無ければnull)。
// 運転記録入力欄への自動反映・修正機能のために使う。
function findExistingDayData(vehicleId, dateStr) {
  if (!vehicleId || !dateStr) return null;
  const [year, month, day] = dateStr.split('-').map(Number);
  const vehicleRef = vehicleRefFor(vehicleId, null);
  const record = loadMonthlyLog(vehicleRef, year, month);
  const dayData = record && record.days && record.days[day];
  return dayHasData(dayData) ? dayData : null;
}
```

- [ ] **Step 4: テストを実行して成功を確認する**

Run: `node .superpowers/sdd/test-trip-entry-prefill.js`
Expected: 各`OK: ...`行が出力され、最後に`ALL TESTS PASSED`が出て終了コード0

- [ ] **Step 5: `vehicleSelectFieldHtml`の車両選択の`selected`判定に`tripSelectedVehicleId`を反映させる**

現在の内容(該当行、フォーマットは実際のファイルを確認して合わせること):
```javascript
        ? `<select name="vehicleId" class="input-lg">
            ${vehicles.map((v) => `<option value="${escapeHtml(v.id)}" ${tripQrVehicleId === v.id ? 'selected' : ''}>${escapeHtml(v.plateNumber)}（${escapeHtml(v.nickname || '車種未設定')}）</option>`).join('')}
          </select>`
```

置き換え後(`tripQrVehicleId === v.id`を`(tripSelectedVehicleId || tripQrVehicleId) === v.id`に変更する。`tripSelectedVehicleId`が設定されていればそちらを優先し、未設定なら従来通り`tripQrVehicleId`にフォールバックする):
```javascript
        ? `<select name="vehicleId" class="input-lg">
            ${vehicles.map((v) => `<option value="${escapeHtml(v.id)}" ${(tripSelectedVehicleId || tripQrVehicleId) === v.id ? 'selected' : ''}>${escapeHtml(v.plateNumber)}（${escapeHtml(v.nickname || '車種未設定')}）</option>`).join('')}
          </select>`
```

- [ ] **Step 6: `tripFormHtml()`を既存データの反映・注記表示に対応させる**

現在の内容(`tripFormHtml`関数全体):
```javascript
function tripFormHtml() {
  const today = new Date().toISOString().slice(0, 10);
  const allVehicles = loadVehicles().filter((v) => v.active !== false);
  const companyVehicles = allVehicles.filter((v) => (v.vehicleType || 'company') !== 'private');
  const privateVehicles = allVehicles.filter((v) => v.vehicleType === 'private');
  const recentDrivers = loadRecentDrivers();

  return `
    <form class="entry-form panel" id="tripEntryForm">
      <h2>運転記録入力</h2>

      ${vehicleSelectFieldHtml(companyVehicles, privateVehicles)}

      <div class="field">
        <label>日付</label>
        <input type="date" name="date" class="input-lg" value="${today}" required>
      </div>

      <div class="field">
        <label>出庫時メーター指針(km)</label>
        <input type="text" name="meterReading" inputmode="decimal" class="input-lg" placeholder="例: 15230">
      </div>

      <div class="field">
        <label>行先</label>
        <input type="text" name="destination" class="input-lg" placeholder="例: 本社 → A社">
      </div>

      <div class="field">
        <label>運転者</label>
        <input type="text" name="driver" class="input-lg" list="recentDrivers" placeholder="運転者名">
        <datalist id="recentDrivers">
          ${recentDrivers.map((d) => `<option value="${d}">`).join('')}
        </datalist>
      </div>

      <div class="field">
        <label>アルコールチェック(mg/L)</label>
        <input type="text" name="alcoholCheck" inputmode="decimal" class="input-lg" placeholder="0">
      </div>

      <button type="submit" class="btn btn-primary btn-block" ${(tripUsePrivateCar ? !privateVehicles.length : !companyVehicles.length) ? 'disabled' : ''}>この記録を保存</button>
      <p class="status ${tripStatusIsError ? 'error' : 'ok'}">${tripStatusMessage}</p>
    </form>
  `;
}
```

置き換え後:
```javascript
function tripFormHtml() {
  const allVehicles = loadVehicles().filter((v) => v.active !== false);
  const companyVehicles = allVehicles.filter((v) => (v.vehicleType || 'company') !== 'private');
  const privateVehicles = allVehicles.filter((v) => v.vehicleType === 'private');
  const recentDrivers = loadRecentDrivers();

  const defaultVehicle = tripUsePrivateCar ? privateVehicles[0] : companyVehicles[0];
  const effectiveVehicleId = tripSelectedVehicleId || tripQrVehicleId || (defaultVehicle ? defaultVehicle.id : null);
  const existingDay = findExistingDayData(effectiveVehicleId, tripSelectedDate);

  return `
    <form class="entry-form panel" id="tripEntryForm">
      <h2>運転記録入力</h2>

      ${existingDay ? '<p class="hint">この日は既に入力済みです。内容を修正して保存できます</p>' : ''}

      ${vehicleSelectFieldHtml(companyVehicles, privateVehicles)}

      <div class="field">
        <label>日付</label>
        <input type="date" name="date" class="input-lg" value="${tripSelectedDate}" required>
      </div>

      <div class="field">
        <label>出庫時メーター指針(km)</label>
        <input type="text" name="meterReading" inputmode="decimal" class="input-lg" placeholder="例: 15230" value="${existingDay && existingDay.meterReading != null ? existingDay.meterReading : ''}">
      </div>

      <div class="field">
        <label>行先</label>
        <input type="text" name="destination" class="input-lg" placeholder="例: 本社 → A社" value="${escapeHtml(existingDay ? existingDay.destination || '' : '')}">
      </div>

      <div class="field">
        <label>運転者</label>
        <input type="text" name="driver" class="input-lg" list="recentDrivers" placeholder="運転者名" value="${escapeHtml(existingDay ? existingDay.driver || '' : '')}">
        <datalist id="recentDrivers">
          ${recentDrivers.map((d) => `<option value="${d}">`).join('')}
        </datalist>
      </div>

      <div class="field">
        <label>アルコールチェック(mg/L)</label>
        <input type="text" name="alcoholCheck" inputmode="decimal" class="input-lg" placeholder="0" value="${existingDay && existingDay.alcoholCheck != null ? existingDay.alcoholCheck : ''}">
      </div>

      <button type="submit" class="btn btn-primary btn-block" ${(tripUsePrivateCar ? !privateVehicles.length : !companyVehicles.length) ? 'disabled' : ''}>この記録を保存</button>
      <p class="status ${tripStatusIsError ? 'error' : 'ok'}">${tripStatusMessage}</p>
    </form>
  `;
}
```

- [ ] **Step 7: 日付欄・車両選択の`change`イベントで再描画するようにする**

現在の内容(`renderTripEntryView`関数内、社有車/私有車の切替ボタンのイベント登録):
```javascript
  root.querySelectorAll('.segmented-btn[data-mode]').forEach((btn) => {
    btn.addEventListener('click', () => {
      tripUsePrivateCar = btn.dataset.mode === 'private';
      tripQrVehicleId = null;
      renderTripEntryView();
    });
  });
```

置き換え後(`tripSelectedVehicleId = null;`を追加する):
```javascript
  root.querySelectorAll('.segmented-btn[data-mode]').forEach((btn) => {
    btn.addEventListener('click', () => {
      tripUsePrivateCar = btn.dataset.mode === 'private';
      tripQrVehicleId = null;
      tripSelectedVehicleId = null;
      renderTripEntryView();
    });
  });
```

続けて、同じ関数内の以下の箇所(運転記録入力モード時のイベント登録):
```javascript
  if (tripEntryMode === 'trip') {
    document.getElementById('tripEntryForm').addEventListener('submit', onTripEntrySubmit);
    const vehicleSelect = document.querySelector('#tripEntryForm select[name="vehicleId"]');
    if (vehicleSelect) {
      vehicleSelect.addEventListener('change', () => { tripQrVehicleId = null; });
    }
  } else {
```

置き換え後(車両選択の変更で再描画するようにし、日付欄の変更イベントも新規追加する):
```javascript
  if (tripEntryMode === 'trip') {
    document.getElementById('tripEntryForm').addEventListener('submit', onTripEntrySubmit);
    const vehicleSelect = document.querySelector('#tripEntryForm select[name="vehicleId"]');
    if (vehicleSelect) {
      vehicleSelect.addEventListener('change', (e) => {
        tripQrVehicleId = null;
        tripSelectedVehicleId = e.target.value;
        renderTripEntryView();
      });
    }
    const dateInput = document.querySelector('#tripEntryForm input[name="date"]');
    if (dateInput) {
      dateInput.addEventListener('change', (e) => {
        tripSelectedDate = e.target.value;
        renderTripEntryView();
      });
    }
  } else {
```

- [ ] **Step 8: `onTripEntrySubmit`から上書き確認ポップアップを削除し、保存成功後に選択状態をリセットする**

現在の内容(`onTripEntrySubmit`関数全体):
```javascript
function onTripEntrySubmit(e) {
  e.preventDefault();
  const fd = new FormData(e.target);
  const dateStr = fd.get('date');
  if (!dateStr) return;
  const [year, month, day] = dateStr.split('-').map(Number);

  const sel = resolveVehicleSelection(fd);
  if (sel.error) {
    tripStatusMessage = sel.error;
    tripStatusIsError = true;
    renderTripEntryView();
    return;
  }
  const { vehicleId, privateCarLabel } = sel;

  const vehicleRef = vehicleRefFor(vehicleId, privateCarLabel);
  const existing = loadMonthlyLog(vehicleRef, year, month);
  if (existing && dayHasData(existing.days && existing.days[day])) {
    const label = vehicleId ? (loadVehicles().find((v) => v.id === vehicleId) || {}).plateNumber : privateCarLabel;
    if (!confirm(`${year}年${month}月${day}日は${label}で既に入力済みです。上書きしますか?`)) return;
  }

  const driver = String(fd.get('driver') || '').trim();
  const dayData = {
    meterReading: parseNumberOrNull(fd.get('meterReading')),
    destination: String(fd.get('destination') || '').trim(),
    driver,
    alcoholCheck: parseNumberOrNull(fd.get('alcoholCheck'))
  };

  const savedRecord = saveTripDay(vehicleRef, year, month, day, dayData, { vehicleId, privateCarLabel, updatedBy: driver });
  syncLogDayToCloud(savedRecord.key, day, savedRecord.days[day]);
  if (driver) pushRecentDriver(driver);

  tripPendingChecklists = checklistEventsDue(savedRecord, day).map((d) => ({ ...d, vehicleRef, year, month, day }));
  tripStatusMessage = `保存しました(${year}年${month}月${day}日)`;
  tripStatusIsError = false;
  renderTripEntryView();
}
```

置き換え後(上書き確認ブロックを削除し、保存成功後の状態リセットを追加する):
```javascript
function onTripEntrySubmit(e) {
  e.preventDefault();
  const fd = new FormData(e.target);
  const dateStr = fd.get('date');
  if (!dateStr) return;
  const [year, month, day] = dateStr.split('-').map(Number);

  const sel = resolveVehicleSelection(fd);
  if (sel.error) {
    tripStatusMessage = sel.error;
    tripStatusIsError = true;
    renderTripEntryView();
    return;
  }
  const { vehicleId, privateCarLabel } = sel;

  const vehicleRef = vehicleRefFor(vehicleId, privateCarLabel);

  const driver = String(fd.get('driver') || '').trim();
  const dayData = {
    meterReading: parseNumberOrNull(fd.get('meterReading')),
    destination: String(fd.get('destination') || '').trim(),
    driver,
    alcoholCheck: parseNumberOrNull(fd.get('alcoholCheck'))
  };

  const savedRecord = saveTripDay(vehicleRef, year, month, day, dayData, { vehicleId, privateCarLabel, updatedBy: driver });
  syncLogDayToCloud(savedRecord.key, day, savedRecord.days[day]);
  if (driver) pushRecentDriver(driver);

  tripPendingChecklists = checklistEventsDue(savedRecord, day).map((d) => ({ ...d, vehicleRef, year, month, day }));
  tripStatusMessage = `保存しました(${year}年${month}月${day}日)`;
  tripStatusIsError = false;
  tripSelectedDate = todayIso();
  tripSelectedVehicleId = null;
  renderTripEntryView();
}
```

- [ ] **Step 9: 構文チェックとテストの再確認**

Run: `node --check public/trip-entry.js`
Expected: 何も出力されず、終了コード0

Run: `node .superpowers/sdd/test-trip-entry-prefill.js`
Expected: 全て`OK: ...`で`ALL TESTS PASSED`、終了コード0(Step 4と同じ内容だが、Step 5〜8の変更後も壊れていないことの再確認)

- [ ] **Step 10: ブラウザでの動作確認は行わない**

このタスクはヘッドレス環境で実装するため、実ブラウザでの確認は行わない。Step 9で十分。コントローラーが後でPlaywrightを使い、(a)日付変更・車両変更のたびに既存データが入力欄へ反映され注記が表示されること、(b)何もない日に切り替えると入力欄が空に戻り注記も消えること、(c)既存データを修正して保存すると上書き確認ポップアップが出ずに保存されること、(d)複数車両がある状態で日付だけを変えても車両選択がリセットされないこと、(e)保存成功後は日付が今日に戻ること、を実際のブラウザ操作で確認する。

- [ ] **Step 11: コミット**

```bash
git rev-parse --show-toplevel && git branch --show-current
git add public/trip-entry.js
git commit -m "運転記録入力で選択中の日付に既存データがあれば入力欄へ自動反映し、その場で修正できるようにする"
git rev-parse --show-toplevel && git branch --show-current
```

(`.superpowers/sdd/test-trip-entry-prefill.js`は`.superpowers/sdd/.gitignore`により追跡対象外なので`git add`しない)

---

### Task 2: キャッシュバージョンの更新(20260722g → 20260722h)

**Files:**
- Modify: `public/index.html`(全ての`?v=20260722g`を`?v=20260722h`に置換)

**Interfaces:**
- Consumes: なし
- Produces: なし(最終タスク)

- [ ] **Step 1: 現在のバージョン文字列の出現数を確認する**

Run: `grep -c 'v=20260722g' public/index.html`
Expected: `9`

- [ ] **Step 2: バージョン文字列を一括置換する**

Run: `sed -i 's/?v=20260722g/?v=20260722h/g' public/index.html`

- [ ] **Step 3: 置換後の出現数を確認する**

Run: `grep -c 'v=20260722h' public/index.html`
Expected: `9`

Run: `grep -c 'v=20260722g' public/index.html`
Expected: `0`(または該当なしでエラー終了。どちらでも「残っていない」ことが確認できればよい)

- [ ] **Step 4: コミット**

```bash
git rev-parse --show-toplevel && git branch --show-current
git add public/index.html
git commit -m "アセットのキャッシュバージョンを20260722hに更新する"
git rev-parse --show-toplevel && git branch --show-current
```
