/* 照着做 — 组件库：图标 / 笔刷 / 常量（本地资源，Lucide 图标 ISC）
 * 许可证：见 assets/follow/licenses/Lucide-ISC.txt，字体许可证见同目录 OFL 文件 */
(function () {
  'use strict';

  // Lucide 线性图标：body 为元素字符串数组；fillIdx 为可被 iconFill 填色的元素下标
  var I = function (b, f) { return { body: b, fillIdx: f || [] }; };

  var ICONS = {
    'search': I([
      '<path d="m21 21-4.34-4.34"/>',
      '<circle cx="11" cy="11" r="8"/>'
    ], [1]),
    'landmark': I([
      '<path d="M10 18v-7"/>',
      '<path d="M11.119 2.205a2 2 0 0 1 1.762 0l7.84 3.846A.5.5 0 0 1 20.5 7h-17a.5.5 0 0 1-.22-.949z"/>',
      '<path d="M14 18v-7"/>',
      '<path d="M18 18v-7"/>',
      '<path d="M3 22h18"/>',
      '<path d="M6 18v-7"/>'
    ], [1]),
    'pencil': I([
      '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/>',
      '<path d="m15 5 4 4"/>'
    ], [0]),
    'graduation-cap': I([
      '<path d="M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z"/>',
      '<path d="M22 10v6"/>',
      '<path d="M6 12.5V16a6 3 0 0 0 12 0v-3.5"/>'
    ], []),
    'sparkles': I([
      '<path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"/>',
      '<path d="M20 2v4"/>',
      '<path d="M22 4h-4"/>',
      '<circle cx="4" cy="20" r="2"/>'
    ], [0]),
    'star': I([
      '<path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 1 1.597-1.16z"/>'
    ], [0]),
    'briefcase': I([
      '<path d="M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>',
      '<rect width="20" height="14" x="2" y="6" rx="2"/>'
    ], [1]),
    'circle-check': I([
      '<circle cx="12" cy="12" r="10"/>',
      '<path d="m16 9-5.5 5.5L8 12"/>'
    ], []),
    'calendar': I([
      '<path d="M8 2v3"/>',
      '<path d="M16 2v3"/>',
      '<rect x="3" y="3" width="18" height="18" rx="2"/>',
      '<path d="M3 9h18"/>'
    ], []),
    'target': I([
      '<circle cx="12" cy="12" r="10"/>',
      '<circle cx="12" cy="12" r="6"/>',
      '<circle cx="12" cy="12" r="2"/>'
    ], [2]),
    'heart': I([
      '<path d="M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5"/>'
    ], [0]),
    'zap': I([
      '<path d="M15.914 4a1.5 1.5 0 0 0-2.474-1.561l-9 9A1.5 1.5 0 0 0 5.5 14h4.002a.5.5 0 0 1 .471.666L8.086 20a1.5 1.5 0 0 0 2.475 1.56l9-9A1.5 1.5 0 0 0 18.5 10h-3.997a.5.5 0 0 1-.472-.667z"/>'
    ], [0]),
    'clock': I([
      '<circle cx="12" cy="12" r="10"/>',
      '<path d="M12 6v6l4 2"/>'
    ], []),
    'list-checks': I([
      '<path d="M13 5h8"/>',
      '<path d="M13 12h8"/>',
      '<path d="M13 19h8"/>',
      '<path d="m3 17 2 2 4-4"/>',
      '<path d="m3 7 2 2 4-4"/>'
    ], []),
    'trophy': I([
      '<path d="M10 14.66V17a1 1 0 0 1-1 1 2 2 0 0 0-2 2v2"/>',
      '<path d="M14 14.66V17a1 1 0 0 0 1 1 2 2 0 0 1 2 2v2"/>',
      '<path d="M17.916 10H19.5A2.5 2.5 0 0 0 22 7.5V5a1 1 0 0 0-1-1h-3"/>',
      '<path d="M4 22h16"/>',
      '<path d="M6 9a6 6 0 0 0 12 0V3a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1z"/>',
      '<path d="M6.084 10H4.5A2.5 2.5 0 0 1 2 7.5V5a1 1 0 0 1 1-1h3"/>'
    ], [4]),
    'book-open': I([
      '<path d="M12 5v16"/>',
      '<path d="M20.001 19A2 2 0 0 0 22 17V5a2 2 0 0 0-1.999-2L16 3.002A5 5 0 0 0 12 5a5 5 0 0 0-4-2H4a2 2 0 0 0-2 2v12a2 2 0 0 0 1.999 2H8a5 5 0 0 0 4 2 5 5 0 0 0 4-2z"/>'
    ], []),
    'lightbulb': I([
      '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/>',
      '<path d="M9 18h6"/>',
      '<path d="M10 22h4"/>'
    ], [0]),
    'message-circle': I([
      '<path d="M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719"/>'
    ], [0]),
    'flame': I([
      '<path d="M12 3q1 4 4 6.5t3 5.5a1 1 0 0 1-14 0 5 5 0 0 1 1-3 1 1 0 0 0 5 0c0-2-1.5-3-1.5-5q0-2 2.5-4"/>'
    ], [0]),
    'gift': I([
      '<path d="M12 7v14"/>',
      '<path d="M20 11v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8"/>',
      '<path d="M7.5 7a1 1 0 0 1 0-5A4.8 8 0 0 1 12 7a4.8 8 0 0 1 4.5-5 1 1 0 0 1 0 5"/>',
      '<rect x="3" y="7" width="18" height="4" rx="1"/>'
    ], [3]),
    'camera': I([
      '<path d="M13.997 4a2 2 0 0 1 1.76 1.05l.486.9A2 2 0 0 0 18.003 7H20a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1.997a2 2 0 0 0 1.759-1.048l.489-.904A2 2 0 0 1 10.004 4z"/>',
      '<circle cx="12" cy="13" r="3"/>'
    ], [1]),
    'bookmark': I([
      '<path d="M17 3a2 2 0 0 1 2 2v15a1 1 0 0 1-1.496.868l-4.512-2.578a2 2 0 0 0-1.984 0l-4.512 2.578A1 1 0 0 1 5 20V5a2 2 0 0 1 2-2z"/>'
    ], [0]),
    'rocket': I([
      '<path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/>',
      '<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09"/>',
      '<path d="M9 12a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.4 22.4 0 0 1-4 2z"/>',
      '<path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 .05 5 .05"/>'
    ], [2]),
    'columns-3': I([
      '<rect width="18" height="18" x="3" y="3" rx="2"/>',
      '<path d="M9 3v18"/>',
      '<path d="M15 3v18"/>'
    ], [])
  };

  // 实心学士帽：黑帽 #26252A + 橙流苏 #C1722D
  var GRAD_CAP_SOLID =
    '<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">' +
    '<g>' +
    // 流苏（先画，被帽体压住一半）
    '<path d="M46 30 L58 22 L58 38" fill="none" stroke="#C1722D" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<circle cx="58" cy="40" r="3.4" fill="#C1722D"/>' +
    // 帽体（菱形顶）
    '<path d="M32 12 L60 25 L32 38 L4 25 Z" fill="#26252A"/>' +
    // 帽冠
    '<path d="M17 29 v10 c0 5 6.7 9 15 9 s15 -4 15 -9 V29 L32 36 Z" fill="#26252A"/>' +
    '</g></svg>';

  // 内联 SVG 图标
  function iconSVG(name, size, extra) {
    var d = ICONS[name];
    if (!d) return '';
    var inner = '';
    for (var i = 0; i < d.body.length; i++) inner += d.body[i];
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" ' +
      'width="' + size + '" height="' + size + '" fill="none" stroke="currentColor" ' +
      'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ' +
      (extra || '') + '>' + inner + '</svg>';
  }

  // 带局部填色的图标（iconFill：把指定元素填色 + 同色描边）
  function iconSVGFill(name, size, fill, extra) {
    var d = ICONS[name];
    if (!d) return '';
    var inner = '';
    for (var i = 0; i < d.body.length; i++) {
      var s = d.body[i];
      if (d.fillIdx.indexOf(i) >= 0 && fill) {
        s = s.replace('/>', ' fill="' + fill + '" stroke="' + fill + '"/>');
      }
      inner += s;
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" ' +
      'width="' + size + '" height="' + size + '" fill="none" stroke="currentColor" ' +
      'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ' +
      (extra || '') + '>' + inner + '</svg>';
  }

  // Lucide 路径（24×24 坐标系）→ Path2D 数组，供 canvas 导出描边用
  function iconPaths(name) {
    var d = ICONS[name];
    if (!d) return [];
    return d.body.map(function (s) {
      var m = s.match(/d="([^"]+)"/);
      return m ? m[1] : null;
    }).filter(function (x) { return x; });
  }

  // ---------- 笔刷形状（inline SVG） ----------
  // sweep：不规则干笔刷横扫，多条锯齿边 path 叠加 + feTurbulence 毛边
  function brushSVG(shape, color, uid) {
    var W = 300, H = 66;
    if (shape === 'dot') {
      return '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">' +
        '<g fill="' + color + '">' +
        '<circle cx="60" cy="30" r="17"/><circle cx="132" cy="26" r="13"/>' +
        '<circle cx="200" cy="32" r="19"/><circle cx="262" cy="27" r="12"/>' +
        '</g></svg>';
    }
    if (shape === 'underline') {
      return '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">' +
        '<defs><filter id="bu' + uid + '" x="-20%" y="-60%" width="140%" height="220%">' +
        '<feTurbulence type="fractalNoise" baseFrequency="0.04 0.11" numOctaves="3" seed="11" result="n"/>' +
        '<feDisplacementMap in="SourceGraphic" in2="n" scale="10"/></filter></defs>' +
        '<path filter="url(#bu' + uid + ')" fill="' + color + '" opacity=".95" ' +
        'd="M8 38 C 60 32, 130 30, 200 33 S 272 40, 293 36 L 293 50 C 240 55, 150 53, 90 49 S 20 48, 8 44 Z"/></svg>';
    }
    // sweep
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">' +
      '<defs><filter id="bs' + uid + '" x="-30%" y="-80%" width="160%" height="260%">' +
      '<feTurbulence type="fractalNoise" baseFrequency="0.035 0.14" numOctaves="4" seed="7" result="n"/>' +
      '<feDisplacementMap in="SourceGraphic" in2="n" scale="30"/></filter></defs>' +
      '<g filter="url(#bs' + uid + ')">' +
      '<path fill="' + color + '" d="M6 32 C 42 20, 96 15, 152 20 S 258 33, 295 26 L 295 42 C 252 49, 160 47, 92 42 S 18 42, 6 36 Z"/>' +
      '<path fill="' + color + '" opacity=".55" d="M10 24 C 60 14, 130 12, 190 17 S 268 26, 292 22 L 293 30 C 240 33, 150 29, 80 26 S 22 28, 10 30 Z"/>' +
      '<path fill="' + color + '" opacity=".5" d="M14 40 C 70 36, 150 38, 214 40 S 272 44, 290 41 L 290 47 C 240 52, 150 50, 88 46 S 26 46, 14 44 Z"/>' +
      '<path fill="' + color + '" opacity=".38" d="M18 18 C 70 10, 150 8, 210 12 S 275 18, 294 15 L 294 21 C 245 25, 160 21, 90 19 S 28 22, 18 23 Z"/>' +
      '<path fill="' + color + '" opacity=".35" d="M20 46 C 80 43, 160 45, 220 47 S 280 50, 296 48 L 296 53 C 245 57, 155 55, 95 51 S 30 51, 20 49 Z"/>' +
      '</g></svg>';
  }

  // 笔刷主形状路径（canvas 导出近似：主 path 按图层宽高缩放 + 抖动偏移）
  var BRUSH_MAIN = 'M6 32 C 42 20, 96 15, 152 20 S 258 33, 295 26 L 295 42 C 252 49, 160 47, 92 42 S 18 42, 6 36 Z';
  var BRUSH_SIDE = [
    'M10 24 C 60 14, 130 12, 190 17 S 268 26, 292 22 L 293 30 C 240 33, 150 29, 80 26 S 22 28, 10 30 Z',
    'M14 40 C 70 36, 150 38, 214 40 S 272 44, 290 41 L 290 47 C 240 52, 150 50, 88 46 S 26 46, 14 44 Z',
    'M18 18 C 70 10, 150 8, 210 12 S 275 18, 294 15 L 294 21 C 245 25, 160 21, 90 19 S 28 22, 18 23 Z',
    'M20 46 C 80 43, 160 45, 220 47 S 280 50, 296 48 L 296 53 C 245 57, 155 55, 95 51 S 30 51, 20 49 Z'
  ];

  // ---------- 常量 ----------
  var PALETTE = ['#000000', '#0C44F9', '#EF5714', '#FDD758', '#FEC4D2', '#D1CFFE', '#FFFFFF', '#FCF8ED'];

  var FONTS = [
    { id: 'SHSans', name: '大粗黑', sample: '照', css: "'SHSans'", weight: 900 },
    { id: 'SHSerif', name: '高级宋', sample: '照', css: "'SHSerif'", weight: 900 },
    { id: 'Smiley', name: '潮酷斜', sample: '照', css: "'Smiley'", weight: 400 },
    { id: 'KuaiLe', name: '可爱圆', sample: '照', css: "'KuaiLe'", weight: 400 }
  ];

  var SHADOWS = {
    soft: 'drop-shadow(0 3px 6px rgba(0,0,0,.22))',
    hard: 'drop-shadow(4px 5px 0 rgba(20,20,20,.85))',
    none: 'none'
  };

  // 编辑器 UI 小图标（工具栏 / 通用）
  var UI_ICONS = {
    type: '<path d="M4 7V5h16v2"/><path d="M12 5v14"/><path d="M9 19h6"/>',
    shapes: '<rect x="3" y="3" width="8" height="8" rx="2"/><circle cx="17" cy="17" r="4"/><path d="M17 3l4 6h-8z"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="1.6"/><path d="m4 18 5-5 4 4 3-3 4 4"/>',
    layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/><path d="m3 17 9 5 9-5" opacity=".45"/>',
    eye: '<path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="2.8"/>',
    download: '<path d="M12 4v11"/><path d="m7 11 5 5 5-5"/><path d="M4 19h16"/>',
    text: '<path d="M5 6V4h14v2"/><path d="M12 4v16"/><path d="M9 20h6"/>',
    pill: '<rect x="2.5" y="8" width="19" height="8" rx="4"/><path d="M7.5 12h.01"/>',
    badge: '<circle cx="12" cy="9" r="5.5"/><path d="m8.8 13.5-1.8 7 5-2.6 5 2.6-1.8-7"/>',
    brush: '<path d="m15 5 4 4"/><path d="M4 20c1-4 3-6 7-9l4-4 4 4-4 4c-3 4-5 6-9 7z"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M4 16V6a2 2 0 0 1 2-2h10"/>',
    trash: '<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7v13a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7"/>',
    up: '<path d="M12 19V5"/><path d="m6 11 6-6 6 6"/>',
    down: '<path d="M12 5v14"/><path d="m6 13 6 6 6-6"/>',
    eyeOff: '<path d="M3 3l18 18"/><path d="M10.6 5.1A9.8 9.8 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-2.5 3.4"/><path d="M6.3 6.5A16.7 16.7 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 4.2-1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
    leftRight: '<path d="M8 8l-4 4 4 4"/><path d="M16 8l4 4-4 4"/><path d="M4 12h16"/>'
  };

  function uiIcon(name, size, sw) {
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="' + (size || 20) +
      '" height="' + (size || 20) + '" fill="none" stroke="currentColor" stroke-width="' + (sw || 1.6) +
      '" stroke-linecap="round" stroke-linejoin="round">' + (UI_ICONS[name] || '') + '</svg>';
  }

  window.FMC = {
    ICONS: ICONS,
    iconSVG: iconSVG,
    iconSVGFill: iconSVGFill,
    iconPaths: iconPaths,
    GRAD_CAP_SOLID: GRAD_CAP_SOLID,
    brushSVG: brushSVG,
    BRUSH_MAIN: BRUSH_MAIN,
    BRUSH_SIDE: BRUSH_SIDE,
    PALETTE: PALETTE,
    FONTS: FONTS,
    SHADOWS: SHADOWS,
    uiIcon: uiIcon
  };
})();
