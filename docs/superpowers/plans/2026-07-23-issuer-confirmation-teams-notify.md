# 発行者確認イベント(Teams通知連携) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 月末の日常点検が完了した瞬間に自動的にMicrosoft Teamsへ通知を送り、発行者がその通知のリンクから運転月報を開いて内容を確認し、「確認しました」ボタン一つで発行者欄(確認日+車両管理者の苗字)を記入できるようにする。

**Architecture:** 月報レコードに`issuerConfirmedAt`という新しいメタ情報を追加し、既存のFirebase同期の仕組み(`buildMetaPayload`/`syncMonthlyLogFromCloud`)にそのまま乗せる。月末点検の保存(既存の仕組み、`trip-entry.js`)をトリガーに、Microsoft Teamsのワークフロー(Webhook)へ素の`fetch()`でメッセージを送信する。通知には運転月報への直接リンク(新しいURLパラメータ)を含め、`app.js`の起動処理でそのリンクを解決する。運転月報画面(`report.js`)には、月末点検完了後・未確認の場合のみ「確認しました」ボタンを表示し、押すと発行者欄に確認日・車両管理者の苗字を自動表示する。

**Tech Stack:** 素の`fetch()`(Microsoft Teamsワークフローへの通知、既存のFirebase呼び出しと同じ方式)。JavaScript・CSSのみ、新規ライブラリの追加無し。

## Global Constraints

- Teams通知は、月末点検(`checklistEnd`)の保存が完了した瞬間にのみ自動的に送信する。15日点検(`checklistMid`)では送信しない。運転者側の操作は従来通りで、追加の操作は発生しない。
- Teams通知の送信は一回きりのfire-and-forgetとし、失敗時の自動リトライは行わない。
- Teams通知のWebhook URLは`storage.js`に定数として埋め込む。このリポジトリは公開設定のため、このURLも第三者から閲覧可能になる点はユーザー確認済みで、そのリスクを許容して進める。実際のURLは以下の通り(既にユーザーが作成・テスト送信済みの本物のURL):
  `https://defaultf7665abfef6f4427bda03700cd1928.70.environment.api.powerplatform.com:443/powerautomate/automations/direct/cu/25/workflows/8e6b8aa3a4e24d6b98db15901c7b1cdd/triggers/manual/paths/invoke?api-version=1&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=JiF36FqrgyE5Rzw1FyMQz5zxHz52wCN-zOAuSEJNzd4`
  送信するJSON本文の形式は`{"text": "..."}`で、実際にこの形式でテスト送信しHTTP 202(受理)を確認済み。
- 運転月報への直接リンクは、新しいURLパラメータ`?reportVehicle=<車両ID>&reportYear=<年>&reportMonth=<月>`を使う。既存のQRコード用`?vehicle=`パラメータとは別名のため、互いに干渉しない。
- 押印欄(3列テーブル、`.print-stamp-table`)のうち「安全運転管理者」「副安全運転管理者」の2列(1・2列目)は、引き続き印刷・PDF出力時のみ表示される空欄の押印欄のまま変更しない。「発行者」列(3列目)のみ、画面プレビュー・印刷の両方で常に表示する。3列とも23mm角のセルサイズは変更しない。
- 発行者欄の確認日の表示形式は「yy/m/d」(例: 26/7/31、2桁年・0埋め無しの月日)。
- 発行者欄に表示する車両管理者名は、姓のみ(既存の`vehicleManager`フィールドの値を全角/半角スペースで区切った最初の部分)。
- 発行者確認後に確認を取り消す・修正する機能は設けない(一度きりの操作)。
- 「安全運転管理者」「副安全運転管理者」欄の同様のデジタル化は今回のスコープ外。
- 全てのコマンドは `C:\Users\shar1\unten-geppo-webapp\.claude\worktrees\qr-vehicle-select` (ブランチ `worktree-qr-vehicle-select`) で実行すること。コミット操作を含む全コマンドの直前・直後に `git rev-parse --show-toplevel` と `git branch --show-current` で確認する。
- 実際に稼働中のFirebase(車両マスタ・運転記録)には実データが入っている。動作確認で作るテスト用データは、必ず自分で名付けた識別可能な車両・日付のものに限定し、他人の実データには一切触れないこと。

---

### Task 1: storage.js — データモデル追加・Teams通知送信関数

**Files:**
- Modify: `public/storage.js:151-169`(`createEmptyMonthlyLog`)
- Modify: `public/storage.js:222-232`(`buildMetaPayload`)
- Modify: `public/storage.js:362-372`(`syncMonthlyLogFromCloud`のmetaマージ処理)
- Modify: `public/storage.js:380-381`(新セクションの追加箇所)
- Test: `.superpowers/sdd/test-issuer-confirm-storage.js`(Node.jsで実行する使い捨て検証スクリプト。コミット対象外)

**Interfaces:**
- Consumes: なし(既存の`buildMetaPayload`・`syncMonthlyLogFromCloud`・`createEmptyMonthlyLog`を拡張する)
- Produces(以降のタスクが使う):
  - `TEAMS_WEBHOOK_URL`(定数、文字列)
  - `sendTeamsNotification(text)` — 指定した文字列をTeamsへfire-and-forgetで送信する。戻り値は使わない。
  - `surnameOf(fullName)` → 文字列。姓(全角/半角スペース区切りの最初の部分)を返す。スペースが無ければ全体をそのまま返す。空/nullなら空文字列。
  - `formatShortDate(isoString)` → 文字列。`isoString`を「yy/m/d」形式に整形する。空/nullなら空文字列。
  - 月報レコードに`issuerConfirmedAt`(文字列またはnull)フィールドが追加される。

- [ ] **Step 1: `createEmptyMonthlyLog`に`issuerConfirmedAt`フィールドを追加する**

現在の内容(`public/storage.js:151-169`):
```javascript
function createEmptyMonthlyLog(vehicleRef, year, month, meta = {}) {
  const days = {};
  for (let d = 1; d <= 31; d++) {
    days[d] = { meterReading: null, destination: '', driver: '', alcoholCheck: null, fuelAdded: null, updatedAt: null, updatedBy: null };
  }
  return {
    key: monthlyLogKey(vehicleRef, year, month),
    vehicleId: meta.vehicleId ?? null,
    privateCarLabel: meta.privateCarLabel ?? null,
    year, month,
    days,
    // 項目文言はFIXED_CHECKLIST_ITEMSから表示時に都度参照する(ここではresultだけ保持する)。
    // レコードに文言を焼き込まないことで、将来文言を直しても既存データの表示が自動的に追従する。
    checklistMid: FIXED_CHECKLIST_ITEMS.map(() => ({ result: null })),
    checklistEnd: FIXED_CHECKLIST_ITEMS.map(() => ({ result: null })),
    metaUpdatedAt: null,
    updatedAt: new Date().toISOString()
  };
}
```

置き換え後(`issuerConfirmedAt: null,`を`checklistEnd`の直後に追加):
```javascript
function createEmptyMonthlyLog(vehicleRef, year, month, meta = {}) {
  const days = {};
  for (let d = 1; d <= 31; d++) {
    days[d] = { meterReading: null, destination: '', driver: '', alcoholCheck: null, fuelAdded: null, updatedAt: null, updatedBy: null };
  }
  return {
    key: monthlyLogKey(vehicleRef, year, month),
    vehicleId: meta.vehicleId ?? null,
    privateCarLabel: meta.privateCarLabel ?? null,
    year, month,
    days,
    // 項目文言はFIXED_CHECKLIST_ITEMSから表示時に都度参照する(ここではresultだけ保持する)。
    // レコードに文言を焼き込まないことで、将来文言を直しても既存データの表示が自動的に追従する。
    checklistMid: FIXED_CHECKLIST_ITEMS.map(() => ({ result: null })),
    checklistEnd: FIXED_CHECKLIST_ITEMS.map(() => ({ result: null })),
    issuerConfirmedAt: null,
    metaUpdatedAt: null,
    updatedAt: new Date().toISOString()
  };
}
```

- [ ] **Step 2: `buildMetaPayload`に`issuerConfirmedAt`を含める**

現在の内容(`public/storage.js:222-232`):
```javascript
function buildMetaPayload(record) {
  return {
    vehicleId: record.vehicleId,
    privateCarLabel: record.privateCarLabel,
    year: record.year,
    month: record.month,
    checklistMid: record.checklistMid,
    checklistEnd: record.checklistEnd,
    updatedAt: record.metaUpdatedAt
  };
}
```

置き換え後:
```javascript
function buildMetaPayload(record) {
  return {
    vehicleId: record.vehicleId,
    privateCarLabel: record.privateCarLabel,
    year: record.year,
    month: record.month,
    checklistMid: record.checklistMid,
    checklistEnd: record.checklistEnd,
    issuerConfirmedAt: record.issuerConfirmedAt,
    updatedAt: record.metaUpdatedAt
  };
}
```

- [ ] **Step 3: `syncMonthlyLogFromCloud`のmetaマージ処理で`issuerConfirmedAt`も反映する**

現在の内容(`public/storage.js:362-372`):
```javascript
  const cloudMeta = cloudData.meta;
  if (cloudMeta) {
    const localTime = local.metaUpdatedAt ? Date.parse(local.metaUpdatedAt) : -Infinity;
    const cloudTime = cloudMeta.updatedAt ? Date.parse(cloudMeta.updatedAt) : -Infinity;
    if (cloudTime > localTime) {
      local.checklistMid = cloudMeta.checklistMid || local.checklistMid;
      local.checklistEnd = cloudMeta.checklistEnd || local.checklistEnd;
      local.metaUpdatedAt = cloudMeta.updatedAt;
      changed = true;
    }
  }
```

置き換え後(`local.issuerConfirmedAt = cloudMeta.issuerConfirmedAt ?? local.issuerConfirmedAt;`を追加):
```javascript
  const cloudMeta = cloudData.meta;
  if (cloudMeta) {
    const localTime = local.metaUpdatedAt ? Date.parse(local.metaUpdatedAt) : -Infinity;
    const cloudTime = cloudMeta.updatedAt ? Date.parse(cloudMeta.updatedAt) : -Infinity;
    if (cloudTime > localTime) {
      local.checklistMid = cloudMeta.checklistMid || local.checklistMid;
      local.checklistEnd = cloudMeta.checklistEnd || local.checklistEnd;
      local.issuerConfirmedAt = cloudMeta.issuerConfirmedAt ?? local.issuerConfirmedAt;
      local.metaUpdatedAt = cloudMeta.updatedAt;
      changed = true;
    }
  }
```

- [ ] **Step 4: Teams通知セクションを新規追加する**

`public/storage.js`の現在の内容(380-381行目付近、`syncMonthlyLogFromCloud`関数の終わりと`// ---------------- 日常点検イベント(15日・月末点検) ----------------`コメントの間):
```javascript
  if (changed) {
    writeMonthlyLogRaw(local);
    return local;
  }
  return null;
}

// ---------------- 日常点検イベント(15日・月末点検) ----------------
```

この間に、以下の新しいセクションを挿入する:
```javascript
  if (changed) {
    writeMonthlyLogRaw(local);
    return local;
  }
  return null;
}

// ---------------- 発行者確認イベント(Teams通知連携) ----------------
// Microsoft Teamsのワークフロー(Webhook)のURL。このリポジトリは公開設定のため、
// このURLも第三者から閲覧可能な状態になるが、既存のFIREBASE_DB_URL・ADMIN_PASSWORDと
// 同じ考え方で許容する(ユーザー確認済み)。
const TEAMS_WEBHOOK_URL = 'https://defaultf7665abfef6f4427bda03700cd1928.70.environment.api.powerplatform.com:443/powerautomate/automations/direct/cu/25/workflows/8e6b8aa3a4e24d6b98db15901c7b1cdd/triggers/manual/paths/invoke?api-version=1&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=JiF36FqrgyE5Rzw1FyMQz5zxHz52wCN-zOAuSEJNzd4';

// 送信結果を待たない一回きりのfire-and-forget通知。失敗してもリトライしない
// (失敗しても運転月報画面の確認バナーが引き続き案内役になるため)。
function sendTeamsNotification(text) {
  fetch(TEAMS_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text })
  }).catch(() => {});
}

// フルネーム(姓　名、全角/半角スペース区切り)から姓だけを取り出す。
// スペースが無ければ文字列全体をそのまま返す。
function surnameOf(fullName) {
  const trimmed = String(fullName ?? '').trim();
  if (!trimmed) return '';
  return trimmed.split(/[\s　]+/)[0];
}

// ISO日時文字列を「yy/m/d」形式(例: 26/7/31)に整形する。
function formatShortDate(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  const yy = String(d.getFullYear()).slice(-2);
  return `${yy}/${d.getMonth() + 1}/${d.getDate()}`;
}

// ---------------- 日常点検イベント(15日・月末点検) ----------------
```

- [ ] **Step 5: 検証スクリプトを作成する**

`.superpowers/sdd/test-issuer-confirm-storage.js`を新規作成する(このファイルは`.superpowers/sdd/.gitignore`により既にgit管理外):

```javascript
// storage.jsの発行者確認・Teams通知まわりの追加ロジックをNode.jsで実行して検証する
// 使い捨てスクリプト。既存のtest-log-sync.jsと同じ手法(localStorage/fetchをスタブして
// storage.jsをevalし、関数を直接呼ぶ)を使う。
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

let fetchCalls = [];
let fetchImpl = async (url) => { fetchCalls.push({ url }); return { ok: true, json: async () => null }; };
global.fetch = (...args) => fetchImpl(...args);

const storageSource = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'storage.js'), 'utf8');
// eslint-disable-next-line no-eval
eval(storageSource);

function resetStorage() {
  global.localStorage.store.clear();
  fetchCalls = [];
}

async function run() {
  // --- surnameOf: 全角/半角スペース区切りの姓を取り出す ---
  assert.strictEqual(surnameOf('雄電　太郎'), '雄電');
  assert.strictEqual(surnameOf('品川 旗郎'), '品川');
  assert.strictEqual(surnameOf('単一名'), '単一名');
  assert.strictEqual(surnameOf(''), '');
  assert.strictEqual(surnameOf(null), '');
  console.log('OK: surnameOf');

  // --- formatShortDate: yy/m/d形式 ---
  const d = new Date('2026-07-31T09:00:00.000Z');
  const expected = `${String(d.getFullYear()).slice(-2)}/${d.getMonth() + 1}/${d.getDate()}`;
  assert.strictEqual(formatShortDate('2026-07-31T09:00:00.000Z'), expected);
  assert.strictEqual(formatShortDate(null), '');
  assert.strictEqual(formatShortDate(''), '');
  console.log('OK: formatShortDate');

  // --- buildMetaPayload: issuerConfirmedAtを含む ---
  resetStorage();
  const rec1 = createEmptyMonthlyLog('veh-a', 2026, 7, { vehicleId: 'veh-a' });
  rec1.issuerConfirmedAt = '2026-07-31T10:00:00.000Z';
  const payload = buildMetaPayload(rec1);
  assert.strictEqual(payload.issuerConfirmedAt, '2026-07-31T10:00:00.000Z');
  console.log('OK: buildMetaPayload includes issuerConfirmedAt');

  // --- syncMonthlyLogFromCloud: クラウド側のissuerConfirmedAtがマージされる ---
  resetStorage();
  const rec2 = createEmptyMonthlyLog('veh-b', 2026, 7, { vehicleId: 'veh-b' });
  writeMonthlyLogRaw(rec2);
  fetchImpl = async () => ({
    ok: true,
    json: async () => ({
      meta: { checklistEnd: [{ result: '○' }], issuerConfirmedAt: '2026-07-31T12:00:00.000Z', updatedAt: '2026-07-31T12:00:00.000Z' }
    })
  });
  const merged = await syncMonthlyLogFromCloud('veh-b', 2026, 7, { vehicleId: 'veh-b' });
  assert.ok(merged, 'cloud meta should be applied');
  assert.strictEqual(merged.issuerConfirmedAt, '2026-07-31T12:00:00.000Z');
  console.log('OK: syncMonthlyLogFromCloud merges issuerConfirmedAt from cloud meta');

  // --- sendTeamsNotification: fetchが正しいURL・本文で呼ばれる ---
  resetStorage();
  fetchImpl = async (url, opts) => { fetchCalls.push({ url, opts }); return { ok: true }; };
  sendTeamsNotification('テストメッセージ');
  await new Promise((r) => setTimeout(r, 0));
  assert.strictEqual(fetchCalls.length, 1);
  assert.strictEqual(fetchCalls[0].url, TEAMS_WEBHOOK_URL);
  assert.strictEqual(fetchCalls[0].opts.method, 'POST');
  assert.strictEqual(JSON.parse(fetchCalls[0].opts.body).text, 'テストメッセージ');
  console.log('OK: sendTeamsNotification posts to the Teams webhook URL with the given text');

  console.log('ALL TESTS PASSED');
}

run().catch((err) => { console.error('TEST FAILED:', err); process.exit(1); });
```

- [ ] **Step 6: 検証スクリプトを実行する**

Run: `node .superpowers/sdd/test-issuer-confirm-storage.js`
Expected: 各`OK: ...`行が出力され、最後に`ALL TESTS PASSED`が出て終了コード0

- [ ] **Step 7: 構文チェック**

Run: `node --check public/storage.js`
Expected: 何も出力されず、終了コード0

- [ ] **Step 8: ブラウザでの動作確認は行わない**

このタスクはヘッドレス環境で実装するため、実ブラウザでの確認は行わない。Step 6・7で十分。コントローラーが後で、実際にMicrosoft Teamsへ通知が届くこと・Firebaseへ`issuerConfirmedAt`が正しく同期されることを確認する。

- [ ] **Step 9: コミット**

```bash
git rev-parse --show-toplevel && git branch --show-current
git add public/storage.js
git commit -m "発行者確認イベント用のissuerConfirmedAtフィールドとTeams通知送信関数を追加する"
git rev-parse --show-toplevel && git branch --show-current
```

(`.superpowers/sdd/test-issuer-confirm-storage.js`は`.superpowers/sdd/.gitignore`により追跡対象外なので`git add`しない)

---

### Task 2: trip-entry.js — 月末点検完了時のTeams通知トリガー

**Files:**
- Modify: `public/trip-entry.js:225-247`(`onChecklistPromptSubmit`)
- Test: `.superpowers/sdd/test-issuer-confirm-trigger.js`(Node.jsで実行する使い捨て検証スクリプト。コミット対象外)

**Interfaces:**
- Consumes: Task 1で追加された`sendTeamsNotification(text)`(`public/storage.js`、`<script>`タグの読み込み順によりグローバルに参照できる)。既存の`loadVehicles()`。
- Produces: `notifyIssuerOfMonthEndChecklist(record)` — 月末点検完了時にTeamsへ通知を送信する関数(このファイル内でのみ使用)

- [ ] **Step 1: `onChecklistPromptSubmit`に月末点検完了時の通知トリガーを追加する**

現在の内容(`public/trip-entry.js:225-247`):
```javascript
function onChecklistPromptSubmit(e) {
  e.preventDefault();
  const pending = tripPendingChecklists[0];
  const fd = new FormData(e.target);
  const results = FIXED_CHECKLIST_ITEMS.map((_, i) => fd.get(`result-${i}`));
  if (results.some((r) => !r)) {
    tripStatusMessage = 'すべての点検項目を選択してください';
    tripStatusIsError = true;
    renderTripEntryView();
    return;
  }
  const record = loadMonthlyLog(pending.vehicleRef, pending.year, pending.month);
  if (record) {
    results.forEach((r, i) => { record[pending.listKey][i].result = r; });
    record.metaUpdatedAt = new Date().toISOString();
    saveMonthlyLog(record);
    syncLogMetaToCloud(record.key, buildMetaPayload(record));
  }
  tripPendingChecklists = tripPendingChecklists.slice(1);
  tripStatusMessage = '点検結果を保存しました';
  tripStatusIsError = false;
  renderTripEntryView();
}
```

置き換え後(月末点検保存時のみ`notifyIssuerOfMonthEndChecklist(record)`を呼ぶ):
```javascript
function onChecklistPromptSubmit(e) {
  e.preventDefault();
  const pending = tripPendingChecklists[0];
  const fd = new FormData(e.target);
  const results = FIXED_CHECKLIST_ITEMS.map((_, i) => fd.get(`result-${i}`));
  if (results.some((r) => !r)) {
    tripStatusMessage = 'すべての点検項目を選択してください';
    tripStatusIsError = true;
    renderTripEntryView();
    return;
  }
  const record = loadMonthlyLog(pending.vehicleRef, pending.year, pending.month);
  if (record) {
    results.forEach((r, i) => { record[pending.listKey][i].result = r; });
    record.metaUpdatedAt = new Date().toISOString();
    saveMonthlyLog(record);
    syncLogMetaToCloud(record.key, buildMetaPayload(record));
    if (pending.listKey === 'checklistEnd') {
      notifyIssuerOfMonthEndChecklist(record);
    }
  }
  tripPendingChecklists = tripPendingChecklists.slice(1);
  tripStatusMessage = '点検結果を保存しました';
  tripStatusIsError = false;
  renderTripEntryView();
}

// 月末点検の完了をTeamsへ通知する(発行者が運転月報を開いて確認できるように)。
// 通知には運転月報への直接リンク(?reportVehicle=&reportYear=&reportMonth=)を含める。
function notifyIssuerOfMonthEndChecklist(record) {
  const vehicles = loadVehicles();
  const vehicle = record.vehicleId ? vehicles.find((v) => v.id === record.vehicleId) : null;
  const vehicleLabel = vehicle
    ? `${vehicle.plateNumber}（${vehicle.nickname || '車種未設定'}）`
    : (record.privateCarLabel || '車両');
  const link = record.vehicleId
    ? `${location.origin}${location.pathname}?reportVehicle=${encodeURIComponent(record.vehicleId)}&reportYear=${record.year}&reportMonth=${record.month}`
    : `${location.origin}${location.pathname}`;
  const text = `[運転管理月報] ${vehicleLabel}の${record.year}年${record.month}月分の月末点検が完了しました。内容をご確認のうえ、発行者欄への確認をお願いします。\n${link}`;
  sendTeamsNotification(text);
}
```

- [ ] **Step 2: 検証スクリプトを作成する**

`.superpowers/sdd/test-issuer-confirm-trigger.js`を新規作成する:

```javascript
// trip-entry.jsのnotifyIssuerOfMonthEndChecklistをNode.jsで実行して検証する
// 使い捨てスクリプト。storage.js→trip-entry.jsの順にevalし、fetchをスタブして
// 実際にTeamsへ送信される内容(URL・本文)を検証する。
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
global.location = { origin: 'https://example.test', pathname: '/unten-geppo-webapp/' };

let fetchCalls = [];
global.fetch = async (url, opts) => { fetchCalls.push({ url, opts }); return { ok: true }; };

const storageSource = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'storage.js'), 'utf8');
// eslint-disable-next-line no-eval
eval(storageSource);
const tripEntrySource = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'trip-entry.js'), 'utf8');
// eslint-disable-next-line no-eval
eval(tripEntrySource);

async function run() {
  saveVehicles([{ id: 'veh-c', vehicleType: 'company', plateNumber: '12-34', nickname: 'テスト車', active: true }]);
  const record = createEmptyMonthlyLog('veh-c', 2026, 7, { vehicleId: 'veh-c' });

  notifyIssuerOfMonthEndChecklist(record);
  await new Promise((r) => setTimeout(r, 0));

  assert.strictEqual(fetchCalls.length, 1);
  const body = JSON.parse(fetchCalls[0].opts.body);
  assert.ok(body.text.includes('12-34'), 'message should include the plate number');
  assert.ok(body.text.includes('テスト車'), 'message should include the nickname');
  assert.ok(body.text.includes('2026年7月分'), 'message should include the year/month');
  assert.ok(body.text.includes('https://example.test/unten-geppo-webapp/?reportVehicle=veh-c&reportYear=2026&reportMonth=7'), 'message should include the direct report link');
  console.log('OK: notifyIssuerOfMonthEndChecklist sends a Teams message with vehicle info and a direct link');

  console.log('ALL TESTS PASSED');
}

run().catch((err) => { console.error('TEST FAILED:', err); process.exit(1); });
```

- [ ] **Step 3: 検証スクリプトを実行する**

Run: `node .superpowers/sdd/test-issuer-confirm-trigger.js`
Expected: `OK: ...`行が出力され、最後に`ALL TESTS PASSED`が出て終了コード0

- [ ] **Step 4: 構文チェック**

Run: `node --check public/trip-entry.js`
Expected: 何も出力されず、終了コード0

- [ ] **Step 5: ブラウザでの動作確認は行わない**

このタスクはヘッドレス環境で実装するため、実ブラウザでの確認は行わない。Step 3・4で十分。コントローラーが後で、実際に月末点検を完了させた際にMicrosoft Teamsへ本物の通知が届くことを確認する。

- [ ] **Step 6: コミット**

```bash
git rev-parse --show-toplevel && git branch --show-current
git add public/trip-entry.js
git commit -m "月末点検完了時にMicrosoft Teamsへ自動通知するようにする"
git rev-parse --show-toplevel && git branch --show-current
```

---

### Task 3: app.js — 運転月報への直接リンク(deep link)対応

**Files:**
- Modify: `public/app.js:225-250`(`bootstrapApp`)

**Interfaces:**
- Consumes: `public/report.js`で宣言済みのトップレベル変数`reportSelectedRef`・`reportSelectedYear`・`reportSelectedMonth`(通常の`<script>`タグ読み込みのため、`report.js`より後に読み込まれる`app.js`から直接代入できる。既存の`tripQrVehicleId`と同じパターン)。既存の`showView(name)`。
- Produces: なし

- [ ] **Step 1: `bootstrapApp`に`?reportVehicle=`等のパラメータ解決を追加する**

現在の内容(`public/app.js:225-250`):
```javascript
async function bootstrapApp() {
  await syncVehiclesFromCloud();
  flushPendingLogSync();

  const params = new URLSearchParams(location.search);
  const qrVehicleId = params.get('vehicle');
  if (qrVehicleId) {
    const vehicles = loadVehicles().filter((v) => v.active !== false);
    const matched = vehicles.find((v) => v.id === qrVehicleId);
    if (matched) {
      tripUsePrivateCar = matched.vehicleType === 'private';
      tripQrVehicleId = qrVehicleId;
    } else {
      tripUsePrivateCar = false;
      tripStatusMessage = 'QRコードに対応する車両が見つかりませんでした。車両を選び直してください';
      tripStatusIsError = true;
    }
    history.replaceState(null, '', location.pathname);
  }

  // 同期待ちの間にユーザーが別タブ(運転月報など)を手動でクリックしていた場合、
  // それを上書きして運転記録入力に戻さないようにするためのガード
  if (!document.body.dataset.view) {
    showView('trip-entry');
  }
}
```

置き換え後(`?reportVehicle=&reportYear=&reportMonth=`を解決し、指定があれば運転月報を直接開く):
```javascript
async function bootstrapApp() {
  await syncVehiclesFromCloud();
  flushPendingLogSync();

  const params = new URLSearchParams(location.search);
  const qrVehicleId = params.get('vehicle');
  if (qrVehicleId) {
    const vehicles = loadVehicles().filter((v) => v.active !== false);
    const matched = vehicles.find((v) => v.id === qrVehicleId);
    if (matched) {
      tripUsePrivateCar = matched.vehicleType === 'private';
      tripQrVehicleId = qrVehicleId;
    } else {
      tripUsePrivateCar = false;
      tripStatusMessage = 'QRコードに対応する車両が見つかりませんでした。車両を選び直してください';
      tripStatusIsError = true;
    }
    history.replaceState(null, '', location.pathname);
  }

  // Teams通知のリンクから開いた場合、該当の車両・年月を選択した状態で
  // 運転月報を自動的に開く(発行者確認イベント用)。
  const reportVehicleId = params.get('reportVehicle');
  const reportYearParam = params.get('reportYear');
  const reportMonthParam = params.get('reportMonth');
  let openReportDirectly = false;
  if (reportVehicleId && reportYearParam && reportMonthParam) {
    reportSelectedRef = reportVehicleId;
    reportSelectedYear = Number(reportYearParam);
    reportSelectedMonth = Number(reportMonthParam);
    openReportDirectly = true;
    history.replaceState(null, '', location.pathname);
  }

  // 同期待ちの間にユーザーが別タブ(運転月報など)を手動でクリックしていた場合、
  // それを上書きして運転記録入力に戻さないようにするためのガード
  if (!document.body.dataset.view) {
    showView(openReportDirectly ? 'report' : 'trip-entry');
  }
}
```

- [ ] **Step 2: 構文チェックと追加箇所の確認**

Run: `node --check public/app.js`
Expected: 何も出力されず、終了コード0

Run: `grep -n "reportVehicle\|reportYear\|reportMonth\|openReportDirectly" public/app.js`
Expected: 複数行(パラメータ取得・条件分岐・`showView`呼び出しの各行)がヒットする

- [ ] **Step 3: ブラウザでの動作確認は行わない**

このタスクはヘッドレス環境で実装するため、実ブラウザでの確認は行わない。Step 2で十分。コントローラーが後で、実際に`?reportVehicle=<ID>&reportYear=<年>&reportMonth=<月>`付きのURLを開き、該当の車両・年月を選択した状態で運転月報タブが自動的に開くことを確認する。

- [ ] **Step 4: コミット**

```bash
git rev-parse --show-toplevel && git branch --show-current
git add public/app.js
git commit -m "Teams通知のリンクから運転月報を直接開けるようにする(?reportVehicle=対応)"
git rev-parse --show-toplevel && git branch --show-current
```

---

### Task 4: report.js・style.css — 発行者確認バナー・発行者欄の自動記入

**Files:**
- Modify: `public/report.js:129-131`(`renderReportView`内、確認バナーの挿入箇所)
- Modify: `public/report.js:169-173`(`print-stamp-table`の発行者欄データセル)
- Modify: `public/report.js:194`付近(`renderReportView`内、確認ボタンのイベント登録)
- Modify: `public/style.css:273-291`(印刷用スタイルのセクション)
- Modify: `public/style.css`(パネル用スタイルのセクション、`.issuer-confirm-panel`の追加)

**Interfaces:**
- Consumes: Task 1で追加された`isChecklistComplete`(既存、`public/storage.js`)・`formatShortDate`・`surnameOf`・`buildMetaPayload`・`syncLogMetaToCloud`(既存)。既存の`vehicleManager`変数(`renderReportView`内で既に計算済み)。
- Produces: なし

- [ ] **Step 1: `renderReportView`に発行者確認バナーを追加する**

現在の内容(`public/report.js:129-131`):
```javascript
      <p class="status ${reportStatusIsError ? 'error' : 'ok'}">${reportStatusMessage}</p>
      ${reportImportConflicts ? logConflictPanelHtml(reportImportConflicts.conflicts) : ''}
    </div>
```

置き換え後(月末点検完了済み・未確認の場合のみバナーを表示する):
```javascript
      <p class="status ${reportStatusIsError ? 'error' : 'ok'}">${reportStatusMessage}</p>
      ${(!record.issuerConfirmedAt && isChecklistComplete(record.checklistEnd)) ? `
        <div class="issuer-confirm-panel no-print">
          <p>月末点検が完了しました。内容をご確認のうえ、発行者欄にご記入ください。</p>
          <button class="btn btn-primary" type="button" id="issuerConfirmBtn">確認しました</button>
        </div>
      ` : ''}
      ${reportImportConflicts ? logConflictPanelHtml(reportImportConflicts.conflicts) : ''}
    </div>
```

- [ ] **Step 2: 押印欄(`print-stamp-table`)の発行者欄データセルに確認日・車両管理者の苗字を表示する**

現在の内容(`public/report.js:169-173`):
```javascript
          <tr>
            <td></td>
            <td></td>
            <td></td>
          </tr>
        </table>
```

置き換え後:
```javascript
          <tr>
            <td></td>
            <td></td>
            <td>${record.issuerConfirmedAt ? `${escapeHtml(formatShortDate(record.issuerConfirmedAt))}<br>${escapeHtml(surnameOf(vehicleManager))}` : ''}</td>
          </tr>
        </table>
```

- [ ] **Step 3: 「確認しました」ボタンのイベントリスナーを追加する**

現在の内容(`public/report.js`、`reportPrintBtn`のイベント登録行):
```javascript
  document.getElementById('reportPrintBtn').addEventListener('click', () => window.print());
```

置き換え後(直後に確認ボタンのリスナーを追加):
```javascript
  document.getElementById('reportPrintBtn').addEventListener('click', () => window.print());
  const issuerConfirmBtnEl = document.getElementById('issuerConfirmBtn');
  if (issuerConfirmBtnEl) {
    issuerConfirmBtnEl.addEventListener('click', () => {
      record.issuerConfirmedAt = new Date().toISOString();
      record.metaUpdatedAt = new Date().toISOString();
      saveMonthlyLog(record);
      syncLogMetaToCloud(record.key, buildMetaPayload(record));
      renderReportView();
    });
  }
```

- [ ] **Step 4: `style.css`の押印欄CSSを列単位の表示制御に変更する**

現在の内容(`public/style.css:273-291`):
```css
/* --- 印刷(A4・サンプルExcelの余白に合わせる) --- */
@page { size: A4 portrait; margin: 19mm 8mm 19mm 13mm; }
.print-page-number { display: none; }
.print-stamp-table { display: none; width: auto; margin-left: auto; margin-bottom: 0; table-layout: fixed; }
.print-stamp-table td { height: 23mm; }
@media print {
  .no-print { display: none !important; }
  body { background: #fff; }
  main { padding: 0; max-width: none; }
  .view { display: none; }
  .view.active { display: block; }
  .report-sheet { border: none; padding: 0; }
  .report-table { font-size: 9.5pt; }
  .report-table th, .report-table td { padding: 0.15rem 0.4rem; }
  .report-header { font-size: 9.5pt; }
  .report-page2 { break-before: page; page-break-before: always; }
  .print-page-number { display: block; text-align: center; font-size: 0.8rem; margin-top: 0.2rem; }
  .print-stamp-table { display: table; }
}
```

置き換え後(`print-stamp-table`自体は常に表示し、1・2列目〈安全運転管理者・副安全運転管理者〉だけを画面上で非表示・印刷時のみ表示する):
```css
/* --- 印刷(A4・サンプルExcelの余白に合わせる) --- */
@page { size: A4 portrait; margin: 19mm 8mm 19mm 13mm; }
.print-page-number { display: none; }
.print-stamp-table { width: auto; margin-left: auto; margin-bottom: 0; table-layout: fixed; }
.print-stamp-table td { height: 23mm; }
/* 安全運転管理者・副安全運転管理者(1・2列目)は引き続き印刷時のみの空欄押印欄。
   発行者列(3列目)は発行者確認の内容を常に表示するため、この2列だけを画面上で隠す。 */
.print-stamp-table th:nth-child(1), .print-stamp-table td:nth-child(1),
.print-stamp-table th:nth-child(2), .print-stamp-table td:nth-child(2) {
  display: none;
}
@media print {
  .no-print { display: none !important; }
  body { background: #fff; }
  main { padding: 0; max-width: none; }
  .view { display: none; }
  .view.active { display: block; }
  .report-sheet { border: none; padding: 0; }
  .report-table { font-size: 9.5pt; }
  .report-table th, .report-table td { padding: 0.15rem 0.4rem; }
  .report-header { font-size: 9.5pt; }
  .report-page2 { break-before: page; page-break-before: always; }
  .print-page-number { display: block; text-align: center; font-size: 0.8rem; margin-top: 0.2rem; }
  .print-stamp-table th:nth-child(1), .print-stamp-table td:nth-child(1),
  .print-stamp-table th:nth-child(2), .print-stamp-table td:nth-child(2) {
    display: table-cell;
  }
}
```

- [ ] **Step 5: 発行者確認バナー用のスタイルを追加する**

`public/style.css`の`.conflict-panel`関連スタイルの直後(`.conflict-choice { display: flex; gap: 0.4rem; align-items: center; }`の行の直後)に、以下を追加する:
```css
.issuer-confirm-panel { display: flex; align-items: center; justify-content: space-between; gap: 1rem; flex-wrap: wrap; border: 1px solid var(--accent); background: #eef4ff; border-radius: 8px; padding: 1rem; margin-bottom: 1rem; }
.issuer-confirm-panel p { margin: 0; }
```

- [ ] **Step 6: 構文チェックと追加箇所の確認**

Run: `node --check public/report.js`
Expected: 何も出力されず、終了コード0

Run: `grep -n "issuerConfirmBtn\|issuer-confirm-panel\|issuerConfirmedAt" public/report.js`
Expected: 複数行(バナーHTML・データセル・イベントリスナーの各行)がヒットする

Run: `grep -n "issuer-confirm-panel\|nth-child(1)\|nth-child(2)" public/style.css`
Expected: 複数行(パネルスタイル・画面非表示ルール・印刷時表示ルールの各行)がヒットする

- [ ] **Step 7: ブラウザでの動作確認は行わない**

このタスクはヘッドレス環境で実装するため、実ブラウザでの確認は行わない。Step 6で十分。コントローラーが後でPlaywrightを使い、(a)月末点検完了済み・未確認の月報を開くとバナーが表示されること、(b)「確認しました」を押すとバナーが消え発行者欄に確認日・車両管理者の苗字が表示されること、(c)これが画面プレビュー・印刷メディアエミュレーションの両方で表示されること、(d)安全運転管理者・副安全運転管理者の2列は引き続き画面では非表示・印刷時のみ表示されることを確認する。

- [ ] **Step 8: コミット**

```bash
git rev-parse --show-toplevel && git branch --show-current
git add public/report.js public/style.css
git commit -m "運転月報に発行者確認バナーと発行者欄の自動記入を追加する"
git rev-parse --show-toplevel && git branch --show-current
```

---

### Task 5: キャッシュバージョンの更新(20260722m → 20260722n)

**Files:**
- Modify: `public/index.html`(全ての`?v=20260722m`を`?v=20260722n`に置換)

**Interfaces:**
- Consumes: なし
- Produces: なし(最終タスク)

- [ ] **Step 1: 現在のバージョン文字列の出現数を確認する**

Run: `grep -c 'v=20260722m' public/index.html`
Expected: `9`

- [ ] **Step 2: バージョン文字列を一括置換する**

Run: `sed -i 's/?v=20260722m/?v=20260722n/g' public/index.html`

- [ ] **Step 3: 置換後の出現数を確認する**

Run: `grep -c 'v=20260722n' public/index.html`
Expected: `9`

Run: `grep -c 'v=20260722m' public/index.html`
Expected: `0`(または該当なしでエラー終了。どちらでも「残っていない」ことが確認できればよい)

- [ ] **Step 4: コミット**

```bash
git rev-parse --show-toplevel && git branch --show-current
git add public/index.html
git commit -m "アセットのキャッシュバージョンを20260722nに更新する"
git rev-parse --show-toplevel && git branch --show-current
```
