# 車両リスト統合(社有車・私有車)と私有車QR配布 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 「社有車リスト」を「車両リスト」に改称し、社有車・私有車をタブで切り替える単一の車両マスタ画面にする。私有車も事前登録制にして(紙の「私有車使用届」を管理者が入力)、社有車と同じ仕組み(運転記録入力での選択・QRコード配布・運転月報での事業所名転記)を使えるようにする。

**Architecture:** 既存の`vehicles`配列(`storage.js`)に`vehicleType`('company'|'private')と`driverName`(私有車のみ)を追加し、社有車・私有車を同じマスタ・同じid体系で管理する。運転記録入力の私有車モードは自由テキスト入力から登録済み車両の選択式に変更する。QRコードの仕組み(PR #1で実装済み)・運転月報の事業所名転記の仕組みは、いずれも「vehicleIdで車両マスタを引く」という既存の構造にそのまま乗るため、大きな新設計は不要。

**Tech Stack:** 素のHTML/CSS/JS(フレームワーク・ビルドなし)、既存の`localStorage`データ層。新規npm依存なし。

## Global Constraints

- 車両マスタ(`vehicles`配列)に`vehicleType`(`'company'`|`'private'`)を追加する。既存レコードにこの項目が無い場合は`'company'`として扱う(後方互換、マイグレーション処理は不要)。
- 私有車専用の必須項目は`driverName`(使用者名)。社有車の`defaultManager`(既定の車両管理者)は私有車では使わない。
- 私有車も社有車と同じ`vehicles`配列・同じ`id`体系に登録し、`vehicleRefFor`はそのまま`vehicleId`を使う(変更不要)。
- 既存の自由入力による私有車の運転記録(もしあれば)は、従来通り`private:<テキスト>`というrefのまま履歴として残る。登録後の新しい記録とは連続しない(この割り切りは確認済み)。
- 運転記録入力の私有車モードの自由テキスト入力は廃止し、登録済み私有車からの選択式のみにする。
- Excel取込・Excel出力・JSON取込・JSON出力は、社有車タブ・私有車タブの両方で使えるようにする(私有車タブのExcel列は「使用者名」を含み「既定の車両管理者」を含まない)。
- 画面名は「社有車リスト」→「車両リスト」に統一する(ナビゲーションタブの表示名・見出し・関連する案内文言すべて)。
- 運転月報での事業所名の私有車への転記(「私有車には転記元が無いため空欄」という現状の案内文言)は、登録済み私有車については事業所名が表示されるように変更する(確認済み)。
- CSS/JSを変更したファイルがある場合、`public/index.html`内の全アセットの`?v=`クエリを新しい値に一括更新する(house convention)。現在値は`20260721a`。
- 社有車・私有車リストの追加・編集・削除を管理者のみに制限する権限機能、および「給油登録」画面の改修は本計画のスコープ外(別プロジェクト)。

---

### Task 1: 車両マスタのデータ層拡張(`storage.js`)

**Files:**
- Modify: `public/storage.js:221`(`exportVehiclesToFile`のファイル名)、`:272-295`(`mergeVehicles`)

**Interfaces:**
- Produces: `mergeVehicles(localList, importedList)`は`plateNumber`と`vehicleType`(未設定は`'company'`扱い)の組み合わせで重複判定するようになる。比較対象フィールドは社有車なら`defaultManager`、私有車なら`driverName`。この関数のシグネチャ・戻り値の形(`{merged, conflicts}`)は変更しない。
- Consumes: なし(Task 2以降がこの関数の新しい重複判定ロジックに依存する)。

- [ ] **Step 1: `exportVehiclesToFile`のファイル名を更新する**

`public/storage.js:220-223`の以下を:

```javascript
async function exportVehiclesToFile() {
  const filename = `社有車リスト_${todayIso()}.json`;
  return saveBlobToFile(new Blob([JSON.stringify(loadVehicles(), null, 2)], { type: 'application/json' }), filename);
}
```

次のように置き換える(社有車・私有車の両方を含む単一JSONのため「車両リスト」に改称):

```javascript
async function exportVehiclesToFile() {
  const filename = `車両リスト_${todayIso()}.json`;
  return saveBlobToFile(new Blob([JSON.stringify(loadVehicles(), null, 2)], { type: 'application/json' }), filename);
}
```

- [ ] **Step 2: `mergeVehicles`を車両タイプ対応にする**

`public/storage.js:271-295`の以下を:

```javascript
// マージ単位は車両番号(plateNumber)。新規車両は追加、既存車両でフィールドが異なる場合は競合として返す。
function mergeVehicles(localList, importedList) {
  const merged = localList.map((v) => ({ ...v }));
  const byPlate = new Map(merged.map((v) => [v.plateNumber, v]));
  const conflicts = [];

  importedList.forEach((iv) => {
    const existing = byPlate.get(iv.plateNumber);
    if (!existing) {
      const added = { ...iv, id: iv.id || generateId() };
      merged.push(added);
      byPlate.set(iv.plateNumber, added);
      return;
    }
    const fieldsDiffer = existing.nickname !== iv.nickname
      || existing.officeName !== iv.officeName
      || existing.defaultManager !== iv.defaultManager
      || existing.active !== iv.active;
    if (fieldsDiffer) {
      conflicts.push({ plateNumber: iv.plateNumber, local: existing, imported: iv });
    }
  });

  return { merged, conflicts };
}
```

次のように置き換える:

```javascript
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
      || (iv.vehicleType === 'private'
        ? existing.driverName !== iv.driverName
        : existing.defaultManager !== iv.defaultManager);
    if (fieldsDiffer) {
      conflicts.push({ plateNumber: iv.plateNumber, local: existing, imported: iv });
    }
  });

  return { merged, conflicts };
}
```

- [ ] **Step 3: Node上で`mergeVehicles`の新しい重複判定ロジックを検証する**

```bash
node -e "
const fs = require('fs');
const code = fs.readFileSync('public/storage.js', 'utf8');
eval(code);

// ケース1: 同じplateNumberでも vehicleType が異なれば別物として追加される
let r1 = mergeVehicles(
  [{ id: 'a', plateNumber: '品川500 あ 12-34', vehicleType: 'company', nickname: 'X', officeName: '本店', defaultManager: '山田', active: true }],
  [{ plateNumber: '品川500 あ 12-34', vehicleType: 'private', nickname: 'Y', officeName: '本店', driverName: '佐藤', active: true }]
);
if (r1.merged.length !== 2) throw new Error('FAIL: 異なるvehicleTypeが誤って統合された');
if (r1.conflicts.length !== 0) throw new Error('FAIL: 別物のはずが競合として検出された');

// ケース2: 同じplateNumber・同じvehicleTypeでdriverNameが違えば競合になる(私有車)
let r2 = mergeVehicles(
  [{ id: 'b', plateNumber: '練馬300 い 56-78', vehicleType: 'private', nickname: '', officeName: '本店', driverName: '鈴木', active: true }],
  [{ plateNumber: '練馬300 い 56-78', vehicleType: 'private', nickname: '', officeName: '本店', driverName: '田中', active: true }]
);
if (r2.conflicts.length !== 1) throw new Error('FAIL: 私有車のdriverName差分が競合として検出されなかった');

// ケース3: vehicleType未設定(既存データ)はcompanyとして扱われ、company側と正しく比較される
let r3 = mergeVehicles(
  [{ id: 'c', plateNumber: '横浜100 う 11-11', nickname: '', officeName: '本店', defaultManager: '旧管理者', active: true }],
  [{ plateNumber: '横浜100 う 11-11', vehicleType: 'company', nickname: '', officeName: '本店', defaultManager: '新管理者', active: true }]
);
if (r3.conflicts.length !== 1) throw new Error('FAIL: vehicleType未設定の既存レコードがcompanyとして正しく比較されなかった');

console.log('OK: all mergeVehicles cases passed');
"
```

Expected: `OK: all mergeVehicles cases passed` が出力される(エラーなし)。

- [ ] **Step 4: Commit**

```bash
git add public/storage.js
git commit -m "$(cat <<'EOF'
車両マスタを社有車・私有車の共通データ層として拡張する

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: 車両リスト画面(`vehicles.js`)を社有車/私有車タブ構成に全面改修する

**Files:**
- Modify: `public/vehicles.js`(全体を書き換え)
- Modify: `public/index.html:17`(ナビゲーションタブの表示名)

**Interfaces:**
- Consumes: Task 1の`mergeVehicles`(型対応済み)、既存の`loadVehicles`/`saveVehicle`/`saveVehicles`/`deleteVehicle`/`OFFICE_NAMES`/`todayIso`(`storage.js`)、`loadScriptOnce`(`app.js`)、`qrcode(...)`(PR #1でvendor配置済みの`public/vendor/qrcode/qrcode.js`、`loadScriptOnce('vendor/qrcode/qrcode.js')`後に使用可能)。
- Produces: 車両オブジェクトに`vehicleType`(`'company'`|`'private'`)と、私有車のみ`driverName`を持たせて`saveVehicle`に渡す。Task 3(`trip-entry.js`)・Task 4(`app.js`)・Task 5(`report.js`)は、車両マスタのこの`vehicleType`フィールドを読み取って社有車/私有車を判別する。

- [ ] **Step 1: `public/vehicles.js`を以下の内容に全面書き換える**

```javascript
// 車両リスト管理画面(社有車・私有車)。データはすべてstorage.js経由(loadVehicles/saveVehicle/deleteVehicle/mergeVehicles)。

const VEHICLE_TYPE_LABELS = { company: '社有車', private: '私有車' };

let vehicleActiveTab = 'company'; // 'company' | 'private'
let vehicleFormState = null; // null=非表示, {vehicleType,...}=新規/編集中
let vehicleImportConflicts = null; // インポート後、競合があれば{merged, conflicts}を保持
let vehicleStatusMessage = '';
let vehicleStatusIsError = false;
let vehicleQrState = null; // null=非表示 / {vehicle, url, svg}=QRコード表示中

function renderVehiclesView() {
  const root = document.getElementById('view-vehicles');
  const allVehicles = loadVehicles();
  const tabLabel = VEHICLE_TYPE_LABELS[vehicleActiveTab];
  const vehicles = allVehicles.filter((v) => (v.vehicleType || 'company') === vehicleActiveTab);

  root.innerHTML = `
    <div class="panel">
      <div class="panel-head ${vehicleQrState ? 'no-print' : ''}">
        <h2>車両リスト</h2>
        <div class="panel-actions">
          <input type="file" id="vehicleExcelInput" accept=".xlsx,.xls" hidden>
          <input type="file" id="vehicleJsonInput" accept=".json" hidden>
          <button class="btn btn-ghost" type="button" id="vehicleExcelImportBtn">Excelから取込</button>
          <button class="btn btn-ghost" type="button" id="vehicleExcelExportBtn">Excelへ出力</button>
          <button class="btn btn-ghost" type="button" id="vehicleJsonImportBtn">JSONから取込</button>
          <button class="btn btn-ghost" type="button" id="vehicleJsonExportBtn">JSONへ出力</button>
          <button class="btn btn-primary" type="button" id="vehicleAddBtn">＋ ${tabLabel}を追加</button>
        </div>
      </div>

      <div class="segmented ${vehicleQrState ? 'no-print' : ''}">
        <button type="button" class="segmented-btn ${vehicleActiveTab === 'company' ? 'active' : ''}" data-vehicle-tab="company">社有車</button>
        <button type="button" class="segmented-btn ${vehicleActiveTab === 'private' ? 'active' : ''}" data-vehicle-tab="private">私有車</button>
      </div>

      ${vehicleFormState ? vehicleFormHtml(vehicleFormState) : ''}
      ${vehicleQrState ? qrPanelHtml(vehicleQrState) : ''}
      ${vehicleImportConflicts ? conflictPanelHtml(vehicleImportConflicts.conflicts) : ''}

      <table class="data-table ${vehicleQrState ? 'no-print' : ''}">
        <thead>
          <tr>
            <th>車両番号</th>
            <th>車種／名称</th>
            <th>事業所名</th>
            <th>${vehicleActiveTab === 'private' ? '使用者名' : '既定の車両管理者'}</th>
            <th>状態</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${vehicles.length ? vehicles.map(vehicleRow).join('') : `<tr><td colspan="6" class="hint">まだ${tabLabel}が登録されていません。「＋ ${tabLabel}を追加」またはExcel取込で登録してください。</td></tr>`}
        </tbody>
      </table>
      <p class="status ${vehicleStatusIsError ? 'error' : 'ok'} ${vehicleQrState ? 'no-print' : ''}">${vehicleStatusMessage}</p>
    </div>
  `;

  root.querySelectorAll('[data-vehicle-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      vehicleActiveTab = btn.dataset.vehicleTab;
      vehicleFormState = null;
      vehicleQrState = null;
      vehicleImportConflicts = null;
      renderVehiclesView();
    });
  });

  document.getElementById('vehicleAddBtn').addEventListener('click', () => {
    vehicleFormState = { active: true, vehicleType: vehicleActiveTab };
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

  root.querySelectorAll('.vehicle-qr-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const vehicle = allVehicles.find((x) => x.id === btn.dataset.id);
      await loadScriptOnce('vendor/qrcode/qrcode.js');
      const url = `${location.origin}${location.pathname}?vehicle=${encodeURIComponent(vehicle.id)}`;
      const qr = qrcode(0, 'M');
      qr.addData(url);
      qr.make();
      vehicleQrState = { vehicle, url, svg: qr.createSvgTag(6, 8) };
      renderVehiclesView();
    });
  });
  root.querySelectorAll('.vehicle-edit-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const v = allVehicles.find((x) => x.id === btn.dataset.id);
      vehicleFormState = { ...v, vehicleType: v.vehicleType || 'company' };
      renderVehiclesView();
    });
  });
  root.querySelectorAll('.vehicle-delete-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const v = allVehicles.find((x) => x.id === btn.dataset.id);
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

  if (vehicleQrState) {
    document.getElementById('qrPrintBtn').addEventListener('click', () => window.print());
    document.getElementById('qrCloseBtn').addEventListener('click', () => {
      vehicleQrState = null;
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
  const isPrivate = (v.vehicleType || 'company') === 'private';
  const lastCol = isPrivate ? (v.driverName || '') : (v.defaultManager || '');
  return `
    <tr>
      <td>${v.plateNumber}</td>
      <td>${v.nickname || ''}</td>
      <td>${v.officeName || ''}</td>
      <td>${lastCol}</td>
      <td><span class="badge ${v.active ? 'badge-active' : 'badge-inactive'}">${v.active ? '使用中' : '停止中'}</span></td>
      <td class="row-actions">
        <button class="btn btn-text vehicle-qr-btn" type="button" data-id="${v.id}">QRコード</button>
        <button class="btn btn-text vehicle-edit-btn" type="button" data-id="${v.id}">編集</button>
        <button class="btn btn-text btn-danger vehicle-delete-btn" type="button" data-id="${v.id}">削除</button>
      </td>
    </tr>
  `;
}

function qrPanelHtml(state) {
  const { vehicle, url, svg } = state;
  return `
    <div class="panel qr-panel" id="vehicleQrPanel">
      <div class="panel-head no-print">
        <h2>QRコード: ${vehicle.plateNumber}</h2>
        <div class="panel-actions">
          <button class="btn btn-ghost" type="button" id="qrPrintBtn">印刷</button>
          <button class="btn btn-ghost" type="button" id="qrCloseBtn">閉じる</button>
        </div>
      </div>
      <div class="qr-print-area">
        <p class="qr-vehicle-label">${vehicle.plateNumber}${vehicle.nickname ? `(${vehicle.nickname})` : ''}</p>
        <div class="qr-image">${svg}</div>
        <p class="qr-url hint no-print">${url}</p>
      </div>
    </div>
  `;
}

function vehicleFormHtml(v) {
  const isPrivate = v.vehicleType === 'private';
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
      ${isPrivate
        ? `<div class="field">
            <label>使用者名(必須)</label>
            <input type="text" class="input-lg" name="driverName" value="${v.driverName || ''}" required>
          </div>`
        : `<div class="field">
            <label>既定の車両管理者</label>
            <input type="text" class="input-lg" name="defaultManager" value="${v.defaultManager || ''}">
          </div>`
      }
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
  const vehicleType = vehicleFormState.vehicleType;
  const existing = loadVehicles();
  const dup = existing.find((v) => v.plateNumber === plateNumber && (v.vehicleType || 'company') === vehicleType && v.id !== vehicleFormState.id);
  if (dup) {
    setVehicleStatus(`車両番号「${plateNumber}」は既に登録されています`, true);
    renderVehiclesView();
    return;
  }
  const vehicle = {
    id: vehicleFormState.id,
    vehicleType,
    plateNumber,
    nickname: String(fd.get('nickname') || '').trim(),
    officeName: String(fd.get('officeName') || ''),
    active: fd.get('active') === 'on'
  };
  if (vehicleType === 'private') {
    const driverName = String(fd.get('driverName') || '').trim();
    if (!driverName) {
      setVehicleStatus('使用者名を入力してください', true);
      renderVehiclesView();
      return;
    }
    vehicle.driverName = driverName;
  } else {
    vehicle.defaultManager = String(fd.get('defaultManager') || '').trim();
  }
  saveVehicle(vehicle);
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
  const vehicleType = vehicleActiveTab;
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
        const entry = { plateNumber, nickname, officeName, vehicleType, active: true };
        if (vehicleType === 'private') {
          entry.driverName = findColumnValue(row, [/使用者/]);
        } else {
          entry.defaultManager = findColumnValue(row, [/管理者/]);
        }
        if (seenPlates.has(plateNumber)) {
          const idx = importedList.findIndex((v) => v.plateNumber === plateNumber);
          importedList[idx] = entry;
        } else {
          seenPlates.add(plateNumber);
          importedList.push(entry);
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
  const vehicleType = vehicleActiveTab;
  const vehicles = loadVehicles().filter((v) => (v.vehicleType || 'company') === vehicleType);
  const sheetName = VEHICLE_TYPE_LABELS[vehicleType] + 'リスト';
  const rows = vehicleType === 'private'
    ? vehicles.map((v) => ({
        車両番号: v.plateNumber,
        車種_名称: v.nickname || '',
        事業所名: v.officeName || '',
        使用者名: v.driverName || '',
        状態: v.active ? '使用中' : '停止中'
      }))
    : vehicles.map((v) => ({
        車両番号: v.plateNumber,
        車種_名称: v.nickname || '',
        事業所名: v.officeName || '',
        既定の車両管理者: v.defaultManager || '',
        状態: v.active ? '使用中' : '停止中'
      }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, `${sheetName}_${todayIso()}.xlsx`);
  setVehicleStatus('Excelへ出力しました', false);
  renderVehiclesView();
}

async function onVehicleJsonSelected(e) {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = await readJsonFile(file);
    if (!Array.isArray(data)) throw new Error('車両リストのJSONファイルではないようです');
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
      ${conflicts.map((c, i) => {
        const isPrivate = c.imported.vehicleType === 'private';
        const localExtra = isPrivate ? (c.local.driverName || '(空)') : (c.local.defaultManager || '(空)');
        const importedExtra = isPrivate ? (c.imported.driverName || '(空)') : (c.imported.defaultManager || '(空)');
        return `
        <div class="conflict-row">
          <span class="conflict-label">${c.plateNumber}</span>
          <span>この端末: ${c.local.nickname || '(空)'} / ${c.local.officeName || '(空)'} / ${localExtra}</span>
          <span>取込データ: ${c.imported.nickname || '(空)'} / ${c.imported.officeName || '(空)'} / ${importedExtra}</span>
          <span class="conflict-choice">
            <label><input type="radio" name="conflict-${i}" value="local" checked> この端末を残す</label>
            <label><input type="radio" name="conflict-${i}" value="imported"> 取込データで更新</label>
          </span>
        </div>
      `;
      }).join('')}
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
      const target = merged.find((v) => v.plateNumber === c.plateNumber && (v.vehicleType || 'company') === (c.imported.vehicleType || 'company'));
      if (target) {
        target.nickname = c.imported.nickname;
        target.officeName = c.imported.officeName;
        target.active = c.imported.active;
        if (c.imported.vehicleType === 'private') {
          target.driverName = c.imported.driverName;
        } else {
          target.defaultManager = c.imported.defaultManager;
        }
      }
    }
  });
  saveVehicles(merged);
  vehicleImportConflicts = null;
  setVehicleStatus('取込内容を適用しました', false);
  renderVehiclesView();
}
```

- [ ] **Step 2: ナビゲーションタブの表示名を変更する**

`public/index.html:17`の以下を:

```html
  <button class="tab-btn" data-view="vehicles"><span class="tab-btn-label">社有車リスト</span></button>
```

次のように置き換える:

```html
  <button class="tab-btn" data-view="vehicles"><span class="tab-btn-label">車両リスト</span></button>
```

- [ ] **Step 3: 開発サーバーで動作確認する**

```bash
npm start
```

ブラウザ(またはPlaywrightの`browser_navigate`)で `http://localhost:5174` を開き、以下を確認する:

1. ナビゲーションタブの表示が「車両リスト」になっている。
2. 「車両リスト」タブを開くと、見出しが「車両リスト」で、「社有車」「私有車」の切替タブが表示される。
3. 「社有車」タブで「＋ 社有車を追加」から車両番号「品川500 あ 12-34」・車種「テスト車」・事業所名「本店」・既定の車両管理者「山田」を保存し、一覧に表示されることを確認する(列: 車両番号・車種／名称・事業所名・既定の車両管理者・状態・操作)。
4. 「私有車」タブに切り替え、「＋ 私有車を追加」から車両番号「練馬300 い 56-78」・使用者名「佐藤」を保存し、一覧に表示されることを確認する(列: 車両番号・車種／名称・事業所名・使用者名・状態・操作。使用者名を空欄のまま保存しようとするとエラーになることも確認する)。
5. 私有車タブの登録行で「QRコード」ボタンを押し、社有車と同様にQR画像・URLが表示され、「閉じる」で戻ることを確認する。
6. 私有車タブでも「Excelへ出力」でファイルがダウンロードされ(列に「使用者名」が含まれ「既定の車両管理者」が含まれないこと)、そのファイルを同タブの「Excelから取込」で再取込しても競合として検出されないことを確認する。

Expected: 上記1〜6がすべて確認できる。

- [ ] **Step 4: Commit**

```bash
git add public/vehicles.js public/index.html
git commit -m "$(cat <<'EOF'
車両リスト画面を社有車/私有車タブ構成に改修する

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: 運転記録入力画面(`trip-entry.js`)の私有車を登録済み選択式にする

**Files:**
- Modify: `public/trip-entry.js:63-81`(`vehicleSelectFieldHtml`)、`:83-96`(`tripFormHtml`冒頭と送信ボタン)、`:138-147`と`:159`(`fuelFormHtml`冒頭と送信ボタン)、`:220-231`(`resolveVehicleSelection`)

**Interfaces:**
- Consumes: Task 2で拡張された車両マスタの`vehicleType`フィールド(`loadVehicles()`経由)。
- Produces: `resolveVehicleSelection(fd)`は社有車・私有車のどちらのモードでも`{ vehicleId, privateCarLabel: null, vehicleManager, vehicle }`または`{ error }`を返す(私有車の自由入力`privateCarLabel`によるパスは廃止)。この戻り値の形は`onTripEntrySubmit`/`onFuelEntrySubmit`から変更なしで利用できる。

- [ ] **Step 1: `vehicleSelectFieldHtml`を社有車・私有車どちらも選択式にする**

`public/trip-entry.js:63-81`の以下を:

```javascript
function vehicleSelectFieldHtml(vehicles) {
  return `
    <div class="field">
      <label>車両</label>
      <div class="segmented">
        <button type="button" class="segmented-btn ${!tripUsePrivateCar ? 'active' : ''}" data-mode="company">社有車</button>
        <button type="button" class="segmented-btn ${tripUsePrivateCar ? 'active' : ''}" data-mode="private">私有車</button>
      </div>
      ${tripUsePrivateCar
        ? `<input type="text" name="privateCarLabel" class="input-lg" placeholder="車両名・ナンバーなど自由入力">`
        : vehicles.length
          ? `<select name="vehicleId" class="input-lg">
              ${vehicles.map((v) => `<option value="${v.id}" ${tripQrVehicleId === v.id ? 'selected' : ''}>${v.plateNumber}（${v.nickname || '車種未設定'}）</option>`).join('')}
            </select>`
          : `<p class="hint">社有車が未登録です。「社有車リスト」画面で登録するか、私有車として入力してください。</p>`
      }
    </div>
  `;
}
```

次のように置き換える:

```javascript
function vehicleSelectFieldHtml(companyVehicles, privateVehicles) {
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
            ${vehicles.map((v) => `<option value="${v.id}" ${tripQrVehicleId === v.id ? 'selected' : ''}>${v.plateNumber}（${v.nickname || '車種未設定'}）</option>`).join('')}
          </select>`
        : `<p class="hint">${emptyHint}</p>`
      }
    </div>
  `;
}
```

- [ ] **Step 2: `tripFormHtml`を社有車・私有車リストを分けて渡すように変更する**

`public/trip-entry.js:83-92`の以下を:

```javascript
function tripFormHtml() {
  const today = new Date().toISOString().slice(0, 10);
  const vehicles = loadVehicles().filter((v) => v.active !== false);
  const recentDrivers = loadRecentDrivers();

  return `
    <form class="entry-form panel" id="tripEntryForm">
      <h2>運転記録入力</h2>

      ${vehicleSelectFieldHtml(vehicles)}
```

次のように置き換える:

```javascript
function tripFormHtml() {
  const today = new Date().toISOString().slice(0, 10);
  const allVehicles = loadVehicles().filter((v) => v.active !== false);
  const companyVehicles = allVehicles.filter((v) => (v.vehicleType || 'company') !== 'private');
  const privateVehicles = allVehicles.filter((v) => v.vehicleType === 'private');
  const recentDrivers = loadRecentDrivers();

  return `
    <form class="entry-form panel" id="tripEntryForm">
      <h2>運転記録入力</h2>

      ${vehicleSelectFieldHtml(companyVehicles, privateVehicles)}
```

`public/trip-entry.js:132`(送信ボタンの`disabled`条件)の以下を:

```javascript
      <button type="submit" class="btn btn-primary btn-block" ${!tripUsePrivateCar && !vehicles.length ? 'disabled' : ''}>この記録を保存</button>
```

次のように置き換える:

```javascript
      <button type="submit" class="btn btn-primary btn-block" ${(tripUsePrivateCar ? !privateVehicles.length : !companyVehicles.length) ? 'disabled' : ''}>この記録を保存</button>
```

- [ ] **Step 3: `fuelFormHtml`も同様に変更する**

`public/trip-entry.js:138-147`の以下を:

```javascript
function fuelFormHtml() {
  const today = new Date().toISOString().slice(0, 10);
  const vehicles = loadVehicles().filter((v) => v.active !== false);

  return `
    <form class="entry-form panel" id="fuelEntryForm">
      <h2>給油を後日記入</h2>
      <p class="hint">運転記録を保存し忘れた日や、給油だけを別日に記録したい場合に使います。既に保存済みのメーター指針・行先・運転者は変更されません。</p>

      ${vehicleSelectFieldHtml(vehicles)}
```

次のように置き換える:

```javascript
function fuelFormHtml() {
  const today = new Date().toISOString().slice(0, 10);
  const allVehicles = loadVehicles().filter((v) => v.active !== false);
  const companyVehicles = allVehicles.filter((v) => (v.vehicleType || 'company') !== 'private');
  const privateVehicles = allVehicles.filter((v) => v.vehicleType === 'private');

  return `
    <form class="entry-form panel" id="fuelEntryForm">
      <h2>給油を後日記入</h2>
      <p class="hint">運転記録を保存し忘れた日や、給油だけを別日に記録したい場合に使います。既に保存済みのメーター指針・行先・運転者は変更されません。</p>

      ${vehicleSelectFieldHtml(companyVehicles, privateVehicles)}
```

`public/trip-entry.js:159`(送信ボタンの`disabled`条件)の以下を:

```javascript
      <button type="submit" class="btn btn-primary btn-block" ${!tripUsePrivateCar && !vehicles.length ? 'disabled' : ''}>給油を記録</button>
```

次のように置き換える:

```javascript
      <button type="submit" class="btn btn-primary btn-block" ${(tripUsePrivateCar ? !privateVehicles.length : !companyVehicles.length) ? 'disabled' : ''}>給油を記録</button>
```

- [ ] **Step 4: `resolveVehicleSelection`を社有車・私有車とも同じ選択式ロジックにする**

`public/trip-entry.js:220-231`の以下を:

```javascript
function resolveVehicleSelection(fd) {
  const vehicles = loadVehicles();
  if (tripUsePrivateCar) {
    const privateCarLabel = String(fd.get('privateCarLabel') || '').trim();
    if (!privateCarLabel) return { error: '私有車の車両名・ナンバーを入力してください' };
    return { vehicleId: null, privateCarLabel, vehicleManager: '' };
  }
  const vehicleId = fd.get('vehicleId');
  if (!vehicleId) return { error: '車両を選択してください' };
  const vehicle = vehicles.find((v) => v.id === vehicleId);
  return { vehicleId, privateCarLabel: null, vehicleManager: (vehicle && vehicle.defaultManager) || '', vehicle };
}
```

次のように置き換える:

```javascript
function resolveVehicleSelection(fd) {
  const vehicles = loadVehicles();
  const vehicleId = fd.get('vehicleId');
  if (!vehicleId) return { error: tripUsePrivateCar ? '私有車を選択してください' : '車両を選択してください' };
  const vehicle = vehicles.find((v) => v.id === vehicleId);
  const vehicleManager = (vehicle && vehicle.vehicleType !== 'private') ? (vehicle.defaultManager || '') : '';
  return { vehicleId, privateCarLabel: null, vehicleManager, vehicle };
}
```

- [ ] **Step 5: 開発サーバーで動作確認する**

```bash
npm start
```

この検証は前タスクのブラウザ状態(localStorage)を引き継がない可能性があるため、まず「車両リスト」画面を開いて、社有車・私有車が1件もなければ以下を登録する(既にあれば新規登録は不要): 社有車「品川500 あ 12-34」、私有車「練馬300 い 56-78」(使用者名「佐藤」)。

その上で、ブラウザ(またはPlaywrightの`browser_navigate`)で `http://localhost:5174` を開き、以下を確認する:

1. 「運転記録入力」タブで「私有車」を選ぶと、以前あった自由テキスト入力欄が無くなり、代わりにプルダウンで登録済み私有車(練馬300 い 56-78)が選べることを確認する。
2. 私有車を選んで日付・出庫時メーター等を入力し保存すると、正常に保存される(エラーが出ない)ことを確認する。

Expected: 上記1・2が確認できる。

- [ ] **Step 6: Commit**

```bash
git add public/trip-entry.js
git commit -m "$(cat <<'EOF'
運転記録入力の私有車選択を自由入力から登録済み車両の選択式に変更する

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: QR自動選択を私有車にも対応させる(`app.js`)

**Files:**
- Modify: `public/app.js:146-161`(`applyQrVehicleParam`)

**Interfaces:**
- Consumes: Task 2で拡張された車両マスタの`vehicleType`フィールド。
- Produces: `?vehicle=<id>`が私有車を指す場合、`tripUsePrivateCar = true`にした上で`tripQrVehicleId`をセットする(社有車の場合は従来通り`tripUsePrivateCar = false`)。

- [ ] **Step 1: `applyQrVehicleParam`を車両タイプ判定対応にする**

`public/app.js:146-161`の以下を:

```javascript
// QRコードからの起動処理(社有車の?vehicle=<id>を読み取り、運転記録入力へ車両自動選択で遷移する)
(function applyQrVehicleParam() {
  const params = new URLSearchParams(location.search);
  const qrVehicleId = params.get('vehicle');
  if (qrVehicleId) {
    const vehicles = loadVehicles().filter((v) => v.active !== false);
    const matched = vehicles.find((v) => v.id === qrVehicleId);
    tripUsePrivateCar = false;
    if (matched) {
      tripQrVehicleId = qrVehicleId;
    } else {
      tripStatusMessage = 'QRコードに対応する車両が見つかりませんでした。車両を選び直してください';
      tripStatusIsError = true;
    }
    history.replaceState(null, '', location.pathname);
  }
})();
```

次のように置き換える:

```javascript
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
```

- [ ] **Step 2: 開発サーバーで動作確認する**

```bash
npm start
```

この検証は前タスクのブラウザ状態(localStorage)を引き継がない可能性があるため、まず「車両リスト」画面を開いて、社有車・私有車が1件もなければ以下を登録する(既にあれば新規登録は不要): 社有車「品川500 あ 12-34」、私有車「練馬300 い 56-78」(使用者名「佐藤」)。

私有車タブでその車両の「QRコード」ボタンを押し、表示されているURL(`?vehicle=<私有車のid>`)を控える。ブラウザ(またはPlaywrightの`browser_navigate`)で `http://localhost:5174/?vehicle=<控えたID>` を直接開き、以下を確認する:

1. 「運転記録入力」タブが開き、車両欄が自動的に「私有車」モードになっていて、練馬300 い 56-78が選択済みであることを確認する。
2. アドレスバーから`?vehicle=`が消えていることを確認する。

続けて、社有車(品川500 あ 12-34)のQRのURLでも同様に開き、「社有車」モードでその車両が選択されることを確認する(既存動作に回帰が無いことの確認)。

Expected: 上記がすべて確認できる。

- [ ] **Step 3: Commit**

```bash
git add public/app.js
git commit -m "$(cat <<'EOF'
QRコードによる車両自動選択を私有車にも対応させる

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: 運転月報画面(`report.js`)の私有車まわりの表示を更新する

**Files:**
- Modify: `public/report.js:10-22`(`reportVehicleOptions`)、`:46`(車両未登録時の案内)、`:66`(コメント)、`:92`(事業所名の案内文言)

**Interfaces:**
- Consumes: Task 2で拡張された車両マスタの`vehicleType`フィールド。
- Produces: なし(この画面の変更に依存する後続タスクはない)。

- [ ] **Step 1: `reportVehicleOptions`を車両タイプ対応にする**

`public/report.js:10-22`の以下を:

```javascript
function reportVehicleOptions() {
  const vehicles = loadVehicles().map((v) => ({
    ref: v.id, label: `${v.plateNumber}（${v.nickname || '車種未設定'}）`, vehicleId: v.id, privateCarLabel: null
  }));
  const privateRefs = new Map();
  loadLogIndex().forEach((e) => {
    if (e.privateCarLabel) privateRefs.set(e.vehicleRef, e.privateCarLabel);
  });
  const privateOptions = Array.from(privateRefs.entries()).map(([ref, label]) => ({
    ref, label: `${label}（私有車）`, vehicleId: null, privateCarLabel: label
  }));
  return [...vehicles, ...privateOptions];
}
```

次のように置き換える(登録済み車両は社有車・私有車ともに車両マスタから一覧を作り、未登録の私有車の過去履歴は従来通り別枠でログ索引から拾う):

```javascript
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
  return [...vehicles, ...legacyPrivateOptions];
}
```

- [ ] **Step 2: 車両未登録時の案内文言を更新する**

`public/report.js:46`の以下を:

```javascript
        <p class="hint">まだ車両が登録されていません。先に「社有車リスト」で登録するか、「運転記録入力」で私有車の記録を1件保存してください。</p>
```

次のように置き換える(私有車も登録制になったため、運転記録入力での自由入力を案内する文言を削除):

```javascript
        <p class="hint">まだ車両が登録されていません。先に「車両リスト」で社有車・私有車を登録してください。</p>
```

- [ ] **Step 3: 事業所名まわりのコメント・案内文言を更新する**

`public/report.js:66`の以下を:

```javascript
  // 事業所名は社有車リストの登録内容から転記する(私有車の場合は転記元が無いため空欄)
```

次のように置き換える:

```javascript
  // 事業所名は車両リストの登録内容から転記する(未登録の私有車履歴の場合は転記元が無いため空欄)
```

`public/report.js:92`の以下を:

```javascript
          <p class="hint">※ 社有車リストの車両登録内容から転記されます。私有車には転記元がないため空欄です。</p>
```

次のように置き換える:

```javascript
          <p class="hint">※ 車両リストの車両登録内容から転記されます。未登録の私有車には転記元がないため空欄です。</p>
```

- [ ] **Step 4: 開発サーバーで動作確認する**

```bash
npm start
```

この検証は前タスクのブラウザ状態(localStorage)を引き継がない可能性があるため、まず「車両リスト」画面を開いて、社有車・私有車が1件もなければ以下を登録する(既にあれば新規登録は不要): 社有車「品川500 あ 12-34」(事業所名「本店」)、私有車「練馬300 い 56-78」(使用者名「佐藤」・事業所名「横浜支店」)。

その上で、ブラウザ(またはPlaywrightの`browser_navigate`)で `http://localhost:5174` を開き、以下を確認する:

1. 「運転月報」タブの車両プルダウンに、社有車・私有車どちらも表示され、私有車側は「(車種・私有車)」または「(私有車)」という表示になっていることを確認する。
2. 私有車(練馬300 い 56-78)を選択すると、事業所名欄に上記で設定した事業所名(横浜支店)が転記表示されることを確認する(以前のように空欄固定でないこと)。
3. 社有車を選んだ場合の事業所名転記に回帰が無いことを確認する。

Expected: 上記1〜3がすべて確認できる。

- [ ] **Step 5: Commit**

```bash
git add public/report.js
git commit -m "$(cat <<'EOF'
運転月報の私有車まわりの表示を車両マスタ登録に対応させる

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: キャッシュ無効化のためのアセットバージョン更新

**Files:**
- Modify: `public/index.html`(全アセットの`?v=`クエリ)

**Interfaces:**
- Consumes: なし(Task 1〜5で変更した`storage.js`・`vehicles.js`・`trip-entry.js`・`app.js`・`report.js`が対象)。

- [ ] **Step 1: `?v=`クエリを一括更新する**

実行はリポジトリルート(`public/`の親ディレクトリ)で行う。

```bash
sed -i 's/?v=20260721a/?v=20260721b/g' public/index.html
```

- [ ] **Step 2: 置き換えを確認する**

```bash
grep -c "v=20260721b" public/index.html
```

Expected: `7`(7箇所すべて置き換わっている)。

- [ ] **Step 3: Commit**

```bash
git add public/index.html
git commit -m "$(cat <<'EOF'
車両リスト統合機能の追加に伴いアセットのキャッシュバージョンを更新

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```
