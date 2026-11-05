// バックアップ(scripts/backup-firebase.mjs の出力)からFirebaseへデータを戻す。
//
// 既定では何も書かず、「戻すと何がどう変わるか」を表示するだけ(dry run)。実際に書くには
// --apply を付ける。書き込みは PATCH(部分更新)で行うため、バックアップに無いキーは
// 消さず、バックアップにあるキーだけをその内容で置き換える。
// これは、データベースのルールがコレクション全体の置き換え(PUT /vehicles.json)を禁止して
// いることにも合わせている。PATCHは1キーずつ別々の書き込みとして評価されるので通る。
//
// 実行例:
//   node scripts/restore-firebase.mjs backup                  変更内容の確認だけ
//   node scripts/restore-firebase.mjs backup --apply          実際に戻す
//   node scripts/restore-firebase.mjs backup --only vehicles  車両だけ

import fs from 'node:fs';
import path from 'node:path';
import { signInAnonymously, readJson, writeRaw } from './firebase-rest.mjs';

const args = process.argv.slice(2);
const backupDir = args.find((a) => !a.startsWith('--'));
const APPLY = args.includes('--apply');
const onlyIdx = args.indexOf('--only');
const ONLY = onlyIdx >= 0 ? args[onlyIdx + 1] : null;

if (!backupDir) {
  console.log('使い方: node scripts/restore-firebase.mjs <バックアップのディレクトリ> [--apply] [--only vehicles|logs]');
  process.exit(1);
}

const COLLECTIONS = ['vehicles', 'logs'].filter((c) => !ONLY || c === ONLY);
// 1回のPATCHに載せるキー数。多すぎると1リクエストが大きくなりすぎるため分ける
const BATCH = 50;

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function main() {
  const meta = JSON.parse(fs.readFileSync(path.join(backupDir, 'meta.json'), 'utf8'));
  console.log(`バックアップ: ${meta.exportedAt} (${Object.entries(meta.counts).map(([k, v]) => `${k} ${v}件`).join(' / ')})`);
  console.log(APPLY ? '★ 実際に書き込みます' : '確認のみ(書き込みません。実行するには --apply)');
  console.log('');

  const idToken = await signInAnonymously();

  for (const name of COLLECTIONS) {
    const backup = JSON.parse(fs.readFileSync(path.join(backupDir, `${name}.json`), 'utf8')) || {};
    const current = (await readJson(idToken, `/${name}.json`)) || {};

    const keys = Object.keys(backup);
    const added = keys.filter((k) => !(k in current));
    const changed = keys.filter((k) => k in current && !same(backup[k], current[k]));
    const unchanged = keys.filter((k) => k in current && same(backup[k], current[k]));
    const onlyCurrent = Object.keys(current).filter((k) => !(k in backup));

    console.log(`[${name}] バックアップ ${keys.length}件 / 現在 ${Object.keys(current).length}件`);
    console.log(`  追加される: ${added.length}件  上書きされる: ${changed.length}件  変更なし: ${unchanged.length}件`);
    console.log(`  現在あってバックアップに無い(そのまま残る): ${onlyCurrent.length}件`);

    if (!APPLY) continue;

    const toWrite = [...added, ...changed];
    if (!toWrite.length) { console.log('  書き込むものはありません'); continue; }

    for (let i = 0; i < toWrite.length; i += BATCH) {
      const chunk = {};
      toWrite.slice(i, i + BATCH).forEach((k) => { chunk[k] = backup[k]; });
      const res = await writeRaw(idToken, `/${name}.json`, { method: 'PATCH', body: chunk });
      if (!res.ok) throw new Error(`${name} の書き込みに失敗しました(HTTP ${res.status})。ルールで拒否された可能性があります`);
      console.log(`  書き込み ${Math.min(i + BATCH, toWrite.length)}/${toWrite.length}件`);
    }
  }

  if (APPLY) console.log('\n復元が完了しました。アプリを再読み込みして内容を確認してください。');
}

main().catch((err) => {
  console.log(`エラー: ${err.message}`);
  process.exitCode = 1;
});
