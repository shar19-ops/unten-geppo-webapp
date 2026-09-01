// 運転月報画面。データはstorage.js経由(loadMonthlyLog/saveMonthlyLog)。

let reportSelectedRef = null;
let reportSelectedYear = null;
let reportSelectedMonth = null;
let reportStatusMessage = '';
let reportStatusIsError = false;
let reportSyncedKey = null; // 直近でクラウド同期を試みた月報キー(同じキーの間は再同期しない)
let reportNextMonthSyncedKey = null; // 直近でクラウド同期を試みた翌月分の月報キー(月末走行距離の自動計算用)
let reportCellErrors = new Set(); // "day:<日>:<field>" / "checklist:<listKey>:<index>" 形式。提出時バリデーションで使う
let reportSafetyManagerNameDraft = ''; // 安全運転管理者名の入力途中の値を再描画間で保持する
let reportShowStatusList = false; // 管理者向け「提出状況一覧」表示中か
let reportStatusListData = undefined; // undefined=未取得、null=取得失敗、Map=取得成功
let reportJustSubmitted = false; // 直前の「提出」操作が成功した直後かどうか
let reportStatusListSelected = new Set(); // 提出状況一覧でチェックを入れた車両ID(一括印刷対象)
let reportStatusListSelectedMonthKey = null; // 上記選択がどの年月時点のものか("year-month"。月切替時に選択をクリアする判定用)
let reportBulkPrintActive = false; // 管理者向け「一括印刷／PDF」画面表示中か
let reportBulkPrintReady = false; // 一括印刷対象車両分のクラウド同期が完了したか
let reportBulkPrintSheets = []; // 同期完了後に組み立てた各車両分の帳票HTML

// 提出時のバリデーション。出庫時メーター指針が入力されている日は、走行距離(自動計算)・
// 行先・運転者・アルコールチェック2回がすべて入力されていることを要求する。あわせて、
// 15日・末日の日常点検が両方とも記録済み(全項目にresultがある)ことを要求する。
function findSubmissionErrorCells(record, nextMonthDays) {
  const errors = new Set();
  for (let d = 1; d <= 31; d++) {
    const day = record.days[d] || {};
    if (day.meterReading == null) continue;
    const distance = computeDistance(record.days, d, record.year, record.month, nextMonthDays);
    if (distance === '') errors.add(`day:${d}:distance`);
    if (!day.destination) errors.add(`day:${d}:destination`);
    if (!day.driver) errors.add(`day:${d}:driver`);
    if (day.alcoholCheckBefore == null) errors.add(`day:${d}:alcoholCheckBefore`);
    if (day.alcoholCheckAfter == null) errors.add(`day:${d}:alcoholCheckAfter`);
  }
  ['checklistMid', 'checklistEnd'].forEach((listKey) => {
    (record[listKey] || []).forEach((item, i) => {
      if (!item || item.result == null) errors.add(`checklist:${listKey}:${i}`);
    });
  });
  return errors;
}

function reportVehicleOptions() {
  const vehicles = sortVehiclesByOffice(loadVehicles()).map((v) => ({
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
  if (tripQrVehicleId && !isAdminUnlocked()) {
    const locked = allOptions.filter((o) => o.ref === tripQrVehicleId);
    if (locked.length) return locked;
  }
  return allOptions;
}

// 直近12ヶ月+選択中の年月を年月選択肢として返す(車両非依存)。
function recentMonthOptions(selectedYear, selectedMonth) {
  const now = new Date();
  const map = new Map();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    map.set(`${d.getFullYear()}-${d.getMonth() + 1}`, { year: d.getFullYear(), month: d.getMonth() + 1 });
  }
  map.set(`${selectedYear}-${selectedMonth}`, { year: selectedYear, month: selectedMonth });
  return map;
}

function buildMonthOptions(vehicleRef, selectedYear, selectedMonth) {
  const map = recentMonthOptions(selectedYear, selectedMonth);
  listMonthlyLogKeysForVehicle(vehicleRef).forEach((e) => {
    map.set(`${e.year}-${e.month}`, { year: e.year, month: e.month });
  });
  return Array.from(map.values()).sort((a, b) => (b.year - a.year) || (b.month - a.month));
}

// 運転月報1台分の帳票HTML(2ページ分)を組み立てる。単一車両の運転月報画面と、
// 管理者向けの一括印刷(複数車両分をまとめてこの関数で組み立てて連結する)の両方から使う。
function buildReportSheetHtml(record, nextMonthDays, officeName, vehicleManager, vehicleNumberLabel) {
  const totals = computeTotals(record.days, record.year, record.month, nextMonthDays);
  const holidays = computeJapaneseHolidays(record.year);
  return `
    <div class="report-sheet">
      <div class="report-header">
        <div class="report-header-cell">事業所名<br><strong>${escapeHtml(officeName)}</strong></div>
        <div class="report-header-cell report-title">${record.year}年　${record.month}月　運転月報</div>
        <div class="report-header-cell">
          車両管理者：<strong>${escapeHtml(vehicleManager)}</strong><br>
          車両番号：<strong>${escapeHtml(vehicleNumberLabel)}</strong>
        </div>
      </div>

      ${reportBlock(record.days, 1, 15, record.year, record.month, holidays, nextMonthDays)}
      ${checklistBlock('点検日15日', record.checklistMid, 'checklistMid')}
      <p class="print-page-number">1 / 2</p>
      <div class="report-page2">
        ${reportBlock(record.days, 16, 31, record.year, record.month, holidays, nextMonthDays)}

        <table class="report-table totals-table">
          <tr>
            <td class="label-cell">走行距離合計(km)</td><td class="num-cell distance-cell">${totals.totalDistance.toLocaleString()}</td>
            <td class="label-cell fuel-economy-label">燃費＝走行距離合計／給油合計(km/L)</td><td class="num-cell">${totals.fuelEconomy}</td>
            <td class="label-cell">給油合計(L)</td><td class="num-cell">${totals.totalFuel.toFixed(2)}</td>
          </tr>
        </table>

        ${checklistBlock('点検日は月の末日', record.checklistEnd, 'checklistEnd')}
        <table class="report-table print-stamp-table">
          <colgroup>
            <col style="width: 23mm;">
            <col style="width: 23mm;">
            <col style="width: 23mm;">
          </colgroup>
          <tr>
            <th>安全運転<br>管理者</th>
            <th>副安全運転<br>管理者</th>
            <th>発行者</th>
          </tr>
          <tr>
            <td>${record.safetyManagerConfirmedAt ? `${escapeHtml(formatShortDate(record.safetyManagerConfirmedAt))}<br>${escapeHtml(record.safetyManagerName || '')}` : ''}</td>
            <td></td>
            <td>${record.issuerConfirmedAt ? `${escapeHtml(formatShortDate(record.issuerConfirmedAt))}<br>${escapeHtml(surnameOf(vehicleManager))}` : ''}</td>
          </tr>
        </table>
        <p class="print-page-number">2 / 2</p>
      </div>
    </div>
  `;
}

// 管理者向け一括印刷用:登録済み車両1台・指定年月分のクラウド最新データを同期してから
// 帳票HTMLを組み立てる(この端末に無い他車両分のデータもクラウドから取得するため)。
async function syncAndBuildReportSheetForVehicle(vehicle, year, month) {
  const vehicleRef = vehicle.id;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  await Promise.all([
    syncMonthlyLogFromCloud(vehicleRef, year, month, { vehicleId: vehicle.id }),
    syncMonthlyLogFromCloud(vehicleRef, nextYear, nextMonth, { vehicleId: vehicle.id })
  ]);
  const record = loadMonthlyLog(vehicleRef, year, month) || createEmptyMonthlyLog(vehicleRef, year, month, { vehicleId: vehicle.id });
  const nextMonthRecord = loadMonthlyLog(vehicleRef, nextYear, nextMonth);
  const nextMonthDays = nextMonthRecord ? nextMonthRecord.days : {};
  const officeName = vehicle.officeName || '';
  const vehicleManager = vehicleManagerOf(vehicle);
  return buildReportSheetHtml(record, nextMonthDays, officeName, vehicleManager, vehicle.plateNumber || '');
}

function renderReportView() {
  const root = document.getElementById('view-report');
  if (isAdminUnlocked() && reportBulkPrintActive) {
    renderReportBulkPrint(root);
    return;
  }
  if (isAdminUnlocked() && reportShowStatusList) {
    renderReportStatusList(root);
    return;
  }
  if (reportJustSubmitted) {
    root.innerHTML = `
      <div class="panel">
        <h2>運転月報</h2>
        <p class="status ok">運転月報を提出しました。このタブを閉じてください。</p>
      </div>
    `;
    return;
  }
  const options = reportVehicleOptions();

  if (!options.length) {
    root.innerHTML = `
      <div class="panel">
        <h2>運転月報</h2>
        <p class="hint">まだ車両が登録されていません。先に「車両リスト」で社有車・私有車を登録してください。</p>
      </div>
    `;
    return;
  }

  const now = new Date();
  if (!reportSelectedRef || !options.some((o) => o.ref === reportSelectedRef)) reportSelectedRef = options[0].ref;
  if (!reportSelectedYear) reportSelectedYear = now.getFullYear();
  if (!reportSelectedMonth) reportSelectedMonth = now.getMonth() + 1;

  const selectedOption = options.find((o) => o.ref === reportSelectedRef);
  const isLocked = tripQrVehicleId && !isAdminUnlocked() && options.length === 1 && options[0].ref === tripQrVehicleId;
  const monthOptions = buildMonthOptions(reportSelectedRef, reportSelectedYear, reportSelectedMonth);
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

  // 月末日の走行距離は翌月最初の記録から計算する。翌月分は他の端末でしか
  // 入力されていない場合もあるため、当月分と同様にクラウドから取得してマージする。
  const nextMonth = record.month === 12 ? 1 : record.month + 1;
  const nextYear = record.month === 12 ? record.year + 1 : record.year;
  const nextMonthRecord = loadMonthlyLog(reportSelectedRef, nextYear, nextMonth);
  const nextMonthDays = nextMonthRecord ? nextMonthRecord.days : {};

  const nextMonthKey = monthlyLogKey(reportSelectedRef, nextYear, nextMonth);
  if (reportNextMonthSyncedKey !== nextMonthKey) {
    reportNextMonthSyncedKey = nextMonthKey;
    syncMonthlyLogFromCloud(reportSelectedRef, nextYear, nextMonth, {
      vehicleId: selectedOption.vehicleId, privateCarLabel: selectedOption.privateCarLabel
    }).then((mergedRecord) => {
      if (mergedRecord) renderReportView();
    });
  }

  // 発行者確認バナーは「翌月の運転記録が1件でも保存されたか」だけで判定する
  // (月末点検の完了状況は見ない)。
  const nextMonthHasEntry = Object.values(nextMonthDays).some((d) => dayHasData(d));

  const totals = computeTotals(record.days, record.year, record.month, nextMonthDays);
  const holidays = computeJapaneseHolidays(record.year);
  // 事業所名・車両管理者は車両リストの登録内容から転記する(未登録の私有車履歴の場合は転記元が無いため空欄)
  const vehicle = selectedOption.vehicleId ? loadVehicles().find((v) => v.id === selectedOption.vehicleId) : null;
  const officeName = vehicle ? (vehicle.officeName || '') : '';
  const vehicleManager = vehicle ? vehicleManagerOf(vehicle) : '';

  root.innerHTML = `
    <div class="panel no-print">
      <div class="panel-head">
        <h2>運転月報</h2>
        <div class="panel-actions">
          ${isLocked
            ? `<span class="input-sm">${escapeHtml(selectedOption.label)}</span>`
            : `<select class="input-sm" id="reportVehicleSelect">
                ${options.map((o) => `<option value="${escapeHtml(o.ref)}" ${o.ref === reportSelectedRef ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}
              </select>`
          }
          <select class="input-sm" id="reportMonthSelect">
            ${monthOptions.map((m) => `<option value="${m.year}-${m.month}" ${m.year === reportSelectedYear && m.month === reportSelectedMonth ? 'selected' : ''}>${m.year}年${m.month}月</option>`).join('')}
          </select>
          ${isAdminUnlocked() ? `
            <button class="btn btn-ghost" type="button" id="reportStatusListBtn">提出状況一覧</button>
            <button class="btn btn-primary" type="button" id="reportPrintBtn">印刷／PDF</button>
          ` : ''}
        </div>
      </div>
      <div class="inline-form">
        <div class="field">
          <label>事業所名</label>
          <input type="text" class="input-lg" value="${escapeHtml(officeName)}" readonly>
          <p class="hint">※ 車両リストの車両登録内容から転記されます。未登録の私有車には転記元がないため空欄です。</p>
        </div>
        <div class="field">
          <label>車両管理者</label>
          <input type="text" class="input-lg" value="${escapeHtml(vehicleManager)}" readonly>
          <p class="hint">※ 車両リストの車両登録内容から転記されます。未登録の私有車には転記元がないため空欄です。</p>
        </div>
      </div>
      <p class="status ${reportStatusIsError ? 'error' : 'ok'}">${reportStatusMessage}</p>
      ${(!record.issuerConfirmedAt && nextMonthHasEntry) ? `
        <div class="issuer-confirm-panel no-print">
          <p>運転月報の記載内容を確認後、記載内容に問題が無ければ提出してください。</p>
          <button class="btn btn-primary" type="button" id="issuerConfirmBtn">提出</button>
        </div>
      ` : ''}
      ${(isAdminUnlocked() && record.issuerConfirmedAt && !record.safetyManagerConfirmedAt) ? `
        <div class="safety-confirm-panel no-print">
          <p>車両管理者による提出が完了しました。内容をご確認のうえ、承認または差し戻しをしてください。</p>
          <div class="field">
            <label>安全運転管理者名</label>
            <input type="text" class="input-lg" id="safetyManagerNameInput" placeholder="氏名を入力してください" value="${escapeHtml(reportSafetyManagerNameDraft)}">
          </div>
          <div class="form-actions">
            <button class="btn btn-primary" type="button" id="safetyConfirmBtn">確認</button>
            <button class="btn btn-danger" type="button" id="safetyRejectBtn">差戻し</button>
          </div>
        </div>
      ` : ''}
    </div>

    ${buildReportSheetHtml(record, nextMonthDays, officeName, vehicleManager, selectedOption.vehicleId ? (vehicle || {}).plateNumber || '' : (record.privateCarLabel || ''))}
  `;

  const reportVehicleSelectEl = document.getElementById('reportVehicleSelect');
  if (reportVehicleSelectEl) {
    reportVehicleSelectEl.addEventListener('change', (e) => {
      reportSelectedRef = e.target.value;
      reportCellErrors = new Set();
      reportSafetyManagerNameDraft = '';
      renderReportView();
    });
  }
  document.getElementById('reportMonthSelect').addEventListener('change', (e) => {
    const [y, m] = e.target.value.split('-').map(Number);
    reportSelectedYear = y; reportSelectedMonth = m;
    reportCellErrors = new Set();
    reportSafetyManagerNameDraft = '';
    renderReportView();
  });
  const reportPrintBtnEl = document.getElementById('reportPrintBtn');
  if (reportPrintBtnEl) reportPrintBtnEl.addEventListener('click', () => window.print());
  const reportStatusListBtnEl = document.getElementById('reportStatusListBtn');
  if (reportStatusListBtnEl) {
    reportStatusListBtnEl.addEventListener('click', () => {
      reportShowStatusList = true;
      reportStatusListData = undefined;
      renderReportView();
    });
  }
  const issuerConfirmBtnEl = document.getElementById('issuerConfirmBtn');
  if (issuerConfirmBtnEl) {
    issuerConfirmBtnEl.addEventListener('click', () => {
      const errors = findSubmissionErrorCells(record, nextMonthDays);
      if (errors.size) {
        reportCellErrors = errors;
        const messages = [];
        if (Array.from(errors).some((k) => k.startsWith('day:'))) {
          messages.push('出庫時メーター指針が入力されている日で、走行距離・行先・運転者・アルコールチェック(始業前/終業後)のいずれかが未入力の日があります(ピンク色のセルをご確認ください)');
        }
        if (Array.from(errors).some((k) => k.startsWith('checklist:'))) {
          messages.push('日常点検(15日・末日)の記録が未入力の項目があります(ピンク色の項目をご確認ください)');
        }
        reportStatusMessage = messages.join(' ');
        reportStatusIsError = true;
        renderReportView();
        return;
      }
      reportCellErrors = new Set();
      reportStatusMessage = '';
      reportStatusIsError = false;
      record.issuerConfirmedAt = new Date().toISOString();
      record.metaUpdatedAt = new Date().toISOString();
      saveMonthlyLog(record);
      syncLogMetaToCloud(record.key, buildMetaPayload(record));
      reportJustSubmitted = true;
      renderReportView();
    });
  }

  const safetyManagerNameInputEl = document.getElementById('safetyManagerNameInput');
  if (safetyManagerNameInputEl) {
    safetyManagerNameInputEl.addEventListener('input', (e) => {
      reportSafetyManagerNameDraft = e.target.value;
    });
  }

  const safetyConfirmBtnEl = document.getElementById('safetyConfirmBtn');
  if (safetyConfirmBtnEl) {
    safetyConfirmBtnEl.addEventListener('click', () => {
      const name = reportSafetyManagerNameDraft.trim();
      if (!name) {
        reportStatusMessage = '安全運転管理者名を入力してください';
        reportStatusIsError = true;
        renderReportView();
        return;
      }
      record.safetyManagerConfirmedAt = new Date().toISOString();
      record.safetyManagerName = name;
      record.metaUpdatedAt = new Date().toISOString();
      reportSafetyManagerNameDraft = '';
      reportStatusMessage = '';
      reportStatusIsError = false;
      saveMonthlyLog(record);
      syncLogMetaToCloud(record.key, buildMetaPayload(record));
      showToast('確認しました');
      renderReportView();
    });
  }

  const safetyRejectBtnEl = document.getElementById('safetyRejectBtn');
  if (safetyRejectBtnEl) {
    safetyRejectBtnEl.addEventListener('click', () => {
      if (!confirm('差し戻します。車両管理者は再度「提出」が必要になります。よろしいですか?')) return;
      const subject = '運転月報の再提出依頼';
      const body = '運転月報の提出ありがとうございます。\n' +
        '提出いただきました運転月報ですが、内容に不備がありますので、見直しをして再提出をお願いいたします。\n' +
        '安全品質保証部';
      location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

      record.issuerConfirmedAt = ''; // nullにするとFirebase側でキーごと消えてしまい、他端末の
      // 古い確定値を上書きできなくなるため空文字を使う(storage.jsのcreateEmptyMonthlyLog参照)
      record.metaUpdatedAt = new Date().toISOString();
      reportSafetyManagerNameDraft = '';
      saveMonthlyLog(record);
      syncLogMetaToCloud(record.key, buildMetaPayload(record));
      showToast('差戻しました');
      renderReportView();
    });
  }

  document.querySelector('.report-sheet').addEventListener('change', (e) => {
    const input = e.target.closest('input[data-field]');
    if (input) {
      const day = Number(input.dataset.day);
      const field = input.dataset.field;
      const numericFields = ['meterReading', 'alcoholCheckBefore', 'alcoholCheckAfter', 'fuelAdded'];
      const value = numericFields.includes(field) ? parseNumberOrNull(input.value) : String(input.value || '').trim();
      const savedRecord = saveTripDay(reportSelectedRef, record.year, record.month, day, { [field]: value }, { vehicleId: record.vehicleId, privateCarLabel: record.privateCarLabel });
      syncLogDayToCloud(savedRecord.key, day, savedRecord.days[day]);
      if (field === 'driver' && value) pushRecentDriver(value);
      if (reportCellErrors.size) reportCellErrors = findSubmissionErrorCells(savedRecord, nextMonthDays);
      renderReportView();
      return;
    }
    const select = e.target.closest('select.checklist-result-select');
    if (select) {
      const listKey = select.dataset.checklistList;
      const idx = Number(select.dataset.checklistIndex);
      record[listKey][idx].result = select.value || null;
      record.metaUpdatedAt = new Date().toISOString();
      saveMonthlyLog(record);
      syncLogMetaToCloud(record.key, buildMetaPayload(record));
      if (reportCellErrors.size) reportCellErrors = findSubmissionErrorCells(record, nextMonthDays);
      renderReportView();
    }
  });

  // 入力の途中でも収まり具合は変わるので、描画直後と1文字ごとの入力で合わせ直す。
  document.querySelector('.report-sheet').addEventListener('input', (e) => {
    const input = e.target.closest('input.cell-input');
    if (input) fitReportCellText(input);
  });
  fitReportCellText();
}

// 管理者向け:全車両分の当月提出状況を一覧表示する。
function renderReportStatusList(root) {
  const year = reportSelectedYear || new Date().getFullYear();
  const month = reportSelectedMonth || (new Date().getMonth() + 1);
  const monthOptions = Array.from(recentMonthOptions(year, month).values())
    .sort((a, b) => (b.year - a.year) || (b.month - a.month));

  if (reportStatusListData === undefined) {
    fetchSubmissionStatusForMonth(year, month).then((map) => {
      reportStatusListData = map;
      if (reportShowStatusList) renderReportView();
    });
  }

  // 前回月から切り替わっていた場合、別の月の車両にチェックが残ったまま一括印刷に
  // 進んでしまわないよう、選択状態をクリアする。
  if (reportStatusListSelectedMonthKey !== `${year}-${month}`) {
    reportStatusListSelectedMonthKey = `${year}-${month}`;
    reportStatusListSelected = new Set();
  }

  const vehicles = sortVehiclesByOffice(loadVehicles().filter((v) => v.active !== false));
  const rows = vehicles.map((v) => {
    const status = reportStatusListData instanceof Map ? reportStatusListData.get(v.id) : null;
    let label, cls;
    if (!status || !status.issuerConfirmedAt) {
      label = '未提出'; cls = 'status-pending';
    } else if (!status.safetyManagerConfirmedAt) {
      label = `提出済み(承認待ち)　${formatShortDate(status.issuerConfirmedAt)}`; cls = 'status-submitted';
    } else {
      label = `承認済み　${formatShortDate(status.safetyManagerConfirmedAt)}　${escapeHtml(status.safetyManagerName || '')}`; cls = 'status-approved';
    }
    const vehicleLabel = v.vehicleType === 'private'
      ? `${v.plateNumber}（${v.nickname ? `${v.nickname}・私有車` : '私有車'}）`
      : `${v.plateNumber}（${v.nickname || '車種未設定'}）`;
    return `
      <tr class="status-list-row" data-vehicle-ref="${escapeHtml(v.id)}">
        <td class="status-list-check-cell"><input type="checkbox" class="status-list-check" data-vehicle-ref="${escapeHtml(v.id)}" ${reportStatusListSelected.has(v.id) ? 'checked' : ''}></td>
        <td>${escapeHtml(v.officeName || '')}</td>
        <td>${escapeHtml(vehicleLabel)}</td>
        <td class="${cls}">${label}</td>
      </tr>
    `;
  }).join('');
  const allChecked = vehicles.length > 0 && vehicles.every((v) => reportStatusListSelected.has(v.id));

  root.innerHTML = `
    <div class="panel no-print">
      <div class="panel-head">
        <h2>提出状況一覧</h2>
        <div class="panel-actions">
          <select class="input-sm" id="reportStatusMonthSelect">
            ${monthOptions.map((m) => `<option value="${m.year}-${m.month}" ${m.year === year && m.month === month ? 'selected' : ''}>${m.year}年${m.month}月</option>`).join('')}
          </select>
          <button class="btn btn-primary" type="button" id="reportBulkPrintBtn" ${reportStatusListSelected.size === 0 ? 'disabled' : ''}>選択した車両を一括印刷／PDF(${reportStatusListSelected.size})</button>
          <button class="btn btn-ghost" type="button" id="reportStatusListBackBtn">月報表示に戻る</button>
        </div>
      </div>
      ${reportStatusListData === undefined ? '<p class="hint">読み込み中…</p>' : ''}
      ${reportStatusListData === null ? '<p class="status error">取得に失敗しました。通信状況を確認してください</p>' : ''}
      <table class="report-table status-list-table">
        <thead><tr><th><input type="checkbox" id="reportStatusListSelectAll" ${allChecked ? 'checked' : ''}></th><th>事業所名</th><th>車両</th><th>提出状況</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="4">車両が登録されていません</td></tr>'}</tbody>
      </table>
    </div>
  `;

  document.getElementById('reportStatusMonthSelect').addEventListener('change', (e) => {
    const [y, m] = e.target.value.split('-').map(Number);
    reportSelectedYear = y; reportSelectedMonth = m;
    reportStatusListData = undefined;
    renderReportView();
  });
  document.getElementById('reportStatusListBackBtn').addEventListener('click', () => {
    reportShowStatusList = false;
    renderReportView();
  });
  const reportBulkPrintBtnEl = document.getElementById('reportBulkPrintBtn');
  if (reportBulkPrintBtnEl) {
    reportBulkPrintBtnEl.addEventListener('click', () => {
      reportBulkPrintReady = false;
      reportBulkPrintActive = true;
      renderReportView();
    });
  }
  document.getElementById('reportStatusListSelectAll').addEventListener('change', (e) => {
    if (e.target.checked) vehicles.forEach((v) => reportStatusListSelected.add(v.id));
    else vehicles.forEach((v) => reportStatusListSelected.delete(v.id));
    renderReportView();
  });
  root.querySelectorAll('.status-list-check').forEach((cb) => {
    cb.addEventListener('click', (e) => e.stopPropagation());
    cb.addEventListener('change', (e) => {
      const ref = e.target.dataset.vehicleRef;
      if (e.target.checked) reportStatusListSelected.add(ref);
      else reportStatusListSelected.delete(ref);
      renderReportView();
    });
  });
  root.querySelectorAll('.status-list-row').forEach((tr) => {
    tr.addEventListener('click', () => {
      reportSelectedRef = tr.dataset.vehicleRef;
      reportShowStatusList = false;
      reportCellErrors = new Set();
      reportSafetyManagerNameDraft = '';
      renderReportView();
    });
  });
}

// 管理者向け:提出状況一覧でチェックした車両分の運転月報をまとめて表示し、1回の印刷操作で
// 全台分をPDF化できるようにする。表示前に各車両のクラウド最新データを同期してから組み立てる。
function renderReportBulkPrint(root) {
  const year = reportSelectedYear;
  const month = reportSelectedMonth;
  const vehicles = sortVehiclesByOffice(loadVehicles().filter((v) => v.active !== false && reportStatusListSelected.has(v.id)));

  if (!reportBulkPrintReady) {
    root.innerHTML = `
      <div class="panel no-print">
        <h2>一括印刷／PDF</h2>
        <p class="hint">選択した${vehicles.length}台分のデータを読み込んでいます…</p>
      </div>
    `;
    Promise.all(vehicles.map((v) => syncAndBuildReportSheetForVehicle(v, year, month)))
      .then((sheets) => {
        reportBulkPrintReady = true;
        reportBulkPrintSheets = sheets;
        if (reportBulkPrintActive) renderReportView();
      });
    return;
  }

  root.innerHTML = `
    <div class="panel no-print">
      <div class="panel-head">
        <h2>一括印刷／PDF(${vehicles.length}台・${year}年${month}月)</h2>
        <div class="panel-actions">
          <button class="btn btn-ghost" type="button" id="reportBulkPrintBackBtn">一覧に戻る</button>
          <button class="btn btn-primary" type="button" id="reportBulkPrintGoBtn" ${vehicles.length === 0 ? 'disabled' : ''}>印刷／PDF</button>
        </div>
      </div>
    </div>
    ${reportBulkPrintSheets.join('')}
  `;

  document.getElementById('reportBulkPrintBackBtn').addEventListener('click', () => {
    reportBulkPrintActive = false;
    renderReportView();
  });
  const reportBulkPrintGoBtnEl = document.getElementById('reportBulkPrintGoBtn');
  if (reportBulkPrintGoBtnEl) reportBulkPrintGoBtnEl.addEventListener('click', () => window.print());
  fitReportCellText();
}

// 行先・運転者は「1日1車両=1行」のまま追記していく運用のため、日によっては列幅に
// 収まらないことがある。溢れたセルだけ、セル幅に収まるところまで文字サイズを自動で
// 縮める(下限あり)。指定はem(=そのセルが継承している文字サイズに対する比率)なので、
// 画面(.report-table 0.8rem)と印刷(9.5pt)のどちらでもそれぞれの基準に対して効く。
const REPORT_CELL_MIN_FONT_SCALE = 0.5;
let reportCellMeasureCanvas = null;

// input要素はscrollWidthが実際の文字幅を返さないブラウザがあるため、canvasで実測する。
function measureReportCellTextWidth(text, el) {
  if (!reportCellMeasureCanvas) reportCellMeasureCanvas = document.createElement('canvas');
  const ctx = reportCellMeasureCanvas.getContext('2d');
  const cs = getComputedStyle(el);
  ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  return ctx.measureText(text).width;
}

// 印刷はA4縦・左右余白13mm/8mm(@page)なので、実際に表が載る幅は画面より狭い。
// 画面の列幅そのままで判定すると印刷時だけ溢れるため、印刷直前は「印刷時の表幅 /
// 画面上の表幅」を掛けて厳しめに判定する。
const PRINT_CONTENT_WIDTH_PX = (210 - 13 - 8) / 25.4 * 96;

function reportPrintWidthScale() {
  const table = document.querySelector('.report-table');
  if (!table || !table.clientWidth) return 1;
  return Math.min(1, PRINT_CONTENT_WIDTH_PX / table.clientWidth);
}

// targetを渡せばそのセルだけ、省略すれば全セルの文字サイズを合わせ直す。
// widthScaleは印刷時に列幅が狭くなる分の補正(画面表示時は1)。
function fitReportCellText(target, widthScale = 1) {
  const inputs = target ? [target] : Array.from(document.querySelectorAll('.report-table input.cell-input'));
  inputs.forEach((el) => {
    el.style.fontSize = ''; // 基準サイズに戻してから測り直す(前回の縮小を引きずらない)
    const text = el.value || '';
    if (!text) return;
    const available = el.clientWidth * widthScale - 1; // 端がぎりぎり切れないよう1px余裕を見る
    if (available <= 0) return;
    const needed = measureReportCellTextWidth(text, el);
    if (needed <= available) return;
    const scale = Math.max(REPORT_CELL_MIN_FONT_SCALE, available / needed);
    el.style.fontSize = `${scale.toFixed(3)}em`;
  });
}

function reportBlock(days, startDay, endDay, year, month, holidays, nextMonthDays) {
  const rows = [];
  for (let d = startDay; d <= endDay; d++) {
    const day = days[d] || {};
    const distance = computeDistance(days, d, year, month, nextMonthDays);
    const colorClass = dayColorClass(year, month, d, holidays);
    const distanceErrorClass = reportCellErrors.has(`day:${d}:distance`) ? 'cell-error' : '';
    const destErrorClass = reportCellErrors.has(`day:${d}:destination`) ? 'cell-error' : '';
    const driverErrorClass = reportCellErrors.has(`day:${d}:driver`) ? 'cell-error' : '';
    const beforeErrorClass = reportCellErrors.has(`day:${d}:alcoholCheckBefore`) ? 'cell-error' : '';
    const afterErrorClass = reportCellErrors.has(`day:${d}:alcoholCheckAfter`) ? 'cell-error' : '';
    rows.push(`
      <tr>
        <td class="day-cell ${colorClass}">${d}</td>
        <td class="num-cell meter-cell"><input type="text" inputmode="decimal" class="cell-input" data-day="${d}" data-field="meterReading" value="${day.meterReading != null ? day.meterReading : ''}"></td>
        <td class="num-cell distance-cell ${distanceErrorClass}">${distance !== '' ? distance.toLocaleString() : ''}</td>
        <td class="dest-cell ${destErrorClass}"><input type="text" class="cell-input" data-day="${d}" data-field="destination" value="${escapeHtml(day.destination || '')}"></td>
        <td class="driver-cell ${driverErrorClass}"><input type="text" class="cell-input" data-day="${d}" data-field="driver" value="${escapeHtml(day.driver || '')}"></td>
        <td class="num-cell ${beforeErrorClass}"><input type="text" inputmode="decimal" class="cell-input" data-day="${d}" data-field="alcoholCheckBefore" value="${day.alcoholCheckBefore != null ? day.alcoholCheckBefore : ''}"></td>
        <td class="num-cell ${afterErrorClass}"><input type="text" inputmode="decimal" class="cell-input" data-day="${d}" data-field="alcoholCheckAfter" value="${day.alcoholCheckAfter != null ? day.alcoholCheckAfter : ''}"></td>
        <td class="num-cell"><input type="text" inputmode="decimal" class="cell-input" data-day="${d}" data-field="fuelAdded" value="${day.fuelAdded != null ? day.fuelAdded : ''}"></td>
      </tr>
    `);
  }
  return `
    <table class="report-table">
      <thead>
        <tr>
          <th>日付</th>
          <th class="meter-cell">出庫時メーター指針<br>km</th>
          <th class="distance-cell">走行距離<br>km</th>
          <th class="dest-cell">行先</th>
          <th>運転者</th>
          <th>ｱﾙｺｰﾙCK<br>始業前</th>
          <th>ｱﾙｺｰﾙCK<br>終業後</th>
          <th>給油<br>ℓ</th>
        </tr>
      </thead>
      <tbody>${rows.join('')}</tbody>
    </table>
  `;
}

// サンプルExcelの日常点検項目ブロック(左に縦書きの点検指定日ラベル、項目ごとに番号+説明文の行、
// 右端に結果(○/×)列、下に記入方法の注記)をそのまま再現する。
// colgroupで列幅を明示するのは、table-layout:fixedでは1行目のcolspanセルしか列幅計算に
// 使われず、2行目以降のtd幅指定(番号セル等)が無視されてしまうため。
function checklistBlock(headerNote, items, listKey) {
  const rows = items.map((item, i) => {
    const errorClass = reportCellErrors.has(`checklist:${listKey}:${i}`) ? 'cell-error' : '';
    return `
    <tr>
      <td class="checklist-num">${i + 1}</td>
      <td class="checklist-item">${FIXED_CHECKLIST_ITEMS[i]}</td>
      <td class="checklist-result ${errorClass}">
        <select class="checklist-result-select" data-checklist-list="${listKey}" data-checklist-index="${i}">
          <option value="" ${!item.result ? 'selected' : ''}></option>
          <option value="○" ${item.result === '○' ? 'selected' : ''}>○</option>
          <option value="×" ${item.result === '×' ? 'selected' : ''}>×</option>
        </select>
      </td>
    </tr>
  `;
  }).join('');
  return `
    <table class="report-table checklist-table">
      <colgroup>
        <col class="col-daylabel"><col class="col-num"><col class="col-item"><col class="col-result">
      </colgroup>
      <tbody>
        <tr>
          <td class="checklist-daylabel" rowspan="${items.length + 2}">点検指定日</td>
          <td class="checklist-header" colspan="2">日　常　点　検　項　目　（${headerNote}）</td>
          <td class="checklist-result-header">結果</td>
        </tr>
        ${rows}
        <tr>
          <td class="checklist-note" colspan="3">点検結果は：異常なしは○、異常ありは×を記入し、×の場合は処置する又は自動車修理依頼書を発行すること。</td>
        </tr>
      </tbody>
    </table>
  `;
}

// 印刷時は用紙幅に合わせて厳しめに縮め、印刷が終わったら画面用に戻す。
// 画面幅が変われば列幅も変わるため、リサイズ後にも合わせ直す。
window.addEventListener('beforeprint', () => fitReportCellText(null, reportPrintWidthScale()));
window.addEventListener('afterprint', () => fitReportCellText());
let reportCellFitResizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(reportCellFitResizeTimer);
  reportCellFitResizeTimer = setTimeout(() => fitReportCellText(), 150);
});
