// Firebase Realtime Databaseの全データを、そのままの形でファイルに書き出す。
// GitHub Actionsから毎日実行され、暗号化したうえでArtifactとして保存される
// (.github/workflows/firebase-backup.yml)。
//
// データベースのルールは「匿名でも認証していれば誰でも読み書きできる」であり、誤操作や
// 悪意で全データが消される可能性がある。ルール側で1リクエストでの全消去は塞いでいるが
// (firebase/database.rules.json)、1件ずつ消していくことまでは止められないため、
// 復旧の手段としてこのバックアップを置いている。
//
// 実行例:
//   node scripts/backup-firebase.mjs backup     ./backup/ に vehicles.json, logs.json, meta.json を書く

import fs from 'node:fs';
import path from 'node:path';
import { signInAnonymously, readJson } from './firebase-rest.mjs';

const outDir = process.argv[2] || 'backup';

// ルート(/.json)を一括で読まず、コレクションごとに読む。ルールでルート直下の読み取りは
// 禁止しているため(全体を1リクエストで持ち出せないようにするため)。
const COLLECTIONS = ['vehicles', 'logs'];

async function main() {
  const idToken = await signInAnonymously();
  fs.mkdirSync(outDir, { recursive: true });

  const counts = {};
  for (const name of COLLECTIONS) {
    const data = await readJson(idToken, `/${name}.json`);
    const count = Object.keys(data || {}).length;
    counts[name] = count;
    fs.writeFileSync(path.join(outDir, `${name}.json`), JSON.stringify(data || {}, null, 2), 'utf8');
    // 中身は個人情報を含むためログに出さない。件数だけ表示する
    console.log(`${name}: ${count}件`);
  }

  fs.writeFileSync(path.join(outDir, 'meta.json'), JSON.stringify({
    exportedAt: new Date().toISOString(),
    source: 'unten-geppo-webapp-default-rtdb',
    counts
  }, null, 2), 'utf8');

  if (!counts.vehicles) {
    // 車両が0件なら、消された後を取ってしまった可能性が高い。失敗扱いにして気づけるようにする
    console.log('::error::車両が0件です。データが消えた後のバックアップの可能性があります');
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.log(`::error::${err.message}`);
  process.exitCode = 1;
});
