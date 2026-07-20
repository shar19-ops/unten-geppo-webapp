// 社有車リスト管理画面。データはすべてstorage.js経由(loadVehicles/saveVehicle/deleteVehicle/mergeVehicles)。

let vehicleFormState = null; // null=非表示, {}=新規, {id,...}=編集中
let vehicleImportConflicts = null; // インポート後、競合があれば{merged, conflicts}を保持
let vehicleStatusMessage = '';
let vehicleStatusIsError = false;

function renderVehiclesView() {
  const root = document.getElementById('view-vehicles');
  const vehicles = loadVehicles();

  root.innerHTML = `
    <div class="panel">
      <div class="panel-head">
        <h2>社有車リスト</h2>
        <div class="panel-actions">
          <input type="file" id="vehicleExcelInput" accept=".xlsx,.xls" hidden>
          <input type="file" id="vehicleJsonInput" accept=".json" hidden>
          <button class="btn btn-ghost" type="button" id="vehicleExcelImportBtn">Excelから取込</button>
          <button class="btn btn-ghost" type="button" id="vehicleExcelExportBtn">Excelへ出力</button>
          <button class="btn btn-ghost" type="button" id="vehicleJsonImportBtn">JSONから取込</button>
          <button class="btn btn-ghost" type="button" id="vehicleJsonExportBtn">JSONへ出力</button>
          <button class="btn btn-primary" type="button" id="vehicleAddBtn">＋ 車両を追加</button>
        </div>
      </div>

      ${vehicleFormState ? vehicleFormHtml(vehicleFormState) : ''}
      ${vehicleImportConflicts ? conflictPanelHtml(vehicleImportConflicts.conflicts) : ''}

      <table class="data-table">
        <thead>
          <tr>
            <th>車両番号</th>
            <th>車種／名称</th>
            <th>事業所名</th>
            <th>既定の車両管理者</th>
            <th>状態</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${vehicles.length ? vehicles.map(vehicleRow).join('') : '<tr><td colspan="6" class="hint">まだ社有車が登録されていません。「＋ 車両を追加」またはExcel取込で登録してください。</td></tr>'}
        </tbody>
      </table>
      <p class="hint">※ 私有車は運転記録入力画面でその都度自由入力します(このリストには登録されません)。</p>
      <p class="status ${vehicleStatusIsError ? 'error' : 'ok'}">${vehicleStatusMessage}</p>
    </div>
  `;

  document.getElementById('vehicleAddBtn').addEventListener('click', () => {
    vehicleFormState = { active: true };
    renderVehiclesView();
  });
  document.getElementById('vehicleExcelImportBtn').addEventListener('click', async () => {
    await loadScriptOnce('vendor/sheetjs/xlsx.full.min.js');
    document.getElementById('vehicleExcelInput').click();
  });
  document.getElementById('vehicleExcelExportBtn').addEventListener('click', async () => {
    await loadScriptOnce('vendor/sheetjs/xlsx.full.min.js');
    exportVehiclesToExcel();
  });
  document.getElementById('vehicleJsonImportBtn').addEventListener('click', () => document.getElementById('vehicleJsonInput').click());
  document.getElementById('vehicleJsonExportBtn').addEventListener('click', async () => {
    const filename = await exportVehiclesToFile();
    setVehicleStatus(filename ? `書き出しました(${filename})` : '', false);
  });
  document.getElementById('vehicleExcelInput').addEventListener('change', onVehicleExcelSelected);
  document.getElementById('vehicleJsonInput').addEventListener('change', onVehicleJsonSelected);

  root.querySelectorAll('.vehicle-edit-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const v = vehicles.find((x) => x.id === btn.dataset.id);
      vehicleFormState = { ...v };
      renderVehiclesView();
    });
  });
  root.querySelectorAll('.vehicle-delete-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const v = vehicles.find((x) => x.id === btn.dataset.id);
      if (confirm(`「${v.plateNumber}」を削除します。よろしいですか?`)) {
        deleteVehicle(v.id);
        setVehicleStatus(`削除しました(${v.plateNumber})`, false);
        renderVehiclesView();
      }
    });
  });

  const form = document.getElementById('vehicleForm');
  if (form) {
    form.addEventListener('submit', onVehicleFormSubmit);
    document.getElementById('vehicleFormCancelBtn').addEventListener('click', () => {
      vehicleFormState = null;
      renderVehiclesView();
    });
  }

  if (vehicleImportConflicts) {
    document.getElementById('conflictApplyBtn').addEventListener('click', applyVehicleConflictResolution);
    document.getElementById('conflictCancelBtn').addEventListener('click', () => {
      vehicleImportConflicts = null;
      setVehicleStatus('取込を取り消しました', false);
      renderVehiclesView();
    });
  }
}

function setVehicleStatus(message, isError) {
  vehicleStatusMessage = message;
  vehicleStatusIsError = !!isError;
}

function vehicleRow(v) {
  return `
    <tr>
      <td>${v.plateNumber}</td>
      <td>${v.nickname || ''}</td>
      <td>${v.officeName || ''}</td>
      <td>${v.defaultManager || ''}</td>
      <td><span class="badge ${v.active ? 'badge-active' : 'badge-inactive'}">${v.active ? '使用中' : '停止中'}</span></td>
      <td class="row-actions">
        <button class="btn btn-text vehicle-edit-btn" type="button" data-id="${v.id}">編集</button>
        <button class="btn btn-text btn-danger vehicle-delete-btn" type="button" data-id="${v.id}">削除</button>
      </td>
    </tr>
  `;
}

function vehicleFormHtml(v) {
  return `
    <form class="inline-form" id="vehicleForm">
      <div class="field">
        <label>車両番号(必須)</label>
        <input type="text" class="input-lg" name="plateNumber" value="${v.plateNumber || ''}" required>
      </div>
      <div class="field">
        <label>車種／名称</label>
        <input type="text" class="input-lg" name="nickname" value="${v.nickname || ''}">
      </div>
      <div class="field">
        <label>事業所名</label>
        <select class="input-lg" name="officeName">
          <option value="">未選択</option>
          ${OFFICE_NAMES.map((name) => `<option value="${name}" ${v.officeName === name ? 'selected' : ''}>${name}</option>`).join('')}
        </select>
      </div>
      <div class="field">
        <label>既定の車両管理者</label>
        <input type="text" class="input-lg" name="defaultManager" value="${v.defaultManager || ''}">
      </div>
      <div class="field">
        <label class="toggle-label"><input type="checkbox" name="active" ${v.active !== false ? 'checked' : ''}> 使用中</label>
      </div>
      <div class="form-actions">
        <button type="submit" class="btn btn-primary">${v.id ? '更新する' : '追加する'}</button>
        <button type="button" class="btn btn-ghost" id="vehicleFormCancelBtn">キャンセル</button>
      </div>
    </form>
  `;
}

function onVehicleFormSubmit(e) {
  e.preventDefault();
  const fd = new FormData(e.target);
  const plateNumber = String(fd.get('plateNumber') || '').trim();
  if (!plateNumber) return;
  const existing = loadVehicles();
  const dup = existing.find((v) => v.plateNumber === plateNumber && v.id !== vehicleFormState.id);
  if (dup) {
    setVehicleStatus(`車両番号「${plateNumber}」は既に登録されています`, true);
    renderVehiclesView();
    return;
  }
  saveVehicle({
    id: vehicleFormState.id,
    plateNumber,
    nickname: String(fd.get('nickname') || '').trim(),
    officeName: String(fd.get('officeName') || ''),
    defaultManager: String(fd.get('defaultManager') || '').trim(),
    active: fd.get('active') === 'on'
  });
  setVehicleStatus(`保存しました(${plateNumber})`, false);
  vehicleFormState = null;
  renderVehiclesView();
}

// ---------------- Excelインポート/エクスポート ----------------
function findColumnValue(row, patterns) {
  const key = Object.keys(row).find((k) => patterns.some((p) => p.test(k)));
  return key ? String(row[key]).trim() : '';
}

function onVehicleExcelSelected(e) {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const wb = XLSX.read(reader.result, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
      const seenPlates = new Set();
      const importedList = [];
      rows.forEach((row) => {
        const plateNumber = findColumnValue(row, [/車両番号/, /ナンバー/, /プレート/]);
        if (!plateNumber) return;
        const nickname = findColumnValue(row, [/車種/, /車両名称/, /名称/]);
        const officeName = findColumnValue(row, [/事業所/]);
        const defaultManager = findColumnValue(row, [/管理者/]);
        if (seenPlates.has(plateNumber)) {
          const idx = importedList.findIndex((v) => v.plateNumber === plateNumber);
          importedList[idx] = { plateNumber, nickname, officeName, defaultManager, active: true };
        } else {
          seenPlates.add(plateNumber);
          importedList.push({ plateNumber, nickname, officeName, defaultManager, active: true });
        }
      });
      if (!importedList.length) {
        setVehicleStatus('「車両番号」列が見つかりませんでした。ヘッダー行を確認してください。', true);
        renderVehiclesView();
        return;
      }
      applyVehicleImport(importedList, `Excelから${importedList.length}件読み込みました`);
    } catch (err) {
      setVehicleStatus('Excelファイルを読み込めませんでした: ' + err.message, true);
      renderVehiclesView();
    }
  };
  reader.readAsArrayBuffer(file);
}

function exportVehiclesToExcel() {
  const vehicles = loadVehicles();
  const rows = vehicles.map((v) => ({
    車両番号: v.plateNumber,
    車種_名称: v.nickname || '',
    事業所名: v.officeName || '',
    既定の車両管理者: v.defaultManager || '',
    状態: v.active ? '使用中' : '停止中'
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '社有車リスト');
  XLSX.writeFile(wb, `社有車リスト_${todayIso()}.xlsx`);
  setVehicleStatus('Excelへ出力しました', false);
  renderVehiclesView();
}

async function onVehicleJsonSelected(e) {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = await readJsonFile(file);
    if (!Array.isArray(data)) throw new Error('社有車リストのJSONファイルではないようです');
    applyVehicleImport(data, `JSONから${data.length}件読み込みました`);
  } catch (err) {
    setVehicleStatus('JSONファイルを読み込めませんでした: ' + err.message, true);
    renderVehiclesView();
  }
}

function applyVehicleImport(importedList, successMessage) {
  const { merged, conflicts } = mergeVehicles(loadVehicles(), importedList);
  if (conflicts.length) {
    vehicleImportConflicts = { merged, conflicts };
    setVehicleStatus(`${conflicts.length}件の車両で内容の食い違いがあります。下で選んで適用してください。`, true);
  } else {
    saveVehicles(merged);
    setVehicleStatus(successMessage, false);
  }
  renderVehiclesView();
}

function conflictPanelHtml(conflicts) {
  return `
    <div class="conflict-panel">
      <h3>取込内容が既存データと異なります(${conflicts.length}件)</h3>
      ${conflicts.map((c, i) => `
        <div class="conflict-row">
          <span class="conflict-label">${c.plateNumber}</span>
          <span>この端末: ${c.local.nickname || '(空)'} / ${c.local.officeName || '(空)'} / ${c.local.defaultManager || '(空)'}</span>
          <span>取込データ: ${c.imported.nickname || '(空)'} / ${c.imported.officeName || '(空)'} / ${c.imported.defaultManager || '(空)'}</span>
          <span class="conflict-choice">
            <label><input type="radio" name="conflict-${i}" value="local" checked> この端末を残す</label>
            <label><input type="radio" name="conflict-${i}" value="imported"> 取込データで更新</label>
          </span>
        </div>
      `).join('')}
      <div class="form-actions" style="margin-top:0.75rem;">
        <button class="btn btn-primary" type="button" id="conflictApplyBtn">選択内容を適用</button>
        <button class="btn btn-ghost" type="button" id="conflictCancelBtn">取込を取り消す</button>
      </div>
    </div>
  `;
}

function applyVehicleConflictResolution() {
  const { merged, conflicts } = vehicleImportConflicts;
  conflicts.forEach((c, i) => {
    const choice = document.querySelector(`input[name="conflict-${i}"]:checked`).value;
    if (choice === 'imported') {
      const target = merged.find((v) => v.plateNumber === c.plateNumber);
      if (target) {
        target.nickname = c.imported.nickname;
        target.officeName = c.imported.officeName;
        target.defaultManager = c.imported.defaultManager;
        target.active = c.imported.active;
      }
    }
  });
  saveVehicles(merged);
  vehicleImportConflicts = null;
  setVehicleStatus('取込内容を適用しました', false);
  renderVehiclesView();
}
