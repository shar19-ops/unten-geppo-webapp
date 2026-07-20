// 【開発中につき一時的に無効化】
// 本来はキャッシュファーストのアプリシェルService Worker(オフラインで運転記録入力できるようにする
// ためのもの)を予定しているが、開発中は更新のたびに古いキャッシュが残り、動作確認の妨げになって
// いたため一旦停止する。このファイル自体の内容が変わったことをブラウザが検知すると、新しい
// Service Workerがインストール→有効化され、有効化と同時に全キャッシュを削除して自分自身を
// 登録解除し、制御下のページを再読み込みする(=手動でUnregisterしなくても自動的に元に戻る)。
// PWA仕上げの段階で、DEVLOG.mdに残したキャッシュファースト設計を元に実装し直す。
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
      .then(() => self.registration.unregister())
      .then(() => self.clients.matchAll())
      .then((clients) => clients.forEach((client) => client.navigate(client.url)))
  );
});
