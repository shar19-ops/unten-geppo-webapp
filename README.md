# 運転管理月報 Webアプリ

社有車・私有車の運転記録(出庫時メーター、行先、アルコールチェック、運転者、給油量)を主にiPhoneでその場で記録し、PCで月報として確認・印刷・Excel出力するための社内向けアプリ。

genka-webapp(原価計算書アプリ)と同じ方針で、フレームワークなしの素のHTML/CSS/JSで作られており、ビルド不要。

## セットアップ

```
npm install
npm start
```

`http://localhost:5174` で起動する。`public/` 配下は素のファイルなので、Node不要でも `public/index.html` を直接ブラウザで開けば動作する(fetch等を使っていないため)。

## デプロイ

`main` ブランチへのpushで `.github/workflows/pages.yml` が `public/` をGitHub Pagesへ自動デプロイする。

## ディレクトリ構成

```
server.js         Express静的サーバー(ローカル起動用)
public/
  index.html       画面シェル(タブで3画面を切り替え)
  style.css        画面表示 + 印刷(A4)スタイル
  storage.js       データアクセス層(localStorage CRUD・JSON export/import・マージ)
  vehicles.js      社有車リスト管理画面
  trip-entry.js    運転記録入力画面(iPhone優先)
  report.js        運転月報画面(表示・印刷・Excel出力)
  xlsx-export.js   サンプル雛形へのExcel書き出し
  app.js           起動処理・画面ルーティング・共通ヘルパー(距離計算・祝日判定)
  assets/          サンプルExcelをテンプレート資産として同梱
  vendor/          ExcelJS・SheetJSを物理配置(GitHub Pagesでも動くようnpm依存にしない)
```

## データの持ち方(現状の設計方針)

現時点ではDBサーバーを持たないため、すべてのデータはブラウザの **localStorage** に保存する。複数端末(複数のiPhone)で入力した内容は、JSONファイルのエクスポート/インポートで手動統合する(genka-webappと同じ運用パターン)。全画面は `storage.js` の関数経由でのみデータに触れる設計にしているため、将来クラウドDB(Firebase / Microsoft Graph APIなど、社内確認後に選定予定)へ移行する際は `storage.js` の中身を差し替えるだけでよい想定。

## 現在の実装状況

- 社有車リスト管理(CRUD・Excel/JSON取込出力・競合解決画面)、運転記録入力(iPhone優先)、運転月報(表示・印刷・Excel出力・JSON取込出力)は実データ(localStorage)で一通り動作する。
- Excel出力はExcelJSでサンプル雛形を読み込み、データセルの値のみを書き換える方式。結合セル・数式・フォント・帳票管理番号のフッターはすべて温存される(往復検証済み、DEVLOG.md参照)。
- PWA化(オフラインキャッシュ・ホーム画面追加)は開発中のキャッシュ事故を避けるため一時的に無効化中(`sw.js`参照)。開発が一段落したら再度実装する。

## 既知の制限

- 1日1車両=1レコード(サンプルExcelの1日1行に合わせた仕様)。同日に別の人が同じ車を使った場合はその日のレコードを上書きする運用。
- 社有車リストの元となるExcelファイルは社内に存在しないため、アプリ内で新規作成する運用。
- 部店所名は運転月報画面で手入力(社有車マスタには持たせていない)。
