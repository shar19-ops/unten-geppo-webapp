# 車両マスタのFirebase共有(クラウド同期) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 車両マスタ(社有車・私有車リスト)をFirebase Realtime Databaseに同期し、どの端末からQRコードを読み取っても正しく車両が見つかるようにする。

**Architecture:** Firebase Realtime Databaseを車両マスタの一次情報源(source of truth)とし、既存の`localStorage`は表示用ローカルキャッシュ兼オフライン時のフォールバックに位置づけを変える。運転記録(走行データ・給油記録・月報)は今まで通り`localStorage`のみで完結し、同期対象にしない。

**Tech Stack:** Firebase Realtime Database(REST API、SDK不使用、素の`fetch()`のみ)。既存のvanilla JS(フレームワーク・ビルドなし)構成をそのまま維持する。

## Global Constraints

- 対象spec: `docs/superpowers/specs/2026-07-22-vehicle-master-cloud-sync-design.md`
- 同期対象は車両マスタ(`/vehicles`ノード)のみ。運転記録・給油記録・月報は対象外。
- Firebase SDKは使わず、素の`fetch()`のみで読み書きする(ビルド不要という既存方針に合わせる)。
- Firebaseのセキュリティルールは`{"rules": {".read": true, ".write": true}}`(全開放。既存の管理者パスワード=クライアント側のみの簡易保護、というセキュリティモデルの延長として承認済み)。
- データ構造は`/vehicles/{車両ID}`というキー付きオブジェクト(配列ではない)。
- `loadVehicles()`(`public/storage.js`)は同期関数のまま維持し、常にローカルキャッシュ(`localStorage`)を読む。`trip-entry.js`・`report.js`は無改修。
- 通信エラー時は起動時読み込みなら黙ってローカルキャッシュにフォールバックし、書き込み(追加・編集・削除・インポート確定)ならローカルキャッシュを更新せずエラーメッセージを表示する。
- 何かCSS/JSファイルを変更したら、最後のタスクで`public/index.html`内の全`?v=`を新しいバージョン文字列に一括更新する(既存の家訓)。現在のバージョンは`20260722a`。

**⚠️ 実行前の前提条件(コントローラー向け):** Task 1で使う`FIREBASE_DB_URL`の値は、ユーザーがFirebaseコンソールで新規プロジェクトを作成し、Realtime Databaseを有効化した上で発行される実際のDatabase URLです。**Task 1をサブエージェントにディスパッチする前に、必ずユーザーからこの実際のURL(例: `https://xxxx-default-rtdb.asia-southeast1.firebasedatabase.app`、末尾スラッシュなし)を確認し、下記コードブロック中の`FIREBASE_DB_URL`の値をその実URLに置き換えてからタスクブリーフを作成すること。** ユーザーがまだURLを持っていない場合は、そこでブロックしてユーザーに確認する(推測や仮の値でタスクを進めない)。

---

### Task 1: storage.jsにFirebase同期関数を追加する

**Files:**
- Modify: `public/storage.js:1-3`(冒頭コメント)
- Modify: `public/storage.js`(46〜73行目の「社有車マスタ」セクション末尾、`deleteVehicle`関数の直後に新セクションを追記)

**Interfaces:**
- Produces: `async function syncVehiclesFromCloud()` → Firebaseから車両マスタ全件を取得し、ローカルキャッシュ(`saveVehicles`)を上書きして配列を返す。通信エラー時は例外を投げずローカルキャッシュの配列を返す。
- Produces: `async function pushVehicleToCloud(vehicle)` → 1台分をFirebaseへ書き込み、成功したらローカルキャッシュも更新して`{ok: true, vehicle}`を返す。失敗したら`{ok: false}`を返し、ローカルキャッシュは変更しない。
- Produces: `async function deleteVehicleFromCloud(vehicleId)` → 1台分をFirebaseから削除し、成功したらローカルキャッシュも更新して`{ok: true}`を返す。失敗したら`{ok: false}`を返し、ローカルキャッシュは変更しない。
- Produces: `async function pushVehiclesToCloud(list)` → 車両配列をまるごとFirebaseへ上書き(Excelインポート確定用)。成功したら`{ok: true}`、失敗したら`{ok: false}`を返す。失敗時はローカルキャッシュを変更しない。
- Consumes: 既存の`loadVehicles()`/`saveVehicles(list)`/`generateId()`(すべて`public/storage.js`内、変更なし)。

- [ ] **Step 1: storage.js冒頭コメントを更新する**

`public/storage.js`の1〜3行目を、以下の内容に置き換える:

```js
// データアクセス層。vehicles.js/trip-entry.js/report.jsはこのファイルの関数経由でのみ
// データに触れる。車両マスタはFirebase Realtime Databaseと同期し(syncVehiclesFromCloud等)、
// 運転記録(月報・給油記録)は引き続きlocalStorageのみで完結する。
```

- [ ] **Step 2: Firebase同期関数を追加する**

`public/storage.js`の73行目(`deleteVehicle`関数の閉じ`}`)の直後、75行目の`// ---------------- 月報レコード ----------------`コメントの直前に、以下を追記する:

```js

// ---------------- 車両マスタのクラウド同期(Firebase Realtime Database) ----------------
// Firebase SDKは使わず、素のfetch()のみで読み書きする(ビルド不要という既存方針に合わせる)。
// ルールは{".read":true,".write":true}(全開放)の前提。DB URLの末尾にスラッシュは付けない。
const FIREBASE_DB_URL = 'https://REPLACE_WITH_REAL_FIREBASE_DB_URL';

async function syncVehiclesFromCloud() {
  try {
    const res = await fetch(`${FIREBASE_DB_URL}/vehicles.json`);
    if (!res.ok) throw new Error('Firebase read failed: ' + res.status);
    const data = await res.json();
    const list = data ? Object.values(data) : [];
    saveVehicles(list);
    return list;
  } catch {
    return loadVehicles();
  }
}

async function pushVehicleToCloud(vehicle) {
  const list = loadVehicles();
  const now = new Date().toISOString();
  const idx = list.findIndex((v) => v.id === vehicle.id);
  const finalVehicle = idx >= 0
    ? { ...list[idx], ...vehicle, updatedAt: now }
    : { ...vehicle, id: vehicle.id || generateId(), createdAt: now, updatedAt: now };
  try {
    const res = await fetch(`${FIREBASE_DB_URL}/vehicles/${finalVehicle.id}.json`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(finalVehicle)
    });
    if (!res.ok) throw new Error('Firebase write failed: ' + res.status);
  } catch {
    return { ok: false };
  }
  const newList = idx >= 0 ? list.map((v, i) => (i === idx ? finalVehicle : v)) : [...list, finalVehicle];
  saveVehicles(newList);
  return { ok: true, vehicle: finalVehicle };
}

async function deleteVehicleFromCloud(vehicleId) {
  try {
    const res = await fetch(`${FIREBASE_DB_URL}/vehicles/${vehicleId}.json`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Firebase delete failed: ' + res.status);
  } catch {
    return { ok: false };
  }
  const list = loadVehicles().filter((v) => v.id !== vehicleId);
  saveVehicles(list);
  return { ok: true };
}

async function pushVehiclesToCloud(list) {
  const map = {};
  list.forEach((v) => { map[v.id] = v; });
  try {
    const res = await fetch(`${FIREBASE_DB_URL}/vehicles.json`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(map)
    });
    if (!res.ok) throw new Error('Firebase bulk write failed: ' + res.status);
  } catch {
    return { ok: false };
  }
  saveVehicles(list);
  return { ok: true };
}
```

**重要:** `FIREBASE_DB_URL`の値`'https://REPLACE_WITH_REAL_FIREBASE_DB_URL'`は、ディスパッチ前にコントローラーから渡された実際のDatabase URLに置き換えてから書き込むこと。この文字列のまま実装を完了してはならない。

- [ ] **Step 3: 動作確認(ブラウザ開発者ツール)**

ターミナルでローカルサーバーを起動する:

```bash
npm start
```

ブラウザで `http://localhost:5174` を開き、開発者ツールのコンソールで以下を順に実行する:

```js
await syncVehiclesFromCloud()
```
期待結果: エラーを投げず、配列(初回は`[]`の可能性が高い)が返る。

```js
const result = await pushVehicleToCloud({ vehicleType: 'company', plateNumber: 'TEST-1', nickname: 'テスト車両', officeName: '本店', active: true, defaultManager: '' });
console.log(result);
```
期待結果: `{ ok: true, vehicle: { id: '...', plateNumber: 'TEST-1', ... } }`が返る。

Firebaseコンソール(https://console.firebase.google.com )で対象プロジェクトの「Realtime Database」→「データ」タブを開き、`/vehicles/<返ってきたid>`ノードに上記内容が保存されていることを目視確認する。

```js
await deleteVehicleFromCloud(result.vehicle.id)
```
期待結果: `{ ok: true }`が返り、Firebaseコンソール側で該当ノードが消えていることを確認する。

```js
await pushVehiclesToCloud([])
```
期待結果: `{ ok: true }`が返り、Firebaseコンソール側で`/vehicles`ノードが空になっていることを確認する(Task 2以降のテストのためクリーンな状態に戻す)。

- [ ] **Step 4: コミット**

```bash
git add public/storage.js
git commit -m "車両マスタをFirebase Realtime Databaseと同期する関数をstorage.jsに追加する"
```

---

### Task 2: vehicles.jsのCRUD処理をクラウド同期に切り替える

**Files:**
- Modify: `public/vehicles.js:1`(冒頭コメント)
- Modify: `public/vehicles.js:110-119`(削除ボタンのイベントリスナー)
- Modify: `public/vehicles.js:232-268`(`onVehicleFormSubmit`)
- Modify: `public/vehicles.js:349-361`(`onVehicleJsonSelected`)
- Modify: `public/vehicles.js:363-373`(`applyVehicleImport`)
- Modify: `public/vehicles.js:403-425`(`applyVehicleConflictResolution`)
- Modify: `public/storage.js:56-73`(旧`saveVehicle`/`deleteVehicle`関数を削除)

**Interfaces:**
- Consumes: `pushVehicleToCloud(vehicle)` / `deleteVehicleFromCloud(vehicleId)` / `pushVehiclesToCloud(list)`(いずれもTask 1で`public/storage.js`に追加済み、すべて非同期、戻り値は`{ok: boolean, vehicle?: object}`)。
- 本タスク完了後、`saveVehicle`/`deleteVehicle`(単数形、`public/storage.js`の旧関数)を呼び出す箇所はコードベース上に一切残らない。

- [ ] **Step 1: vehicles.js冒頭コメントを更新する**

`public/vehicles.js`の1行目を以下に置き換える:

```js
// 車両リスト管理画面(社有車・私有車)。データはすべてstorage.js経由(loadVehicles/pushVehicleToCloud/deleteVehicleFromCloud/pushVehiclesToCloud/mergeVehicles)。車両マスタはFirebaseと同期される。
```

- [ ] **Step 2: 削除ボタンの処理を非同期化する**

`public/vehicles.js`の110〜119行目を、以下に置き換える:

```js
  root.querySelectorAll('.vehicle-delete-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const v = allVehicles.find((x) => x.id === btn.dataset.id);
      if (confirm(`「${v.plateNumber}」を削除します。よろしいですか?`)) {
        const result = await deleteVehicleFromCloud(v.id);
        if (!result.ok) {
          setVehicleStatus('削除できませんでした(通信エラー)', true);
          renderVehiclesView();
          return;
        }
        setVehicleStatus(`削除しました(${v.plateNumber})`, false);
        renderVehiclesView();
      }
    });
  });
```

- [ ] **Step 3: 追加・編集フォームの送信処理を非同期化する**

`public/vehicles.js`の232〜268行目(`function onVehicleFormSubmit(e) { ... }`全体)を、以下に置き換える:

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
    setVehicleStatus('保存できませんでした(通信エラー)', true);
    renderVehiclesView();
    return;
  }
  setVehicleStatus(`保存しました(${plateNumber})`, false);
  vehicleFormState = null;
  renderVehiclesView();
}
```

- [ ] **Step 4: JSON取込の呼び出しをawaitする**

`public/vehicles.js`の349〜361行目(`async function onVehicleJsonSelected(e) { ... }`)内、356行目の

```js
    applyVehicleImport(data, `JSONから${data.length}件読み込みました`);
```

を、以下に置き換える:

```js
    await applyVehicleImport(data, `JSONから${data.length}件読み込みました`);
```

- [ ] **Step 5: インポート反映処理を非同期化する**

`public/vehicles.js`の363〜373行目(`function applyVehicleImport(importedList, successMessage) { ... }`全体)を、以下に置き換える:

```js
async function applyVehicleImport(importedList, successMessage) {
  const { merged, conflicts } = mergeVehicles(loadVehicles(), importedList);
  if (conflicts.length) {
    vehicleImportConflicts = { merged, conflicts };
    setVehicleStatus(`${conflicts.length}件の車両で内容の食い違いがあります。下で選んで適用してください。`, true);
  } else {
    const result = await pushVehiclesToCloud(merged);
    if (!result.ok) {
      setVehicleStatus('保存できませんでした(通信エラー)', true);
      renderVehiclesView();
      return;
    }
    setVehicleStatus(successMessage, false);
  }
  renderVehiclesView();
}
```

- [ ] **Step 6: 競合解決確定処理を非同期化する**

`public/vehicles.js`の403〜425行目(`function applyVehicleConflictResolution() { ... }`全体)を、以下に置き換える:

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
    vehicleImportConflicts = null;
    renderVehiclesView();
    return;
  }
  vehicleImportConflicts = null;
  setVehicleStatus('取込内容を適用しました', false);
  renderVehiclesView();
}
```

- [ ] **Step 7: 不要になった旧関数をstorage.jsから削除する**

`public/storage.js`の56〜73行目、以下のブロックを丸ごと削除する(この時点でコードベース上に呼び出し箇所は残っていない):

```js
function saveVehicle(vehicle) {
  const list = loadVehicles();
  const now = new Date().toISOString();
  const idx = list.findIndex((v) => v.id === vehicle.id);
  if (idx >= 0) {
    list[idx] = { ...list[idx], ...vehicle, updatedAt: now };
  } else {
    list.push({ ...vehicle, id: vehicle.id || generateId(), createdAt: now, updatedAt: now });
  }
  saveVehicles(list);
  return list;
}

function deleteVehicle(vehicleId) {
  const list = loadVehicles().filter((v) => v.id !== vehicleId);
  saveVehicles(list);
  return list;
}
```

削除後、`grep -n "saveVehicle(\|deleteVehicle(" public/*.js`を実行して、定義・呼び出しとも一件もヒットしないことを確認する(`saveVehicles`/`loadVehicles`という別関数名はヒットしても問題ない)。

- [ ] **Step 8: 動作確認(ブラウザ)**

`npm start`でローカルサーバーを起動し、ブラウザで`http://localhost:5174`を開く。

1. ヘッダーの「管理者」にチェックを入れ、パスワード`anzen_kanri`で解除する。
2. 「車両リスト」タブを開き、「社有車」タブで「＋社有車を追加」から、車両番号`TEST-2`、車種`検証車両`で追加する。「保存しました」と表示されることを確認する。
3. Firebaseコンソールの「データ」タブで`/vehicles`配下に`TEST-2`のノードが追加されていることを確認する。
4. 一覧の「編集」から車種名を`検証車両(編集済み)`に変更して更新し、Firebaseコンソール側の値も更新されていることを確認する。
5. 「削除」ボタンで削除し、Firebaseコンソール側からもノードが消えることを確認する。
6. 通信エラー時の挙動確認: 開発者ツールのNetworkタブで「Offline」に切り替えた状態で車両を追加し、「保存できませんでした(通信エラー)」が表示されること、かつ一覧に追加されていないことを確認する。確認後、Networkタブを「Online」に戻す。

- [ ] **Step 9: コミット**

```bash
git add public/vehicles.js public/storage.js
git commit -m "車両リスト画面の追加・編集・削除・インポート確定をFirebaseへの書き込みに切り替える"
```

---

### Task 3: app.jsの起動処理・タブ切替をクラウド同期に対応させる

**Files:**
- Modify: `public/app.js:19-28`(`showView`関数)
- Modify: `public/app.js:212-231`(起動時のQR解決処理・初期表示呼び出し)

**Interfaces:**
- Consumes: `syncVehiclesFromCloud()`(Task 1で`public/storage.js`に追加済み、非同期、ローカルキャッシュを上書きしてから配列を返す)。
- Produces: `showView(name)`が非同期関数になる(呼び出し側は`await`してもしなくても動作するが、結果を待たずに呼んだ場合は描画が数百ms遅れて反映される)。

- [ ] **Step 1: showView()を非同期化し、車両リスト表示前にクラウド同期する**

`public/app.js`の19〜28行目を、以下に置き換える:

```js
async function showView(name) {
  VIEWS.forEach((v) => {
    document.getElementById(`view-${v}`).classList.toggle('active', v === name);
    document.querySelector(`.tab-btn[data-view="${v}"]`).classList.toggle('active', v === name);
  });
  document.body.dataset.view = name;
  if (name === 'vehicles') {
    await syncVehiclesFromCloud();
    renderVehiclesView();
  }
  if (name === 'trip-entry') renderTripEntryView();
  if (name === 'report') renderReportView();
}
```

- [ ] **Step 2: 起動処理をクラウド同期→QR解決→初期表示の順に組み直す**

`public/app.js`の212〜231行目(`// QRコードからの起動処理...`のコメントから末尾の`showView('trip-entry');`まで)を、以下に置き換える:

```js
// アプリ起動処理: 車両マスタをFirebaseから同期してから、QRパラメータの解決・初期画面表示を行う
// (社有車・私有車問わず?vehicle=<id>を読み取り、運転記録入力へ車両自動選択で遷移する)
async function bootstrapApp() {
  await syncVehiclesFromCloud();

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

  // 同期待ちの間にユーザーが別タブ(運転月報など)を手動でクリックしていた場合、
  // それを上書きして運転記録入力に戻さないようにするためのガード
  if (!document.body.dataset.view) {
    showView('trip-entry');
  }
}

bootstrapApp();
```

- [ ] **Step 3: 動作確認(2つの別ブラウザコンテキストで端末をまたいだ動作を検証)**

`npm start`でローカルサーバーを起動する。

1. 通常のブラウザウィンドウ(コンテキストA)で`http://localhost:5174`を開き、「管理者」を`anzen_kanri`で解除→「車両リスト」→「社有車」タブで、車両番号`TEST-3`、車種`共有確認用`を追加する。
2. 同じ車両行の「QRコード」ボタンを押し、表示される`.qr-url`のURL文字列(`http://localhost:5174/?vehicle=id_...`の形式)をコピーする。
3. 別のブラウザコンテキスト(シークレットウィンドウ、または別ブラウザ。コンテキストB。コンテキストAとは別のlocalStorageになるので「別端末」を模擬できる)で、まず`http://localhost:5174`(パラメータなし)を開き、「運転記録入力」画面の車両選択プルダウンに`TEST-3`が表示されることを確認する(=起動時同期で他コンテキストの追加分が見えている)。
4. コンテキストBで、手順2でコピーしたURL(`?vehicle=...`付き)を開く。「運転記録入力」画面が開き、車両選択に`TEST-3`が自動選択されていることを確認する(「QRコードに対応する車両が見つかりませんでした」が表示されないこと)。これが元の不具合の直接的な再現確認になる。
5. コンテキストAで`TEST-3`を削除する。コンテキストBをリロードし、車両選択プルダウンから`TEST-3`が消えていることを確認する。
6. オフライン時のフォールバック確認: コンテキストBの開発者ツールNetworkタブを「Offline」にしてからリロードする。エラーでアプリが止まらず、「運転記録入力」画面が表示されること(直前まで同期済みのキャッシュで動作すること)を確認する。確認後、Networkタブを「Online」に戻す。
7. 起動時の同期待ちレース確認: 開発者ツールのNetworkタブで「Slow 3G」などの低速回線に設定してからリロードし、ページ読み込み直後(まだどの画面も表示されていないタイミング)に素早く「運転月報」タブをクリックする。同期完了後に「運転記録入力」へ勝手に戻されず、「運転月報」が表示されたままであることを確認する。確認後、Networkタブを「No throttling」に戻す。

- [ ] **Step 4: コミット**

```bash
git add public/app.js
git commit -m "アプリ起動時とタブ切替時に車両マスタをFirebaseから同期するようにする"
```

---

### Task 4: キャッシュバージョンの更新

**Files:**
- Modify: `public/index.html`

**Interfaces:**
- Consumes: なし(Task 1〜3で`public/storage.js`・`public/vehicles.js`・`public/app.js`が変更されたことを受けての、既存のキャッシュバスティング運用に従う作業)。

- [ ] **Step 1: バージョン文字列を一括更新する**

`public/index.html`内の`?v=20260722a`をすべて`?v=20260722b`に置き換える(`link`タグ1箇所+`script`タグ6箇所、計7箇所):

```bash
sed -i 's/?v=20260722a/?v=20260722b/g' public/index.html
```

- [ ] **Step 2: 置換件数を確認する**

```bash
grep -c "?v=20260722b" public/index.html
```

期待結果: `7`

- [ ] **Step 3: コミット**

```bash
git add public/index.html
git commit -m "車両マスタのFirebase共有機能の追加に伴いアセットのキャッシュバージョンを更新"
```
