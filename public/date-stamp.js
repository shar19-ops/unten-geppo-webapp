/*
 * date-stamp.js — 丸型デート印（SVG版）
 * 伝票アプリ（payment-slip-app / transfer-slip-app）の date-stamp.js と同じレイアウト・寸法比率で、
 * Canvas/pdf-lib の代わりに SVG を返す。画面表示とブラウザ印刷（PDF保存含む）でそのまま使える。
 *
 *   DateStamp.svg({ name: '佐藤', date: { year: 2026, month: 10, day: 15 }, color: 'red' })
 *   DateStamp.svg({ nameTop: '佐藤', nameBottom: '課長', date: new Date(), color: 'black' })
 */
(function (root) {
  'use strict';

  var COLORS = { black: 'rgb(0,0,0)', red: 'rgb(184,15,15)' };
  var R = 50; // viewBox 上の半径（表示サイズは CSS で決める）

  function toYMD(date) {
    if (date instanceof Date) return { y: date.getFullYear(), m: date.getMonth() + 1, d: date.getDate() };
    if (date && typeof date === 'object') return { y: date.year, m: date.month, d: date.day };
    var now = new Date();
    return { y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() };
  }

  // 伝票アプリと同じ "26/10/15"（年2桁）表記
  function formatDate(date) {
    var t = toYMD(date);
    return String(t.y).slice(-2) + '/' + t.m + '/' + t.d;
  }

  // 役職なしは苗字を上下に分割、指定があれば nameTop / nameBottom をそのまま使う
  function splitName(o) {
    if (o.nameTop != null || o.nameBottom != null) return { top: o.nameTop || '', bottom: o.nameBottom || '' };
    var name = (o.name || '').trim();
    var half = Math.ceil(name.length / 2);
    return { top: name.slice(0, half), bottom: name.slice(half) };
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
  }

  // 1行の文字。横幅が弦の長さを超えるときだけ textLength で縮める
  function text(str, y, size, maxW) {
    if (!str) return '';
    var fit = str.length * size > maxW ? ' textLength="' + maxW.toFixed(1) + '" lengthAdjust="spacingAndGlyphs"' : '';
    return '<text x="0" y="' + y.toFixed(2) + '" font-size="' + size + '"' + fit + '>' + esc(str) + '</text>';
  }

  function svg(o) {
    o = o || {};
    var color = COLORS[o.color] || COLORS.red;
    var offset = R / 3;                       // 中心から仕切り線まで
    var chordHalf = Math.sqrt(R * R - offset * offset);
    var bw = Math.max(R * 0.04, 1.5);
    var names = splitName(o);
    var nameSize = R * 0.4, dateSize = R * 0.32;
    var nameY = (R + offset) / 2;              // 上下段の中心
    var nameW = 2 * Math.sqrt(R * R - nameY * nameY) * 0.9;

    var parts = [
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + -(R + bw) + ' ' + -(R + bw) + ' ' + 2 * (R + bw) + ' ' + 2 * (R + bw) + '" class="date-stamp">',
      '<g fill="none" stroke="' + color + '" stroke-width="' + bw + '">',
      '<circle cx="0" cy="0" r="' + R + '"/>',
    ];
    if (names.top || names.bottom) {
      parts.push('<line x1="' + -chordHalf + '" y1="' + -offset + '" x2="' + chordHalf + '" y2="' + -offset + '"/>');
      parts.push('<line x1="' + -chordHalf + '" y1="' + offset + '" x2="' + chordHalf + '" y2="' + offset + '"/>');
    }
    parts.push('</g>');
    parts.push('<g fill="' + color + '" font-weight="bold" text-anchor="middle" dominant-baseline="central" font-family="Meiryo, \'Yu Gothic\', \'MS Gothic\', sans-serif">');
    parts.push(text(names.top, -nameY, nameSize, nameW));
    parts.push(text(names.bottom, nameY, nameSize, nameW));
    parts.push(text(formatDate(o.date), 0, dateSize, chordHalf * 1.8));
    parts.push('</g></svg>');
    return parts.join('');
  }

  root.DateStamp = { svg: svg, formatDate: formatDate };
})(window);
