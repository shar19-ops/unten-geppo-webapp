// 運転記録入力画面(iPhone優先)。データはstorage.js経由(saveTripDay/saveFuelOnly/loadMonthlyLog)。

let tripUsePrivateCar = false;
let tripEntryMode = 'trip'; // 'trip'=運転記録入力 / 'fuel'=給油入力
let tripStatusMessage = '';
let tripStatusIsError = false;
let tripPendingChecklists = []; // 保存直後に発生した点検イベントのキュー({listKey, headerNote, vehicleRef, year, month, day})
let tripQrVehicleId = null; // QR経由で指定された車両ID(未指定/該当なしの場合はnull)
let tripQrBlockedMessage = null; // QR対象車両が使用不可(期限切れ・停止中)のため入力自体をブロックしている場合の案内文
let tripSelectedDate = todayIso(); // 運転記録入力欄で現在選択中の日付
let tripSelectedVehicleId = null; // 運転記録入力欄で現在選択中の車両ID(未選択ならQRロック車両または一覧の先頭車両に従う)
let tripSyncedLogKey = null; // 直近にクラウドから取り直した月報キー(車両×年月)。同じ組み合わせの再取得を防ぐ
let tripFormDirty = false; // 入力欄に手を入れたか(クラウド反映で入力中の内容を消さないための判定)

function renderTripEntryView() {
  const root = document.getElementById('view-trip-entry');
  tripFormDirty = false; // 画面を組み直すので「入力中」の状態も一度リセットする

  // QR対象の車両が使用不可の場合、他の車両を自由に選べる画面には落とさず、理由を
  // 明示して入力そのものをブロックする(管理者モードのみ通常表示に進める例外)。
  if (tripQrBlockedMessage && !isAdminUnlocked()) {
    root.innerHTML = `
      <div class="panel">
        <h2>運転記録入力</h2>
        <p class="status error">${escapeHtml(tripQrBlockedMessage)}</p>
      </div>
    `;
    return;
  }

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
      tripSelectedVehicleId = null;
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
    setupTripAppendHelpers();
    // 他の人・他の端末で入力済みの内容を入力欄へ出すため、クラウドから取り直す
    ensureTripLogSynced(effectiveTripVehicleId(), tripSelectedDate);
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

// 現在の選択(手動選択 > QR指定 > 一覧の先頭)から、入力対象の車両IDを決める。
// tripFormHtmlとクラウド同期の双方が同じ車両を見るよう、判定を1か所にまとめている。
function effectiveTripVehicleId() {
  const allVehicles = sortVehiclesByOffice(loadVehicles()).filter(isVehicleUsable);
  const candidates = tripUsePrivateCar
    ? allVehicles.filter((v) => v.vehicleType === 'private')
    : allVehicles.filter((v) => (v.vehicleType || 'company') !== 'private');
  return tripSelectedVehicleId || tripQrVehicleId || (candidates[0] ? candidates[0].id : null);
}

// 選択中の「車両 × 日付」の月報をクラウドから取り直す。
// 運転記録入力画面はこの端末のlocalStorageしか見ていなかったため、同じ日に別の人・
// 別の端末で入力された内容が入力欄に出ず、そのまま保存すると1日1レコードの仕様上
// 相手の行先・運転者を丸ごと上書きしてしまっていた。運転月報画面と同じ
// syncMonthlyLogFromCloudでマージしてから入力欄へ反映する。
async function ensureTripLogSynced(vehicleId, dateStr) {
  if (!vehicleId || !dateStr) return;
  const [year, month] = dateStr.split('-').map(Number);
  if (!year || !month) return;
  const vehicleRef = vehicleRefFor(vehicleId, null);
  const key = monthlyLogKey(vehicleRef, year, month);
  if (tripSyncedLogKey === key) return; // 同じ車両・同じ月なら取得済み
  tripSyncedLogKey = key;

  const merged = await syncMonthlyLogFromCloud(vehicleRef, year, month, { vehicleId });
  if (!merged) return; // 取得失敗、またはクラウド側に新しい内容が無ければ現状のまま
  if (tripSyncedLogKey !== key) return; // 待っている間に車両・日付が変わっていたら破棄する
  if (document.body.dataset.view !== 'trip-entry' || tripEntryMode !== 'trip') return;
  if (tripFormDirty) {
    // 既に入力し始めている場合は勝手に貼り替えず、読み込むかどうかを本人に選んでもらう
    showTripCloudUpdateNotice();
    return;
  }
  renderTripEntryView();
}

// 入力中にクラウド側の更新を見つけた場合の案内。入力途中の内容を消さないよう、
// 反映は「最新の内容を読み込む」を押した時だけ行う。
function showTripCloudUpdateNotice() {
  const form = document.getElementById('tripEntryForm');
  if (!form || document.getElementById('tripCloudUpdateNotice')) return;
  const heading = form.querySelector('h2');
  if (!heading) return;

  const notice = document.createElement('p');
  notice.id = 'tripCloudUpdateNotice';
  notice.className = 'status error';
  notice.textContent = 'この日の記録が他の端末で更新されました。';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn btn-ghost btn-inline';
  btn.textContent = '最新の内容を読み込む';
  btn.addEventListener('click', () => {
    tripSyncedLogKey = null; // 押された時は改めて取り直す
    renderTripEntryView();
  });

  notice.appendChild(btn);
  heading.insertAdjacentElement('afterend', notice);
}

// 既存の行先へ「追記」しやすくするための補助。入力に手が入ったことを覚えておき
// (クラウド反映で入力中の内容を消さないため)、行先欄を最初にタップした時だけ
// カーソルを末尾へ送って、既に入っている行先の後ろから続けて書けるようにする。
function setupTripAppendHelpers() {
  const form = document.getElementById('tripEntryForm');
  if (!form) return;
  form.addEventListener('input', () => { tripFormDirty = true; });

  const destInput = form.querySelector('input[name="destination"]');
  if (!destInput || !destInput.value) return;
  destInput.addEventListener('focus', function moveCaretToEnd() {
    destInput.removeEventListener('focus', moveCaretToEnd);
    const end = destInput.value.length;
    // iOS Safariはfocus直後だと選択位置が戻されるため、1tick遅らせて末尾へ送る
    setTimeout(() => { try { destInput.setSelectionRange(end, end); } catch {} }, 0);
  });
}

// 「いつ入力されたか」は同じ日に複数回記入する運用で効くので、日付だけでなく時刻も出す。
function formatUpdatedAtLabel(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// 既に入力済みの日に、誰がいつ入力したかを添えて案内する。同じ日に行先が複数ある場合は
// 行を増やさず既存の内容へ追記してもらう運用なので、その旨も文言に含める。
function existingDayHintText(existingDay) {
  const who = existingDay.updatedBy ? `${escapeHtml(existingDay.updatedBy)}さんが` : '';
  const when = formatUpdatedAtLabel(existingDay.updatedAt);
  const stamp = (who || when) ? `（${who}${when ? `${when}に` : ''}入力）` : '';
  return `この日は既に入力済みです${stamp}。行は増やさず、下の内容に追記・修正して保存してください。`;
}

function vehicleSelectFieldHtml(companyVehicles, privateVehicles) {
  if (tripQrVehicleId && !isAdminUnlocked()) {
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
  const allVehicles = sortVehiclesByOffice(loadVehicles()).filter(isVehicleUsable);
  const companyVehicles = allVehicles.filter((v) => (v.vehicleType || 'company') !== 'private');
  const privateVehicles = allVehicles.filter((v) => v.vehicleType === 'private');
  const recentDrivers = loadRecentDrivers();

  const effectiveVehicleId = effectiveTripVehicleId();
  checkPermitExpiryWarning(effectiveVehicleId);
  const existingDay = findExistingDayData(effectiveVehicleId, tripSelectedDate);

  return `
    <form class="entry-form panel" id="tripEntryForm">
      <h2>運転記録入力</h2>

      ${existingDay ? `<p class="hint entry-existing-hint">${existingDayHintText(existingDay)}</p>` : ''}

      ${vehicleSelectFieldHtml(companyVehicles, privateVehicles)}

      <div class="field">
        <label>日付</label>
        <input type="date" name="date" class="input-lg" value="${tripSelectedDate}" required>
      </div>

      <div class="field">
        <label>出庫時メーター指針(km)</label>
        <input type="text" name="meterReading" inputmode="decimal" class="input-lg" placeholder="例: 15230" value="${existingDay && existingDay.meterReading != null ? escapeHtml(existingDay.meterReading) : ''}">
      </div>

      <div class="field">
        <label>行先</label>
        <input type="text" name="destination" class="input-lg" placeholder="例: 自宅 → 本店" value="${escapeHtml(existingDay ? existingDay.destination || '' : '')}">
      </div>

      <div class="field">
        <label>運転者</label>
        <input type="text" name="driver" class="input-lg" list="recentDrivers" placeholder="運転者名" value="${escapeHtml(existingDay ? existingDay.driver || '' : '')}">
        <datalist id="recentDrivers">
          ${recentDrivers.map((d) => `<option value="${d}">`).join('')}
        </datalist>
      </div>

      <div class="field">
        <label>アルコールチェック(始業前・mg/L)</label>
        <input type="text" name="alcoholCheckBefore" inputmode="decimal" class="input-lg" placeholder="0" value="${existingDay && existingDay.alcoholCheckBefore != null ? escapeHtml(existingDay.alcoholCheckBefore) : ''}">
      </div>

      <div class="field">
        <label>アルコールチェック(終業後・mg/L)</label>
        <input type="text" name="alcoholCheckAfter" inputmode="decimal" class="input-lg" placeholder="0" value="${existingDay && existingDay.alcoholCheckAfter != null ? escapeHtml(existingDay.alcoholCheckAfter) : ''}">
      </div>

      <button type="submit" class="btn btn-primary btn-block" ${(tripUsePrivateCar ? !privateVehicles.length : !companyVehicles.length) ? 'disabled' : ''}>この記録を保存</button>
      <p class="status ${tripStatusIsError ? 'error' : 'ok'}">${tripStatusMessage}</p>
    </form>
  `;
}

function fuelFormHtml() {
  const today = todayIso();
  const allVehicles = sortVehiclesByOffice(loadVehicles()).filter(isVehicleUsable);
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
    if (pending.listKey === 'checklistEnd') {
      notifyIssuerOfMonthEndChecklist(record);
    }
    if (results.includes('×')) {
      const vehicle = record.vehicleId ? loadVehicles().find((v) => v.id === record.vehicleId) : null;
      const isPrivate = vehicle ? vehicle.vehicleType === 'private' : false;
      alert(isPrivate
        ? '適切な処置または整備工場などに持込み修理を行なってください。'
        : '適切な処置または、自動車修理依頼書を発行してください。');
    }
    showToast('点検結果を保存しました');
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

// ---------------- 通常の運転記録入力 ----------------
function parseNumberOrNull(value) {
  // 運転月報のメーター指針は桁区切り付きで表示する(例: 15,000)ため、数値に戻す際は
  // カンマを取り除く。他の数値欄でカンマが混ざっても同様に読めるようにしておく。
  const trimmed = String(value || '').replace(/[,，]/g, '').trim();
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
    alcoholCheckBefore: parseNumberOrNull(fd.get('alcoholCheckBefore')),
    alcoholCheckAfter: parseNumberOrNull(fd.get('alcoholCheckAfter'))
  };

  const isOverAlcoholLimit = (v) => v != null && v >= 0.15;
  if (isOverAlcoholLimit(dayData.alcoholCheckBefore) || isOverAlcoholLimit(dayData.alcoholCheckAfter)) {
    alert('酒気帯びです。運転は中止してください！');
  }

  const savedRecord = saveTripDay(vehicleRef, year, month, day, dayData, { vehicleId, privateCarLabel, updatedBy: driver });
  syncLogDayToCloud(savedRecord.key, day, savedRecord.days[day]);
  if (driver) pushRecentDriver(driver);

  tripPendingChecklists = checklistEventsDue(savedRecord, day).map((d) => ({ ...d, vehicleRef, year, month, day }));
  tripStatusMessage = `保存しました(${year}年${month}月${day}日)`;
  tripStatusIsError = false;
  showToast('保存しました');
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
  showToast('給油を記録しました');
  renderTripEntryView();
}
