// 前月分の運転月報が未提出の車両管理者へ、提出のお願いメールを送るためのバッチ。
// GitHub Actionsから毎月3日に実行される(提出期限は毎月5日のため、2日前に案内する)。
//
// このスクリプト自体はメールを送らない。「誰に・どんな件名と本文で送るか」を組み立てて
// Power AutomateのWebhookへ1件ずつPOSTし、実際の送信はPower Automate側の
// 「Office 365 Outlook - メールの送信(V2)」に任せる。アプリ本体が静的サイトで
// サーバーを持たないため、月初に自動で動く主体としてGitHub Actionsを使っている。
//
// 実行例:
//   node scripts/submission-reminder.mjs --dry-run   送信せず対象を一覧表示するだけ
//   REMINDER_WEBHOOK_URL=... node scripts/submission-reminder.mjs

// アプリ(public/storage.js)と同じ公開値。Firebaseの設計上どちらも非公開情報ではなく、
// 実際のアクセス制御はデータベース側のルール("auth != null")で行う。
const FIREBASE_DB_URL = 'https://unten-geppo-webapp-default-rtdb.firebaseio.com';
const FIREBASE_API_KEY = 'AIzaSyDoZPZmb14J2Zu3WXgyD6A8eeSy1Nyz0_g';
const APP_URL = 'https://shar19-ops.github.io/unten-geppo-webapp/';

const DRY_RUN = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';
const WEBHOOK_URL = process.env.REMINDER_WEBHOOK_URL || '';
// テスト送信の宛先。指定すると、対象が何台あっても「1通だけ」このアドレスへ送る。
// 本番は実在の車両管理者32名へ一斉に送るため、その前にPower Automate → Outlookの
// 配信経路だけを安全に確かめられるようにしている。
const TEST_TO = (process.env.TEST_TO || '').trim();

// ---------------- 日付(JST固定) ----------------
// 実行環境はUTCのため、toISOString()やgetMonth()をそのまま使うと日本時間と最大9時間ずれる
// (アプリ側で同じ原因の不具合を2026-09-02に修正済み)。ここでは明示的にJSTへ寄せる。
// REMINDER_TODAY=2026-05-03 のように実行日を差し替えられる。5月だけ文面が変わる分岐や
// 年またぎ(1月→前年12月)の確認、送り漏れた過去分の再送に使う。
function nowInJst() {
  const override = process.env.REMINDER_TODAY;
  if (override) {
    const [y, m, d] = override.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d, 8, 0, 0));
  }
  return new Date(Date.now() + 9 * 60 * 60 * 1000);
}

function previousMonthOf(jstDate) {
  const y = jstDate.getUTCFullYear();
  const m = jstDate.getUTCMonth() + 1; // 1-12
  return m === 1 ? { year: y - 1, month: 12 } : { year: y, month: m - 1 };
}

// ---------------- Firebase(匿名認証つき読み取り) ----------------
async function signInAnonymously() {
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FIREBASE_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ returnSecureToken: true })
  });
  if (!res.ok) throw new Error(`Firebase匿名サインインに失敗しました: ${res.status}`);
  const data = await res.json();
  return data.idToken;
}

async function readJson(idToken, path) {
  const res = await fetch(`${FIREBASE_DB_URL}${path}?auth=${encodeURIComponent(idToken)}`);
  if (!res.ok) throw new Error(`Firebase読み取りに失敗しました(${path}): ${res.status}`);
  return res.json();
}

// ---------------- メール文面 ----------------
// 差戻しメールと同じ調子に揃える。期限の書き方だけ、送信月が5月のときは
// 3日〜5日が祝日で「5日までに」が成り立たないため「速やかに」に切り替える。
function deadlinePhrase(sendMonth) {
  return sendMonth === 5 ? '速やかに' : `${sendMonth}月5日までに`;
}

function buildMessage(vehicle, report, sendMonth) {
  const reportUrl = `${APP_URL}?reportVehicle=${encodeURIComponent(vehicle.id)}&reportYear=${report.year}&reportMonth=${report.month}`;
  const label = `${vehicle.plateNumber}${vehicle.nickname ? `(${vehicle.nickname})` : ''}`;
  const subject = `【運転管理月報】${report.year}年${report.month}月分の提出のお願い(${vehicle.plateNumber})`;
  const body = [
    'いつも運転記録の入力にご協力いただきありがとうございます。',
    `${label}の${report.year}年${report.month}月分の運転月報が未提出です。`,
    `${deadlinePhrase(sendMonth)}内容をご確認のうえ、提出をお願いいたします。`,
    '安全品質保証部',
    '',
    '対象の運転月報:',
    reportUrl
  ].join('\n');

  return {
    to: vehicle.managerEmail,
    subject,
    body,
    vehicleId: vehicle.id,
    plateNumber: vehicle.plateNumber,
    vehicleManager: vehicle.vehicleManager || '',
    reportYear: report.year,
    reportMonth: report.month,
    reportUrl
  };
}

// ---------------- 本体 ----------------
async function main() {
  const jstNow = nowInJst();
  const sendMonth = jstNow.getUTCMonth() + 1;
  const report = previousMonthOf(jstNow);
  console.log(`実行日(JST): ${jstNow.toISOString().slice(0, 10)} / 対象: ${report.year}年${report.month}月分`);

  const idToken = await signInAnonymously();
  const [vehiclesRaw, logsRaw] = await Promise.all([
    readJson(idToken, '/vehicles.json'),
    readJson(idToken, '/logs.json')
  ]);

  const vehicles = Object.entries(vehiclesRaw || {}).map(([id, v]) => ({ ...v, id }));
  const logs = logsRaw || {};

  // 提出済みの判定は運転月報画面と同じ: metaのissuerConfirmedAtが入っていれば提出済み。
  const isSubmitted = (vehicleId) => {
    const meta = (logs[`${vehicleId}_${report.year}_${report.month}`] || {}).meta || {};
    return !!meta.issuerConfirmedAt;
  };

  // 停止中の車両は対象外(使用していないため月報の提出義務も無い)。
  const active = vehicles.filter((v) => v.active !== false);
  const unsubmitted = active.filter((v) => !isSubmitted(v.id));
  const targets = unsubmitted.filter((v) => v.managerEmail);
  const noEmail = unsubmitted.filter((v) => !v.managerEmail);

  console.log(`車両 ${vehicles.length}台 / 使用中 ${active.length}台 / 未提出 ${unsubmitted.length}台 / 送信対象 ${targets.length}件`);
  if (noEmail.length) {
    console.log(`::warning::メールアドレス未登録のため送信できない車両が${noEmail.length}台あります: ${noEmail.map((v) => v.plateNumber).join(', ')}`);
  }
  if (!targets.length) {
    console.log('送信対象がありません。処理を終了します。');
    return;
  }

  let messages = targets.map((v) => buildMessage(v, report, sendMonth));

  if (TEST_TO) {
    messages = messages.slice(0, 1).map((m) => ({ ...m, to: TEST_TO, subject: `【テスト送信】${m.subject}` }));
    console.log(`テスト送信モード: ${TEST_TO} 宛に1通だけ送ります(本来の宛先には送りません)`);
  }

  if (DRY_RUN) {
    console.log('\n--- DRY RUN(送信しません) ---');
    messages.forEach((m) => {
      console.log(`\n宛先: ${m.to}  [${m.plateNumber} / ${m.vehicleManager}]`);
      console.log(`件名: ${m.subject}`);
      console.log(m.body.split('\n').map((line) => `  | ${line}`).join('\n'));
    });
    return;
  }

  if (!WEBHOOK_URL) {
    console.log('::warning::REMINDER_WEBHOOK_URL が未設定のため送信をスキップしました。'
      + 'Power Automateでフローを作成し、そのURLをリポジトリのSecretsに REMINDER_WEBHOOK_URL として登録してください'
      + '(手順: docs/submission-reminder-setup.md)。');
    return;
  }

  let sent = 0;
  const failed = [];
  for (const m of messages) {
    try {
      const res = await fetch(WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(m)
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      sent += 1;
    } catch (err) {
      failed.push(`${m.plateNumber}(${m.to}): ${err.message}`);
    }
    // Power Automate側の同時実行を抑えるため、1件ずつ間隔をあけて送る
    await new Promise((r) => setTimeout(r, 300));
  }

  console.log(`送信依頼: 成功 ${sent}件 / 失敗 ${failed.length}件`);
  if (failed.length) {
    failed.forEach((f) => console.log(`::error::送信に失敗しました - ${f}`));
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.log(`::error::${err.message}`);
  process.exitCode = 1;
});
