# アプリアイコンの設定 設計書

## 背景・目的

現在、PWAマニフェスト(`public/manifest.json`)のアイコンは仮のプレースホルダー画像のままで、ブラウザタブのファビコンも未設定(`favicon.ico`への404エラーが発生している)。ユーザーが用意した「運転月報/YUDENSHA」ロゴ画像を、ブラウザタブ・PWAマニフェスト・iOSホーム画面追加のすべてでアプリアイコンとして使用できるようにする。

## 元画像

`C:\Users\shar1\OneDrive\MCフォルダ\運転管理月報\運転月報.png`(392×392px、RGBA)。

## 生成するファイル

`public/icons/`配下に、元画像から以下を生成し、既存の仮アイコンを置き換える:

- `icon-192.png`(192×192、PWAマニフェスト用)
- `icon-512.png`(512×512、PWAマニフェスト用。元画像より大きいためアップスケールになるが、単色・単純な図柄のため実用上問題ない)
- `apple-touch-icon.png`(180×180、iOSホーム画面追加用の標準サイズ)

画像のリサイズには、追加のライブラリ・npm依存を導入せず、Windows標準の.NET(`System.Drawing`)をPowerShell経由で使用する(このプロジェクトの「ビルド不要・依存追加を避ける」方針に合わせる)。

## HTML・マニフェストの変更

`public/index.html`の`<head>`に以下を追加する:

- `<link rel="icon" type="image/png" sizes="192x192" href="icons/icon-192.png?v=...">`(ブラウザタブのファビコン。現在の404エラーが解消される)
- `<link rel="apple-touch-icon" href="icons/apple-touch-icon.png?v=...">`(iOSホーム画面追加用)

`public/manifest.json`の`icons`配列(参照するファイル名`icons/icon-192.png`・`icons/icon-512.png`)自体は変更しない。中身の画像ファイルだけを新しいロゴに差し替える。

## キャッシュバスティング

既存の`?v=`の慣例に従い、新規追加する2つの`<link>`タグにも`?v=`を付与し、`public/index.html`内の全`?v=`を最後にまとめて更新する。

## スコープ外

- Android向けのmaskableアイコン対応は行わない(現状のシンプルな用途では不要と判断)。
- 既存のPWAとしてインストール済みの端末で、アイコンがいつ反映されるか(OS側のキャッシュ・更新タイミング)の制御は行わない。
