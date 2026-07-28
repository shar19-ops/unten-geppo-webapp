// 運転月報画面。データはstorage.js経由(loadMonthlyLog/saveMonthlyLog)。

let reportSelectedRef = null;
let reportSelectedYear = null;
let reportSelectedMonth = null;
let reportStatusMessage = '';
let reportStatusIsError = false;
let reportSyncedKey = null; // 直近でクラウド同期を試みた月報キー(同じキーの間は再同期しない)
let reportNextMonthSyncedKey = null; // 直近でクラウド同期を試みた翌月分の月報キー(月末走行距離の自動計算用)
let reportAlcoholErrorCells = new Set(); // "day:field" 形式。提出時のアルコールチェック未入力バリデーションで使う
let reportSafetyManagerNameDraft = ''; // 安全運転管理者名の入力途中の値を再描画間で保持する

// 始業前・終業後のどちらか一方だけ入力されている日を探す(両方入力済み・両方未入力は対象外)。
function findAlcoholErrorCells(record) {
  const errors = new Set();
  for (let d = 1; d <= 31; d++) {
    const day = record.days[d] || {};
    const hasBefore = day.alcoholCheckBefore != null;
    const hasAfter = day.alcoholCheckAfter != null;
    if (hasBefore && !hasAfter) errors.add(`${d}:alcoholCheckAfter`);
    if (hasAfter && !hasBefore) errors.add(`${d}:alcoholCheckBefore`);
  }
  return errors;
}

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

function buildMonthOptions(vehicleRef, selectedYear, selectedMonth) {
  const now = new Date();
  const map = new Map();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    map.set(`${d.getFullYear()}-${d.getMonth() + 1}`, { year: d.getFullYear(), month: d.getMonth() + 1 });
  }
  listMonthlyLogKeysForVehicle(vehicleRef).forEach((e) => {
    map.set(`${e.year}-${e.month}`, { year: e.year, month: e.month });
  });
  map.set(`${selectedYear}-${selectedMonth}`, { year: selectedYear, month: selectedMonth });
  return Array.from(map.values()).sort((a, b) => (b.year - a.year) || (b.month - a.month));
}

function renderReportView() {
  const root = document.getElementById('view-report');
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
  const isLocked = tripQrVehicleId && options.length === 1 && options[0].ref === tripQrVehicleId;
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

    <div class="report-sheet">
      <div class="report-header">
        <div class="report-header-cell">事業所名<br><strong>${escapeHtml(officeName)}</strong></div>
        <div class="report-header-cell report-title">${record.year}年　${record.month}月　運転月報</div>
        <div class="report-header-cell">
          車両管理者：<strong>${escapeHtml(vehicleManager)}</strong><br>
          車両番号：<strong>${escapeHtml(selectedOption.vehicleId ? (vehicle || {}).plateNumber || '' : (record.privateCarLabel || ''))}</strong>
        </div>
      </div>

      ${reportBlock(record.days, 1, 15, record.year, record.month, holidays, nextMonthDays)}
      ${checklistBlock('点検日15日', record.checklistMid)}
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

        ${checklistBlock('点検日は月の末日', record.checklistEnd)}
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

  const reportVehicleSelectEl = document.getElementById('reportVehicleSelect');
  if (reportVehicleSelectEl) {
    reportVehicleSelectEl.addEventListener('change', (e) => {
      reportSelectedRef = e.target.value;
      reportAlcoholErrorCells = new Set();
      reportSafetyManagerNameDraft = '';
      renderReportView();
    });
  }
  document.getElementById('reportMonthSelect').addEventListener('change', (e) => {
    const [y, m] = e.target.value.split('-').map(Number);
    reportSelectedYear = y; reportSelectedMonth = m;
    reportAlcoholErrorCells = new Set();
    reportSafetyManagerNameDraft = '';
    renderReportView();
  });
  const reportPrintBtnEl = document.getElementById('reportPrintBtn');
  if (reportPrintBtnEl) reportPrintBtnEl.addEventListener('click', () => window.print());
  const issuerConfirmBtnEl = document.getElementById('issuerConfirmBtn');
  if (issuerConfirmBtnEl) {
    issuerConfirmBtnEl.addEventListener('click', () => {
      const errors = findAlcoholErrorCells(record);
      if (errors.size) {
        reportAlcoholErrorCells = errors;
        reportStatusMessage = 'アルコールチェックが未入力の日があります(ピンク色のセルをご確認ください)';
        reportStatusIsError = true;
        renderReportView();
        return;
      }
      reportAlcoholErrorCells = new Set();
      reportStatusMessage = '';
      reportStatusIsError = false;
      record.issuerConfirmedAt = new Date().toISOString();
      record.metaUpdatedAt = new Date().toISOString();
      saveMonthlyLog(record);
      syncLogMetaToCloud(record.key, buildMetaPayload(record));
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
      renderReportView();
    });
  }

  const safetyRejectBtnEl = document.getElementById('safetyRejectBtn');
  if (safetyRejectBtnEl) {
    safetyRejectBtnEl.addEventListener('click', () => {
      if (!confirm('差し戻します。車両管理者は再度「提出」が必要になります。よろしいですか?')) return;
      const subject = '運転月報の再提出依頼';
      const body = '運転月報の提出ありがとうございます。\n' +
        '　　　提出いただきました運転月報ですが内容に不備がありますので見直しをして再提出をお願いいたします。\n' +
        '　　　安全品質保証部';
      location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

      record.issuerConfirmedAt = ''; // nullにするとFirebase側でキーごと消えてしまい、他端末の
      // 古い確定値を上書きできなくなるため空文字を使う(storage.jsのcreateEmptyMonthlyLog参照)
      record.metaUpdatedAt = new Date().toISOString();
      reportSafetyManagerNameDraft = '';
      saveMonthlyLog(record);
      syncLogMetaToCloud(record.key, buildMetaPayload(record));
      renderReportView();
    });
  }

  document.querySelector('.report-sheet').addEventListener('change', (e) => {
    const input = e.target.closest('input[data-field]');
    if (!input) return;
    const day = Number(input.dataset.day);
    const field = input.dataset.field;
    const numericFields = ['meterReading', 'alcoholCheckBefore', 'alcoholCheckAfter', 'fuelAdded'];
    const value = numericFields.includes(field) ? parseNumberOrNull(input.value) : String(input.value || '').trim();
    const savedRecord = saveTripDay(reportSelectedRef, record.year, record.month, day, { [field]: value }, { vehicleId: record.vehicleId, privateCarLabel: record.privateCarLabel });
    syncLogDayToCloud(savedRecord.key, day, savedRecord.days[day]);
    if (field === 'driver' && value) pushRecentDriver(value);
    if (reportAlcoholErrorCells.size) reportAlcoholErrorCells = findAlcoholErrorCells(savedRecord);
    renderReportView();
  });
}

function reportBlock(days, startDay, endDay, year, month, holidays, nextMonthDays) {
  const rows = [];
  for (let d = startDay; d <= endDay; d++) {
    const day = days[d] || {};
    const distance = computeDistance(days, d, year, month, nextMonthDays);
    const colorClass = dayColorClass(year, month, d, holidays);
    const beforeErrorClass = reportAlcoholErrorCells.has(`${d}:alcoholCheckBefore`) ? 'cell-error' : '';
    const afterErrorClass = reportAlcoholErrorCells.has(`${d}:alcoholCheckAfter`) ? 'cell-error' : '';
    rows.push(`
      <tr>
        <td class="day-cell ${colorClass}">${d}</td>
        <td class="num-cell meter-cell"><input type="text" inputmode="decimal" class="cell-input" data-day="${d}" data-field="meterReading" value="${day.meterReading != null ? day.meterReading : ''}"></td>
        <td class="num-cell distance-cell">${distance !== '' ? distance.toLocaleString() : ''}</td>
        <td class="dest-cell"><input type="text" class="cell-input" data-day="${d}" data-field="destination" value="${escapeHtml(day.destination || '')}"></td>
        <td class="driver-cell"><input type="text" class="cell-input" data-day="${d}" data-field="driver" value="${escapeHtml(day.driver || '')}"></td>
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
function checklistBlock(headerNote, items) {
  const rows = items.map((item, i) => `
    <tr>
      <td class="checklist-num">${i + 1}</td>
      <td class="checklist-item">${FIXED_CHECKLIST_ITEMS[i]}</td>
      <td class="checklist-result">${escapeHtml(item.result || '')}</td>
    </tr>
  `).join('');
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
