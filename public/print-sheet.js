// 運転月報の印刷用帳票。社内書式アプリ Y-Format の品質記録様式「本-安全-A0014 運転月報」と同じ見た目で、
// 印刷するときだけ表示する(画面の入力用の表 .report-sheet は印刷では隠す)。
// 1枚目：表題・年月・押印欄(安全運転管理者・副安全運転管理者・発行者)・1〜15日・15日点検
// 2枚目：16〜末日・走行距離合計/燃費/給油合計・末日点検
// 押印欄の安全運転管理者・発行者は、確認・提出した日付と苗字の丸型デート印(date-stamp.js)で表す。

const PRINT_FORM_CODE = '本-安全-A0014';
const PRINT_FORM_TITLE = '運転月報';
// Y-Format の様式と同じフッター(制定日は元の様式のまま、最終改訂日は Y-Format 側の指定)
const PRINT_FORM_VERSION = '07/08/06制定　　26/11/17最終改訂';
const PRINT_ROW_MM = 9; // 日ごとの行の高さ(Y-Format と同じ)

// 列幅(mm)。行先は残りの幅
const PRINT_DAY_COLUMNS = [
  { key: 'day', label: '日付', w: 8 },
  { key: 'holiday', label: '休日<br>〇印', w: 8 },
  { key: 'meter', label: '出庫時<br>メーター指針<br>(km)', w: 20 },
  { key: 'distance', label: '走行距離<br>(km)', w: 15 },
  { key: 'dest', label: '行　先' },
  { key: 'driver', label: '運転者', w: 19 },
  { key: 'alcBefore', label: '運転前', w: 13, group: true },
  { key: 'alcAfter', label: '運転後', w: 13, group: true },
  { key: 'fuel', label: '給油<br>(ℓ)', w: 13 },
  { key: 'slip', label: '伝票<br>照合', w: 9 }
];

let printMeasureCanvas = null;
// 長い行先・運転者は、欄の幅に収まるところまで文字を小さくする(下限は元の半分)
function printFitStyle(text, widthMm, basePt) {
  if (!text) return '';
  if (!printMeasureCanvas) printMeasureCanvas = document.createElement('canvas');
  const ctx = printMeasureCanvas.getContext('2d');
  ctx.font = `${basePt}pt "BIZ UDPGothic", "BIZ UDPゴシック", "Yu Gothic UI", "Meiryo", sans-serif`;
  const available = (widthMm - 3) / 25.4 * 96; // 左右の余白1.5mmずつ
  const needed = ctx.measureText(text).width;
  if (needed <= available) return '';
  return ` style="font-size:${(basePt * Math.max(0.5, available / needed)).toFixed(2)}pt"`;
}

function printStampSvg(name, iso) {
  if (!iso || typeof DateStamp === 'undefined') return '';
  const d = new Date(iso);
  return DateStamp.svg({ name: surnameOf(name), date: d, color: 'red' });
}

function printHeaderHtml(record, page, stampCells) {
  const stamps = page === 1 ? `
    <div class="ps-stamps">
      ${stampCells.map((s) => `
        <div class="ps-stamp-box">
          <div class="ps-sb-label ps-two">${s.label}</div>
          <div class="ps-sb-area">${s.svg}</div>
        </div>`).join('')}
    </div>` : '';
  return `
    <div class="ps-header">
      <div class="ps-head-left">
        <div class="ps-code">${PRINT_FORM_CODE}</div>
        <div class="ps-title">${PRINT_FORM_TITLE}${page === 2 ? '<span class="ps-sub">（2/2）</span>' : ''}</div>
        ${page === 1 ? `<div class="ps-meta"><span class="ps-m-label">年　月</span><span class="ps-m-val">${record.year}年 ${record.month}月</span></div>` : ''}
      </div>
      ${stamps}
    </div>`;
}

function printInfoHtml(cells) {
  return `
    <table class="ps-grid ps-info">
      <colgroup>${cells.map((c) => `<col style="width:${c.lw}mm"><col>`).join('')}</colgroup>
      <tr>${cells.map((c) => `<td class="ps-lbl">${c.label}</td><td class="ps-txt">${escapeHtml(c.value)}</td>`).join('')}</tr>
    </table>`;
}

function printDaysHtml(record, nextMonthDays, startDay, endDay, holidays) {
  const lastDay = lastDayOfMonth(record.year, record.month);
  const fixed = PRINT_DAY_COLUMNS.reduce((s, c) => s + (c.w || 0), 0);
  const destW = 186 - fixed;
  const rows = [];
  for (let d = startDay; d <= endDay; d++) {
    const inMonth = d <= lastDay;
    const day = (inMonth && record.days[d]) || {};
    const distance = inMonth ? computeDistance(record.days, d, record.year, record.month, nextMonthDays) : '';
    const dow = inMonth ? new Date(record.year, record.month - 1, d).getDay() : -1;
    const isHoliday = inMonth && (dow === 0 || dow === 6 || holidays.has(dateKey(record.year, record.month, d)));
    const dest = day.destination || '';
    const driver = day.driver || '';
    rows.push(`
      <tr>
        <td class="ps-c">${inMonth ? d : ''}</td>
        <td class="ps-c">${isHoliday ? '〇' : ''}</td>
        <td class="ps-n">${day.meterReading != null ? day.meterReading.toLocaleString() : ''}</td>
        <td class="ps-n">${distance !== '' ? distance.toLocaleString() : ''}</td>
        <td class="ps-t"${printFitStyle(dest, destW, 9)}>${escapeHtml(dest)}</td>
        <td class="ps-t"${printFitStyle(driver, 19, 9)}>${escapeHtml(driver)}</td>
        <td class="ps-c">${day.alcoholCheckBefore != null ? day.alcoholCheckBefore : ''}</td>
        <td class="ps-c">${day.alcoholCheckAfter != null ? day.alcoholCheckAfter : ''}</td>
        <td class="ps-n">${day.fuelAdded != null ? day.fuelAdded : ''}</td>
        <td class="ps-c">${day.fuelSlipChecked ? '✓' : ''}</td>
      </tr>`);
  }
  const head1 = PRINT_DAY_COLUMNS.map((c, i) => {
    if (c.group) return i === PRINT_DAY_COLUMNS.findIndex((x) => x.group) ? '<th colspan="2">アルコール検知値(mg/ℓ)</th>' : '';
    return `<th rowspan="2">${c.label}</th>`;
  }).join('');
  const head2 = PRINT_DAY_COLUMNS.filter((c) => c.group).map((c) => `<th>${c.label}</th>`).join('');
  return `
    <table class="ps-grid ps-days">
      <colgroup>${PRINT_DAY_COLUMNS.map((c) => `<col${c.w ? ` style="width:${c.w}mm"` : ''}>`).join('')}</colgroup>
      <thead><tr>${head1}</tr><tr>${head2}</tr></thead>
      <tbody>${rows.join('')}</tbody>
    </table>`;
}

function printChecklistHtml(items, when) {
  const list = Array.isArray(items) ? items : [];
  const rows = FIXED_CHECKLIST_ITEMS.map((text, i) => `
    <tr>
      <td class="ps-c">${i + 1}</td>
      <td class="ps-t ps-item">${escapeHtml(text)}</td>
      <td class="ps-c ps-result">${(list[i] && list[i].result) || ''}</td>
    </tr>`).join('');
  return `
    <table class="ps-grid ps-check">
      <colgroup><col style="width:7mm"><col style="width:6mm"><col><col style="width:20mm"></colgroup>
      <tr>
        <td class="ps-lbl ps-vertical" rowspan="${FIXED_CHECKLIST_ITEMS.length + 2}">点検指定日（${when}）</td>
        <td class="ps-lbl" colspan="2">日常点検項目（点検日${when}）</td>
        <td class="ps-lbl">結　果</td>
      </tr>
      ${rows}
      <tr><td class="ps-note" colspan="3">点検結果は、異状なし〇、異常あり×、を記入し、×の場合は処置する又は自動車修理依頼書を発行する。</td></tr>
    </table>`;
}

function printFooterHtml() {
  return `
    <div class="ps-footer">
      <div class="ps-brand"><img class="ps-mark" src="assets/logo-mark.jpg" alt=""><span class="ps-word">YUDENSHA</span></div>
      <div class="ps-ver">${PRINT_FORM_CODE}　${PRINT_FORM_TITLE}　　${PRINT_FORM_VERSION}</div>
    </div>`;
}

// 1台分(2枚)の印刷用帳票HTML。buildReportSheetHtml(report.js)から、画面用の表と一緒に出力する。
function buildPrintSheetHtml(record, nextMonthDays, officeName, vehicleManager, vehicleNumberLabel) {
  const totals = computeTotals(record.days, record.year, record.month, nextMonthDays);
  const holidays = computeJapaneseHolidays(record.year);
  const stampCells = [
    { label: '安全運転<br>管理者', svg: record.safetyManagerConfirmedAt ? printStampSvg(record.safetyManagerName, record.safetyManagerConfirmedAt) : '' },
    { label: '副安全運転<br>管理者', svg: '' },
    { label: '発行者', svg: record.issuerConfirmedAt ? printStampSvg(vehicleManager, record.issuerConfirmedAt) : '' }
  ];
  return `
    <div class="print-sheet">
      <div class="ps-page">
        ${printHeaderHtml(record, 1, stampCells)}
        <div class="ps-body">
          ${printInfoHtml([
            { label: '事業所名', lw: 18, value: officeName },
            { label: '車両番号', lw: 18, value: vehicleNumberLabel },
            { label: '車両管理者', lw: 20, value: vehicleManager }
          ])}
          ${printDaysHtml(record, nextMonthDays, 1, 15, holidays)}
          ${printChecklistHtml(record.checklistMid, '15日')}
        </div>
        ${printFooterHtml()}
      </div>
      <div class="ps-page">
        ${printHeaderHtml(record, 2, stampCells)}
        <div class="ps-body">
          ${printInfoHtml([
            { label: '年　月', lw: 18, value: `${record.year}年 ${record.month}月` },
            { label: '車両番号', lw: 18, value: vehicleNumberLabel },
            { label: '車両管理者', lw: 20, value: vehicleManager }
          ])}
          ${printDaysHtml(record, nextMonthDays, 16, 31, holidays)}
          <table class="ps-grid ps-totals">
            <colgroup><col style="width:24mm"><col><col style="width:30mm"><col><col style="width:20mm"><col></colgroup>
            <tr>
              <td class="ps-lbl">走行距離合計</td><td class="ps-n">${totals.totalDistance.toLocaleString()}<span class="ps-unit">km</span></td>
              <td class="ps-lbl">燃費≒走行距離<br>合計/給油合計</td><td class="ps-n">${totals.fuelEconomy}<span class="ps-unit">km/ℓ</span></td>
              <td class="ps-lbl">給油合計</td><td class="ps-n">${totals.totalFuel.toFixed(2)}<span class="ps-unit">ℓ</span></td>
            </tr>
          </table>
          ${printChecklistHtml(record.checklistEnd, '末日')}
        </div>
        ${printFooterHtml()}
      </div>
    </div>`;
}
