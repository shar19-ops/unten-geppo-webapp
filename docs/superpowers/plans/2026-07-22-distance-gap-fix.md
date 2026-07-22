# 走行距離計算のギャップ対応 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 運転月報の走行距離が、翌日の出庫時メーター指針が未入力(休日等)だと空欄になってしまう不具合を修正する。

**Architecture:** `public/app.js`の`computeDistance(days, day)`関数を、「翌日固定」から「その日以降で最初にメーター指針が記録されている日(月末=31日まで)を探して差分を取る」方式に変更する。

**Tech Stack:** 既存のvanilla JS構成をそのまま維持する。

## Global Constraints

- 対象spec: `docs/superpowers/specs/2026-07-22-distance-gap-fix-design.md`
- 月をまたいだ探索は行わない(月報レコードは月ごとに独立したデータのため、31日までで探索を打ち切る)。
- `computeTotals`(合計走行距離の計算ロジック自体)は変更しない。
- 対象は画面表示・印刷のみ。Excel出力(`xlsx-export.js`・テンプレートの数式)は今回のスコープ外。
- 何かCSS/JSファイルを変更したら、最後のタスクで`public/index.html`内の全`?v=`を新しいバージョン文字列に一括更新する(既存の家訓)。現在のバージョンは`20260722e`。

---

### Task 1: computeDistanceのギャップ対応

**Files:**
- Modify: `public/app.js:33-45`(`computeDistance`関数とその直前のコメント)

**Interfaces:**
- 変更なし: `computeDistance(days, day)`の呼び出し方(`public/report.js:279`の`computeDistance(days, d)`、`public/app.js:123`の`computeDistance(days, d)`)。戻り値は引き続き数値または空文字列`''`。

- [ ] **Step 1: `computeDistance`をギャップ対応に書き換える**

`public/app.js`の33〜45行目、以下のコメント+関数全体を:

```js
// サンプルExcelのG列数式ロジックを再現する共通関数
// distance(day n) = meter(day n+1) - meter(day n) (n=1..14, 16..30)
// distance(day 15) = meter(day 16) - meter(day 15) (点検欄行をまたいでブロック2に接続)
// distance(day 31) = 空欄(day32が存在しないため)
function computeDistance(days, day) {
  const cur = days[day];
  if (!cur || cur.meterReading == null) return '';
  const nextDay = day === 31 ? null : day + 1;
  if (nextDay === null) return '';
  const next = days[nextDay];
  if (!next || next.meterReading == null) return '';
  return next.meterReading - cur.meterReading;
}
```

以下に置き換える:

```js
// サンプルExcelのG列数式ロジックを再現する共通関数。
// distance(day n) = meter(次にメーター指針が記録されている日) - meter(day n)
// 休日等で翌日以降のメーター指針が未入力の場合は、月末(31日)までの間で
// 次に記録されている日まで遡って差分を取る(間の空欄日はスキップする)。
// 記録されている日が月末までに無い場合、または対象日自体が未入力の場合は空欄。
function computeDistance(days, day) {
  const cur = days[day];
  if (!cur || cur.meterReading == null) return '';
  for (let d = day + 1; d <= 31; d++) {
    const next = days[d];
    if (next && next.meterReading != null) {
      return next.meterReading - cur.meterReading;
    }
  }
  return '';
}
```

- [ ] **Step 2: 動作確認(ブラウザ)**

`npm start`でローカルサーバーを起動し、ブラウザの開発者ツールコンソールで以下を実行してロジックを直接検証する:

```js
const days = {
  10: { meterReading: 1000 },
  11: {},
  12: { meterReading: 1050 },
  13: { meterReading: 1080 }
};
console.log(computeDistance(days, 10)); // 期待値: 50 (12日の1050 - 10日の1000、11日を飛び越える)
console.log(computeDistance(days, 11)); // 期待値: '' (11日自体にメーター指針が無い)
console.log(computeDistance(days, 12)); // 期待値: 30 (13日の1080 - 12日の1050)
console.log(computeDistance(days, 13)); // 期待値: '' (14日以降にデータが無い)
console.log(computeDistance(days, 9));  // 期待値: '' (9日自体が未定義)
```

続けて、実際の運転月報画面で以下を確認する:

1. 「運転記録入力」から、当月のある車両に対して、ある日(例: 10日)にメーター指針を入力して保存する。
2. 翌日(11日)は何も入力しない。
3. 翌々日(12日)に別のメーター指針を入力して保存する。
4. 「運転月報」タブを開き、10日の行の「走行距離」列に、12日のメーター指針との差分が正しく表示されること(空欄のままにならないこと)を確認する。11日の行は走行距離が空欄のままであることを確認する。
5. 月報下部の「走行距離合計」が、10日の行に表示された値を含めて正しく合計されていることを確認する。

- [ ] **Step 3: コミット**

```bash
git add public/app.js
git commit -m "運転月報の走行距離計算が休日等のギャップを飛び越えて計算できるようにする"
```

---

### Task 2: キャッシュバージョンの更新

**Files:**
- Modify: `public/index.html`

**Interfaces:**
- Consumes: なし(Task 1で`public/app.js`が変更されたことを受けての、既存のキャッシュバスティング運用に従う作業)。

- [ ] **Step 1: バージョン文字列を一括更新する**

`public/index.html`内の`?v=20260722e`をすべて`?v=20260722f`に置き換える(全9箇所):

```bash
sed -i 's/?v=20260722e/?v=20260722f/g' public/index.html
```

- [ ] **Step 2: 置換件数を確認する**

```bash
grep -c "?v=20260722f" public/index.html
```

期待結果: `9`

- [ ] **Step 3: コミット**

```bash
git add public/index.html
git commit -m "走行距離計算のギャップ対応に伴いアセットのキャッシュバージョンを更新"
```
