# 運転月報 印刷時の押印欄 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 運転月報の「印刷／PDF」出力時、最終ページの末日点検表の下・ページ番号の手前に、「安全運転管理者」「副安全運転管理者」「発行者」の3列の押印欄を表示する。

**Architecture:** 既存の`.report-table`クラスを流用した3列のテーブルを`report.js`に追加し、`style.css`で画面表示時は非表示・印刷時のみ表示するようにする。既存のページ番号(`.print-page-number`)と全く同じ「印刷専用表示」の仕組みを踏襲する。

**Tech Stack:** 素のHTML/CSS(`@media print`)。JavaScriptの新規ロジックは無い。

## Global Constraints

- 対象は「印刷／PDF」出力のみ。「Excelとして出力」「JSONへ出力」は変更しない。
- 押印欄は画面上のプレビュー表示時には表示せず、印刷・PDF出力時にのみ表示する。
- 配置順序は「末日点検表 → 押印欄 → ページ番号(2 / 2)」。既存のページ番号要素(`<p class="print-page-number">2 / 2</p>`)より手前に押印欄を挿入する。
- 押印欄は見出し3つ(安全運転管理者・副安全運転管理者・発行者)+ 押印用の空白行1行の構成。氏名の印字(データ入力・保存)は行わない。
- 押印用の空白セルの高さは`height: 3rem`程度を確保する。
- 全てのコマンドは `C:\Users\shar1\unten-geppo-webapp\.claude\worktrees\qr-vehicle-select` (ブランチ `worktree-qr-vehicle-select`) で実行すること。コミット操作を含む全コマンドの直前・直後に `git rev-parse --show-toplevel` と `git branch --show-current` で確認する。

---

### Task 1: report.js・style.css — 印刷時の押印欄表示

**Files:**
- Modify: `public/report.js:157-158`(`renderReportView`内、末日点検表の直後・ページ番号「2 / 2」の直前)
- Modify: `public/style.css`(印刷用スタイルのセクション、`.print-page-number`の定義箇所付近)

**Interfaces:**
- Consumes: なし(既存のHTML構造・CSSクラスのみ)
- Produces: `.print-stamp-table`というCSSクラス(このタスク内でのみ使用。他のタスクからは参照されない)

- [ ] **Step 1: `public/report.js`に押印欄のテーブルを追加する**

現在の内容(`public/report.js:157-158`):
```javascript
        ${checklistBlock('点検日は月の末日', record.checklistEnd)}
        <p class="print-page-number">2 / 2</p>
```

置き換え後(末日点検表の直後、ページ番号の直前に押印欄のテーブルを挿入する):
```javascript
        ${checklistBlock('点検日は月の末日', record.checklistEnd)}
        <table class="report-table print-stamp-table">
          <tr>
            <th>安全運転管理者</th>
            <th>副安全運転管理者</th>
            <th>発行者</th>
          </tr>
          <tr>
            <td></td>
            <td></td>
            <td></td>
          </tr>
        </table>
        <p class="print-page-number">2 / 2</p>
```

- [ ] **Step 2: `public/style.css`に押印欄のスタイルを追加する**

現在の内容(`public/style.css`、`.print-page-number`の定義箇所):
```css
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

置き換え後(`.print-stamp-table`を、通常時は非表示・印刷時のみ`display: table`で表示するスタイルとして追加し、押印用セルの高さも指定する):
```css
.print-page-number { display: none; }
.print-stamp-table { display: none; }
.print-stamp-table td { height: 3rem; }
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
  .print-stamp-table { display: table; }
}
```

- [ ] **Step 3: 構文チェックと追加箇所の確認**

Run: `node --check public/report.js`
Expected: 何も出力されず、終了コード0

Run: `grep -n "print-stamp-table" public/report.js`
Expected: 1行(`<table class="report-table print-stamp-table">`を含む行)がヒットする

Run: `grep -n "print-stamp-table" public/style.css`
Expected: 3行(`.print-stamp-table { display: none; }`、`.print-stamp-table td { height: 3rem; }`、`@media print`内の`display: table;`の行)がヒットする

Run: `grep -n "安全運転管理者\|副安全運転管理者\|発行者" public/report.js`
Expected: 3行(それぞれの見出しを含む行)がヒットする

- [ ] **Step 4: ブラウザでの動作確認は行わない**

このタスクはヘッドレス環境で実装するため、実ブラウザでの確認は行わない。Step 3で十分。コントローラーが後でPlaywrightの印刷メディアエミュレーション(`page.emulateMedia({media:'print'})`)を使い、(a)通常の画面表示では押印欄が表示されないこと、(b)印刷メディア適用時は末日点検表の下・ページ番号「2 / 2」の上に、安全運転管理者・副安全運転管理者・発行者の3列の押印欄が表示されること、(c)既存のレイアウト(点検表・ページ番号)が崩れていないことを確認する。

- [ ] **Step 5: コミット**

```bash
git rev-parse --show-toplevel && git branch --show-current
git add public/report.js public/style.css
git commit -m "運転月報の印刷時に最終ページへ押印欄を表示する"
git rev-parse --show-toplevel && git branch --show-current
```

---

### Task 2: キャッシュバージョンの更新(20260722i → 20260722j)

**Files:**
- Modify: `public/index.html`(全ての`?v=20260722i`を`?v=20260722j`に置換)

**Interfaces:**
- Consumes: なし
- Produces: なし(最終タスク)

- [ ] **Step 1: 現在のバージョン文字列の出現数を確認する**

Run: `grep -c 'v=20260722i' public/index.html`
Expected: `9`

- [ ] **Step 2: バージョン文字列を一括置換する**

Run: `sed -i 's/?v=20260722i/?v=20260722j/g' public/index.html`

- [ ] **Step 3: 置換後の出現数を確認する**

Run: `grep -c 'v=20260722j' public/index.html`
Expected: `9`

Run: `grep -c 'v=20260722i' public/index.html`
Expected: `0`(または該当なしでエラー終了。どちらでも「残っていない」ことが確認できればよい)

- [ ] **Step 4: コミット**

```bash
git rev-parse --show-toplevel && git branch --show-current
git add public/index.html
git commit -m "アセットのキャッシュバージョンを20260722jに更新する"
git rev-parse --show-toplevel && git branch --show-current
```
