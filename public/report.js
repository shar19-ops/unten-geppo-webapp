// 運転月報画面。データはstorage.js経由(loadMonthlyLog/saveMonthlyLog/mergeMonthlyLog)。

let reportSelectedRef = null;
let reportSelectedYear = null;
let reportSelectedMonth = null;
let reportStatusMessage = '';
let reportStatusIsError = false;
let reportImportConflicts = null; // {merged, conflicts}
let reportSyncedKey = null; // 直近でクラウド同期を試みた月報キー(同じキーの間は再同期しない)

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

  const totals = computeTotals(record.days);
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
          <input type="file" id="reportJsonInput" accept=".json" hidden>
          <button class="btn btn-ghost" type="button" id="reportJsonImportBtn">JSONから取込</button>
          <button class="btn btn-ghost" type="button" id="reportJsonExportBtn">JSONへ出力</button>
          <button class="btn btn-ghost" type="button" id="reportPrintBtn">印刷／PDF</button>
          <button class="btn btn-primary" type="button" id="xlsxExportBtn">Excelとして出力</button>
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
      ${reportImportConflicts ? logConflictPanelHtml(reportImportConflicts.conflicts) : ''}
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

      ${reportBlock(record.days, 1, 15, record.year, record.month, holidays)}
      ${checklistBlock('点検日15日', record.checklistMid)}
      <div class="report-page2">
        ${reportBlock(record.days, 16, 31, record.year, record.month, holidays)}

        <table class="report-table totals-table">
          <tr>
            <td class="label-cell">走行距離合計(km)</td><td class="num-cell distance-cell">${totals.totalDistance}</td>
            <td class="label-cell fuel-economy-label">燃費＝走行距離合計／給油合計(km/L)</td><td class="num-cell">${totals.fuelEconomy}</td>
            <td class="label-cell">給油合計(L)</td><td class="num-cell">${totals.totalFuel.toFixed(2)}</td>
          </tr>
        </table>

        ${checklistBlock('点検日は月の末日', record.checklistEnd)}
      </div>
    </div>
  `;

  const reportVehicleSelectEl = document.getElementById('reportVehicleSelect');
  if (reportVehicleSelectEl) {
    reportVehicleSelectEl.addEventListener('change', (e) => {
      reportSelectedRef = e.target.value;
      reportImportConflicts = null;
      renderReportView();
    });
  }
  document.getElementById('reportMonthSelect').addEventListener('change', (e) => {
    const [y, m] = e.target.value.split('-').map(Number);
    reportSelectedYear = y; reportSelectedMonth = m;
    reportImportConflicts = null;
    renderReportView();
  });
  document.getElementById('reportPrintBtn').addEventListener('click', () => window.print());
  document.getElementById('xlsxExportBtn').addEventListener('click', async () => {
    reportStatusMessage = '出力しています…';
    reportStatusIsError = false;
    renderReportView();
    try {
      await loadScriptOnce('vendor/exceljs/exceljs.min.js');
      const vehicleLabel = selectedOption.vehicleId ? (vehicle || {}).plateNumber : record.privateCarLabel;
      await exportMonthlyLogToXlsx(record, vehicleLabel, officeName, vehicleManager);
      reportStatusMessage = 'Excelファイルを出力しました';
      reportStatusIsError = false;
    } catch (err) {
      reportStatusMessage = 'Excel出力に失敗しました: ' + err.message;
      reportStatusIsError = true;
    }
    renderReportView();
  });
  document.getElementById('reportJsonExportBtn').addEventListener('click', async () => {
    const vehicleLabel = selectedOption.vehicleId ? (vehicle || {}).plateNumber : record.privateCarLabel;
    const filename = await exportMonthlyLogToFile(record, vehicleLabel);
    reportStatusMessage = filename ? `書き出しました(${filename})` : '';
    reportStatusIsError = false;
    renderReportView();
  });
  document.getElementById('reportJsonImportBtn').addEventListener('click', () => document.getElementById('reportJsonInput').click());
  document.getElementById('reportJsonInput').addEventListener('change', onReportJsonSelected);

  if (reportImportConflicts) {
    document.getElementById('logConflictApplyBtn').addEventListener('click', applyLogConflictResolution);
    document.getElementById('logConflictCancelBtn').addEventListener('click', () => {
      reportImportConflicts = null;
      reportStatusMessage = '取込を取り消しました';
      reportStatusIsError = false;
      renderReportView();
    });
  }
}

async function onReportJsonSelected(e) {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const imported = await readJsonFile(file);
    if (!imported || typeof imported !== 'object' || !imported.days || !imported.year || !imported.month) {
      throw new Error('運転月報のデータファイルではないようです');
    }
    const importedRef = vehicleRefFor(imported.vehicleId, imported.privateCarLabel);
    reportSelectedRef = importedRef;
    reportSelectedYear = imported.year;
    reportSelectedMonth = imported.month;
    const local = loadMonthlyLog(importedRef, imported.year, imported.month);
    const { merged, conflicts } = mergeMonthlyLog(local, imported);
    if (conflicts.length) {
      reportImportConflicts = { merged, conflicts };
      reportStatusMessage = `${conflicts.length}件の日で内容の食い違いがあります。下で選んで適用してください。`;
      reportStatusIsError = true;
    } else {
      saveMonthlyLog(merged);
      reportStatusMessage = '取込内容を反映しました';
      reportStatusIsError = false;
    }
    renderReportView();
  } catch (err) {
    reportStatusMessage = 'JSONファイルを読み込めませんでした: ' + err.message;
    reportStatusIsError = true;
    renderReportView();
  }
}

function logConflictPanelHtml(conflicts) {
  return `
    <div class="conflict-panel">
      <h3>取込内容が既存データと異なります(${conflicts.length}件)</h3>
      ${conflicts.map((c, i) => {
        const label = c.type === 'day' ? `${c.day}日` : `点検(${c.label})`;
        const localText = c.type === 'day' ? `${c.local.destination || ''} / ${c.local.driver || ''}` : c.local;
        const importedText = c.type === 'day' ? `${c.imported.destination || ''} / ${c.imported.driver || ''}` : c.imported;
        return `
          <div class="conflict-row">
            <span class="conflict-label">${label}</span>
            <span>この端末: ${localText}</span>
            <span>取込データ: ${importedText}</span>
            <span class="conflict-choice">
              <label><input type="radio" name="log-conflict-${i}" value="local" checked> この端末を残す</label>
              <label><input type="radio" name="log-conflict-${i}" value="imported"> 取込データで更新</label>
            </span>
          </div>
        `;
      }).join('')}
      <div class="form-actions" style="margin-top:0.75rem;">
        <button class="btn btn-primary" type="button" id="logConflictApplyBtn">選択内容を適用</button>
        <button class="btn btn-ghost" type="button" id="logConflictCancelBtn">取込を取り消す</button>
      </div>
    </div>
  `;
}

function applyLogConflictResolution() {
  const { merged, conflicts } = reportImportConflicts;
  conflicts.forEach((c, i) => {
    const choice = document.querySelector(`input[name="log-conflict-${i}"]:checked`).value;
    if (choice !== 'imported') return;
    if (c.type === 'day') merged.days[c.day] = c.imported;
    else merged[c.listKey][c.index].result = c.imported;
  });
  saveMonthlyLog(merged);
  reportImportConflicts = null;
  reportStatusMessage = '取込内容を適用しました';
  reportStatusIsError = false;
  renderReportView();
}

function reportBlock(days, startDay, endDay, year, month, holidays) {
  const rows = [];
  for (let d = startDay; d <= endDay; d++) {
    const day = days[d] || {};
    const distance = computeDistance(days, d);
    const colorClass = dayColorClass(year, month, d, holidays);
    rows.push(`
      <tr>
        <td class="day-cell ${colorClass}">${d}</td>
        <td class="num-cell meter-cell">${day.meterReading != null ? day.meterReading.toLocaleString() : ''}</td>
        <td class="num-cell distance-cell">${distance !== '' ? distance.toLocaleString() : ''}</td>
        <td class="dest-cell">${escapeHtml(day.destination || '')}</td>
        <td class="driver-cell">${escapeHtml(day.driver || '')}</td>
        <td class="num-cell">${day.alcoholCheck != null ? day.alcoholCheck : ''}</td>
        <td class="num-cell">${day.fuelAdded != null ? day.fuelAdded.toFixed(2) : ''}</td>
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
          <th>ｱﾙｺｰﾙCK<br>㎎/ℓ</th>
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
