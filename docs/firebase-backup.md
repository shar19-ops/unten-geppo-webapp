# Firebaseのバックアップと復元

Firebase Realtime Databaseの全データ(車両マスタ・運転月報)を、**毎日3:00(JST)に自動で書き出して90日分保管**する仕組みです。

## なぜ必要か

このアプリのデータベースは「匿名でも認証していれば誰でも読み書きできる」ルールで動いています。ルール側で**1リクエストでの全消去は塞いでいます**が(`docs/firebase-rules.md`)、1件ずつ消していくことまでは止められません。誤操作・不具合・悪意のいずれでもデータが失われる可能性があるため、復旧の手段として置いています。

Firebaseの自動バックアップ機能は有料プラン(Blaze)専用のため、GitHub Actionsで代替しています。

## 仕組み

```
GitHub Actions(毎日3:00 JST)
  → Firebaseを読む(匿名認証。アプリと同じ公開APIキー)
  → vehicles.json / logs.json / meta.json を書き出す
  → tar.gzにまとめて AES-256 で暗号化
  → Artifactとして保存(90日で自動削除)
```

> ⚠️ **必ず暗号化してから保存しています。** このリポジトリはpublicで、Artifactは誰でもダウンロードできるためです。中身は運転者名・行先・メールアドレスを含む個人情報です。暗号化のパスフレーズはGitHubのSecretsにだけ置き、ワークフローのログにも出しません。

## セットアップ(初回のみ)

### 1. パスフレーズを作る

十分に長いランダムな文字列を作ります。PowerShellなら:

```powershell
-join ((48..57)+(65..90)+(97..122) | Get-Random -Count 48 | ForEach-Object {[char]$_})
```

### 2. 2か所に保存する

| 場所 | 目的 |
|---|---|
| **GitHubのSecrets** | ワークフローが暗号化に使う |
| **パスワード管理ツール(1Password等)** | 復元のときに使う |

> ⚠️ **Secretsに入れた値は、あとから取り出せません。** パスワード管理ツール側に控えを残さないと、バックアップはあっても復元できなくなります。

GitHubへの登録は、リポジトリの **Settings → Secrets and variables → Actions → New repository secret** で:

| 名前 | 値 |
|---|---|
| `BACKUP_PASSPHRASE` | 手順1で作った文字列 |

### 3. 一度手動で動かして確認する

**Actions → Firebaseのバックアップ → Run workflow**。成功すると、そのRunのページ下部に `firebase-backup-YYYYMMDD-HHMM` というArtifactが出ます。

## 復元のしかた

### 1. Artifactをダウンロードして復号する

Actionsから該当日のArtifactをダウンロードし、zipを展開すると `firebase-backup-YYYYMMDD-HHMM.tar.gz.enc` が出ます。Git Bash(またはopensslのある環境)で:

```bash
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 \
  -in firebase-backup-YYYYMMDD-HHMM.tar.gz.enc -out backup.tar.gz
# → パスフレーズを聞かれるので、パスワード管理ツールの値を入力
mkdir backup && tar -xzf backup.tar.gz -C backup
```

`backup/` に `vehicles.json` `logs.json` `meta.json` が出ます。

### 2. まず「何が変わるか」だけ確認する

```bash
node scripts/restore-firebase.mjs backup
```

書き込みは行わず、コレクションごとに「追加される / 上書きされる / 変更なし / 現在あってバックアップに無い」の件数を表示します。

### 3. 実際に戻す

```bash
node scripts/restore-firebase.mjs backup --apply
```

車両だけ、月報だけ戻すこともできます(`--only vehicles` / `--only logs`)。

復元は**部分更新(PATCH)**で行います。バックアップにあるキーはその内容で置き換え、**バックアップに無いキーは消しません**。バックアップ後に追加された記録が残るようにするためと、データベースのルールがコレクション全体の置き換えを禁止しているためです。

## 保管期間について

Artifactの保管はGitHubの上限で**最長90日**です。それより古い時点に戻したい可能性がある場合は、月に一度など任意のタイミングで手動実行したRunのArtifactを**ダウンロードして社内の安全な場所に保管**してください。

## 止めたいとき

`.github/workflows/firebase-backup.yml` の `schedule:` の2行をコメントアウトすれば定期実行だけ止まります(手動実行は残ります)。
