# 「車両管理者」統一・アプリアイコン設定 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 車両リストの「使用者名」(私有車)・「既定の車両管理者」(社有車)を表示・内部データとも「車両管理者」に統一し、運転月報の車両管理者欄を車両リストの登録内容から読み取り専用で転記させる。あわせて、アプリのブラウザタブアイコン・PWAアイコン・iOSホーム画面アイコンを指定画像に設定する。

**Architecture:** 車両オブジェクトの管理者情報を`vehicleManager`という単一フィールドに統一し、既存データ(`defaultManager`/`driverName`)は読み取り時のフォールバックで吸収する(一括移行はしない)。運転月報の車両管理者表示は、既存の「事業所名」欄と同じ「毎回車両リストから読み取る読み取り専用」方式にする。アイコンは元画像からPowerShell(.NET `System.Drawing`)でリサイズし、`public/icons/`配下の既存プレースホルダーを差し替える。

**Tech Stack:** 既存のvanilla JS(フレームワーク・ビルドなし)構成をそのまま維持する。画像リサイズは追加ライブラリを導入せず、Windows標準の.NET経由で行う。

## Global Constraints

- 対象spec: `docs/superpowers/specs/2026-07-22-vehicle-manager-unification-design.md`、`docs/superpowers/specs/2026-07-22-app-icon-design.md`
- 車両管理者の内部フィールド名は`vehicleManager`に統一する。既存の`defaultManager`(社有車)・`driverName`(私有車)は、読み取り時のみ`v.vehicleManager ?? v.defaultManager ?? v.driverName ?? ''`という優先順でフォールバックする。既存Firebaseデータの一括変換は行わない(次回編集・保存時に自然と`vehicleManager`のみで保存され直る)。
- 表示ラベルは社有車・私有車とも「車両管理者」に統一する。私有車側は引き続き必須項目とする。
- 運転月報の「車両管理者」欄は、「事業所名」欄と全く同じ方式(読み取り専用、選択中車両の登録内容から毎回転記、該当車両が無ければ空欄)に変更する。月報レコードへの`vehicleManager`保存は廃止する。
- アイコン元画像: `C:\Users\shar1\OneDrive\MCフォルダ\運転管理月報\運転月報.png`(392×392px)。追加のnpm依存は導入しない。
- 何かCSS/JSファイルを変更したら、最後のタスクで`public/index.html`内の全`?v=`を新しいバージョン文字列に一括更新する(既存の家訓)。現在のバージョンは`20260722d`。

---

### Task 1: storage.jsに車両管理者の統一ヘルパーを追加する

**Files:**
- Modify: `public/storage.js:30-32`(`sanitizeKey`関数の直後に追加)
- Modify: `public/storage.js:146-164`(`createEmptyMonthlyLog`関数)
- Modify: `public/storage.js:329-356`(`mergeVehicles`関数)

**Interfaces:**
- Produces: `function vehicleManagerOf(v)` → 車両オブジェクトから管理者名を取得する(`v.vehicleManager`があればそれを、無ければ`v.defaultManager`、それも無ければ`v.driverName`、いずれも無ければ空文字列を返す)。後続タスクの`vehicles.js`・`report.js`が使用する。

- [ ] **Step 1: `vehicleManagerOf`ヘルパーを追加する**

`public/storage.js`の30〜32行目(`sanitizeKey`関数)の直後、33行目(空行)の後に以下を追加する:

```js

function vehicleManagerOf(v) {
  return v.vehicleManager ?? v.defaultManager ?? v.driverName ?? '';
}
```

- [ ] **Step 2: `createEmptyMonthlyLog`から`vehicleManager`の保存を削除する**

`public/storage.js`の146〜164行目、以下の関数全体を:

```js
function createEmptyMonthlyLog(vehicleRef, year, month, meta = {}) {
  const days = {};
  for (let d = 1; d <= 31; d++) {
    days[d] = { meterReading: null, destination: '', driver: '', alcoholCheck: null, fuelAdded: null, updatedAt: null, updatedBy: null };
  }
  return {
    key: monthlyLogKey(vehicleRef, year, month),
    vehicleId: meta.vehicleId ?? null,
    privateCarLabel: meta.privateCarLabel ?? null,
    year, month,
    vehicleManager: meta.vehicleManager ?? '',
    days,
    // 項目文言はFIXED_CHECKLIST_ITEMSから表示時に都度参照する(ここではresultだけ保持する)。
    // レコードに文言を焼き込まないことで、将来文言を直しても既存データの表示が自動的に追従する。
    checklistMid: FIXED_CHECKLIST_ITEMS.map(() => ({ result: null })),
    checklistEnd: FIXED_CHECKLIST_ITEMS.map(() => ({ result: null })),
    updatedAt: new Date().toISOString()
  };
}
```

以下に置き換える(`vehicleManager: meta.vehicleManager ?? '',`の行を削除するだけ):

```js
function createEmptyMonthlyLog(vehicleRef, year, month, meta = {}) {
  const days = {};
  for (let d = 1; d <= 31; d++) {
    days[d] = { meterReading: null, destination: '', driver: '', alcoholCheck: null, fuelAdded: null, updatedAt: null, updatedBy: null };
  }
  return {
    key: monthlyLogKey(vehicleRef, year, month),
    vehicleId: meta.vehicleId ?? null,
    privateCarLabel: meta.privateCarLabel ?? null,
    year, month,
    days,
    // 項目文言はFIXED_CHECKLIST_ITEMSから表示時に都度参照する(ここではresultだけ保持する)。
    // レコードに文言を焼き込まないことで、将来文言を直しても既存データの表示が自動的に追従する。
    checklistMid: FIXED_CHECKLIST_ITEMS.map(() => ({ result: null })),
    checklistEnd: FIXED_CHECKLIST_ITEMS.map(() => ({ result: null })),
    updatedAt: new Date().toISOString()
  };
}
```

- [ ] **Step 3: `mergeVehicles`の比較を`vehicleManagerOf`に統一する**

`public/storage.js`の329〜356行目、以下の関数全体を:

```js
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

以下に置き換える:

```js
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
      || vehicleManagerOf(existing) !== vehicleManagerOf(iv);
    if (fieldsDiffer) {
      conflicts.push({ plateNumber: iv.plateNumber, local: existing, imported: iv });
    }
  });

  return { merged, conflicts };
}
```

- [ ] **Step 4: 動作確認**

```bash
node --check public/storage.js
```

期待結果: エラーなし。

ブラウザの開発者ツールコンソールで以下を実行し、フォールバックが正しく機能することを確認する:

```js
console.log(vehicleManagerOf({ vehicleManager: '新形式太郎' }));   // "新形式太郎"
console.log(vehicleManagerOf({ defaultManager: '旧社有車太郎' }));  // "旧社有車太郎"
console.log(vehicleManagerOf({ driverName: '旧私有車太郎' }));      // "旧私有車太郎"
console.log(vehicleManagerOf({}));                                 // ""
```

- [ ] **Step 5: コミット**

```bash
git add public/storage.js
git commit -m "車両管理者フィールドの統一ヘルパーを追加し、月報レコードへの保存を廃止する"
```

---

### Task 2: vehicles.jsの表示・入力・Excel入出力を「車両管理者」に統一する

**Files:**
- Modify: `public/vehicles.js:48`(一覧の列見出し)
- Modify: `public/vehicles.js:158-176`(`vehicleRow`関数)
- Modify: `public/vehicles.js:198-236`(`vehicleFormHtml`関数)
- Modify: `public/vehicles.js:238-280`(`onVehicleFormSubmit`関数)
- Modify: `public/vehicles.js:301-311`(Excelインポートの列マッピング、`onVehicleExcelSelected`内)
- Modify: `public/vehicles.js:334-359`(`exportVehiclesToExcel`関数)
- Modify: `public/vehicles.js:392-418`(`conflictPanelHtml`関数)
- Modify: `public/vehicles.js:420-447`(`applyVehicleConflictResolution`関数)

**Interfaces:**
- Consumes: `vehicleManagerOf(v)`(Task 1で`public/storage.js`に追加済み)。
- 変更なし: `pushVehicleToCloud`/`pushVehiclesToCloud`/`mergeVehicles`の呼び出し方自体(渡すオブジェクトの中身だけが変わる)。

- [ ] **Step 1: 一覧の列見出しを統一する**

`public/vehicles.js`の48行目:

```js
            <th>${vehicleActiveTab === 'private' ? '使用者名' : '既定の車両管理者'}</th>
```

を、以下に置き換える:

```js
            <th>車両管理者</th>
```

- [ ] **Step 2: `vehicleRow`を`vehicleManagerOf`に統一する**

`public/vehicles.js`の158〜176行目、以下の関数全体を:

```js
function vehicleRow(v) {
  const isPrivate = (v.vehicleType || 'company') === 'private';
  const lastCol = isPrivate ? (v.driverName || '') : (v.defaultManager || '');
  const id = escapeHtml(v.id);
  return `
    <tr>
      <td>${escapeHtml(v.plateNumber)}</td>
      <td>${escapeHtml(v.nickname || '')}</td>
      <td>${escapeHtml(v.officeName || '')}</td>
      <td>${escapeHtml(lastCol)}</td>
      <td><span class="badge ${v.active ? 'badge-active' : 'badge-inactive'}">${v.active ? '使用中' : '停止中'}</span></td>
      <td class="row-actions">
        <button class="btn btn-text vehicle-qr-btn" type="button" data-id="${id}">QRコード</button>
        <button class="btn btn-text vehicle-edit-btn" type="button" data-id="${id}">編集</button>
        <button class="btn btn-text btn-danger vehicle-delete-btn" type="button" data-id="${id}">削除</button>
      </td>
    </tr>
  `;
}
```

以下に置き換える:

```js
function vehicleRow(v) {
  const id = escapeHtml(v.id);
  return `
    <tr>
      <td>${escapeHtml(v.plateNumber)}</td>
      <td>${escapeHtml(v.nickname || '')}</td>
      <td>${escapeHtml(v.officeName || '')}</td>
      <td>${escapeHtml(vehicleManagerOf(v))}</td>
      <td><span class="badge ${v.active ? 'badge-active' : 'badge-inactive'}">${v.active ? '使用中' : '停止中'}</span></td>
      <td class="row-actions">
        <button class="btn btn-text vehicle-qr-btn" type="button" data-id="${id}">QRコード</button>
        <button class="btn btn-text vehicle-edit-btn" type="button" data-id="${id}">編集</button>
        <button class="btn btn-text btn-danger vehicle-delete-btn" type="button" data-id="${id}">削除</button>
      </td>
    </tr>
  `;
}
```

- [ ] **Step 3: `vehicleFormHtml`の入力欄を統一する**

`public/vehicles.js`の198〜236行目、以下の関数全体を:

```js
function vehicleFormHtml(v) {
  const isPrivate = v.vehicleType === 'private';
  return `
    <form class="inline-form" id="vehicleForm">
      <div class="field">
        <label>車両番号(必須)</label>
        <input type="text" class="input-lg" name="plateNumber" value="${escapeHtml(v.plateNumber || '')}" required>
      </div>
      <div class="field">
        <label>車種／名称</label>
        <input type="text" class="input-lg" name="nickname" value="${escapeHtml(v.nickname || '')}">
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
            <input type="text" class="input-lg" name="driverName" value="${escapeHtml(v.driverName || '')}" required>
          </div>`
        : `<div class="field">
            <label>既定の車両管理者</label>
            <input type="text" class="input-lg" name="defaultManager" value="${escapeHtml(v.defaultManager || '')}">
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
```

以下に置き換える:

```js
function vehicleFormHtml(v) {
  const isPrivate = v.vehicleType === 'private';
  return `
    <form class="inline-form" id="vehicleForm">
      <div class="field">
        <label>車両番号(必須)</label>
        <input type="text" class="input-lg" name="plateNumber" value="${escapeHtml(v.plateNumber || '')}" required>
      </div>
      <div class="field">
        <label>車種／名称</label>
        <input type="text" class="input-lg" name="nickname" value="${escapeHtml(v.nickname || '')}">
      </div>
      <div class="field">
        <label>事業所名</label>
        <select class="input-lg" name="officeName">
          <option value="">未選択</option>
          ${OFFICE_NAMES.map((name) => `<option value="${name}" ${v.officeName === name ? 'selected' : ''}>${name}</option>`).join('')}
        </select>
      </div>
      <div class="field">
        <label>車両管理者${isPrivate ? '(必須)' : ''}</label>
        <input type="text" class="input-lg" name="vehicleManager" value="${escapeHtml(vehicleManagerOf(v))}" ${isPrivate ? 'required' : ''}>
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
```

- [ ] **Step 4: `onVehicleFormSubmit`を統一する**

`public/vehicles.js`の238〜280行目、以下の関数全体を:

```js
async function onVehicleFormSubmit(e) {
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
  const result = await pushVehicleToCloud(vehicle);
  if (!result.ok) {
    vehicleFormState = vehicle;
    setVehicleStatus('保存できませんでした(通信エラー)', true);
    renderVehiclesView();
    return;
  }
  setVehicleStatus(`保存しました(${plateNumber})`, false);
  vehicleFormState = null;
  renderVehiclesView();
}
```

以下に置き換える:

```js
async function onVehicleFormSubmit(e) {
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
  const vehicleManager = String(fd.get('vehicleManager') || '').trim();
  if (vehicleType === 'private' && !vehicleManager) {
    setVehicleStatus('車両管理者を入力してください', true);
    renderVehiclesView();
    return;
  }
  const vehicle = {
    id: vehicleFormState.id,
    vehicleType,
    plateNumber,
    nickname: String(fd.get('nickname') || '').trim(),
    officeName: String(fd.get('officeName') || ''),
    vehicleManager,
    active: fd.get('active') === 'on'
  };
  const result = await pushVehicleToCloud(vehicle);
  if (!result.ok) {
    vehicleFormState = vehicle;
    setVehicleStatus('保存できませんでした(通信エラー)', true);
    renderVehiclesView();
    return;
  }
  setVehicleStatus(`保存しました(${plateNumber})`, false);
  vehicleFormState = null;
  renderVehiclesView();
}
```

- [ ] **Step 5: Excelインポートの列マッピングを統一する**

`public/vehicles.js`の301〜311行目:

```js
        const entry = { plateNumber, nickname, officeName, vehicleType, active: true };
        if (vehicleType === 'private') {
          entry.driverName = findColumnValue(row, [/使用者/]);
        } else {
          entry.defaultManager = findColumnValue(row, [/管理者/]);
        }
```

を、以下に置き換える(旧形式の列見出し「使用者名」のファイルも引き続き取り込めるよう、`/使用者/`も一緒にマッチさせる):

```js
        const entry = { plateNumber, nickname, officeName, vehicleType, active: true, vehicleManager: findColumnValue(row, [/管理者/, /使用者/]) };
```

- [ ] **Step 6: Excelエクスポートの列を統一する**

`public/vehicles.js`の334〜359行目、以下の関数全体を:

```js
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
```

以下に置き換える:

```js
function exportVehiclesToExcel() {
  const vehicleType = vehicleActiveTab;
  const vehicles = loadVehicles().filter((v) => (v.vehicleType || 'company') === vehicleType);
  const sheetName = VEHICLE_TYPE_LABELS[vehicleType] + 'リスト';
  const rows = vehicles.map((v) => ({
    車両番号: v.plateNumber,
    車種_名称: v.nickname || '',
    事業所名: v.officeName || '',
    車両管理者: vehicleManagerOf(v),
    状態: v.active ? '使用中' : '停止中'
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, `${sheetName}_${todayIso()}.xlsx`);
  setVehicleStatus('Excelへ出力しました', false);
  renderVehiclesView();
}
```

- [ ] **Step 7: 競合解決パネルの表示を統一する**

`public/vehicles.js`の392〜418行目、以下の関数全体を:

```js
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
          <span class="conflict-label">${escapeHtml(c.plateNumber)}</span>
          <span>この端末: ${escapeHtml(c.local.nickname || '(空)')} / ${escapeHtml(c.local.officeName || '(空)')} / ${escapeHtml(localExtra)}</span>
          <span>取込データ: ${escapeHtml(c.imported.nickname || '(空)')} / ${escapeHtml(c.imported.officeName || '(空)')} / ${escapeHtml(importedExtra)}</span>
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
```

以下に置き換える:

```js
function conflictPanelHtml(conflicts) {
  return `
    <div class="conflict-panel">
      <h3>取込内容が既存データと異なります(${conflicts.length}件)</h3>
      ${conflicts.map((c, i) => {
        return `
        <div class="conflict-row">
          <span class="conflict-label">${escapeHtml(c.plateNumber)}</span>
          <span>この端末: ${escapeHtml(c.local.nickname || '(空)')} / ${escapeHtml(c.local.officeName || '(空)')} / ${escapeHtml(vehicleManagerOf(c.local) || '(空)')}</span>
          <span>取込データ: ${escapeHtml(c.imported.nickname || '(空)')} / ${escapeHtml(c.imported.officeName || '(空)')} / ${escapeHtml(vehicleManagerOf(c.imported) || '(空)')}</span>
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
```

- [ ] **Step 8: 競合解決の適用処理を統一する**

`public/vehicles.js`の420〜447行目、以下の関数全体を:

```js
async function applyVehicleConflictResolution() {
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
  const result = await pushVehiclesToCloud(merged);
  if (!result.ok) {
    setVehicleStatus('保存できませんでした(通信エラー)', true);
    renderVehiclesView();
    return;
  }
  vehicleImportConflicts = null;
  setVehicleStatus('取込内容を適用しました', false);
  renderVehiclesView();
}
```

以下に置き換える:

```js
async function applyVehicleConflictResolution() {
  const { merged, conflicts } = vehicleImportConflicts;
  conflicts.forEach((c, i) => {
    const choice = document.querySelector(`input[name="conflict-${i}"]:checked`).value;
    if (choice === 'imported') {
      const target = merged.find((v) => v.plateNumber === c.plateNumber && (v.vehicleType || 'company') === (c.imported.vehicleType || 'company'));
      if (target) {
        target.nickname = c.imported.nickname;
        target.officeName = c.imported.officeName;
        target.active = c.imported.active;
        target.vehicleManager = vehicleManagerOf(c.imported);
      }
    }
  });
  const result = await pushVehiclesToCloud(merged);
  if (!result.ok) {
    setVehicleStatus('保存できませんでした(通信エラー)', true);
    renderVehiclesView();
    return;
  }
  vehicleImportConflicts = null;
  setVehicleStatus('取込内容を適用しました', false);
  renderVehiclesView();
}
```

- [ ] **Step 9: 動作確認(ブラウザ)**

```bash
node --check public/vehicles.js
```

期待結果: エラーなし。

`npm start`でローカルサーバーを起動し、ブラウザで`http://localhost:5174`を開いて以下を確認する(管理者パスワード`anzen_kanri`で解除):

1. 「車両リスト」で社有車を1台新規追加する。フォームのラベルが「車両管理者」(必須マークなし)になっていることを確認する。一覧の列見出しも「車両管理者」になっていることを確認する。
2. 「私有車」タブで1台新規追加する。フォームのラベルが「車両管理者(必須)」になっていること、未入力で送信すると「車両管理者を入力してください」と表示されることを確認する。
3. 追加した車両を編集し、車両管理者欄に前回入力した値が正しく表示されていることを確認する。
4. 「Excelへ出力」して、出力されたファイルの列見出しが社有車・私有車とも「車両管理者」になっていることを確認する(表計算ソフトまたはファイル内容の確認で可)。
5. 既存の実データ(Firebase上の`defaultManager`のみ保存済みの車両)を表示し、一覧・編集フォームの車両管理者欄に、フォールバックで正しく値が表示されることを確認する(この既存データは絶対に変更・削除しないこと)。

- [ ] **Step 10: コミット**

```bash
git add public/vehicles.js
git commit -m "車両リストの使用者名・既定の車両管理者を車両管理者に統一する"
```

---

### Task 3: trip-entry.jsから月報レコードへのvehicleManager書き込みを削除する

**Files:**
- Modify: `public/trip-entry.js:224-231`(`resolveVehicleSelection`関数)
- Modify: `public/trip-entry.js:233-271`(`onTripEntrySubmit`関数)
- Modify: `public/trip-entry.js:274-303`(`onFuelEntrySubmit`関数)

**Interfaces:**
- 変更なし: `saveTripDay`/`saveFuelOnly`(`public/storage.js`)のシグネチャ自体(第5引数の`meta`オブジェクトに渡すキーが減るだけ)。

- [ ] **Step 1: `resolveVehicleSelection`から`vehicleManager`の計算を削除する**

`public/trip-entry.js`の224〜231行目:

```js
function resolveVehicleSelection(fd) {
  const vehicles = loadVehicles();
  const vehicleId = fd.get('vehicleId');
  if (!vehicleId) return { error: tripUsePrivateCar ? '私有車を選択してください' : '車両を選択してください' };
  const vehicle = vehicles.find((v) => v.id === vehicleId);
  const vehicleManager = (vehicle && vehicle.vehicleType !== 'private') ? (vehicle.defaultManager || '') : '';
  return { vehicleId, privateCarLabel: null, vehicleManager, vehicle };
}
```

を、以下に置き換える:

```js
function resolveVehicleSelection(fd) {
  const vehicles = loadVehicles();
  const vehicleId = fd.get('vehicleId');
  if (!vehicleId) return { error: tripUsePrivateCar ? '私有車を選択してください' : '車両を選択してください' };
  const vehicle = vehicles.find((v) => v.id === vehicleId);
  return { vehicleId, privateCarLabel: null, vehicle };
}
```

- [ ] **Step 2: `onTripEntrySubmit`の分割代入・保存呼び出しから`vehicleManager`を削除する**

`public/trip-entry.js`の247行目:

```js
  const { vehicleId, privateCarLabel, vehicleManager } = sel;
```

を、以下に置き換える:

```js
  const { vehicleId, privateCarLabel } = sel;
```

同じ関数内、264行目:

```js
  const savedRecord = saveTripDay(vehicleRef, year, month, day, dayData, { vehicleId, privateCarLabel, vehicleManager, updatedBy: driver });
```

を、以下に置き換える:

```js
  const savedRecord = saveTripDay(vehicleRef, year, month, day, dayData, { vehicleId, privateCarLabel, updatedBy: driver });
```

- [ ] **Step 3: `onFuelEntrySubmit`の分割代入・保存呼び出しから`vehicleManager`を削除する**

`public/trip-entry.js`の288行目:

```js
  const { vehicleId, privateCarLabel, vehicleManager } = sel;
```

を、以下に置き換える:

```js
  const { vehicleId, privateCarLabel } = sel;
```

同じ関数内、298行目:

```js
  saveFuelOnly(vehicleRef, year, month, day, fuelAdded, { vehicleId, privateCarLabel, vehicleManager });
```

を、以下に置き換える:

```js
  saveFuelOnly(vehicleRef, year, month, day, fuelAdded, { vehicleId, privateCarLabel });
```

- [ ] **Step 4: 動作確認(ブラウザ)**

```bash
node --check public/trip-entry.js
```

期待結果: エラーなし。

ブラウザで運転記録入力・給油入力それぞれ1件ずつ保存し、エラーが出ないこと、`loadMonthlyLog(vehicleRef, year, month)`の該当レコードに`vehicleManager`キー自体が含まれていないこと(または`undefined`であること)をコンソールで確認する。

- [ ] **Step 5: コミット**

```bash
git add public/trip-entry.js
git commit -m "運転記録入力・給油入力から月報レコードへのvehicleManager書き込みを廃止する"
```

---

### Task 4: 運転月報の車両管理者を読み取り専用の転記表示にする

**Files:**
- Modify: `public/report.js:76-181`(`renderReportView`関数)
- Modify: `public/xlsx-export.js:13-27`(`exportMonthlyLogToXlsx`関数)

**Interfaces:**
- Consumes: `vehicleManagerOf(v)`(Task 1で`public/storage.js`に追加済み)。
- Produces(変更): `exportMonthlyLogToXlsx(record, vehicleLabel, officeName, vehicleManager)` — 第4引数`vehicleManager`が追加される。

- [ ] **Step 1: `renderReportView`で`vehicleManager`を事業所名と同じ方式で計算する**

`public/report.js`の76〜80行目:

```js
  const totals = computeTotals(record.days);
  const holidays = computeJapaneseHolidays(record.year);
  // 事業所名は車両リストの登録内容から転記する(未登録の私有車履歴の場合は転記元が無いため空欄)
  const vehicle = selectedOption.vehicleId ? loadVehicles().find((v) => v.id === selectedOption.vehicleId) : null;
  const officeName = vehicle ? (vehicle.officeName || '') : '';
```

を、以下に置き換える:

```js
  const totals = computeTotals(record.days);
  const holidays = computeJapaneseHolidays(record.year);
  // 事業所名・車両管理者は車両リストの登録内容から転記する(未登録の私有車履歴の場合は転記元が無いため空欄)
  const vehicle = selectedOption.vehicleId ? loadVehicles().find((v) => v.id === selectedOption.vehicleId) : null;
  const officeName = vehicle ? (vehicle.officeName || '') : '';
  const vehicleManager = vehicle ? vehicleManagerOf(vehicle) : '';
```

- [ ] **Step 2: 車両管理者の入力欄を読み取り専用にする**

`public/report.js`の109〜112行目:

```js
        <div class="field">
          <label>車両管理者</label>
          <input type="text" class="input-lg" id="reportManagerInput" value="${escapeHtml(record.vehicleManager || '')}">
        </div>
```

を、以下に置き換える:

```js
        <div class="field">
          <label>車両管理者</label>
          <input type="text" class="input-lg" value="${escapeHtml(vehicleManager)}" readonly>
          <p class="hint">※ 車両リストの車両登録内容から転記されます。未登録の私有車には転記元がないため空欄です。</p>
        </div>
```

- [ ] **Step 3: 印刷用ヘッダーの表示を転記した値に変更する**

`public/report.js`の123行目:

```js
          車両管理者：<strong>${escapeHtml(record.vehicleManager || '')}</strong><br>
```

を、以下に置き換える:

```js
          車両管理者：<strong>${escapeHtml(vehicleManager)}</strong><br>
```

- [ ] **Step 4: 車両管理者の手入力保存リスナーを削除する**

`public/report.js`の160〜164行目:

```js
  document.getElementById('reportManagerInput').addEventListener('blur', (e) => {
    record.vehicleManager = e.target.value.trim();
    saveMonthlyLog(record);
    renderReportView();
  });
```

このブロックを丸ごと削除する(`reportManagerInput`というID自体がStep 2でinputから外れているため、このリスナー登録は不要になる)。

- [ ] **Step 5: Excel出力の呼び出しに`vehicleManager`を渡す**

`public/report.js`の172〜173行目:

```js
      const vehicleLabel = selectedOption.vehicleId ? (vehicle || {}).plateNumber : record.privateCarLabel;
      await exportMonthlyLogToXlsx(record, vehicleLabel, officeName);
```

を、以下に置き換える:

```js
      const vehicleLabel = selectedOption.vehicleId ? (vehicle || {}).plateNumber : record.privateCarLabel;
      await exportMonthlyLogToXlsx(record, vehicleLabel, officeName, vehicleManager);
```

- [ ] **Step 6: `exportMonthlyLogToXlsx`が`vehicleManager`を引数で受け取るようにする**

`public/xlsx-export.js`の13〜27行目:

```js
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
```

を、以下に置き換える:

```js
async function exportMonthlyLogToXlsx(record, vehicleLabel, officeName, vehicleManager) {
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
  cover.getCell('E30').value = vehicleManager || '';
```

(関数の残り、31行目以降は変更しない。)

- [ ] **Step 7: 動作確認(ブラウザ)**

```bash
node --check public/report.js && node --check public/xlsx-export.js
```

期待結果: エラーなし。

ブラウザで「運転月報」タブを開き、以下を確認する:

1. 車両管理者欄が入力不可(readonly)になっており、選択中の車両(車両リストで登録した「車両管理者」)の値がそのまま表示されること。
2. 車両を切り替えると、車両管理者欄の表示も切り替わること。
3. 印刷プレビュー(またはページ上の`.report-header-cell`表示)にも同じ値が表示されること。
4. 「Excelとして出力」を実行し、出力ファイルの表紙シートE30セルに車両管理者名が正しく入っていること。
5. 既存の実データ(Firebase上の`defaultManager`のみ保存済みの社有車)を選択し、車両管理者欄に正しくフォールバックで値が転記されることを確認する(既存データは変更・削除しないこと)。

- [ ] **Step 8: コミット**

```bash
git add public/report.js public/xlsx-export.js
git commit -m "運転月報の車両管理者欄を車両リストからの読み取り専用転記に変更する"
```

---

### Task 5: アプリアイコンを生成し、favicon・PWA・iOS用に設定する

**Files:**
- Create/Overwrite: `public/icons/icon-192.png`
- Create/Overwrite: `public/icons/icon-512.png`
- Create: `public/icons/apple-touch-icon.png`
- Modify: `public/index.html:6-9`(`<head>`内)

**Interfaces:**
- 変更なし: `public/manifest.json`(`icons`配列のファイルパス自体は変更しない。中身のPNGファイルだけ差し替える)。

- [ ] **Step 1: 元画像から3つのアイコンファイルを生成する**

PowerShellツールで以下を実行する(Windows標準の.NET `System.Drawing`を使用。追加ライブラリのインストールは不要):

```powershell
Add-Type -AssemblyName System.Drawing
function Resize-SquareIcon {
    param([string]$SourcePath, [string]$DestPath, [int]$Size)
    $src = [System.Drawing.Image]::FromFile($SourcePath)
    $bmp = New-Object System.Drawing.Bitmap($Size, $Size)
    $graphics = [System.Drawing.Graphics]::FromImage($bmp)
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.DrawImage($src, 0, 0, $Size, $Size)
    $bmp.Save($DestPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $graphics.Dispose()
    $bmp.Dispose()
    $src.Dispose()
}
$sourceImage = "C:\Users\shar1\OneDrive\MCフォルダ\運転管理月報\運転月報.png"
Resize-SquareIcon -SourcePath $sourceImage -DestPath "public\icons\icon-192.png" -Size 192
Resize-SquareIcon -SourcePath $sourceImage -DestPath "public\icons\icon-512.png" -Size 512
Resize-SquareIcon -SourcePath $sourceImage -DestPath "public\icons\apple-touch-icon.png" -Size 180
Write-Output "Done"
```

期待結果: `Done`が出力され、エラーが発生しない。

- [ ] **Step 2: 生成したファイルのサイズを確認する**

```bash
file public/icons/icon-192.png public/icons/icon-512.png public/icons/apple-touch-icon.png
```

期待結果: それぞれ`PNG image data, 192 x 192`、`PNG image data, 512 x 512`、`PNG image data, 180 x 180`という出力になること。

- [ ] **Step 3: `index.html`にファビコン・iOS用アイコンのリンクを追加する**

`public/index.html`の6〜9行目:

```html
<title>運転管理月報</title>
<link rel="manifest" href="manifest.json">
<meta name="theme-color" content="#2f6fed">
<link rel="stylesheet" href="style.css?v=20260722d">
```

を、以下に置き換える:

```html
<title>運転管理月報</title>
<link rel="manifest" href="manifest.json">
<link rel="icon" type="image/png" sizes="192x192" href="icons/icon-192.png?v=20260722d">
<link rel="apple-touch-icon" href="icons/apple-touch-icon.png?v=20260722d">
<meta name="theme-color" content="#2f6fed">
<link rel="stylesheet" href="style.css?v=20260722d">
```

- [ ] **Step 4: 動作確認(ブラウザ)**

`npm start`でローカルサーバーを起動し、ブラウザで`http://localhost:5174`を開いて以下を確認する:

1. ブラウザタブに新しいロゴのファビコンが表示され、開発者ツールのコンソール・ネットワークタブに`favicon.ico`の404エラーが出ないこと(`icon-192.png`が代わりに正常に読み込まれること)。
2. 開発者ツールのNetworkタブ、またはページ内で`icons/icon-192.png?v=20260722d`・`icons/apple-touch-icon.png?v=20260722d`が200 OKで読み込まれていることを確認する。
3. `public/manifest.json`の中身自体は変更していないが、参照先の`icons/icon-192.png`・`icons/icon-512.png`が新しいロゴ画像になっていることを、ブラウザで直接`http://localhost:5174/icons/icon-192.png`を開いて目視確認する。

- [ ] **Step 5: コミット**

```bash
git add public/icons/icon-192.png public/icons/icon-512.png public/icons/apple-touch-icon.png public/index.html
git commit -m "アプリアイコンをブラウザタブ・PWA・iOSホーム画面用に設定する"
```

---

### Task 6: キャッシュバージョンの更新

**Files:**
- Modify: `public/index.html`

**Interfaces:**
- Consumes: なし(Task 1〜5で`public/storage.js`・`public/vehicles.js`・`public/trip-entry.js`・`public/report.js`・`public/xlsx-export.js`・`public/index.html`が変更されたことを受けての、既存のキャッシュバスティング運用に従う作業)。

- [ ] **Step 1: バージョン文字列を一括更新する**

`public/index.html`内の`?v=20260722d`をすべて`?v=20260722e`に置き換える(既存の`link`タグ1箇所+`script`タグ6箇所+Task 5で追加した2箇所、計9箇所):

```bash
sed -i 's/?v=20260722d/?v=20260722e/g' public/index.html
```

- [ ] **Step 2: 置換件数を確認する**

```bash
grep -c "?v=20260722e" public/index.html
```

期待結果: `9`

- [ ] **Step 3: コミット**

```bash
git add public/index.html
git commit -m "車両管理者統一・アプリアイコン設定の追加に伴いアセットのキャッシュバージョンを更新"
```
