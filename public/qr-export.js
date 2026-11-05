// QRコードを「車両に貼るためのPDF」と「そのPDFを添付したメールの下書き」に書き出す。
//
// PDFライブラリは使っていない。日本語を含むため、一般的なPDFライブラリを使っても
// 標準フォントでは文字が出せず、どのみち日本語部分はcanvasに描いて画像として
// 埋め込むことになる。それなら数百KBのvendorファイルを増やす意味が薄いので、
// 必要な部分だけを直接組み立てている。QRコード自体は画像ではなく矩形の塗りつぶし
// (ベクター)で描いているため、拡大してもにじまずファイルも小さくなる。

const PT_PER_MM = 72 / 25.4;
const PAGE_W_PT = 210 * PT_PER_MM;
const PAGE_H_PT = 297 * PT_PER_MM;
const PDF_MARGIN_PT = 20 * PT_PER_MM;
const QR_SIZE_PT = 70 * PT_PER_MM; // 貼付後に少し離れても読めるよう、画面印刷より大きめにする
// 日本語をcanvasに描くときの倍率。PDF内では1/CANVAS_SCALEに縮小して配置するため、
// この値がそのまま解像度になる(4倍 = 約288dpi)。
const CANVAS_SCALE = 4;
const PDF_FONT_STACK = '"Yu Gothic", "Hiragino Sans", "Meiryo", sans-serif';

// ---------------- 小さなユーティリティ ----------------
const utf8Bytes = (text) => new TextEncoder().encode(text);

function concatBytes(parts) {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  parts.forEach((p) => { out.set(p, at); at += p.length; });
  return out;
}

function bytesToBase64(bytes) {
  // btoaは文字列しか受け取らないため一度バイナリ文字列にする。
  // 引数の個数制限に当たらないよう分割して渡す。
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

// PDFの数値。小数が長いとファイルが無駄に膨らむので丸める。
const pdfNum = (n) => (Math.round(n * 1000) / 1000).toString();

// PDFの文字列リテラルに直接書けない文字を退避する。
const pdfText = (s) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

// ---------------- 日本語の見出しをcanvasで描いて1bit画像にする ----------------
function renderQrHeadingImage(vehicle, widthPt) {
  const instruction = '運転月報App用QRコードを読取、運転記録を入力してください';
  const label = `${vehicle.plateNumber}${vehicle.nickname ? `(${vehicle.nickname})` : ''}`;
  const instructionPt = 11;
  const labelPt = 22;
  const gapPt = 12;
  const heightPt = instructionPt + gapPt + labelPt + 6;

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(widthPt * CANVAS_SCALE);
  canvas.height = Math.round(heightPt * CANVAS_SCALE);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000000';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.font = `${instructionPt * CANVAS_SCALE}px ${PDF_FONT_STACK}`;
  ctx.fillText(instruction, canvas.width / 2, 0, canvas.width);
  ctx.font = `bold ${labelPt * CANVAS_SCALE}px ${PDF_FONT_STACK}`;
  ctx.fillText(label, canvas.width / 2, (instructionPt + gapPt) * CANVAS_SCALE, canvas.width);

  return { canvas, widthPt, heightPt };
}

// 白黒2値なので1bit/pixelで持つ。フルカラーのまま埋め込むと数MBになる。
function canvasTo1BitImage(canvas) {
  const { width, height } = canvas;
  const data = canvas.getContext('2d').getImageData(0, 0, width, height).data;
  const stride = Math.ceil(width / 8);
  const bytes = new Uint8Array(stride * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      // DeviceGrayの1bitでは0が黒・1が白。白のビットだけ立てる。
      if ((data[i] + data[i + 1] + data[i + 2]) / 3 >= 128) {
        bytes[y * stride + (x >> 3)] |= 0x80 >> (x & 7);
      }
    }
  }
  return { bytes, width, height };
}

// PDFの/FlateDecodeはzlib形式で、CompressionStream('deflate')の出力がそのまま使える。
// 非対応の環境では圧縮せずに埋め込む(ファイルは大きくなるが中身は同じ)。
async function deflateBytes(bytes) {
  if (typeof CompressionStream !== 'function') return null;
  try {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
}

// ---------------- QRコードを矩形の塗りつぶしとして書き出す ----------------
function qrFillOps(qr, originX, originY, sizePt) {
  const count = qr.getModuleCount();
  const cell = sizePt / count;
  // 隣り合う矩形の継ぎ目に、描画時のアンチエイリアスで白い筋が出ることがある。
  // 実寸で0.03mm程度だけ重ねて塞ぐ(読み取りには影響しない大きさ)。
  const bleed = cell * 0.01;
  const ops = [];
  for (let r = 0; r < count; r += 1) {
    let runStart = -1;
    for (let c = 0; c <= count; c += 1) {
      const dark = c < count && qr.isDark(r, c);
      if (dark && runStart < 0) runStart = c;
      if (!dark && runStart >= 0) {
        // 横に連続する黒モジュールは1つの矩形にまとめる
        const x = originX + runStart * cell;
        const y = originY + sizePt - (r + 1) * cell;
        const w = (c - runStart) * cell;
        ops.push(`${pdfNum(x)} ${pdfNum(y)} ${pdfNum(w + bleed)} ${pdfNum(cell + bleed)} re`);
        runStart = -1;
      }
    }
  }
  return ops.join('\n');
}

// ---------------- PDF本体の組み立て ----------------
async function buildQrPdfBytes(vehicle, url, qr) {
  const contentW = PAGE_W_PT - PDF_MARGIN_PT * 2;
  const heading = renderQrHeadingImage(vehicle, contentW);
  const image = canvasTo1BitImage(heading.canvas);
  const compressed = await deflateBytes(image.bytes);
  const imageBytes = compressed || image.bytes;

  const headingBottom = PAGE_H_PT - PDF_MARGIN_PT - heading.heightPt;
  const qrY = headingBottom - 12 * PT_PER_MM - QR_SIZE_PT;
  const qrX = (PAGE_W_PT - QR_SIZE_PT) / 2;
  const urlY = qrY - 8 * PT_PER_MM;

  const content = [
    'q',
    `${pdfNum(heading.widthPt)} 0 0 ${pdfNum(heading.heightPt)} ${pdfNum(PDF_MARGIN_PT)} ${pdfNum(headingBottom)} cm`,
    '/Im0 Do',
    'Q',
    '0 0 0 rg',
    qrFillOps(qr, qrX, qrY, QR_SIZE_PT),
    'f',
    // URLはASCIIのみなので、標準14フォントのHelveticaで埋め込み無しに出せる
    `BT /F1 8 Tf 1 0 0 1 ${pdfNum(PDF_MARGIN_PT)} ${pdfNum(urlY)} Tm (${pdfText(url)}) Tj ET`
  ].join('\n');

  const contentBytes = utf8Bytes(content);
  const objects = [
    utf8Bytes('<< /Type /Catalog /Pages 2 0 R >>'),
    utf8Bytes('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    utf8Bytes(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pdfNum(PAGE_W_PT)} ${pdfNum(PAGE_H_PT)}]`
      + ' /Resources << /XObject << /Im0 5 0 R >> /Font << /F1 6 0 R >> >> /Contents 4 0 R >>'),
    concatBytes([utf8Bytes(`<< /Length ${contentBytes.length} >>\nstream\n`), contentBytes, utf8Bytes('\nendstream')]),
    concatBytes([
      utf8Bytes(`<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height}`
        + ` /ColorSpace /DeviceGray /BitsPerComponent 1${compressed ? ' /Filter /FlateDecode' : ''}`
        + ` /Length ${imageBytes.length} >>\nstream\n`),
      imageBytes,
      utf8Bytes('\nendstream')
    ]),
    utf8Bytes('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>')
  ];

  const parts = [];
  let offset = 0;
  const push = (bytes) => { parts.push(bytes); offset += bytes.length; };
  push(utf8Bytes('%PDF-1.4\n'));
  // 2行目はPDFがバイナリを含むことを示す慣例のマーカー。転送時に壊されるのを防ぐ。
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

  const xrefOffsets = [];
  objects.forEach((body, i) => {
    xrefOffsets.push(offset);
    push(utf8Bytes(`${i + 1} 0 obj\n`));
    push(body);
    push(utf8Bytes('\nendobj\n'));
  });

  const xrefStart = offset;
  const xref = [`xref\n0 ${objects.length + 1}\n`, '0000000000 65535 f \n']
    .concat(xrefOffsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`))
    .join('');
  push(utf8Bytes(xref));
  push(utf8Bytes(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`));

  return concatBytes(parts);
}

function downloadBytes(bytes, mimeType, fileName) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(a.href);
}

function qrPdfFileName(vehicle) {
  const label = `${vehicle.plateNumber}${vehicle.nickname ? `(${vehicle.nickname})` : ''}`;
  // Windowsのファイル名に使えない文字を落とす(車両番号に入ることは無いが念のため)
  return `QRコード_${label.replace(/[\\/:*?"<>|]/g, '_')}.pdf`;
}

// ---------------- PDFを添付したメールの下書き(.eml) ----------------
// mailto:には添付の仕組みが無いため、メール1通をファイル(.eml)として書き出す。
// X-Unsent: 1 を付けると、Outlookはこれを受信済みメールではなく「送信前の下書き」
// として開くので、宛先・件名・本文・添付が入った状態から送信ボタンを押すだけになる。
function encodeMimeWord(text) {
  // 日本語のヘッダはRFC2047のencoded-wordにする。1つのencoded-wordは75文字までの
  // 制限があるため、UTF-8のバイト境界を壊さないように分割して並べる。
  const chars = Array.from(text);
  const words = [];
  let chunk = '';
  let chunkBytes = 0;
  const flush = () => {
    if (!chunk) return;
    words.push(`=?UTF-8?B?${bytesToBase64(utf8Bytes(chunk))}?=`);
    chunk = '';
    chunkBytes = 0;
  };
  chars.forEach((ch) => {
    const size = utf8Bytes(ch).length;
    // base64にすると4/3倍になる。encoded-wordの装飾込みで75文字に収まる上限が45バイト。
    if (chunkBytes + size > 45) flush();
    chunk += ch;
    chunkBytes += size;
  });
  flush();
  return words.join('\r\n ');
}

function base64Lines(bytes) {
  // MIMEの本文行は76文字までに折り返す
  return bytesToBase64(bytes).replace(/(.{76})/g, '$1\r\n');
}

function buildQrMailEml({ to, subject, body, pdfBytes, pdfFileName }) {
  const boundary = '----=_ug_qr_' + Math.random().toString(36).slice(2);
  const encodedName = encodeMimeWord(pdfFileName);
  const lines = [
    // メールアドレス未登録の車両では空のTo行を出さない(メールソフト側で宛先を入れてもらう)
    ...(to ? [`To: ${to}`] : []),
    `Subject: ${encodeMimeWord(subject)}`,
    'X-Unsent: 1',
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    base64Lines(utf8Bytes(body)),
    `--${boundary}`,
    `Content-Type: application/pdf; name="${encodedName}"`,
    'Content-Transfer-Encoding: base64',
    `Content-Disposition: attachment; filename="${encodedName}"`,
    '',
    base64Lines(pdfBytes),
    `--${boundary}--`,
    ''
  ];
  return lines.join('\r\n');
}
