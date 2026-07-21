// 起動処理・画面ルーティング・共通ヘルパー(モック段階: storage.js未接続)

const VIEWS = ['vehicles', 'trip-entry', 'report'];

// vendor配下の重いライブラリ(ExcelJS/SheetJS)は使う画面でだけ読み込む
// (iPhoneでの運転記録入力が主用途のため、初期読み込みを軽く保つ)
const loadedScripts = new Set();
function loadScriptOnce(src) {
  if (loadedScripts.has(src)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => { loadedScripts.add(src); resolve(); };
    s.onerror = () => reject(new Error(`スクリプトの読み込みに失敗しました: ${src}`));
    document.head.appendChild(s);
  });
}

function showView(name) {
  VIEWS.forEach((v) => {
    document.getElementById(`view-${v}`).classList.toggle('active', v === name);
    document.querySelector(`.tab-btn[data-view="${v}"]`).classList.toggle('active', v === name);
  });
  document.body.dataset.view = name;
  if (name === 'vehicles') renderVehiclesView();
  if (name === 'trip-entry') renderTripEntryView();
  if (name === 'report') renderReportView();
}

// サンプルExcelのG列数式ロジックを再現する共通関数
// distance(day n) = meter(day n+1) - meter(day n) (n=1..14, 16..30)
// distance(day 15) = meter(day 16) - meter(day 15) (点検欄行をまたいでブロック2に接続)
// distance(day 31) = 空欄(day32が存在しないため)
function computeDistance(days, day) {
  const cur = days[day];
  if (!cur || cur.meterReading == null) return '';
  const nextDay = day === 31 ? null : day + 1;
  if (nextDay === null) return '';
  const next = days[nextDay];
  if (!next || next.meterReading == null) return '';
  return next.meterReading - cur.meterReading;
}

// --- 日本の祝日判定(振替休日込み、春分・秋分は近似式) ---
function dateKey(y, m, d) {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function nthMonday(year, month, n) {
  const d = new Date(year, month - 1, 1);
  let count = 0;
  while (true) {
    if (d.getDay() === 1) {
      count += 1;
      if (count === n) return d.getDate();
    }
    d.setDate(d.getDate() + 1);
  }
}

// 春分・秋分の日は太陽の運行によるため官報の正式発表まで確定しないが、
// 実用上はこの近似式(1980-2099年の範囲で有効)で十分な精度が出る。
function vernalEquinoxDay(year) {
  return Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
}
function autumnalEquinoxDay(year) {
  return Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
}

function computeJapaneseHolidays(year) {
  const holidays = new Map();
  const add = (m, d, name) => holidays.set(dateKey(year, m, d), name);

  add(1, 1, '元日');
  add(1, nthMonday(year, 1, 2), '成人の日');
  add(2, 11, '建国記念の日');
  add(2, 23, '天皇誕生日');
  add(3, vernalEquinoxDay(year), '春分の日');
  add(4, 29, '昭和の日');
  add(5, 3, '憲法記念日');
  add(5, 4, 'みどりの日');
  add(5, 5, 'こどもの日');
  add(7, nthMonday(year, 7, 3), '海の日');
  add(8, 11, '山の日');
  add(9, nthMonday(year, 9, 3), '敬老の日');
  add(9, autumnalEquinoxDay(year), '秋分の日');
  add(10, nthMonday(year, 10, 2), 'スポーツの日');
  add(11, 3, '文化の日');
  add(11, 23, '勤労感謝の日');

  // 振替休日: 祝日が日曜なら、直後の祝日でない日を休日にする
  Array.from(holidays.keys()).forEach((key) => {
    const [y, m, d] = key.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    if (date.getDay() === 0) {
      const sub = new Date(date);
      do {
        sub.setDate(sub.getDate() + 1);
      } while (holidays.has(dateKey(sub.getFullYear(), sub.getMonth() + 1, sub.getDate())));
      holidays.set(dateKey(sub.getFullYear(), sub.getMonth() + 1, sub.getDate()), '振替休日');
    }
  });

  return holidays;
}

// 曜日・祝日に応じたセルの色分けクラス(日曜・祝日=赤、土曜=青)
function dayColorClass(year, month, day, holidays) {
  if (holidays.has(dateKey(year, month, day))) return 'day-holiday';
  const dow = new Date(year, month - 1, day).getDay();
  if (dow === 0) return 'day-sunday';
  if (dow === 6) return 'day-saturday';
  return '';
}

function computeTotals(days) {
  let totalDistance = 0;
  let totalFuel = 0;
  for (let d = 1; d <= 31; d++) {
    const dist = computeDistance(days, d);
    if (typeof dist === 'number') totalDistance += dist;
    const fuel = days[d] && days[d].fuelAdded;
    if (typeof fuel === 'number') totalFuel += fuel;
  }
  const fuelEconomy = totalDistance > 0 && totalFuel > 0 ? (totalDistance / totalFuel).toFixed(2) : '0';
  return { totalDistance, totalFuel, fuelEconomy };
}

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
    document.getElementById('adminModeCheck').checked = true;
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

// 開発中はService Workerを一時的に無効化している(更新のたびに手動Unregisterが必要になり、
// 動作確認の妨げになるため)。既に登録されている端末があれば自動的に解除・キャッシュ削除して、
// 通常の再読み込みだけで最新版が反映されるようにする。PWA仕上げの段階で再度有効化する。
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((regs) => {
    regs.forEach((reg) => reg.unregister());
  });
}
if (window.caches) {
  caches.keys().then((keys) => keys.forEach((key) => caches.delete(key)));
}

// QRコードからの起動処理(社有車・私有車問わず?vehicle=<id>を読み取り、運転記録入力へ車両自動選択で遷移する)
(function applyQrVehicleParam() {
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
})();

showView('trip-entry');
