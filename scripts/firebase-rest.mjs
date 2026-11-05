// バックアップ・復元・ルール検証の各スクリプトが共有する、Firebase Realtime Databaseの
// REST呼び出し。アプリ本体(public/storage.js)と同じく、SDKは使わずfetchだけで行う。
//
// アプリと同じ公開値。Firebaseの設計上どちらも非公開情報ではなく、実際のアクセス制御は
// データベース側のルール(firebase/database.rules.json)で行う。
export const FIREBASE_DB_URL = 'https://unten-geppo-webapp-default-rtdb.firebaseio.com';
export const FIREBASE_API_KEY = 'AIzaSyDoZPZmb14J2Zu3WXgyD6A8eeSy1Nyz0_g';

export async function signInAnonymously() {
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FIREBASE_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ returnSecureToken: true })
  });
  if (!res.ok) throw new Error(`Firebase匿名サインインに失敗しました: ${res.status}`);
  const data = await res.json();
  return data.idToken;
}

function withAuth(path, idToken) {
  const sep = path.includes('?') ? '&' : '?';
  return `${FIREBASE_DB_URL}${path}${sep}auth=${encodeURIComponent(idToken)}`;
}

// 読み取り。wantEtag=true にすると、あとで「その時点から変わっていなければ書く」条件付き
// 書き込みに使えるETagも一緒に返す。
export async function readJson(idToken, path, { wantEtag = false } = {}) {
  const headers = wantEtag ? { 'X-Firebase-ETag': 'true' } : {};
  const res = await fetch(withAuth(path, idToken), { headers });
  if (!res.ok) throw new Error(`Firebase読み取りに失敗しました(${path}): ${res.status}`);
  const data = await res.json();
  return wantEtag ? { data, etag: res.headers.get('etag') } : data;
}

// 書き込み。結果を投げずにそのまま返す(ルール検証では「拒否されること」を確かめたいため)。
// ifMatch にETagを渡すと、読み取り時点から変わっていた場合は412で何も書かれない。
export async function writeRaw(idToken, path, { method = 'PUT', body, ifMatch } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (ifMatch) headers['if-match'] = ifMatch;
  const res = await fetch(withAuth(path, idToken), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: res.status, ok: res.ok };
}
