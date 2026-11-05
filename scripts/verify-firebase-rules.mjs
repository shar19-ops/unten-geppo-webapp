// firebase/database.rules.json をFirebase Consoleで公開したあと、本番に対して
// 「守るべきものが拒否され、アプリの正規の書き込みは通る」ことを確かめる。
//
// 本番データを壊さないよう、書き込みの確認はすべて次のどちらかで行う。
//   - 今ある内容と同じものを、ETag付き(読み取り時点から変わっていなければ)で書く
//     → 通っても中身は変わらず、他の人の更新と競合すれば412で何も書かれない
//   - アプリからは見えない検証用のキーに書き、直後に消す
//
// 実行例:
//   node scripts/verify-firebase-rules.mjs          ルール公開前でも安全な確認だけ
//   node scripts/verify-firebase-rules.mjs --post   ルール公開後の全確認(拒否されるべき書き込みも試す)

import { signInAnonymously, readJson, writeRaw } from './firebase-rest.mjs';

const POST = process.argv.includes('--post');
const results = [];

function record(group, name, expected, actual, note = '') {
  const ok = expected.includes(actual);
  results.push({ group, name, expected, actual, ok, note });
  const mark = ok ? 'OK ' : 'NG ';
  console.log(`  ${mark} ${name}: HTTP ${actual}${ok ? '' : ` (期待: ${expected.join('/')})`}${note ? `  ${note}` : ''}`);
}

async function main() {
  console.log(POST ? 'ルール公開後の確認(全項目)' : 'ルール公開前でも安全な確認のみ(拒否されるべき書き込みの確認は --post で行います)');
  const idToken = await signInAnonymously();

  // ---------- A. 読み取り ----------
  console.log('\nA. 読み取り');
  {
    const v = await fetch(`https://unten-geppo-webapp-default-rtdb.firebaseio.com/vehicles.json?auth=${idToken}`);
    record('A', '車両一覧を読む(アプリが使う)', [200], v.status);
    const l = await fetch(`https://unten-geppo-webapp-default-rtdb.firebaseio.com/logs.json?auth=${idToken}`);
    record('A', '月報一覧を読む(アプリ・リマインドが使う)', [200], l.status);
    const r = await fetch(`https://unten-geppo-webapp-default-rtdb.firebaseio.com/.json?shallow=true&auth=${idToken}`);
    record('A', 'ルート直下を読む(1リクエストで全体を持ち出す)', POST ? [401] : [200, 401], r.status,
      POST ? '' : '(公開前は通る)');
  }

  // ---------- B. 全体の置き換え(禁止されるべき) ----------
  console.log('\nB. コレクション全体の置き換え(1リクエストでの全消去・全上書き)');
  {
    const { data: vehicles, etag: vEtag } = await readJson(idToken, '/vehicles.json', { wantEtag: true });
    const res = await writeRaw(idToken, '/vehicles.json', { body: vehicles, ifMatch: vEtag });
    record('B', 'PUT /vehicles.json(同じ内容・ETag付き)', POST ? [401] : [200, 401, 412], res.status,
      POST ? '' : '(公開前は通るが内容は同じ)');

    const { data: logs, etag: lEtag } = await readJson(idToken, '/logs.json', { wantEtag: true });
    const res2 = await writeRaw(idToken, '/logs.json', { body: logs, ifMatch: lEtag });
    record('B', 'PUT /logs.json(同じ内容・ETag付き)', POST ? [401] : [200, 401, 412], res2.status,
      POST ? '' : '(公開前は通るが内容は同じ)');
  }

  // ---------- C. アプリの正規の書き込み(通るべき) ----------
  console.log('\nC. アプリの正規の書き込み');
  {
    const vehicles = await readJson(idToken, '/vehicles.json');
    const sample = Object.values(vehicles || {}).find((v) => v && typeof v.plateNumber === 'string' && v.plateNumber.startsWith('見本'));
    if (!sample) {
      console.log('  -- 見本車両(車両番号が「見本」で始まるもの)が無いため、車両の書き込み確認は省略');
    } else {
      // 車両1台のPUT(車両の追加・編集・QR発行で使う経路)。今ある内容をそのまま書く
      const { data: one, etag } = await readJson(idToken, `/vehicles/${sample.id}.json`, { wantEtag: true });
      const res = await writeRaw(idToken, `/vehicles/${sample.id}.json`, { body: one, ifMatch: etag });
      record('C', `車両1台をPUT(${sample.plateNumber}・同じ内容)`, [200, 412], res.status, res.status === 412 ? '(同時更新のため未実行)' : '');

      // 複数車両のPATCH(Excel取込で使う経路)。1キーずつ別の書き込みとして評価される
      const res2 = await writeRaw(idToken, '/vehicles.json', { method: 'PATCH', body: { [sample.id]: one } });
      record('C', `複数車両をPATCH(${sample.plateNumber}・同じ内容)`, [200], res2.status);
    }

    // 月報の1日分の書き込み(運転記録入力の経路)。実在しない車両IDの検証用キーに書き、直後に消す。
    // アプリは車両からたどって月報を読むため、車両の無い月報は画面には一切出ない
    const key = 'ruletest-vehicle_2026_9';
    const res3 = await writeRaw(idToken, `/logs/${key}/days/1.json`, { body: { destination: 'ルール検証', updatedAt: new Date().toISOString() } });
    record('C', '月報の1日分をPUT(検証用キー)', [200], res3.status);
    const res4 = await writeRaw(idToken, `/logs/${key}/meta.json`, { body: { note: 'ルール検証' } });
    record('C', '月報のmetaをPUT(検証用キー)', [200], res4.status);
    const del = await writeRaw(idToken, `/logs/${key}.json`, { method: 'DELETE' });
    record('C', '検証用の月報を削除(後片付け)', [200], del.status);
  }

  // ---------- D. 壊れたデータ・想定外の場所(拒否されるべき) ----------
  if (POST) {
    console.log('\nD. 壊れたデータ・想定外の場所への書き込み');
    const cases = [
      ['車両番号の無い車両', '/vehicles/ruletest-invalid.json', 'PUT', { foo: 'bar' }],
      ['idがキーと違う車両', '/vehicles/ruletest-mismatch.json', 'PUT', { id: 'other', plateNumber: 'x' }],
      ['形式に合わないキーの月報', '/logs/bad_key/days/1.json', 'PUT', { destination: 'x' }],
      ['ルート直下の新しいキー', '/ruletest-root.json', 'PUT', 'x']
    ];
    for (const [name, path, method, body] of cases) {
      const res = await writeRaw(idToken, path, { method, body });
      record('D', name, [401], res.status);
      if (res.ok) {
        // ルールが効いていなかった場合のみ、書けてしまったものを消す
        const cleanupPath = path.replace(/\/days\/1\.json$/, '.json');
        const del = await writeRaw(idToken, cleanupPath, { method: 'DELETE' });
        console.log(`     -> 書けてしまったため削除しました(HTTP ${del.status})`);
      }
    }
  }

  // ---------- まとめ ----------
  const ng = results.filter((r) => !r.ok);
  console.log('');
  if (ng.length) {
    console.log(`NG ${ng.length}件: ${ng.map((r) => r.name).join(' / ')}`);
    process.exitCode = 1;
  } else {
    console.log(POST ? 'すべて期待どおりです。ルールは意図どおりに効いています。' : '安全な確認はすべて期待どおりです。ルールを公開したら --post で再度実行してください。');
  }
}

main().catch((err) => {
  console.log(`エラー: ${err.message}`);
  process.exitCode = 1;
});
