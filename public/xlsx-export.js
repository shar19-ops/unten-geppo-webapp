// サンプル雛形(assets/unten-geppo-template.xlsx)をExcelJSで読み込み、データセルの値だけを
// 書き換えてダウンロードする。結合セル・数式・フォント等のスタイルには一切触れない
// (ExcelJSでの往復検証済み。詳細はDEVLOG.md参照)。

const TEMPLATE_URL = 'assets/unten-geppo-template.xlsx';

// 運転月報シートの日付→行番号(実ファイルのセルレイアウトから特定):
// 1〜15日 = 7〜21行、16〜31日 = 31〜46行
function dayRow(day) {
  return day <= 15 ? 6 + day : day + 15;
}

async function exportMonthlyLogToXlsx(record, vehicleLabel, officeName) {
  const resp = await fetch(TEMPLATE_URL);
  if (!resp.ok) throw new Error('テンプレートファイルを読み込めませんでした');
  const buf = await resp.arrayBuffer();

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.getWorksheet('運転月報');
  const cover = wb.getWorksheet('表紙');

  ws.getCell('E2').value = officeName || '';
  ws.getCell('A4').value = record.year;
  ws.getCell('E4').value = record.month;
  cover.getCell('E29').value = vehicleLabel || record.privateCarLabel || '';
  cover.getCell('E30').value = record.vehicleManager || '';

  for (let d = 1; d <= 31; d++) {
    const day = record.days[d] || {};
    const row = dayRow(d);
    ws.getCell(`B${row}`).value = day.meterReading != null ? day.meterReading : null;
    ws.getCell(`H${row}`).value = day.destination || '';
    ws.getCell(`L${row}`).value = day.driver || '';
    ws.getCell(`N${row}`).value = day.alcoholCheck != null ? day.alcoholCheck : null;
    ws.getCell(`O${row}`).value = day.fuelAdded != null ? day.fuelAdded : null;
  }

  (record.checklistMid || []).forEach((item, i) => {
    ws.getCell(`O${23 + i}`).value = item.result || '';
  });
  (record.checklistEnd || []).forEach((item, i) => {
    ws.getCell(`O${49 + i}`).value = item.result || '';
  });

  const blob = new Blob(
    [await wb.xlsx.writeBuffer()],
    { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }
  );
  const filename = `${sanitizeFilename(vehicleLabel || record.privateCarLabel || '車両')}_運転月報_${record.year}${String(record.month).padStart(2, '0')}.xlsx`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
  return filename;
}
