# 運転月報 印刷時のページ番号フッター Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 運転月報の「印刷／PDF」出力時のみ、各ページ(常に2ページ構成)の末尾に「1 / 2」「2 / 2」というページ番号を表示する。

**Architecture:** 運転月報は常に2ページ構成に固定されているため、`report.js`の各ページ末尾に固定文字列のページ番号要素を追加し、`style.css`で画面表示時は非表示・印刷時のみ表示するようにする。動的なページ数計算は行わない。

**Tech Stack:** 素のHTML/CSS(`@media print`)。JavaScriptの新規ロジックは無い。

## Global Constraints

- 対象は「印刷／PDF」出力のみ。「Excelとして出力」「JSONへ出力」は変更しない。
- ページ番号は画面上のプレビュー表示時には表示せず、印刷・PDF出力時にのみ表示する。
- 運転月報は常に2ページ構成(1ページ目: 1〜15日の表+15日点検、2ページ目: 16〜31日の表+合計+末日点検)であり、ページ数は可変にならない。動的なページ数計算(CSSカウンター等)は行わず、「1 / 2」「2 / 2」という固定文字列を直接記述する。
- 全てのコマンドは `C:\Users\shar1\unten-geppo-webapp\.claude\worktrees\qr-vehicle-select` (ブランチ `worktree-qr-vehicle-select`) で実行すること。コミット操作を含む全コマンドの直前・直後に `git rev-parse --show-toplevel` と `git branch --show-current` で確認する。

---

### Task 1: report.js・style.css — 印刷時のページ番号表示

**Files:**
- Modify: `public/report.js:143-157`(`renderReportView`内、1ページ目末尾・2ページ目末尾)
- Modify: `public/style.css:273-285`(印刷用スタイルのセクション)

**Interfaces:**
- Consumes: なし(既存のHTML構造・CSSクラスのみ)
- Produces: `.print-page-number`というCSSクラス(このタスク内でのみ使用。他のタスクからは参照されない)

- [ ] **Step 1: `public/report.js`の1ページ目末尾・2ページ目末尾にページ番号要素を追加する**

現在の内容(`public/report.js:143-157`):
```javascript
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
```

置き換え後(1ページ目末尾に`<p class="print-page-number">1 / 2</p>`、2ページ目末尾に`<p class="print-page-number">2 / 2</p>`を追加する):
```javascript
      ${reportBlock(record.days, 1, 15, record.year, record.month, holidays)}
      ${checklistBlock('点検日15日', record.checklistMid)}
      <p class="print-page-number">1 / 2</p>
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
        <p class="print-page-number">2 / 2</p>
      </div>
    </div>
  `;
```

- [ ] **Step 2: `public/style.css`にページ番号のスタイルを追加する**

現在の内容(`public/style.css:273-285`、印刷用スタイルのセクション):
```css
/* --- 印刷(A4・サンプルExcelの余白に合わせる) --- */
@page { size: A4 portrait; margin: 19mm 8mm 19mm 13mm; }
@media print {
  .no-print { display: none !important; }
  body { background: #fff; }
  main { padding: 0; max-width: none; }
  .view { display: none; }
  .view.active { display: block; }
  .report-sheet { border: none; padding: 0; }
  .report-table { font-size: 9.5pt; }
  .report-header { font-size: 9.5pt; }
  .report-page2 { break-before: page; page-break-before: always; }
}
```

置き換え後(`.print-page-number`を、通常時は非表示、印刷時のみ表示するスタイルとして追加する):
```css
/* --- 印刷(A4・サンプルExcelの余白に合わせる) --- */
@page { size: A4 portrait; margin: 19mm 8mm 19mm 13mm; }
.print-page-number { display: none; }
@media print {
  .no-print { display: none !important; }
  body { background: #fff; }
  main { padding: 0; max-width: none; }
  .view { display: none; }
  .view.active { display: block; }
  .report-sheet { border: none; padding: 0; }
  .report-table { font-size: 9.5pt; }
  .report-header { font-size: 9.5pt; }
  .report-page2 { break-before: page; page-break-before: always; }
  .print-page-number { display: block; text-align: center; font-size: 0.8rem; margin-top: 0.5rem; }
}
```

- [ ] **Step 3: 構文チェックと追加箇所の確認**

Run: `node --check public/report.js`
Expected: 何も出力されず、終了コード0

Run: `grep -n "print-page-number" public/report.js`
Expected: 2行(`1 / 2`を含む行と`2 / 2`を含む行)がヒットする

Run: `grep -n "print-page-number" public/style.css`
Expected: 3行(`.print-page-number { display: none; }`の行、`@media print`内の`display: block`の行、コメント等は無いのでこの2つ+念のため周辺一致含め概ね2〜3件)がヒットする

- [ ] **Step 4: ブラウザでの動作確認は行わない**

このタスクはヘッドレス環境で実装するため、実ブラウザでの確認は行わない。Step 3で十分。コントローラーが後でPlaywrightの印刷メディアエミュレーション(`page.emulate_media`相当)を使い、(a)通常の画面表示ではページ番号が表示されないこと、(b)印刷メディア適用時は1ページ目末尾に「1 / 2」・2ページ目末尾に「2 / 2」が表示されること、(c)既存の運転月報のレイアウト(表・点検表・合計行)が崩れていないこと、を確認する。

- [ ] **Step 5: コミット**

```bash
git rev-parse --show-toplevel && git branch --show-current
git add public/report.js public/style.css
git commit -m "運転月報の印刷時に各ページの末尾へページ番号を表示する"
git rev-parse --show-toplevel && git branch --show-current
```

---

### Task 2: キャッシュバージョンの更新(20260722h → 20260722i)

**Files:**
- Modify: `public/index.html`(全ての`?v=20260722h`を`?v=20260722i`に置換)

**Interfaces:**
- Consumes: なし
- Produces: なし(最終タスク)

- [ ] **Step 1: 現在のバージョン文字列の出現数を確認する**

Run: `grep -c 'v=20260722h' public/index.html`
Expected: `9`

- [ ] **Step 2: バージョン文字列を一括置換する**

Run: `sed -i 's/?v=20260722h/?v=20260722i/g' public/index.html`

- [ ] **Step 3: 置換後の出現数を確認する**

Run: `grep -c 'v=20260722i' public/index.html`
Expected: `9`

Run: `grep -c 'v=20260722h' public/index.html`
Expected: `0`(または該当なしでエラー終了。どちらでも「残っていない」ことが確認できればよい)

- [ ] **Step 4: コミット**

```bash
git rev-parse --show-toplevel && git branch --show-current
git add public/index.html
git commit -m "アセットのキャッシュバージョンを20260722iに更新する"
git rev-parse --show-toplevel && git branch --show-current
```
