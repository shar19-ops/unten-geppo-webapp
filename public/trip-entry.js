// 運転記録入力画面(iPhone優先)。データはstorage.js経由(saveTripDay/saveFuelOnly/loadMonthlyLog)。

let tripUsePrivateCar = false;
let tripEntryMode = 'trip'; // 'trip'=運転記録入力 / 'fuel'=給油入力
let tripStatusMessage = '';
let tripStatusIsError = false;
let tripPendingChecklists = []; // 保存直後に発生した点検イベントのキュー({listKey, headerNote, vehicleRef, year, month, day})
let tripQrVehicleId = null; // QR経由で指定された車両ID(未指定/該当なしの場合はnull)
let tripSelectedDate = todayIso(); // 運転記録入力欄で現在選択中の日付
let tripSelectedVehicleId = null; // 運転記録入力欄で現在選択中の車両ID(未選択ならQRロック車両または一覧の先頭車両に従う)

function renderTripEntryView() {
  const root = document.getElementById('view-trip-entry');

  root.innerHTML = `
    ${tripPendingChecklists.length ? checklistPromptPanelHtml(tripPendingChecklists[0]) : ''}
    <div class="panel entry-mode-panel">
      <div class="segmented">
        <button type="button" class="segmented-btn ${tripEntryMode === 'trip' ? 'active' : ''}" data-entry-mode="trip">運転記録入力</button>
        <button type="button" class="segmented-btn ${tripEntryMode === 'fuel' ? 'active' : ''}" data-entry-mode="fuel">給油入力</button>
      </div>
    </div>
    ${tripEntryMode === 'trip' ? tripFormHtml() : fuelFormHtml()}
  `;

  root.querySelectorAll('[data-entry-mode]').forEach((btn) => {
    btn.addEventListener('click', () => {
      tripEntryMode = btn.dataset.entryMode;
      tripStatusMessage = '';
      renderTripEntryView();
    });
  });

  root.querySelectorAll('.segmented-btn[data-mode]').forEach((btn) => {
    btn.addEventListener('click', () => {
      tripUsePrivateCar = btn.dataset.mode === 'private';
      tripQrVehicleId = null;
      tripSelectedVehicleId = null;
      renderTripEntryView();
    });
  });

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
    document.getElementById('fuelEntryForm').addEventListener('submit', onFuelEntrySubmit);
  }

  if (tripPendingChecklists.length) {
    document.getElementById('checklistPromptForm').addEventListener('submit', onChecklistPromptSubmit);
    document.getElementById('checklistPromptSkipBtn').addEventListener('click', () => {
      tripPendingChecklists = tripPendingChecklists.slice(1);
      renderTripEntryView();
    });
  }
}

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
            ${vehicles.map((v) => `<option value="${escapeHtml(v.id)}" ${(tripSelectedVehicleId || tripQrVehicleId) === v.id ? 'selected' : ''}>${escapeHtml(v.plateNumber)}（${escapeHtml(v.nickname || '車種未設定')}）</option>`).join('')}
          </select>`
        : `<p class="hint">${emptyHint}</p>`
      }
    </div>
  `;
}

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

function fuelFormHtml() {
  const today = new Date().toISOString().slice(0, 10);
  const allVehicles = loadVehicles().filter((v) => v.active !== false);
  const companyVehicles = allVehicles.filter((v) => (v.vehicleType || 'company') !== 'private');
  const privateVehicles = allVehicles.filter((v) => v.vehicleType === 'private');

  return `
    <form class="entry-form panel" id="fuelEntryForm">
      <h2>給油入力</h2>
      <p class="hint">運転記録を保存し忘れた日や、給油だけを別日に記録したい場合に使います。既に保存済みのメーター指針・行先・運転者は変更されません。</p>

      ${vehicleSelectFieldHtml(companyVehicles, privateVehicles)}

      <div class="field">
        <label>給油した日付</label>
        <input type="date" name="date" class="input-lg" value="${today}" required>
      </div>

      <div class="field">
        <label>給油量(L)</label>
        <input type="text" name="fuelAdded" inputmode="decimal" class="input-lg" placeholder="例: 30.5" required>
      </div>

      <button type="submit" class="btn btn-primary btn-block" ${(tripUsePrivateCar ? !privateVehicles.length : !companyVehicles.length) ? 'disabled' : ''}>給油を記録</button>
      <p class="status ${tripStatusIsError ? 'error' : 'ok'}">${tripStatusMessage}</p>
    </form>
  `;
}

// ---------------- 点検イベント(15日・月末点検) ----------------
function checklistPromptPanelHtml(pending) {
  return `
    <div class="panel checklist-prompt-panel">
      <h2>日常点検の記入(${pending.headerNote})</h2>
      <p class="hint">${pending.year}年${pending.month}月分です。各項目を確認し、○(異常なし)／×(異常あり)を選んでください。</p>
      <form id="checklistPromptForm">
        ${FIXED_CHECKLIST_ITEMS.map((label, i) => `
          <div class="checklist-prompt-row">
            <span class="checklist-prompt-label">${i + 1}. ${label}</span>
            <span class="checklist-prompt-choice">
              <label><input type="radio" name="result-${i}" value="○" required> ○</label>
              <label><input type="radio" name="result-${i}" value="×"> ×</label>
            </span>
          </div>
        `).join('')}
        <div class="form-actions">
          <button type="submit" class="btn btn-primary">点検結果を保存</button>
          <button type="button" class="btn btn-ghost" id="checklistPromptSkipBtn">後で記入する</button>
        </div>
      </form>
    </div>
  `;
}

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

// ---------------- 通常の運転記録入力 ----------------
function parseNumberOrNull(value) {
  const trimmed = String(value || '').trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

function resolveVehicleSelection(fd) {
  const vehicles = loadVehicles();
  const vehicleId = fd.get('vehicleId');
  if (!vehicleId) return { error: tripUsePrivateCar ? '私有車を選択してください' : '車両を選択してください' };
  const vehicle = vehicles.find((v) => v.id === vehicleId);
  return { vehicleId, privateCarLabel: null, vehicle };
}

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

// ---------------- 給油入力 ----------------
function onFuelEntrySubmit(e) {
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
  const fuelAdded = parseNumberOrNull(fd.get('fuelAdded'));
  if (fuelAdded == null) {
    tripStatusMessage = '給油量を入力してください';
    tripStatusIsError = true;
    renderTripEntryView();
    return;
  }

  const vehicleRef = vehicleRefFor(vehicleId, privateCarLabel);
  const savedRecord = saveFuelOnly(vehicleRef, year, month, day, fuelAdded, { vehicleId, privateCarLabel });
  syncLogDayToCloud(savedRecord.key, day, savedRecord.days[day]);

  tripStatusMessage = `給油量を記録しました(${year}年${month}月${day}日・${fuelAdded}L)`;
  tripStatusIsError = false;
  renderTripEntryView();
}
