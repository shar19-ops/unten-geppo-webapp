const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5174;

// 静的ファイル配信(ExcelJS/SheetJSはpublic/vendor配下に物理コピー済み。
// GitHub Pagesなどの静的ホスティングでもそのまま動くよう、node_modulesからの動的配信はしない)
app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => {
  console.log(`運転管理月報アプリ起動: http://localhost:${PORT}`);
});
