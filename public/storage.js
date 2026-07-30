// データアクセス層。vehicles.js/trip-entry.js/report.jsはこのファイルの関数経由でのみ
// データに触れる。車両マスタ・運転記録(月報・給油記録)ともにFirebase Realtime Databaseと
// 同期する(syncVehiclesFromCloud/syncLogDayToCloud/syncLogMetaToCloud/syncMonthlyLogFromCloud等)。
// ローカル保存(localStorage)は常に即座に完了し、クラウド送信はその後バックグラウンドで行う。

const VEHICLES_KEY = 'ug_vehicles';
const LOG_PREFIX = 'ug_log_';
const LOG_INDEX_KEY = 'ug_log_index';

// 事業所名リスト(社内の支払伝票・振替伝票アプリの事業所マスタと同一)
const OFFICE_NAMES = ['本店', '東関東支店', '横浜支店', '大阪支店', '名古屋支店', '仙台支店', '北関東支店'];

const FIXED_CHECKLIST_ITEMS = [
  'ブレーキ(ききが十分か・ブレーキの液量が適当か・駐車ブレーキの引きしろが適当か)',
  'タイヤ(空気圧が適当か・亀裂損傷はないか・異常な磨耗はないか・溝の深さが十分であるか)',
  'バッテリー(液量が適当であるか)',
  'エンジン(冷却水の量はよいか・エンジンオイルの量はよいか・異音はないか・低速及び加速の状態が良好であるか)',
  '灯火装置及び方向指示器(点灯又は点滅具合はよいか・汚れ及び損傷はないか)',
  'ウインド・ウォッシャー及びワイパー(噴射状態の不良はないか・払拭状態はよいか)'
];

function generateId() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'id_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

function sanitizeFilename(name) {
  return String(name ?? '').replace(/[\\/:*?"<>|]/g, '_');
}

function sanitizeKey(s) {
  return String(s || '').trim().replace(/\s+/g, '_').replace(/[^\w\-぀-ヿ一-鿿]/g, '');
}

function vehicleManagerOf(v) {
  return v.vehicleManager ?? v.defaultManager ?? v.driverName ?? '';
}

// 私有車の使用許可期限が過ぎているか(社有車・未設定は常にfalse)。
function isPermitExpired(v) {
  return v.vehicleType === 'private' && !!v.permitExpiryDate && v.permitExpiryDate < todayIso();
}

// 運転記録・給油記録の車両選択に出してよいか(使用中フラグ かつ 許可期限切れでない)。
function isVehicleUsable(v) {
  return v.active !== false && !isPermitExpired(v);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function vehicleRefFor(vehicleId, privateCarLabel) {
  return vehicleId ? vehicleId : `private:${sanitizeKey(privateCarLabel)}`;
}

function monthlyLogKey(vehicleRef, year, month) {
  return `${vehicleRef}_${year}_${month}`;
}

// ---------------- 社有車マスタ ----------------
function loadVehicles() {
  try { return JSON.parse(localStorage.getItem(VEHICLES_KEY)) || []; }
  catch { return []; }
}

function saveVehicles(list) {
  localStorage.setItem(VEHICLES_KEY, JSON.stringify(list));
}

// ---------------- 車両マスタのクラウド同期(Firebase Realtime Database) ----------------
// Firebase SDKは使わず、素のfetch()のみで読み書きする(ビルド不要という既存方針に合わせる)。
// ルールは{".read":true,".write":true}(全開放)の前提。DB URLの末尾にスラッシュは付けない。
const FIREBASE_DB_URL = 'https://unten-geppo-webapp-default-rtdb.firebaseio.com';

async function syncVehiclesFromCloud() {
  try {
    const res = await fetch(`${FIREBASE_DB_URL}/vehicles.json`);
    if (!res.ok) throw new Error('Firebase read failed: ' + res.status);
    const data = await res.json();
    const list = data ? Object.values(data) : [];
    saveVehicles(list);
    return list;
  } catch {
    return loadVehicles();
  }
}

async function pushVehicleToCloud(vehicle) {
  const list = loadVehicles();
  const now = new Date().toISOString();
  const idx = list.findIndex((v) => v.id === vehicle.id);
  const finalVehicle = idx >= 0
    ? { ...list[idx], ...vehicle, updatedAt: now }
    : { ...vehicle, id: vehicle.id || generateId(), createdAt: now, updatedAt: now };
  try {
    const res = await fetch(`${FIREBASE_DB_URL}/vehicles/${finalVehicle.id}.json`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(finalVehicle)
    });
    if (!res.ok) throw new Error('Firebase write failed: ' + res.status);
  } catch {
    return { ok: false };
  }
  const newList = idx >= 0 ? list.map((v, i) => (i === idx ? finalVehicle : v)) : [...list, finalVehicle];
  saveVehicles(newList);
  return { ok: true, vehicle: finalVehicle };
}

async function deleteVehicleFromCloud(vehicleId) {
  try {
    const res = await fetch(`${FIREBASE_DB_URL}/vehicles/${vehicleId}.json`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Firebase delete failed: ' + res.status);
  } catch {
    return { ok: false };
  }
  const list = loadVehicles().filter((v) => v.id !== vehicleId);
  saveVehicles(list);
  return { ok: true };
}

async function pushVehiclesToCloud(list) {
  const map = {};
  list.forEach((v) => { map[v.id] = v; });
  try {
    const res = await fetch(`${FIREBASE_DB_URL}/vehicles.json`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(map)
    });
    if (!res.ok) throw new Error('Firebase bulk write failed: ' + res.status);
  } catch {
    return { ok: false };
  }
  saveVehicles(list);
  return { ok: true };
}

// ---------------- 月報レコード ----------------
function loadLogIndex() {
  try { return JSON.parse(localStorage.getItem(LOG_INDEX_KEY)) || []; }
  catch { return []; }
}

function saveLogIndex(list) {
  localStorage.setItem(LOG_INDEX_KEY, JSON.stringify(list));
}

function loadMonthlyLog(vehicleRef, year, month) {
  try { return JSON.parse(localStorage.getItem(LOG_PREFIX + monthlyLogKey(vehicleRef, year, month))); }
  catch { return null; }
}

function createEmptyMonthlyLog(vehicleRef, year, month, meta = {}) {
  const days = {};
  for (let d = 1; d <= 31; d++) {
    days[d] = { meterReading: null, destination: '', driver: '', alcoholCheckBefore: null, alcoholCheckAfter: null, fuelAdded: null, updatedAt: null, updatedBy: null };
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
    // 未確定は空文字(nullは使わない)。Firebase Realtime DatabaseはPUT時に値がnullの
    // キーを丸ごと削除するため、差戻し等で「確定済み→未確定」に戻すと、他端末が読み込んだ
    // 際にそのフィールド自体が存在しない(undefined)扱いになり、ローカルの古い確定値が
    // 上書きされず残ってしまう。空文字ならFirebase上にも値として残るため、この問題を避けられる。
    issuerConfirmedAt: '',
    safetyManagerConfirmedAt: '',
    safetyManagerName: '',
    metaUpdatedAt: null,
    updatedAt: new Date().toISOString()
  };
}

function getOrCreateMonthlyLog(vehicleRef, year, month, meta = {}) {
  return loadMonthlyLog(vehicleRef, year, month) || createEmptyMonthlyLog(vehicleRef, year, month, meta);
}

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

// 運転記録入力画面から1日分を保存する際の便利関数
function saveTripDay(vehicleRef, year, month, day, dayData, meta = {}) {
  const record = getOrCreateMonthlyLog(vehicleRef, year, month, meta);
  record.days[day] = { ...record.days[day], ...dayData, updatedAt: new Date().toISOString(), updatedBy: meta.updatedBy || null };
  return saveMonthlyLog(record);
}

// 給油量だけを後日追記する(他の項目には触れず、既存の出庫時メーター等を消さない)
function saveFuelOnly(vehicleRef, year, month, day, fuelAdded, meta = {}) {
  const record = getOrCreateMonthlyLog(vehicleRef, year, month, meta);
  record.days[day] = { ...record.days[day], fuelAdded, updatedAt: new Date().toISOString(), updatedBy: meta.updatedBy || record.days[day].updatedBy || null };
  return saveMonthlyLog(record);
}

function listMonthlyLogKeysForVehicle(vehicleRef) {
  return loadLogIndex().filter((e) => e.vehicleRef === vehicleRef);
}

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
    issuerConfirmedAt: record.issuerConfirmedAt,
    safetyManagerConfirmedAt: record.safetyManagerConfirmedAt,
    safetyManagerName: record.safetyManagerName,
    updatedAt: record.metaUpdatedAt
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
    const localTime = local.metaUpdatedAt ? Date.parse(local.metaUpdatedAt) : -Infinity;
    const cloudTime = cloudMeta.updatedAt ? Date.parse(cloudMeta.updatedAt) : -Infinity;
    if (cloudTime > localTime) {
      // cloudMetaに項目が無い(旧バージョンが書き込んだデータ)場合はローカルの値を残すが、
      // 明示的なnull(差戻しによるissuerConfirmedAtのクリア等)はそのまま採用する
      // (?? だとnullも「無い」扱いになりリセットがローカルへ反映されなくなるため使わない)。
      const adoptCloud = (cloudValue, localValue) => (cloudValue !== undefined ? cloudValue : localValue);
      local.checklistMid = cloudMeta.checklistMid || local.checklistMid;
      local.checklistEnd = cloudMeta.checklistEnd || local.checklistEnd;
      local.issuerConfirmedAt = adoptCloud(cloudMeta.issuerConfirmedAt, local.issuerConfirmedAt);
      local.safetyManagerConfirmedAt = adoptCloud(cloudMeta.safetyManagerConfirmedAt, local.safetyManagerConfirmedAt);
      local.safetyManagerName = adoptCloud(cloudMeta.safetyManagerName, local.safetyManagerName);
      local.metaUpdatedAt = cloudMeta.updatedAt;
      changed = true;
    }
  }

  if (changed) {
    writeMonthlyLogRaw(local);
    return local;
  }
  return null;
}

// ---------------- 管理者向け:月次の全車両提出状況一覧 ----------------
// 指定年月の全車両分の提出状況(meta)だけをまとめて取得する。日々の運転記録(days)は
// 一覧表示に不要なため取得しない。/logs.jsonを1回だけ読み、キー末尾が"_year_month"の
// ものだけ拾う(vehicleRef自体にアンダースコアを含んでいても、末尾一致で安全に元の
// vehicleRefへ戻せる)。
async function fetchSubmissionStatusForMonth(year, month) {
  const suffix = `_${year}_${month}`;
  try {
    const res = await fetch(`${FIREBASE_DB_URL}/logs.json`);
    if (!res.ok) throw new Error('Firebase read failed: ' + res.status);
    const data = await res.json();
    const map = new Map();
    Object.entries(data || {}).forEach(([key, entry]) => {
      if (!key.endsWith(suffix)) return;
      const vehicleRef = key.slice(0, -suffix.length);
      const meta = (entry && entry.meta) || {};
      map.set(vehicleRef, {
        issuerConfirmedAt: meta.issuerConfirmedAt || '',
        safetyManagerConfirmedAt: meta.safetyManagerConfirmedAt || '',
        safetyManagerName: meta.safetyManagerName || ''
      });
    });
    return map;
  } catch {
    return null;
  }
}

// ---------------- 発行者確認イベント(Teams通知連携) ----------------
// Microsoft Teamsのワークフロー(Webhook)のURL。このリポジトリは公開設定のため、
// このURLも第三者から閲覧可能な状態になるが、既存のFIREBASE_DB_URL・ADMIN_PASSWORDと
// 同じ考え方で許容する(ユーザー確認済み)。
const TEAMS_WEBHOOK_URL = 'https://defaultf7665abfef6f4427bda03700cd1928.70.environment.api.powerplatform.com:443/powerautomate/automations/direct/cu/25/workflows/8e6b8aa3a4e24d6b98db15901c7b1cdd/triggers/manual/paths/invoke?api-version=1&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=JiF36FqrgyE5Rzw1FyMQz5zxHz52wCN-zOAuSEJNzd4';

// 一時停止中(再開する場合はtrueに戻す)。Webhook設定自体は変更していない。
const TEAMS_NOTIFICATIONS_ENABLED = false;

// 送信結果を待たない一回きりのfire-and-forget通知。失敗してもリトライしない
// (失敗しても運転月報画面の確認バナーが引き続き案内役になるため)。
function sendTeamsNotification(text) {
  if (!TEAMS_NOTIFICATIONS_ENABLED) return;
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
function lastDayOfMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

function isChecklistComplete(list) {
  return Array.isArray(list) && list.length > 0 && list.every((item) => item && item.result != null);
}

// 「この記録を保存」した日が指定日(15日/末日)以降で、かつ未記入なら点検イベントを発生させる。
// 指定日そのものに運転が無くても、以降で最初に保存された日に発生する(所定日以降直近)。
function checklistEventsDue(record, savedDay) {
  const due = [];
  if (savedDay >= 15 && !isChecklistComplete(record.checklistMid)) {
    due.push({ listKey: 'checklistMid', headerNote: '点検日15日' });
  }
  const lastDay = lastDayOfMonth(record.year, record.month);
  if (savedDay >= lastDay && !isChecklistComplete(record.checklistEnd)) {
    due.push({ listKey: 'checklistEnd', headerNote: '点検日は月の末日' });
  }
  return due;
}

// ---------------- 直近使用した運転者名(入力補助) ----------------
const RECENT_DRIVERS_KEY = 'ug_recent_drivers';

function loadRecentDrivers() {
  try { return JSON.parse(localStorage.getItem(RECENT_DRIVERS_KEY)) || []; }
  catch { return []; }
}

function pushRecentDriver(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return;
  const list = loadRecentDrivers().filter((n) => n !== trimmed);
  list.unshift(trimmed);
  localStorage.setItem(RECENT_DRIVERS_KEY, JSON.stringify(list.slice(0, 8)));
}

// ---------------- ファイルエクスポート/インポート(genka-webappと同じ方式) ----------------
async function saveBlobToFile(blob, filename) {
  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }]
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return filename;
    } catch (err) {
      if (err.name === 'AbortError') return null;
      // 未対応/失敗時は下のフォールバックへ
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
  return filename;
}

// ---------------- マージ(複数端末からの取り込み) ----------------
function dayHasData(day) {
  return !!day && (day.meterReading != null || day.destination || day.driver || day.alcoholCheckBefore != null || day.alcoholCheckAfter != null || day.fuelAdded != null);
}

// マージ単位は車両番号(plateNumber)+車両タイプ(vehicleType)。新規車両は追加、
// 既存車両でフィールドが異なる場合は競合として返す。
function mergeVehicles(localList, importedList) {
  const merged = localList.map((v) => ({ ...v }));
  const keyFor = (v) => `${v.vehicleType || 'company'}::${v.plateNumber}`;
  const byKey = new Map(merged.map((v) => [keyFor(v), v]));
  const conflicts = [];

  importedList.forEach((iv) => {
    const key = keyFor(iv);
    const existing = byKey.get(key);
    if (!existing) {
      const added = { ...iv, id: iv.id || generateId() };
      merged.push(added);
      byKey.set(key, added);
      return;
    }
    const fieldsDiffer = existing.nickname !== iv.nickname
      || existing.officeName !== iv.officeName
      || existing.active !== iv.active
      || vehicleManagerOf(existing) !== vehicleManagerOf(iv);
    if (fieldsDiffer) {
      conflicts.push({ plateNumber: iv.plateNumber, local: existing, imported: iv });
    }
  });

  return { merged, conflicts };
}
