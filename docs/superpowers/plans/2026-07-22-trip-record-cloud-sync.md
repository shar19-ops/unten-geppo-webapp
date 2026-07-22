# 運転記録・給油記録のFirebase自動同期 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 運転記録入力・給油入力で保存した月報データ(`localStorage`)を、保存直後にFirebase Realtime Databaseへバックグラウンドで自動送信し、運転月報を開いた際にクラウドの最新データを取り込んで表示することで、iPhoneで入力した記録がPCの運転月報にも反映されるようにする。

**Architecture:** 月報データを「日ごと」と「meta(点検結果等)」に分けて`/logs/<key>/days/<day>`・`/logs/<key>/meta`にPUTする。保存は常にローカルを先に完了させ、クラウド送信は失敗してもローカルの未送信キュー(`localStorage`)に積んで後で自動リトライする。運転月報を開いた時だけクラウドから該当月報を取得し、日ごと・meta単位で`updatedAt`の新しい方を採用してローカルへマージする(常時ポーリングはしない)。既存のExcel/JSON手動取込・競合解決機能には触れない。

**Tech Stack:** 素の`fetch()` + Firebase Realtime Database REST API(既存の車両マスタ同期と同じ方式、SDK不使用)。ビルドツールなし。

## Global Constraints

- Firebaseルールは全開放(`{".read":true,".write":true}`)。既存の`FIREBASE_DB_URL`(`public/storage.js`)をそのまま使う。SDKは使わずfetch()のみ。
- 保存操作(ローカルへの書き込み)は電波の有無に関わらず必ず即座に成功させる。クラウド送信はその後のバックグラウンド処理とし、成否をユーザーに個別確認させない。
- クラウド送信リトライは「アプリを開いた(再読み込みした)とき」と「次に何か別の記録を保存したとき」にのみ試みる。常時ポーリング・定期リトライは実装しない。
- 運転月報画面は「開いた時(車両・月を選び直した時を含む)」にのみクラウドから取得する。画面を開いたままの間の自動更新(ポーリング)はしない。
- 日ごとのデータ・meta(点検結果等)は、それぞれの`updatedAt`を比較し新しい方を自動的に採用する。手動の競合解決UIはこの自動同期経路には出さない。
- 既存のExcel/JSON手動取込・競合解決機能(`mergeMonthlyLog`・`logConflictPanelHtml`・`applyLogConflictResolution`・`onReportJsonSelected`)は変更しない。
- 起動時に全車両・全月分のログを一括同期することはしない。閲覧・保存の都度、対象の月報キーだけを同期する。
- 「既に入力済みです。上書きしますか?」という既存のローカルのみの重複確認(`onTripEntrySubmit`内の`confirm(...)`)は変更しない。
- Firebaseルールが全開放であることに伴い、運転月報の日次表(`reportBlock`)の「行先」(`destination`)・「運転者」(`driver`)、日常点検結果表(`checklistBlock`)の結果(`result`)は、既存の`escapeHtml()`(`public/storage.js`)でエスケープしてから表示する。
- 全てのコマンドは `C:\Users\shar1\unten-geppo-webapp\.claude\worktrees\qr-vehicle-select` (ブランチ `worktree-qr-vehicle-select`) で実行すること。コミット操作を含む全コマンドの直前・直後に `git rev-parse --show-toplevel` と `git branch --show-current` で確認する。
- 実際に稼働中のFirebase車両マスタ(`/vehicles.json`)には実データ(実在の車両番号・車両管理者名)が入っている。`pushVehiclesToCloud([])`のような一括上書き関数や、`/logs.json`ルート全体への一括PUT/DELETEは絶対に実行しないこと。動作確認で作るテスト用の月報データは、必ず自分で名付けた識別可能な車両・日付のものに限定し、他人の実データには一切触れないこと。
- タスクはTask 1→2→3→4→5の順に依存している(Task 2/3/4はTask 1が定義する関数を呼ぶ)。並列実行はしない。

---

### Task 1: storage.js — 月報クラウド同期の基盤(saveMonthlyLogの分離・送信・リトライキュー・マージ取得)

**Files:**
- Modify: `public/storage.js:173-206` (既存の`saveMonthlyLog`/`saveTripDay`/`saveFuelOnly`/`listMonthlyLogKeysForVehicle`の直後に新セクションを追加)
- Test: `.superpowers/sdd/test-log-sync.js` (Node.jsで実行する使い捨て検証スクリプト。コミット対象外 — `.superpowers/sdd/`はgit管理外)

**Interfaces:**
- Consumes: 既存の`FIREBASE_DB_URL`、`monthlyLogKey(vehicleRef, year, month)`、`loadMonthlyLog(vehicleRef, year, month)`、`createEmptyMonthlyLog(vehicleRef, year, month, meta)`、`loadLogIndex`/`saveLogIndex`(すべて`public/storage.js`内、既存)
- Produces(以降のタスクが使う):
  - `writeMonthlyLogRaw(record)` — `record.updatedAt`を書き換えずにそのままlocalStorage+インデックスへ保存して`record`を返す
  - `saveMonthlyLog(record)` — 既存と同じ公開シグネチャ・挙動(内部で`updatedAt`を現在時刻にしてから`writeMonthlyLogRaw`を呼ぶだけになる)
  - `buildMetaPayload(record)` — `{vehicleId, privateCarLabel, year, month, checklistMid, checklistEnd, updatedAt}`を返す
  - `pushLogDayToCloud(key, day, dayData)` → `Promise<{ok: boolean}>`
  - `pushLogMetaToCloud(key, metaData)` → `Promise<{ok: boolean}>`
  - `loadPendingLogSync()` / `savePendingLogSync(list)` / `queuePendingLogSync(entry)` / `removePendingLogSync(entry)` — `entry`は`{key, type: 'day'|'meta', day}`(metaの場合`day`は`undefined`)
  - `flushPendingLogSync()` → `Promise<void>` — キュー内の各entryについて現在のローカルレコードを読み直して再送信し、成功したものだけキューから削除する
  - `syncLogDayToCloud(key, day, dayData)` — fire-and-forget。送信し、失敗したらキューに積み、その後`flushPendingLogSync()`を呼ぶ
  - `syncLogMetaToCloud(key, metaData)` — 同上(meta版)
  - `syncMonthlyLogFromCloud(vehicleRef, year, month, meta = {})` → `Promise<record|null>` — クラウドの`days`/`meta`を取得し、ローカルレコード(無ければ`meta`引数で新規シェルを作る)へ日ごと・meta単位で`updatedAt`の新しい方をマージし、何か変わっていれば`writeMonthlyLogRaw`で保存して合成後のレコードを返す。何も変わらなければ`null`を返す。

- [ ] **Step 1: `public/storage.js:173-188`の`saveMonthlyLog`を`writeMonthlyLogRaw`+`saveMonthlyLog`に分離する**

現在の内容(削除対象):
```javascript
function saveMonthlyLog(record) {
  record.updatedAt = new Date().toISOString();
  const vehicleRef = vehicleRefFor(record.vehicleId, record.privateCarLabel);
  localStorage.setItem(LOG_PREFIX + record.key, JSON.stringify(record));

  const index = loadLogIndex();
  const existing = index.findIndex((e) => e.key === record.key);
  const entry = {
    key: record.key, vehicleRef,
    vehicleId: record.vehicleId, privateCarLabel: record.privateCarLabel,
    year: record.year, month: record.month, updatedAt: record.updatedAt
  };
  if (existing >= 0) index[existing] = entry; else index.push(entry);
  saveLogIndex(index);
  return record;
}
```

置き換え後:
```javascript
// クラウド同期時(syncMonthlyLogFromCloud)は、マージ済みレコードのupdatedAtを
// 「今」に上書きしてはいけない(次回のマージ比較が壊れるため)。そのため
// 「そのまま保存するだけ」のwriteMonthlyLogRawと、「今の時刻に更新してから保存する」
// saveMonthlyLogを分離する。ローカルでの通常保存は引き続きsaveMonthlyLogを使う。
function writeMonthlyLogRaw(record) {
  const vehicleRef = vehicleRefFor(record.vehicleId, record.privateCarLabel);
  localStorage.setItem(LOG_PREFIX + record.key, JSON.stringify(record));

  const index = loadLogIndex();
  const existing = index.findIndex((e) => e.key === record.key);
  const entry = {
    key: record.key, vehicleRef,
    vehicleId: record.vehicleId, privateCarLabel: record.privateCarLabel,
    year: record.year, month: record.month, updatedAt: record.updatedAt
  };
  if (existing >= 0) index[existing] = entry; else index.push(entry);
  saveLogIndex(index);
  return record;
}

function saveMonthlyLog(record) {
  record.updatedAt = new Date().toISOString();
  return writeMonthlyLogRaw(record);
}
```

- [ ] **Step 2: `public/storage.js:204-206`(`listMonthlyLogKeysForVehicle`)の直後、`208`行目の`// ---------------- 日常点検イベント`コメントの直前に、クラウド同期セクションを追加する**

以下をそのまま挿入する:
```javascript
// ---------------- 運転記録・給油記録のクラウド同期(Firebase Realtime Database) ----------------
// 月報レコードは日ごとのデータ(/logs/<key>/days/<day>)とそれ以外(/logs/<key>/meta)を
// 別々のパスに書き込む。こうすることで、Aさんが5日分・Bさんが8日分を別々の端末で
// 保存しても、Firebase上ではそれぞれ別の場所に書き込まれ、互いの入力を上書きしない。
function buildMetaPayload(record) {
  return {
    vehicleId: record.vehicleId,
    privateCarLabel: record.privateCarLabel,
    year: record.year,
    month: record.month,
    checklistMid: record.checklistMid,
    checklistEnd: record.checklistEnd,
    updatedAt: record.updatedAt
  };
}

async function pushLogDayToCloud(key, day, dayData) {
  try {
    const res = await fetch(`${FIREBASE_DB_URL}/logs/${encodeURIComponent(key)}/days/${day}.json`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(dayData)
    });
    if (!res.ok) throw new Error('Firebase write failed: ' + res.status);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

async function pushLogMetaToCloud(key, metaData) {
  try {
    const res = await fetch(`${FIREBASE_DB_URL}/logs/${encodeURIComponent(key)}/meta.json`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(metaData)
    });
    if (!res.ok) throw new Error('Firebase write failed: ' + res.status);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

// ---------------- 未送信キュー(送信失敗時のリトライ用) ----------------
// データ自体は既にlocalStorageの月報レコードに保存済み。このキューは
// 「まだFirebaseに送れていない」という印だけを持つ(entryは{key, type, day})。
const PENDING_LOG_SYNC_KEY = 'ug_pending_log_sync';

function loadPendingLogSync() {
  try { return JSON.parse(localStorage.getItem(PENDING_LOG_SYNC_KEY)) || []; }
  catch { return []; }
}

function savePendingLogSync(list) {
  localStorage.setItem(PENDING_LOG_SYNC_KEY, JSON.stringify(list));
}

function queuePendingLogSync(entry) {
  const list = loadPendingLogSync();
  const exists = list.some((e) => e.key === entry.key && e.type === entry.type && e.day === entry.day);
  if (!exists) {
    list.push(entry);
    savePendingLogSync(list);
  }
}

function removePendingLogSync(entry) {
  const list = loadPendingLogSync().filter((e) => !(e.key === entry.key && e.type === entry.type && e.day === entry.day));
  savePendingLogSync(list);
}

// キュー内の各entryについて、今のローカルレコードから最新の値を読み直して再送信する
// (entry自体には古いデータのスナップショットを持たせず、常に「今のローカルの内容」を送る)。
async function flushPendingLogSync() {
  const list = loadPendingLogSync();
  for (const entry of list) {
    let record;
    try { record = JSON.parse(localStorage.getItem(LOG_PREFIX + entry.key)); }
    catch { record = null; }
    if (!record) { removePendingLogSync(entry); continue; }
    const result = entry.type === 'day'
      ? await pushLogDayToCloud(entry.key, entry.day, record.days[entry.day])
      : await pushLogMetaToCloud(entry.key, buildMetaPayload(record));
    if (result.ok) removePendingLogSync(entry);
  }
}

// 運転記録入力・給油入力の保存直後に呼ぶ、fire-and-forgetの送信関数。
// 呼び出し側はPromiseを待たない(ローカル保存は既に完了しているため)。
function syncLogDayToCloud(key, day, dayData) {
  pushLogDayToCloud(key, day, dayData).then((result) => {
    if (!result.ok) queuePendingLogSync({ key, type: 'day', day });
    flushPendingLogSync();
  });
}

function syncLogMetaToCloud(key, metaData) {
  pushLogMetaToCloud(key, metaData).then((result) => {
    if (!result.ok) queuePendingLogSync({ key, type: 'meta', day: undefined });
    flushPendingLogSync();
  });
}

// 運転月報を開いた際に呼ぶ。クラウドの該当月報を取得し、日ごと・meta単位で
// updatedAtの新しい方をローカルへマージする。ローカルにまだ無い月報(この端末では
// 初めて開く月報)の場合は、meta引数(vehicleId/privateCarLabel)でシェルを作ってから
// マージする(でなければiPhoneでしか入力されていない月報がPCに一切反映されない)。
// その際、シェルのupdatedAtは「今」ではなく未設定(null)として扱い、クラウド側の
// meta.updatedAtと比較させる(createEmptyMonthlyLogは通常時刻を今にするが、ここでは
// 「ローカルに保存履歴が一切無い」ことを表すためnullに上書きする)。
// 何かが変わった場合はwriteMonthlyLogRaw(updatedAtを今に書き換えない保存)で永続化し、
// 合成後のレコードを返す。何も変わらなければnullを返す。
async function syncMonthlyLogFromCloud(vehicleRef, year, month, meta = {}) {
  const key = monthlyLogKey(vehicleRef, year, month);
  let cloudData;
  try {
    const res = await fetch(`${FIREBASE_DB_URL}/logs/${encodeURIComponent(key)}.json`);
    if (!res.ok) throw new Error('Firebase read failed: ' + res.status);
    cloudData = await res.json();
  } catch {
    return null;
  }
  if (!cloudData) return null;

  const existingLocal = loadMonthlyLog(vehicleRef, year, month);
  const local = existingLocal || createEmptyMonthlyLog(vehicleRef, year, month, meta);
  if (!existingLocal) local.updatedAt = null;

  let changed = false;

  const cloudDays = cloudData.days || {};
  for (let d = 1; d <= 31; d++) {
    const cloudDay = cloudDays[d];
    if (!cloudDay) continue;
    const localDay = local.days[d];
    const localTime = localDay && localDay.updatedAt ? Date.parse(localDay.updatedAt) : -Infinity;
    const cloudTime = cloudDay.updatedAt ? Date.parse(cloudDay.updatedAt) : -Infinity;
    if (cloudTime > localTime) {
      local.days[d] = cloudDay;
      changed = true;
    }
  }

  const cloudMeta = cloudData.meta;
  if (cloudMeta) {
    const localTime = local.updatedAt ? Date.parse(local.updatedAt) : -Infinity;
    const cloudTime = cloudMeta.updatedAt ? Date.parse(cloudMeta.updatedAt) : -Infinity;
    if (cloudTime > localTime) {
      local.checklistMid = cloudMeta.checklistMid || local.checklistMid;
      local.checklistEnd = cloudMeta.checklistEnd || local.checklistEnd;
      local.updatedAt = cloudMeta.updatedAt;
      changed = true;
    }
  }

  if (changed) {
    writeMonthlyLogRaw(local);
    return local;
  }
  return null;
}
```

- [ ] **Step 3: 構文チェック**

Run: `node --check public/storage.js`
Expected: 何も出力されず、終了コード0(構文エラーなし)

- [ ] **Step 4: Node.jsでの実行検証スクリプトを作成する**

`.superpowers/sdd/test-log-sync.js`を新規作成する(このファイルは`.superpowers/sdd/.gitignore`により既にgit管理外なので、コミットしなくてよい):

```javascript
// storage.jsのクラウド同期ロジックをNode.jsで実行して検証する使い捨てスクリプト。
// ブラウザのlocalStorage/fetchをスタブしてstorage.js全体をevalし、関数を直接呼ぶ。
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

let fetchImpl = async () => { throw new Error('fetch not stubbed for this call'); };
global.fetch = (...args) => fetchImpl(...args);

const source = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'storage.js'), 'utf8');
// eslint-disable-next-line no-eval
eval(source);

function resetStorage() {
  global.localStorage.store.clear();
}

async function run() {
  // --- writeMonthlyLogRaw vs saveMonthlyLog: updatedAtの扱いの違い ---
  resetStorage();
  const rec1 = createEmptyMonthlyLog('veh-a', 2026, 7, { vehicleId: 'veh-a' });
  rec1.updatedAt = '2020-01-01T00:00:00.000Z';
  writeMonthlyLogRaw(rec1);
  const stored1 = loadMonthlyLog('veh-a', 2026, 7);
  assert.strictEqual(stored1.updatedAt, '2020-01-01T00:00:00.000Z', 'writeMonthlyLogRaw must not change updatedAt');

  saveMonthlyLog(rec1);
  assert.notStrictEqual(rec1.updatedAt, '2020-01-01T00:00:00.000Z', 'saveMonthlyLog must bump updatedAt');
  console.log('OK: writeMonthlyLogRaw/saveMonthlyLog updatedAt split');

  // --- 未送信キュー: 追加/削除、重複は増えない ---
  resetStorage();
  queuePendingLogSync({ key: 'k1', type: 'day', day: 5 });
  queuePendingLogSync({ key: 'k1', type: 'day', day: 5 });
  assert.strictEqual(loadPendingLogSync().length, 1, 'duplicate queue entries must be collapsed');
  queuePendingLogSync({ key: 'k1', type: 'meta', day: undefined });
  assert.strictEqual(loadPendingLogSync().length, 2);
  removePendingLogSync({ key: 'k1', type: 'day', day: 5 });
  assert.strictEqual(loadPendingLogSync().length, 1);
  assert.strictEqual(loadPendingLogSync()[0].type, 'meta');
  console.log('OK: pending sync queue add/remove');

  // --- flushPendingLogSync: 成功したものだけキューから消える ---
  resetStorage();
  const rec2 = createEmptyMonthlyLog('veh-b', 2026, 7, { vehicleId: 'veh-b' });
  rec2.days[3] = { ...rec2.days[3], meterReading: 100, updatedAt: '2026-07-03T00:00:00.000Z' };
  writeMonthlyLogRaw(rec2);
  queuePendingLogSync({ key: rec2.key, type: 'day', day: 3 });
  queuePendingLogSync({ key: rec2.key, type: 'meta', day: undefined });

  let putCalls = [];
  fetchImpl = async (url) => {
    putCalls.push(url);
    if (url.includes('/days/3.json')) return { ok: true };
    return { ok: false, status: 500 };
  };
  await flushPendingLogSync();
  const remaining = loadPendingLogSync();
  assert.strictEqual(remaining.length, 1, 'only the failed entry should remain queued');
  assert.strictEqual(remaining[0].type, 'meta');
  assert.ok(putCalls.some((u) => u.includes('/days/3.json')));
  console.log('OK: flushPendingLogSync partial retry success');

  // --- syncMonthlyLogFromCloud: クラウドにデータが無ければnull ---
  resetStorage();
  fetchImpl = async () => ({ ok: true, json: async () => null });
  const result1 = await syncMonthlyLogFromCloud('veh-c', 2026, 7, { vehicleId: 'veh-c' });
  assert.strictEqual(result1, null, 'no cloud data must return null');
  console.log('OK: syncMonthlyLogFromCloud returns null when cloud has no data');

  // --- syncMonthlyLogFromCloud: この端末では初めて見る月報でもクラウドから取り込める ---
  resetStorage();
  fetchImpl = async () => ({
    ok: true,
    json: async () => ({
      days: { 5: { meterReading: 200, destination: '本社', driver: '田中', alcoholCheck: 0, fuelAdded: null, updatedAt: '2026-07-05T09:00:00.000Z', updatedBy: '田中' } },
      meta: { vehicleId: 'veh-d', privateCarLabel: null, year: 2026, month: 7, checklistMid: [{ result: '○' }], checklistEnd: [{ result: null }], updatedAt: '2026-07-05T09:00:00.000Z' }
    })
  });
  assert.strictEqual(loadMonthlyLog('veh-d', 2026, 7), null, 'precondition: no local record yet');
  const merged1 = await syncMonthlyLogFromCloud('veh-d', 2026, 7, { vehicleId: 'veh-d' });
  assert.ok(merged1, 'first-ever sync for a record unseen on this device must pull cloud data down');
  assert.strictEqual(merged1.days[5].meterReading, 200);
  assert.strictEqual(merged1.checklistMid[0].result, '○');
  const persisted1 = loadMonthlyLog('veh-d', 2026, 7);
  assert.strictEqual(persisted1.days[5].meterReading, 200, 'merged record must be persisted locally');
  console.log('OK: syncMonthlyLogFromCloud creates a local record from cloud-only data');

  // --- syncMonthlyLogFromCloud: ローカルの方が新しければローカルを維持 ---
  resetStorage();
  const rec3 = createEmptyMonthlyLog('veh-e', 2026, 7, { vehicleId: 'veh-e' });
  rec3.days[10] = { ...rec3.days[10], meterReading: 999, updatedAt: '2026-07-10T12:00:00.000Z' };
  writeMonthlyLogRaw(rec3);
  fetchImpl = async () => ({
    ok: true,
    json: async () => ({ days: { 10: { meterReading: 111, updatedAt: '2026-07-10T08:00:00.000Z' } } })
  });
  const merged2 = await syncMonthlyLogFromCloud('veh-e', 2026, 7, { vehicleId: 'veh-e' });
  assert.strictEqual(merged2, null, 'when nothing is actually newer, no change should be reported');
  const persisted2 = loadMonthlyLog('veh-e', 2026, 7);
  assert.strictEqual(persisted2.days[10].meterReading, 999, 'newer local data must not be overwritten by older cloud data');
  console.log('OK: syncMonthlyLogFromCloud keeps newer local day over older cloud day');

  // --- syncMonthlyLogFromCloud: クラウドの方が新しければクラウドを採用 ---
  resetStorage();
  const rec4 = createEmptyMonthlyLog('veh-f', 2026, 7, { vehicleId: 'veh-f' });
  rec4.days[12] = { ...rec4.days[12], meterReading: 100, updatedAt: '2026-07-12T08:00:00.000Z' };
  writeMonthlyLogRaw(rec4);
  fetchImpl = async () => ({
    ok: true,
    json: async () => ({ days: { 12: { meterReading: 250, updatedAt: '2026-07-12T20:00:00.000Z' } } })
  });
  const merged3 = await syncMonthlyLogFromCloud('veh-f', 2026, 7, { vehicleId: 'veh-f' });
  assert.ok(merged3, 'newer cloud day must be reported as a change');
  assert.strictEqual(merged3.days[12].meterReading, 250);
  console.log('OK: syncMonthlyLogFromCloud applies newer cloud day over older local day');

  console.log('ALL TESTS PASSED');
}

run().catch((err) => { console.error('TEST FAILED:', err); process.exit(1); });
```

- [ ] **Step 5: 検証スクリプトを実行する**

Run: `node .superpowers/sdd/test-log-sync.js`
Expected: 各`OK: ...`行が出力され、最後に`ALL TESTS PASSED`が出て終了コード0。1つでもFAILすれば`TEST FAILED:`とエラー内容が出て終了コード1。

- [ ] **Step 6: ブラウザでの動作確認は行わない**

このタスクはヘッドレス環境で実装するため、実ブラウザでの確認は行わない。Step 3〜5(構文チェック+Node実行検証)で十分。実際のFirebaseとの通信・複数端末でのマージ挙動は、コントローラー(人間パートナー)が後でPlaywright+実際のFirebase書き込みで確認する。

- [ ] **Step 7: コミット**

```bash
git rev-parse --show-toplevel && git branch --show-current
git add public/storage.js
git commit -m "運転記録・給油記録のFirebaseクラウド同期の基盤(送信・リトライキュー・マージ取得)を追加"
git rev-parse --show-toplevel && git branch --show-current
```

(`.superpowers/sdd/test-log-sync.js`は`.superpowers/sdd/.gitignore`により追跡対象外なので`git add`しない)

---

### Task 2: trip-entry.js — 保存直後にクラウドへ自動送信する

**Files:**
- Modify: `public/trip-entry.js:205-209`(`onChecklistPromptSubmit`)
- Modify: `public/trip-entry.js:263`(`onTripEntrySubmit`)
- Modify: `public/trip-entry.js:296-297`(`onFuelEntrySubmit`)

**Interfaces:**
- Consumes: Task 1で追加された`syncLogMetaToCloud(key, metaData)`・`buildMetaPayload(record)`・`syncLogDayToCloud(key, day, dayData)`(すべて`public/storage.js`、`<script>`タグの読み込み順によりグローバルに参照できる)。既存の`saveTripDay`・`saveFuelOnly`・`saveMonthlyLog`は月報レコード(`.key`プロパティを持つ)を返す。
- Produces: なし(この画面の外から呼ばれる新しい関数は追加しない)

- [ ] **Step 1: `onChecklistPromptSubmit`(点検結果の保存)にmeta送信を追加する**

現在の内容(`public/trip-entry.js:205-209`):
```javascript
  const record = loadMonthlyLog(pending.vehicleRef, pending.year, pending.month);
  if (record) {
    results.forEach((r, i) => { record[pending.listKey][i].result = r; });
    saveMonthlyLog(record);
  }
```

置き換え後:
```javascript
  const record = loadMonthlyLog(pending.vehicleRef, pending.year, pending.month);
  if (record) {
    results.forEach((r, i) => { record[pending.listKey][i].result = r; });
    saveMonthlyLog(record);
    syncLogMetaToCloud(record.key, buildMetaPayload(record));
  }
```

- [ ] **Step 2: `onTripEntrySubmit`(通常の運転記録保存)に日次データ送信を追加する**

現在の内容(`public/trip-entry.js:263-264`):
```javascript
  const savedRecord = saveTripDay(vehicleRef, year, month, day, dayData, { vehicleId, privateCarLabel, updatedBy: driver });
  if (driver) pushRecentDriver(driver);
```

置き換え後:
```javascript
  const savedRecord = saveTripDay(vehicleRef, year, month, day, dayData, { vehicleId, privateCarLabel, updatedBy: driver });
  syncLogDayToCloud(savedRecord.key, day, savedRecord.days[day]);
  if (driver) pushRecentDriver(driver);
```

- [ ] **Step 3: `onFuelEntrySubmit`(給油入力保存)に日次データ送信を追加する**

現在の内容(`public/trip-entry.js:296-297`):
```javascript
  const vehicleRef = vehicleRefFor(vehicleId, privateCarLabel);
  saveFuelOnly(vehicleRef, year, month, day, fuelAdded, { vehicleId, privateCarLabel });
```

置き換え後:
```javascript
  const vehicleRef = vehicleRefFor(vehicleId, privateCarLabel);
  const savedRecord = saveFuelOnly(vehicleRef, year, month, day, fuelAdded, { vehicleId, privateCarLabel });
  syncLogDayToCloud(savedRecord.key, day, savedRecord.days[day]);
```

- [ ] **Step 4: 構文チェックと追加箇所の確認**

Run: `node --check public/trip-entry.js`
Expected: 何も出力されず、終了コード0

Run: `grep -n "syncLogDayToCloud\|syncLogMetaToCloud" public/trip-entry.js`
Expected: 3行(onChecklistPromptSubmit内の`syncLogMetaToCloud`が1件、onTripEntrySubmit内・onFuelEntrySubmit内の`syncLogDayToCloud`が各1件)がヒットする

- [ ] **Step 5: ブラウザでの動作確認は行わない**

このタスクはヘッドレス環境で実装するため、実ブラウザでの確認・実際のFirebaseへの送信確認は行わない。Step 4で十分。コントローラーが後でPlaywrightと実際のFirebase読み取りで、保存後に該当パス(`/logs/<key>/days/<day>`・`/logs/<key>/meta`)へ実際に書き込まれることを確認する。

- [ ] **Step 6: コミット**

```bash
git rev-parse --show-toplevel && git branch --show-current
git add public/trip-entry.js
git commit -m "運転記録・給油記録の保存直後にFirebaseへ自動送信する"
git rev-parse --show-toplevel && git branch --show-current
```

---

### Task 3: report.js — 運転月報を開いた時にクラウドの最新データを取り込む + XSS対策

**Files:**
- Modify: `public/report.js:8`(状態変数の追加)
- Modify: `public/report.js:71-76`(`renderReportView`のレコード解決直後に同期トリガーを追加)
- Modify: `public/report.js:286-287`(`reportBlock`の`destination`/`driver`エスケープ)
- Modify: `public/report.js:320`(`checklistBlock`の`result`エスケープ)

**Interfaces:**
- Consumes: Task 1で追加された`syncMonthlyLogFromCloud(vehicleRef, year, month, meta)`(`public/storage.js`)。既存の`escapeHtml(value)`(`public/storage.js`)。
- Produces: `let reportSyncedKey`(トップレベル変数。Task 4でapp.jsから`reportSyncedKey = null`として参照・代入される。このファイル群は`<script type="module">`ではなく通常の`<script>`タグで順に読み込まれるため、`report.js`で宣言した`let`はここより後に読み込まれる`app.js`からもそのまま読み書きできる — 実際に既存の`tripQrVehicleId`等も同じ方式で複数ファイル間で共有されている)

- [ ] **Step 1: 同期済みキーを追跡する変数を追加する**

現在の内容(`public/report.js:8`):
```javascript
let reportImportConflicts = null; // {merged, conflicts}
```

置き換え後:
```javascript
let reportImportConflicts = null; // {merged, conflicts}
let reportSyncedKey = null; // 直近でクラウド同期を試みた月報キー(同じキーの間は再同期しない)
```

- [ ] **Step 2: `renderReportView`のレコード解決直後にクラウド同期トリガーを挿入する**

現在の内容(`public/report.js:71-76`):
```javascript
  const record = loadMonthlyLog(reportSelectedRef, reportSelectedYear, reportSelectedMonth)
    || createEmptyMonthlyLog(reportSelectedRef, reportSelectedYear, reportSelectedMonth, {
      vehicleId: selectedOption.vehicleId, privateCarLabel: selectedOption.privateCarLabel
    });

  const totals = computeTotals(record.days);
```

置き換え後:
```javascript
  const record = loadMonthlyLog(reportSelectedRef, reportSelectedYear, reportSelectedMonth)
    || createEmptyMonthlyLog(reportSelectedRef, reportSelectedYear, reportSelectedMonth, {
      vehicleId: selectedOption.vehicleId, privateCarLabel: selectedOption.privateCarLabel
    });

  // この車両・年月の組み合わせを表示するのが初めてなら、クラウドの最新データを取得して
  // マージする(画面を開いている間の自動更新はしない。車両・月を選び直すか、タブを
  // 開き直した時だけ再取得する — app.jsのshowViewがreportSyncedKeyをnullに戻す)。
  if (reportSyncedKey !== record.key) {
    reportSyncedKey = record.key;
    syncMonthlyLogFromCloud(reportSelectedRef, reportSelectedYear, reportSelectedMonth, {
      vehicleId: selectedOption.vehicleId, privateCarLabel: selectedOption.privateCarLabel
    }).then((mergedRecord) => {
      if (mergedRecord) renderReportView();
    });
  }

  const totals = computeTotals(record.days);
```

- [ ] **Step 3: `reportBlock`の行先・運転者をエスケープする**

現在の内容(`public/report.js:286-287`):
```javascript
        <td class="dest-cell">${day.destination || ''}</td>
        <td class="driver-cell">${day.driver || ''}</td>
```

置き換え後:
```javascript
        <td class="dest-cell">${escapeHtml(day.destination || '')}</td>
        <td class="driver-cell">${escapeHtml(day.driver || '')}</td>
```

- [ ] **Step 4: `checklistBlock`の点検結果をエスケープする**

現在の内容(`public/report.js:320`):
```javascript
      <td class="checklist-result">${item.result || ''}</td>
```

置き換え後:
```javascript
      <td class="checklist-result">${escapeHtml(item.result || '')}</td>
```

- [ ] **Step 5: 構文チェックと追加箇所の確認**

Run: `node --check public/report.js`
Expected: 何も出力されず、終了コード0

Run: `grep -n "reportSyncedKey\|syncMonthlyLogFromCloud\|escapeHtml(day.destination\|escapeHtml(day.driver\|escapeHtml(item.result" public/report.js`
Expected: `reportSyncedKey`の宣言・比較・代入で3箇所前後、`syncMonthlyLogFromCloud`呼び出しで1箇所、`escapeHtml(day.destination`/`escapeHtml(day.driver`/`escapeHtml(item.result`が各1箇所ずつヒットする

- [ ] **Step 6: ブラウザでの動作確認は行わない**

このタスクはヘッドレス環境で実装するため、実ブラウザでの確認は行わない。Step 5で十分。コントローラーが後でPlaywrightを使い、(a)実際にiPhone相当の別セッションでFirebaseへ書き込んだ月報データがPC側の運転月報表示に反映されること、(b)行先欄に`<script>`等を含む値を保存してもエスケープされてタグとして実行されないこと、の両方を実データではなく識別可能なテスト車両・テストデータで確認する。

- [ ] **Step 7: コミット**

```bash
git rev-parse --show-toplevel && git branch --show-current
git add public/report.js
git commit -m "運転月報を開いた時にFirebaseの最新データを取り込み、表示のXSS対策を追加する"
git rev-parse --show-toplevel && git branch --show-current
```

---

### Task 4: app.js — アプリ起動時のリトライ + 運転月報タブを開くたびの再同期

**Files:**
- Modify: `public/app.js:19-31`(`showView`)
- Modify: `public/app.js:220-222`(`bootstrapApp`)

**Interfaces:**
- Consumes: Task 1の`flushPendingLogSync()`(`public/storage.js`)。Task 3の`reportSyncedKey`(`public/report.js`で宣言済みのトップレベル変数。通常の`<script>`タグ読み込みのため、`report.js`より後に読み込まれる`app.js`から直接代入できる)。
- Produces: なし

- [ ] **Step 1: `showView`の運転月報分岐で`reportSyncedKey`をリセットする**

現在の内容(`public/app.js:19-31`):
```javascript
async function showView(name) {
  VIEWS.forEach((v) => {
    document.getElementById(`view-${v}`).classList.toggle('active', v === name);
    document.querySelector(`.tab-btn[data-view="${v}"]`).classList.toggle('active', v === name);
  });
  document.body.dataset.view = name;
  if (name === 'vehicles') {
    await syncVehiclesFromCloud();
    renderVehiclesView();
  }
  if (name === 'trip-entry') renderTripEntryView();
  if (name === 'report') renderReportView();
}
```

置き換え後:
```javascript
async function showView(name) {
  VIEWS.forEach((v) => {
    document.getElementById(`view-${v}`).classList.toggle('active', v === name);
    document.querySelector(`.tab-btn[data-view="${v}"]`).classList.toggle('active', v === name);
  });
  document.body.dataset.view = name;
  if (name === 'vehicles') {
    await syncVehiclesFromCloud();
    renderVehiclesView();
  }
  if (name === 'trip-entry') renderTripEntryView();
  if (name === 'report') {
    // タブを開くたび(既に開いている状態からの再クリックも含む)にクラウドから
    // 最新の月報データを取り直させるため、直近の同期済みキーの記録をリセットする。
    reportSyncedKey = null;
    renderReportView();
  }
}
```

- [ ] **Step 2: `bootstrapApp`にアプリ起動時のリトライを追加する**

現在の内容(`public/app.js:220-222`):
```javascript
async function bootstrapApp() {
  await syncVehiclesFromCloud();

  const params = new URLSearchParams(location.search);
```

置き換え後:
```javascript
async function bootstrapApp() {
  await syncVehiclesFromCloud();
  flushPendingLogSync();

  const params = new URLSearchParams(location.search);
```

- [ ] **Step 3: 構文チェックと追加箇所の確認**

Run: `node --check public/app.js`
Expected: 何も出力されず、終了コード0

Run: `grep -n "reportSyncedKey = null\|flushPendingLogSync()" public/app.js`
Expected: `reportSyncedKey = null;`が1件、`flushPendingLogSync();`が1件ヒットする

- [ ] **Step 4: ブラウザでの動作確認は行わない**

このタスクはヘッドレス環境で実装するため、実ブラウザでの確認は行わない。Step 3で十分。コントローラーが後でPlaywrightを使い、(a)未送信キューにエントリがある状態でページを再読み込みするとリトライされること、(b)運転月報タブを離れてまた開き直すと毎回クラウド取得が走ること、を確認する。

- [ ] **Step 5: コミット**

```bash
git rev-parse --show-toplevel && git branch --show-current
git add public/app.js
git commit -m "アプリ起動時に未送信の運転記録をリトライし、運転月報タブを開くたびに再同期する"
git rev-parse --show-toplevel && git branch --show-current
```

---

### Task 5: キャッシュバージョンの更新(20260722f → 20260722g)

**Files:**
- Modify: `public/index.html`(全ての`?v=20260722f`を`?v=20260722g`に置換)

**Interfaces:**
- Consumes: なし
- Produces: なし(最終タスク)

- [ ] **Step 1: 現在のバージョン文字列の出現数を確認する**

Run: `grep -c 'v=20260722f' public/index.html`
Expected: `9`

- [ ] **Step 2: バージョン文字列を一括置換する**

Run: `sed -i 's/?v=20260722f/?v=20260722g/g' public/index.html`

- [ ] **Step 3: 置換後の出現数を確認する**

Run: `grep -c 'v=20260722g' public/index.html`
Expected: `9`

Run: `grep -c 'v=20260722f' public/index.html`
Expected: `0`(または該当なしでエラー終了。どちらでも「残っていない」ことが確認できればよい)

- [ ] **Step 4: コミット**

```bash
git rev-parse --show-toplevel && git branch --show-current
git add public/index.html
git commit -m "アセットのキャッシュバージョンを20260722gに更新する"
git rev-parse --show-toplevel && git branch --show-current
```
