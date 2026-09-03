# 運転月報の提出リマインドメール — 設定手順

前月分の運転月報が未提出の車両管理者へ、**毎月3日の朝8時に自動でメールを送る**仕組みです。提出期限が毎月5日のため、2日前に案内します。

## 仕組み

```
GitHub Actions(毎月3日 8:00 JST)
  → Firebaseを読む(匿名認証。既存の公開APIキーを使用)
  → 前月分の issuerConfirmedAt が空 = 未提出の車両を抽出
  → 車両管理者のメールアドレスを付けて、1台につき1回 Webhook へ POST
Power Automate(HTTPトリガー)
  → Office 365 Outlook「メールの送信(V2)」
車両管理者へメール
```

アプリ本体は GitHub Pages 上の静的サイトでサーバーを持たないため、「月初に誰も開いていなくても動く主体」として GitHub Actions を使っています。メールの送信そのものは Power Automate 側で行います。

**追加費用はかかりません。** GitHub Actions は public リポジトリなら無料、Power Automate の HTTP トリガーと Outlook 送信は標準コネクタです。

## 送られるメールの内容

- 件名: `【運転管理月報】2026年8月分の提出のお願い(湘南531ふ4173)`
- 本文:

  ```
  いつも運転記録の入力にご協力いただきありがとうございます。
  湘南531ふ4173(ハイエース)の2026年8月分の運転月報が未提出です。
  9月5日までに内容をご確認のうえ、提出をお願いいたします。
  安全品質保証部

  対象の運転月報:
  https://shar19-ops.github.io/unten-geppo-webapp/?reportVehicle=...&reportYear=2026&reportMonth=8
  ```

**5月に送る分だけ「速やかに」**という書き方に切り替わります。5月3日〜5日は祝日で「5日までに」が成り立たないためです。

## セットアップ

### 1. Power Automate でフローを作る

1. Power Automate で「**インスタント クラウド フロー**」を新規作成し、トリガーに「**HTTP 要求の受信時**」を選ぶ
2. 「要求本文の JSON スキーマ」に次を貼り付ける

   ```json
   {
     "type": "object",
     "properties": {
       "to": { "type": "string" },
       "subject": { "type": "string" },
       "body": { "type": "string" },
       "vehicleId": { "type": "string" },
       "plateNumber": { "type": "string" },
       "vehicleManager": { "type": "string" },
       "reportYear": { "type": "integer" },
       "reportMonth": { "type": "integer" },
       "reportUrl": { "type": "string" }
     }
   }
   ```

3. アクションに「**Office 365 Outlook — メールの送信(V2)**」を追加し、次のように割り当てる

   | 項目 | 値 |
   |---|---|
   | 宛先 | `to` |
   | 件名 | `subject` |
   | 本文 | `body` |

   本文はプレーンテキストです。改行をそのまま出したい場合は、本文欄の詳細オプションで「HTML でない」を選ぶか、`body` の改行を `<br>` に置き換えてください。

4. 保存すると、トリガーに **HTTP POST の URL** が表示されるのでコピーする

### 2. GitHub にシークレットとして登録する

リポジトリの **Settings → Secrets and variables → Actions → New repository secret** で登録します。

| 名前 | 値 |
|---|---|
| `REMINDER_WEBHOOK_URL` | 手順1でコピーしたURL |

> **既存の `TEAMS_WEBHOOK_URL`(`public/storage.js` に直接書かれているもの)は使わないでください。**
> あちらはソースコードに書かれていて第三者から見える状態です。Teams への通知だけなら影響は限定的でしたが、メール送信に使うと「社員宛に偽のメールを送れる」ことになり、リスクの質が変わります。リマインド用には**別のフローを新規に作り**、その URL はコードに書かず Secrets にだけ置いてください。

### 3. 動作を確認する

シークレットを登録する前でも、**送信せずに対象だけ確認**できます。

- GitHub の **Actions → 運転月報の提出リマインド → Run workflow** を開く
- `送信せず対象の一覧だけ確認する` を **true** のまま実行する
- ログに、宛先・件名・本文がそのまま表示される

問題なければ、同じ手順で **false** にして実行すると実際に送信されます。

## 動作の細かい仕様

- **対象**: 「使用中」の車両のみ。停止中の車両は月報の提出義務が無いため対象外です
- **未提出の判定**: 運転月報画面と同じく、`meta.issuerConfirmedAt`(発行者=車両管理者の提出)が空かどうかで判定します。安全運転管理者の承認待ちのものは「提出済み」として送りません
- **メールアドレス未登録の車両**: 送信できないため、Actions のログに警告として車両番号が出ます
- **運転記録が1件も無い月**: 現在の実装では「未提出」として送ります。使っていない月でも月報の提出は必要という前提です。不要であれば除外できます
- **失敗時**: 1件でも送信に失敗すると Actions が失敗として記録され、ログに車両番号が出ます

## 送信をやめたいとき

`.github/workflows/submission-reminder.yml` の `schedule:` の2行をコメントアウトすれば、定期実行だけ止まります(手動実行は残ります)。
