/* 照着做 — 封面编辑器（移植自 follow-make-demo v3.1 demo.js）
 * IIFE，只暴露 window.FollowMake = { open(opts), close() }
 * 依赖：follow/components.js (window.FMC)、follow/presets.js (window.FMPRE)
 * 字体按需加载：首次 open 时插入 @font-face <style>，document.fonts 就绪后再渲染
 */
(function () {
  'use strict';
  var C = window.FMC;
  var P = window.FMPRE;
  var CW = 300, CH = 400;
  var V = '20261110a';
  var FONT_BASE = './assets/follow/fonts/';

  // ---------- 字体按需加载（只插入一次 @font-face <style>） ----------
  var FACES = [
    { family: 'SHSans', weight: 900, file: 'SourceHanSansCN-Heavy.woff2' },
    { family: 'SHSerif', weight: 900, file: 'SourceHanSerifCN-Heavy.woff2' },
    { family: 'Smiley', weight: 400, file: 'SmileySans-Oblique.woff2' },
    { family: 'KuaiLe', weight: 400, file: 'ZCOOLKuaiLe-Regular.woff2' }
  ];
  var fontsReady = false;
  function ensureFonts() {
    if (fontsReady) return Promise.resolve();
    var css = '';
    FACES.forEach(function (f) {
      css += "@font-face{font-family:'" + f.family + "';src:url('" + FONT_BASE + f.file +
        "?v=" + V + "') format('woff2');font-weight:" + f.weight + ";font-display:swap;}\n";
    });
    var st = document.createElement('style');
    st.textContent = css;
    document.head.appendChild(st);
    var loads = FACES.map(function (f) {
      if (document.fonts && document.fonts.load) {
        return document.fonts.load(f.weight + ' 48px "' + f.family + '"').catch(function () {});
      }
      return Promise.resolve();
    });
    return Promise.all(loads).then(function () { fontsReady = true; });
  }

  // ---------- 工具 ----------
  function deep(o) { return JSON.parse(JSON.stringify(o)); }
  function TS(id) {
    for (var i = 0; i < P.textStyles.length; i++) if (P.textStyles[i].id === id) return P.textStyles[i];
    return P.textStyles[0];
  }
  function CP(id) {
    for (var i = 0; i < P.components.length; i++) if (P.components[i].id === id) return P.components[i];
    return P.components[0];
  }
  function hexId(c) { return String(c || '').replace('#', '').toLowerCase(); }

  var uidN = 0;
  function uid() { return 'l' + (++uidN); }

  // ---------- 标题分词：headline → runs（每行第二个词块蓝色） ----------
  var RE_LATIN = /[A-Za-z0-9]/, RE_CJK = /[\u3400-\u9fff\uf900-\ufaff]/,
      RE_SEP = /[\s，。！？、；：,.!?;:—…·()（）\[\]【】"“”'‘’！？]/;

  // 一行 → 词块数组：按空格/标点/中英文·数字边界切；连续英文或数字绝不拆开；中文串按 2–4 字词块
  function tokenizeLine(line) {
    var s = String(line || '');
    var units = []; // [{text, latin}] 连续同类的最小单元
    var i = 0;
    while (i < s.length) {
      var ch = s[i];
      if (RE_SEP.test(ch)) { i++; continue; } // 空格/标点只作切分点
      var latin = RE_LATIN.test(ch);
      var j = i;
      while (j < s.length && !RE_SEP.test(s[j]) && RE_LATIN.test(s[j]) === latin) j++;
      units.push({ text: s.slice(i, j), latin: latin });
      i = j;
    }
    // 中文长串切成 2–4 字词块
    var words = [];
    units.forEach(function (u) {
      if (u.latin || u.text.length <= 4) { words.push(u.text); return; }
      var rest = u.text;
      while (rest.length > 4) {
        var take = (rest.length === 5 || rest.length === 7) ? 2 : 3;
        words.push(rest.slice(0, take));
        rest = rest.slice(take);
      }
      if (rest.length) words.push(rest);
    });
    return words;
  }

  // 找一个适合换行的切点：优先中文标点/空格，其次中英边界，避免切断英文单词
  function findLineCut(s) {
    var m = s.slice(1, -1).match(/[，。！？；、：,.!?;:]|\s+/);
    if (m && m.index != null) return m.index + m[0].length;
    var mid = Math.ceil(s.length / 2);
    for (var d = 0; d < s.length; d++) {
      if (mid + d < s.length && RE_LATIN.test(s[mid + d]) !== RE_LATIN.test(s[mid + d - 1])) return mid + d;
      if (mid - d > 0 && RE_LATIN.test(s[mid - d]) !== RE_LATIN.test(s[mid - d - 1])) return mid - d;
    }
    var cut = mid;
    while (cut > 1 && cut < s.length - 1 && RE_LATIN.test(s[cut]) && RE_LATIN.test(s[cut - 1])) cut--;
    return cut;
  }

  function splitTitleRuns(text) {
    var t = String(text || '').trim();
    if (!t) t = '写下你的标题';
    // 「/」或换行 → 行；滤掉空段，不产生空行
    var lines = t.split(/[\n\/]+/).map(function (s) { return s.trim(); }).filter(Boolean);
    if (!lines.length) lines = ['写下你的标题'];
    if (lines.length === 1 && lines[0].length > 9) {
      var s = lines[0], cut = findLineCut(s);
      lines = [s.slice(0, cut), s.slice(cut)];
    }
    lines = lines.slice(0, 2);
    var BLUE = '#0C44F9';
    var runs = [];
    lines.forEach(function (line, li) {
      var words = tokenizeLine(line);
      if (li > 0 && runs.length) runs.push({ text: '\n', color: '#000000' });
      if (!words.length) words = [line];
      if (words.length >= 2) {
        runs.push({ text: words[0], color: '#000000' });
        runs.push({ text: words[1], color: BLUE });
        if (words.length > 2) runs.push({ text: words.slice(2).join(''), color: '#000000' });
      } else if (words[0] && !RE_LATIN.test(words[0]) && words[0].length > 1) {
        var half = Math.ceil(words[0].length / 2);
        runs.push({ text: words[0].slice(0, half), color: '#000000' });
        runs.push({ text: words[0].slice(half), color: BLUE });
      } else {
        runs.push({ text: words[0] || line, color: '#000000' });
      }
    });
    return runs;
  }

  // ---------- 字效预设应用 ----------
  function applyTextStyle(l, id) {
    var t = TS(id);
    l.presetId = t.id;
    l.textStyle = t.id;
    l.font = t.font;
    l.weight = t.weight;
    if (t.size) l.size = t.size;
    l.strokes = deep(t.strokes);
    l.shadow = t.shadow ? deep(t.shadow) : { x: 0, y: 0, blur: 0, color: 'rgba(0,0,0,.25)', on: false };
    if (t.shadow) l.shadow.on = true;
    if (!l.runs) l.runs = [{ text: '双击编辑文字', color: t.defaultColor }];
  }

  function layerFromPreset(p, overrides) {
    var l = deep(p.defaults);
    l.id = uid();
    l.type = p.type === 'imageCard' ? 'image' : p.type;
    l.name = p.name + ' ' + (l.text || '');
    l.x = 0; l.y = 0; l.rot = 0;
    l.visible = true; l.locked = false;
    l.presetId = p.id;
    if (l.type === 'image') l.crop = { scale: 1, ox: 0, oy: 0 };
    if (overrides) for (var k in overrides) l[k] = overrides[k];
    return l;
  }

  // ---------- 编辑器状态（每次 open 重建） ----------
  var root = null, doc = null, sel = null, opts = null;
  var refOn = false, refHold = false, scale = 1;
  var hist = [], hi = -1;
  var curSheet = null;
  var runSelIdx = 0;
  var exportOpen = false;
  var TSDW_SEQ = 0;

  function buildDoc(layoutId) {
    var lid = layoutId || (opts && opts.layout) || 'simple';
    var ly = null;
    P.layouts.forEach(function (x) { if (x.id === lid) ly = x; });
    if (!ly) ly = P.layouts[0];
    var ctx = {
      headline: (opts && opts.headline) || '',
      whyClick: (opts && opts.whyClick) || '',
      bg: opts && opts.bgColor,
      uid: uid, deep: deep, CP: CP, TS: TS,
      splitTitleRuns: splitTitleRuns
    };
    return ly.build(ctx);
  }

  function findLayer(id) {
    for (var i = 0; i < doc.layers.length; i++) if (doc.layers[i].id === id) return doc.layers[i];
    return null;
  }
  function selLayer() { return sel ? findLayer(sel) : null; }
  function layerIndex(l) { return doc.layers.indexOf(l); }

  // ---------- 历史 ----------
  function pushHist() {
    var snap = JSON.stringify(doc);
    if (hist[hi] === snap) return;
    hist = hist.slice(0, hi + 1);
    hist.push(snap);
    if (hist.length > 50) hist.shift();
    hi = hist.length - 1;
    updHistBtns();
  }
  function restore(i) {
    hi = i;
    doc = JSON.parse(hist[hi]);
    if (sel && !findLayer(sel)) sel = null;
    render(); updHistBtns();
    // 撤销后面板按当前 sel 重建（图层已删则关闭）
    if (curSheet === 'layers') buildLayersPanel();
    else if (curSheet) {
      if (selLayer()) openSheet(curSheet);
      else closeSheet();
    }
  }
  function updHistBtns() {
    $('fm-undo').disabled = hi <= 0;
    $('fm-redo').disabled = hi >= hist.length - 1;
  }

  // ---------- 渲染：图层 ----------
  function fontCss(l) {
    var f = C.FONTS.filter(function (x) { return x.id === l.font; })[0] || C.FONTS[0];
    return 'font-family:' + f.css + ';font-weight:' + (l.weight || f.weight) + ';';
  }

  function buildTextLines(l) {
    var lines = [[]];
    (l.runs || []).forEach(function (r) {
      var parts = String(r.text == null ? '' : r.text).split('\n');
      parts.forEach(function (p, i) {
        if (i > 0) lines.push([]);
        if (p) lines[lines.length - 1].push({ text: p, color: r.color || l.color || '#000' });
      });
    });
    return lines;
  }

  // SVG <text> 渲染标题：多层描边 = 多个 <text> 副本从外到内叠放
  function renderText(l) {
    var NS = 'http://www.w3.org/2000/svg';
    var el = document.createElement('div');
    var lines = buildTextLines(l);
    var strokeList = (l.strokes || []).filter(function (s) { return s.on !== false && s.width > 0; });

    var cums = [], cum = 0;
    strokeList.forEach(function (s) { cum += s.width; cums.push(cum); });

    var copies = [];
    for (var i = strokeList.length - 1; i >= 0; i--) {
      copies.push({ color: strokeList[i].color, w: cums[i] * 2, fill: false });
    }
    copies.push({
      color: strokeList.length ? strokeList[0].color : null,
      w: strokeList.length ? strokeList[0].width * 2 : 0,
      fill: true
    });

    var f = C.FONTS.filter(function (x) { return x.id === l.font; })[0] || C.FONTS[0];
    var weight = l.weight || f.weight;
    var lineH = l.size * l.lineHeight;
    var ascent = l.size * 0.8;

    var fid = 'tsdw' + l.id + '_' + (++TSDW_SEQ);
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('overflow', 'visible');
    svg.style.cssText = 'position:absolute;left:0;top:0;overflow:visible;display:block;';

    var defs = document.createElementNS(NS, 'defs');
    if (l.shadow && l.shadow.on) {
      var filt = document.createElementNS(NS, 'filter');
      filt.setAttribute('id', fid);
      filt.setAttribute('x', '-30%'); filt.setAttribute('y', '-30%');
      filt.setAttribute('width', '160%'); filt.setAttribute('height', '160%');
      var ds = document.createElementNS(NS, 'feDropShadow');
      ds.setAttribute('dx', l.shadow.x || 0);
      ds.setAttribute('dy', l.shadow.y || 0);
      ds.setAttribute('stdDeviation', (l.shadow.blur || 0) / 2);
      ds.setAttribute('flood-color', l.shadow.color || 'rgba(0,0,0,.22)');
      filt.appendChild(ds);
      defs.appendChild(filt);
    }
    if (defs.firstChild) svg.appendChild(defs);

    var g = document.createElementNS(NS, 'g');
    copies.forEach(function (cp, ci) {
      lines.forEach(function (line, li) {
        var t = document.createElementNS(NS, 'text');
        t.setAttribute('x', 0);
        t.setAttribute('y', li * lineH + ascent);
        t.setAttribute('font-family', f.css);
        t.setAttribute('font-weight', weight);
        t.setAttribute('font-size', l.size);
        t.setAttribute('letter-spacing', (l.letterSpacing || 0) + 'px');
        t.setAttribute('stroke-linejoin', 'round');
        t.setAttribute('stroke-linecap', 'round');
        t.setAttribute('paint-order', 'stroke fill');
        if (cp.color && cp.w > 0) {
          t.setAttribute('stroke', cp.color);
          t.setAttribute('stroke-width', cp.w);
        }
        if (!cp.fill) t.setAttribute('fill', 'none');
        if (ci === 0 && l.shadow && l.shadow.on) t.setAttribute('filter', 'url(#' + fid + ')');
        line.forEach(function (seg) {
          var sp = document.createElementNS(NS, 'tspan');
          if (cp.fill) sp.setAttribute('fill', seg.color || l.color || '#000');
          sp.textContent = seg.text;
          t.appendChild(sp);
        });
        g.appendChild(t);
      });
    });
    svg.appendChild(g);
    el.appendChild(svg);
    return el;
  }

  function sizeTextLayer(layerEl, l) {
    var svg = layerEl.querySelector('svg');
    if (!svg) return;
    var g = svg.querySelector('g');
    var bb = g.getBBox();
    var strokeList = (l.strokes || []).filter(function (s) { return s.on !== false && s.width > 0; });
    var pad = 0;
    strokeList.forEach(function (s) { pad += s.width; });
    pad += 1;
    g.setAttribute('transform', 'translate(' + (pad - bb.x) + ',' + (pad - bb.y) + ')');
    l.w = Math.ceil(bb.width + pad * 2);
    l.h = Math.ceil(bb.height + pad * 2);
    svg.setAttribute('width', l.w);
    svg.setAttribute('height', l.h);
    layerEl.style.width = l.w + 'px';
    layerEl.style.height = l.h + 'px';
  }

  // 标题等 autoFit 文字：最长一行超画布宽 90% 时自动缩字号（拖拽缩放中的图层跳过）
  function fitTextLayer(el, l) {
    if (!l.autoFit || l.type !== 'text') return;
    for (var i = 0; i < 5; i++) {
      if (l.w <= CW * 0.9) break;
      var k = CW * 0.9 / l.w;
      var ns = Math.max(10, Math.floor(l.size * k * 10) / 10);
      if (ns >= l.size) break;
      l.size = ns;
      var child = el.firstChild;
      if (child) el.removeChild(child);
      el.appendChild(renderText(l));
      sizeTextLayer(el, l);
    }
  }

  function renderBrush(l) {
    var el = document.createElement('div');
    el.style.cssText = 'width:100%;height:100%;opacity:' + (l.opacity == null ? 1 : l.opacity) + ';';
    el.innerHTML = C.brushSVG(l.shape || 'sweep', l.color || '#FDD758', l.id);
    return el;
  }

  function renderPill(l) {
    var el = document.createElement('div');
    var sh = [];
    if (l.halo > 0) sh.push('0 0 0 ' + l.halo + 'px #FFFFFF');
    el.style.cssText =
      'width:100%;height:100%;border-radius:999px;background:' + (l.bg || '#FFDA65') + ';' +
      (l.strokeWidth > 0 ? 'border:' + l.strokeWidth + 'px solid ' + (l.strokeColor || '#0A0A0A') + ';' : '') +
      (sh.length ? 'box-shadow:' + sh.join(',') + ';' : '') +
      'display:flex;align-items:center;justify-content:center;gap:4px;overflow:visible;';
    if (C.SHADOWS[l.shadow] && l.shadow !== 'none') el.style.filter = C.SHADOWS[l.shadow];
    if (l.icon) {
      var iw = Math.min(16, l.h - 10);
      var isv = l.iconFill ? C.iconSVGFill(l.icon, iw, l.iconFill, 'style="flex:none;color:#1A1A1A"')
        : C.iconSVG(l.icon, iw, 'style="flex:none;color:#1A1A1A"');
      var tmp = document.createElement('div');
      tmp.innerHTML = isv;
      el.appendChild(tmp.firstChild);
    }
    var tx = document.createElement('span');
    tx.textContent = l.text || '';
    tx.style.cssText = fontCss(l) + 'font-size:' + l.size + 'px;line-height:1;white-space:nowrap;color:' + (l.textColor || '#111110') + ';';
    el.appendChild(tx);
    return el;
  }

  function renderImage(l) {
    var el = document.createElement('div');
    el.className = 'fm-img-wrap';
    el.style.cssText =
      'width:100%;height:100%;border-radius:' + (l.radius || 0) + 'px;' +
      'background:' + (l.borderColor || '#fff') + ';' +
      (l.border > 0 ? 'padding:' + l.border + 'px;' : '') +
      (l.outline ? 'box-shadow:0 0 0 1px ' + l.outline + ';' : '');
    if (C.SHADOWS[l.shadow] && l.shadow !== 'none') el.style.filter = C.SHADOWS[l.shadow];
    var box = document.createElement('div');
    box.style.cssText = 'width:100%;height:100%;overflow:hidden;border-radius:' + (l.radius || 0) + 'px;';
    if (!l.src) {
      // 灰色占位块：提示换自己的图
      box.style.cssText += 'background:#E9E6DF;display:flex;align-items:center;justify-content:center;';
      var ph = document.createElement('span');
      ph.textContent = '点面板「换图」';
      ph.style.cssText = 'font-size:10px;color:#9A988F;';
      box.appendChild(ph);
    } else {
      var img = document.createElement('img');
      img.src = l.src; img.draggable = false;
      img.style.cssText = 'width:100%;height:100%;object-fit:cover;pointer-events:none;' +
        'transform:scale(' + (l.crop ? l.crop.scale : 1) + ') translate(' + (l.crop ? l.crop.ox : 0) + '%,' + (l.crop ? l.crop.oy : 0) + '%);';
      box.appendChild(img);
    }
    el.appendChild(box);
    return el;
  }

  function renderBadge(l) {
    var el = document.createElement('div');
    el.style.cssText = 'position:relative;width:100%;height:100%;';
    var ow = (l.outer && l.outer.width) || 0;
    var iw = (l.inner && l.inner.width) || 0;
    var circ = document.createElement('div');
    circ.style.cssText =
      'width:100%;height:100%;border-radius:50%;box-sizing:border-box;background:' + (l.fill || '#FFF5E9') + ';' +
      (ow > 0 ? 'border:' + ow + 'px solid ' + (l.outer.color || '#FFFFFF') + ';' : '');
    if (C.SHADOWS[l.shadow] && l.shadow !== 'none') circ.style.filter = C.SHADOWS[l.shadow];
    var ring = document.createElement('div');
    ring.style.cssText =
      'position:absolute;box-sizing:border-box;border-radius:50%;pointer-events:none;' +
      'left:' + ow + 'px;top:' + ow + 'px;right:' + ow + 'px;bottom:' + ow + 'px;' +
      (iw > 0 ? 'border:' + iw + 'px solid ' + ((l.inner && l.inner.color) || 'transparent') + ';' : '');
    var isz = Math.round(l.r - ow);
    var ico = document.createElement('div');
    ico.style.cssText =
      'position:absolute;width:' + isz + 'px;height:' + isz + 'px;flex:none;' +
      'left:calc(50% - ' + (isz / 2) + 'px);top:calc(50% - ' + Math.round(isz * 0.9) + 'px);color:' + (l.iconColor || '#26252A') + ';';
    if (l.icon === 'graduation-cap') {
      ico.innerHTML = C.GRAD_CAP_SOLID;
      var sv = ico.firstChild;
      if (sv) { sv.style.width = '100%'; sv.style.height = '100%'; sv.style.display = 'block'; }
    } else {
      ico.innerHTML = C.iconSVG(l.icon || 'star', isz);
    }
    var tx = document.createElement('div');
    tx.className = 'fm-b-txt';
    tx.textContent = l.text || '';
    tx.style.cssText = 'position:absolute;left:50%;top:calc(50% + 10px);transform:translateX(-50%);' +
      fontCss(l) + 'font-size:' + (l.size || 15) + 'px;line-height:1;white-space:nowrap;color:' + (l.iconColor || '#26252A') + ';';
    el.appendChild(circ);
    el.appendChild(ring);
    el.appendChild(ico);
    el.appendChild(tx);
    return el;
  }

  var RENDERERS = { text: renderText, brush: renderBrush, pill: renderPill, image: renderImage, badge: renderBadge };

  function renderDocInto(canvasEl, d, clean) {
    canvasEl.innerHTML = '';
    canvasEl.style.background = d.bg.color;
    d.layers.forEach(function (l, i) {
      if (l.visible === false) return;
      var el = document.createElement('div');
      el.className = 'fm-layer layer';
      el.dataset.id = l.id;
      el.style.cssText =
        'left:' + l.x + 'px;top:' + l.y + 'px;width:' + l.w + 'px;height:' + l.h + 'px;' +
        'transform:rotate(' + (l.rot || 0) + 'deg);transform-origin:center;z-index:' + (i + 1) + ';';
      var child = (RENDERERS[l.type] || renderText)(l);
      if (clean) child.style.pointerEvents = 'none';
      el.appendChild(child);
      if (clean) el.style.pointerEvents = 'none';
      canvasEl.appendChild(el);
      if (l.type === 'text') { sizeTextLayer(el, l); if (!(drag && drag.l === l)) fitTextLayer(el, l); }
    });
    if (d.bg.paper) {
      var p = document.createElement('div');
      p.className = 'fm-paper-tex';
      canvasEl.appendChild(p);
    }
  }

  function $f(id) { return root.querySelector('#' + id); }
  function $(id) { return document.getElementById(id); }

  function render() {
    renderDocInto($('fm-canvas'), doc, false);
    if (layoutStack()) renderDocInto($('fm-canvas'), doc, false);
    updateRef();
    updateOverlay();
    layout();
  }

  // 带标记的组件（胶囊/徽章等）放到标题实际包围盒下方 gap 像素处；返回是否改动
  function layoutStack() {
    var a = null;
    doc.layers.forEach(function (l) { if (l.stackAnchor && l.type === 'text') a = l; });
    if (!a) return false;
    var bottom = a.y + a.h, changed = false;
    doc.layers.forEach(function (l) {
      if (l.stackAfterTitle == null || l.id === a.id) return;
      var ny = Math.round(bottom + l.stackAfterTitle);
      if (l.y !== ny) { l.y = ny; changed = true; }
      if (l.stackAlignX && l.x !== a.x) { l.x = a.x; changed = true; }
    });
    return changed;
  }

  // ---------- 布局 / 缩放 ----------
  function layout() {
    var area = $('fm-stage-area');
    if (!area) return;
    var r = area.getBoundingClientRect();
    var ah = r.height - (exportOpen ? 120 : 8);
    var aw = r.width - 16;
    if (exportOpen) {
      scale = Math.max(0.5, Math.min(320 / CW, ah / CH));
    } else {
      scale = Math.max(0.4, Math.min(aw / CW, ah / CH, 1.12));
    }
    var wrap = $('fm-canvas-wrap');
    // wrap 缩到实际尺寸并 flex 居中，画布 transform 等比缩放 → 任意视口宽度下水平居中
    wrap.style.width = (CW * scale) + 'px';
    wrap.style.height = (CH * scale) + 'px';
    var cv = $('fm-canvas');
    cv.style.transform = 'scale(' + scale + ')';
    cv.style.transformOrigin = '0 0';
    updateOverlay();
  }

  function updateRef() {
    var rl = $('fm-ref-layer');
    var on = (refOn || refHold) && !exportOpen;
    rl.classList.toggle('on', on);
    rl.style.opacity = refHold ? '1' : '0.55';
  }

  // ---------- 选中 overlay ----------
  function updateOverlay() {
    var overlay = $('fm-overlay');
    overlay.innerHTML = '';
    var l = selLayer();
    if (!l || exportOpen) return;
    if (l.visible === false) return;
    var k = scale;
    var bx = l.x, by = l.y, bw = l.w, bh = l.h;
    var box = document.createElement('div');
    box.className = 'fm-sel-box';
    box.style.cssText =
      'left:' + bx * k + 'px;top:' + by * k + 'px;width:' + bw * k + 'px;height:' + bh * k + 'px;' +
      'transform:rotate(' + (l.rot || 0) + 'deg);';
    overlay.appendChild(box);

    var cx = (bx + bw / 2) * k, cy = (by + bh / 2) * k;
    var rad = (l.rot || 0) * Math.PI / 180;
    var cos = Math.cos(rad), sin = Math.sin(rad);
    function pt(hx, hy) {
      var dx = hx * bw * k / 2, dy = hy * bh * k / 2;
      return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos];
    }
    [['nw', -1, -1], ['ne', 1, -1], ['sw', -1, 1], ['se', 1, 1]].forEach(function (c) {
      var p = pt(c[1], c[2]);
      var h = document.createElement('div');
      h.className = 'fm-handle';
      h.dataset.corner = c[0];
      h.style.left = p[0] + 'px'; h.style.top = p[1] + 'px';
      overlay.appendChild(h);
    });
    var tp = pt(0, -1);
    var dirx = sin, diry = -cos;
    var rp = [tp[0] + dirx * 20, tp[1] + diry * 20];
    var stem = document.createElement('div');
    stem.className = 'fm-rot-stem';
    stem.style.cssText = 'left:' + tp[0] + 'px;top:' + tp[1] + 'px;height:20px;' +
      'transform-origin:0 0;transform:rotate(' + ((l.rot || 0) + 180) + 'deg);';
    overlay.appendChild(stem);
    var rh = document.createElement('div');
    rh.className = 'fm-handle fm-rot';
    rh.dataset.corner = 'rot';
    rh.style.left = rp[0] + 'px'; rh.style.top = rp[1] + 'px';
    rh.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="#27362F" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>';
    overlay.appendChild(rh);
  }

  // ---------- 交互：拖动 / 吸附 / 缩放 / 旋转 ----------
  var drag = null;
  function logical(e) {
    var r = $('fm-canvas').getBoundingClientRect();
    return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
  }

  function startDrag(e, mode) {
    e.preventDefault(); e.stopPropagation();
    var l = selLayer(); if (!l) return;
    var p = logical(e);
    drag = {
      mode: mode, l: l, p0: p,
      x0: l.x, y0: l.y, w0: l.w, h0: l.h, rot0: l.rot || 0,
      cx: l.x + l.w / 2, cy: l.y + l.h / 2
    };
    window.addEventListener('pointermove', onDrag);
    window.addEventListener('pointerup', endDrag);
  }

  function snapVal(v, targets, thr) {
    var best = null, bd = thr;
    targets.forEach(function (t) {
      var d = Math.abs(v - t);
      if (d < bd) { bd = d; best = t; }
    });
    return best == null ? v : best;
  }

  function showGuides(list) {
    var g = $('fm-guides');
    g.innerHTML = '';
    list.forEach(function (gd) {
      var el = document.createElement('div');
      el.className = 'fm-guide ' + gd[0];
      if (gd[0] === 'v') el.style.left = gd[1] * scale + 'px';
      else el.style.top = gd[1] * scale + 'px';
      g.appendChild(el);
    });
  }

  function onDrag(e) {
    if (!drag) return;
    var l = drag.l;
    var p = logical(e);
    if (drag.mode === 'move') {
      if (l.type === 'image' && l.cropDrag) {
        l.crop = l.crop || { scale: 1, ox: 0, oy: 0 };
        l.crop.ox = Math.max(-40, Math.min(40, (l.crop.ox || 0) + (p.x - drag.p0.x) * 0.2));
        l.crop.oy = Math.max(-40, Math.min(40, (l.crop.oy || 0) + (p.y - drag.p0.y) * 0.2));
        drag.p0 = p;
        render();
        return;
      }
      var others = doc.layers.filter(function (o) { return o !== l; });
      var xs = [CW / 2], ys = [CH / 2];
      others.forEach(function (o) {
        xs.push(o.x, o.x + o.w / 2, o.x + o.w);
        ys.push(o.y, o.y + o.h / 2, o.y + o.h);
      });
      var nx = drag.x0 + (p.x - drag.p0.x);
      var ny = drag.y0 + (p.y - drag.p0.y);
      var guides = [];
      var sx = snapVal(nx, xs, 5), sx2 = snapVal(nx + l.w / 2, xs, 5) - l.w / 2, sx3 = snapVal(nx + l.w, xs, 5) - l.w;
      var sy = snapVal(ny, ys, 5), sy2 = snapVal(ny + l.h / 2, ys, 5) - l.h / 2, sy3 = snapVal(ny + l.h, ys, 5) - l.h;
      if (sx !== nx) { nx = sx; guides.push(['v', sx]); }
      else if (sx2 !== nx + l.w / 2) { nx = sx2; guides.push(['v', sx2 + l.w / 2]); }
      else if (sx3 !== nx + l.w) { nx = sx3; guides.push(['v', sx3 + l.w]); }
      if (sy !== ny) { ny = sy; guides.push(['h', sy]); }
      else if (sy2 !== ny + l.h / 2) { ny = sy2; guides.push(['h', sy2 + l.h / 2]); }
      else if (sy3 !== ny + l.h) { ny = sy3; guides.push(['h', sy3 + l.h]); }
      l.x = Math.round(nx * 10) / 10; l.y = Math.round(ny * 10) / 10;
      showGuides(guides);
      render();
    } else if (drag.mode === 'scale') {
      var c0 = {
        nw: [drag.x0 + drag.w0, drag.y0 + drag.h0],
        ne: [drag.x0, drag.y0 + drag.h0],
        sw: [drag.x0 + drag.w0, drag.y0],
        se: [drag.x0, drag.y0]
      }[drag.l._c || 'nw'];
      var ratioX = Math.abs(p.x - c0[0]) / Math.max(4, Math.abs(drag.p0.x - c0[0]));
      var ratioY = Math.abs(p.y - c0[1]) / Math.max(4, Math.abs(drag.p0.y - c0[1]));
      var ratio = Math.max(0.2, Math.min(3, (ratioX + ratioY) / 2));
      l.w = Math.round(drag.w0 * ratio * 10) / 10;
      l.h = Math.round(drag.h0 * ratio * 10) / 10;
      l.x = c0[0] + (drag.x0 - c0[0]) * ratio;
      l.y = c0[1] + (drag.y0 - c0[1]) * ratio;
      if (l.type === 'text') { l.size = Math.max(8, Math.round(drag.size0 * ratio)); }
      if (l.type === 'badge') { l.r = Math.round(drag.w0 * ratio / 2); }
      render();
    } else if (drag.mode === 'rot') {
      var ang = Math.atan2(p.y - drag.cy, p.x - drag.cx) * 180 / Math.PI + 90;
      var snapA = Math.round(ang / 90) * 90;
      if (Math.abs(ang - snapA) < 4) ang = snapA;
      l.rot = Math.round(ang * 10) / 10;
      render();
    }
  }

  function endDrag() {
    if (drag) {
      showGuides([]);
      delete drag.l.size0;
      delete drag.l._c;
      pushHist();
      drag = null;
    }
    window.removeEventListener('pointermove', onDrag);
    window.removeEventListener('pointerup', endDrag);
  }

  function bindCanvasInteract() {
    var canvas = $('fm-canvas');
    canvas.addEventListener('pointerdown', function (e) {
      var el = e.target.closest('.layer');
      if (!el) { select(null); if (sheetOpen()) closeSheet(); return; }
      select(el.dataset.id);
      var l = selLayer();
      if (l && curSheet !== 'layers') {
        var want = l.type === 'text' ? 'text' : l.type;
        if (curSheet !== want) openSheetFor(l);
      }
      if (e.target.closest('.fm-handle')) return;
      startDrag(e, 'move');
    });

    var overlay = $('fm-overlay');
    overlay.addEventListener('pointerdown', function (e) {
      var h = e.target.closest('.fm-handle');
      if (!h) return;
      var l = selLayer(); if (!l) return;
      if (h.dataset.corner === 'rot') { startDrag(e, 'rot'); }
      else {
        l._c = { nw: 'se', ne: 'sw', sw: 'ne', se: 'nw' }[h.dataset.corner];
        l.size0 = l.size;
        startDrag(e, 'scale');
      }
    });
  }

  function select(id) {
    sel = id;
    updateOverlay();
    if (selLayer() && curSheet === 'layers') buildLayersPanel();
  }

  // ---------- toast ----------
  function toast(msg) {
    var t = $('fm-toast');
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(t._t);
    t._t = setTimeout(function () { t.classList.remove('on'); }, 1600);
  }

  function insertLayer(l, openPanel) {
    doc.layers.push(l);
    sel = l.id;
    pushHist();
    render();
    if (openPanel) openSheetFor(l);
  }

  function centerLayer(l) {
    l.x = Math.round((CW - l.w) / 2); l.y = Math.round((CH - l.h) / 2);
    return l;
  }

  // ---------- 顶栏 / 工具栏 ----------
  function bindChrome() {
    $('fm-back').addEventListener('click', close);
    $('fm-undo').addEventListener('click', function () { if (hi > 0) restore(hi - 1); });
    $('fm-redo').addEventListener('click', function () { if (hi < hist.length - 1) restore(hi + 1); });
    $('fm-export').addEventListener('click', function () { openExportView(); });
    $('fm-tool-text').addEventListener('click', function () {
      var l = {
        id: uid(), type: 'text', name: '文字 新文字', x: 50, y: 180, w: 200, h: 40, rot: 0,
        visible: true, locked: false,
        runs: [{ text: '双击编辑文字', color: TS('heavy3').defaultColor }],
        color: TS('heavy3').defaultColor, font: 'SHSans', weight: 900, size: 28,
        letterSpacing: 0, lineHeight: 1.15, align: 'left', autoFit: true,
        strokes: [], shadow: { x: 0, y: 0, blur: 0, color: 'rgba(0,0,0,.25)', on: false }
      };
      applyTextStyle(l, 'heavy3');
      insertLayer(centerLayer(l), true);
    });
    $('fm-tool-comp').addEventListener('click', function () { openSheet('insert'); });
    $('fm-tool-layer').addEventListener('click', function () { openSheet('layers'); });
    $('fm-tool-ref').addEventListener('click', function () { toggleRef(); });
    $('fm-chip-ref').addEventListener('click', toggleRef);
    $('fm-chip-hold').addEventListener('pointerdown', function () {
      refHold = true; updateRef();
    });
    window.addEventListener('pointerup', refHoldUp);
    window.addEventListener('pointercancel', refHoldUp);
    // 换图文件选择
    $('fm-file-input').addEventListener('change', onFilePicked);
  }

  function refHoldUp() {
    if (refHold) { refHold = false; updateRef(); }
  }

  function toggleRef() {
    refOn = !refOn;
    updateRef();
    $('fm-chip-ref').classList.toggle('on', refOn);
    $('fm-chip-ref-eye').innerHTML = refOn ? C.uiIcon('eye', 14) : C.uiIcon('eyeOff', 14);
  }

  // ---------- 弹层 ----------
  function sheetOpen() { return !!curSheet; }

  function openSheet(type) {
    curSheet = type;
    var t = $('fm-sheet-title');
    t.textContent = '';
    if (type === 'text') { t.textContent = '字效'; buildTextPanel(); }
    else if (type === 'pill') { t.textContent = '胶囊'; buildPillPanel(); }
    else if (type === 'image') { t.textContent = '图片'; buildImagePanel(); }
    else if (type === 'badge') { t.textContent = '徽章'; buildBadgePanel(); }
    else if (type === 'brush') { t.textContent = '笔刷'; buildBrushPanel(); }
    else if (type === 'layers') { t.textContent = '图层'; buildLayersPanel(); }
    else if (type === 'insert') { t.textContent = '添加组件'; buildInsertSheet(); }
    $('fm-sheet').classList.add('on');
    $('fm-sheet-mask').classList.add('on');
    if (!exportOpen) $('fm-stage').style.paddingBottom = '0px';
    var n = 0;
    (function lo() { layout(); if (++n < 22) requestAnimationFrame(lo); })();
  }

  function closeSheet() {
    curSheet = null;
    $('fm-sheet').classList.remove('on');
    $('fm-sheet-mask').classList.remove('on');
    $('fm-stage').style.paddingBottom = '0px';
    removeLayerActions();
    setTimeout(layout, 260);
  }

  function openSheetFor(l) {
    openSheet(l.type === 'text' ? 'text' : l.type);
  }

  // ---------- 面板控件辅助 ----------
  function segRow(id, opts, cur) {
    var h = '<div class="fm-seg" id="' + id + '">';
    opts.forEach(function (o) {
      h += '<button data-v="' + o[0] + '"' + (o[0] === cur ? ' class="sel"' : '') + '>' + o[1] + '</button>';
    });
    return h + '</div>';
  }
  function bindSeg(rootEl, id, fn) {
    var seg = rootEl.querySelector('#' + id);
    if (!seg) return;
    seg.querySelectorAll('button').forEach(function (b) {
      b.addEventListener('click', function () {
        seg.querySelectorAll('button').forEach(function (x) { x.classList.remove('sel'); });
        b.classList.add('sel');
        fn(b.dataset.v);
        pushHist();
      });
    });
  }

  // ---------- 字效面板 ----------
  function tsSample(t) {
    var sz = 26;
    var k = sz / (t.size || sz);
    var tmp = {
      id: 'samp-' + t.id, type: 'text',
      runs: [{ text: '爆款', color: t.defaultColor }],
      color: t.defaultColor, font: t.font, weight: t.weight, size: sz,
      letterSpacing: 0, lineHeight: 1, align: 'left',
      strokes: deep(t.strokes), shadow: t.shadow ? deep(t.shadow) : null
    };
    tmp.strokes.forEach(function (s) { s.on = true; s.width = s.width * k; });
    if (tmp.shadow) {
      tmp.shadow.on = true;
      tmp.shadow.x *= k; tmp.shadow.y *= k; tmp.shadow.blur *= k;
    }
    var el = renderText(tmp);
    return { el: el, tmp: tmp };
  }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  function buildTextPanel() {
    var l = selLayer();
    var b = $('fm-sheet-body');
    if (!l || l.type !== 'text') { b.innerHTML = '<div class="fm-hint">选中一个文字图层后可编辑字效</div>'; return; }
    var plain = (l.runs || []).map(function (r) { return r.text; }).join('');

    var chips = '', chipN = 0;
    (l.runs || []).forEach(function (r, i) {
      if (!r.text || r.text === '\n') return;
      var parts = r.text.split('\n').filter(function (s) { return s; });
      parts.forEach(function (p) {
        chips += '<button class="fm-run-chip' + (i === runSelIdx ? ' sel' : '') + '" data-ri="' + i + '" data-testid="run-' + chipN + '">' +
          '<span class="fm-cd" style="background:' + (r.color || '#000') + '"></span>' + esc(p) + '</button>';
        chipN++;
      });
    });

    var cards = '';
    P.textStyles.forEach(function (t) {
      cards += '<button class="fm-ts-card' + (l.presetId === t.id ? ' sel' : '') + '" data-ts="' + t.id + '" data-testid="ts-' + t.id + '">' +
        '<span class="fm-ts-sample"></span><span class="fm-ts-name">' + t.name + '</span></button>';
    });

    var hl = '';
    P.highlightColors.forEach(function (c) {
      hl += '<button class="fm-swatch fm-hl-dot' + (selRunColor(l) === c ? ' sel' : '') + '" data-c="' + c + '" data-testid="hl-' + hexId(c) + '" style="background:' + c + '"></button>';
    });

    b.innerHTML =
      '<div class="fm-sec"><input class="fm-input fm-ta-input" id="fm-ta-text" data-testid="text-input" value="' +
      esc(plain).replace(/\n/g, '/') + '"></div>' +

      '<div class="fm-sec"><div class="fm-sec-label">字效</div><div class="fm-ts-row" id="fm-ts-row">' + cards + '</div></div>' +

      '<div class="fm-sec"><div class="fm-sec-label">分词</div>' +
      '<div class="fm-run-chips" id="fm-run-chips">' + chips + '</div>' +
      (chipN ? '<div class="fm-pal" id="fm-run-pal" style="margin-top:6px">' + hl + '</div>' : '') +
      '</div>';

    var ta = $('fm-ta-text');
    ta.addEventListener('change', function () {
      var nt = ta.value.replace(/\//g, '\n')
        .split('\n').map(function (s) { return s.trim(); }).filter(Boolean).join('\n');
      rebuildRuns(l, nt);
      pushHist(); render(); buildTextPanel();
    });

    $('fm-ts-row').querySelectorAll('.fm-ts-card').forEach(function (card) {
      var t = TS(card.dataset.ts);
      var s = tsSample(t);
      var box = card.querySelector('.fm-ts-sample');
      box.appendChild(s.el);
      sizeTextLayer(s.el, s.tmp);
      var sc = Math.min(70 / s.tmp.w, 30 / s.tmp.h, 1);
      box.style.width = s.tmp.w * sc + 'px';
      box.style.height = s.tmp.h * sc + 'px';
      s.el.style.transform = 'scale(' + sc + ')';
      s.el.style.transformOrigin = '0 0';
      card.addEventListener('click', function () {
        applyTextStyle(l, card.dataset.ts);
        pushHist(); render(); buildTextPanel();
      });
    });

    $('fm-run-chips').querySelectorAll('.fm-run-chip').forEach(function (ch) {
      ch.addEventListener('click', function () {
        runSelIdx = parseInt(ch.dataset.ri, 10);
        buildTextPanel();
      });
    });
    if (chipN) {
      $('fm-run-pal').querySelectorAll('.fm-swatch').forEach(function (sw) {
        sw.addEventListener('click', function () {
          var r = (l.runs || [])[runSelIdx];
          if (!r) return;
          r.color = sw.dataset.c;
          pushHist(); render(); buildTextPanel();
        });
      });
    }
  }

  function selRunColor(l) {
    var r = (l.runs || [])[runSelIdx];
    return r ? (r.color || '#000000') : null;
  }

  // 内容编辑（/ 为换行）→ 按旧分词颜色对齐重建 runs
  function rebuildRuns(l, newText) {
    var old = deep(l.runs || []);
    var runs = [];
    var pos = 0;
    old.forEach(function (r) {
      var t = (r.text || '').replace(/\n/g, '');
      if (!t) return;
      var idx = newText.indexOf(t, pos);
      if (idx < 0) idx = newText.indexOf(t);
      if (idx >= 0) {
        if (idx > pos) runs.push({ text: newText.slice(pos, idx), color: '#000000' });
        runs.push({ text: newText.slice(idx, idx + t.length), color: r.color || '#000' });
        pos = idx + t.length;
      }
    });
    if (pos < newText.length) runs.push({ text: newText.slice(pos), color: '#000000' });
    runs.forEach(function (r) {
      var i = newText.indexOf(r.text);
      if (i > 0 && newText[i - 1] === '\n') r.text = '\n' + r.text;
    });
    l.runs = runs.length ? runs : [{ text: newText, color: '#000000' }];
    runSelIdx = 0;
  }

  // ---------- 组件面板 ----------
  function compPreset(l) {
    return l.presetId ? CP(l.presetId) : null;
  }

  function compDots(colors, cur) {
    return colors.map(function (c) {
      return '<button class="fm-swatch' + (c === cur ? ' sel' : '') + '" data-c="' + c + '" data-testid="cc-' + hexId(c) + '" style="background:' + c + '"></button>';
    }).join('');
  }

  function iconGridHTML(icons, cur, useSolidCap) {
    return icons.map(function (n) {
      var sv = (useSolidCap && n === 'graduation-cap')
        ? '<span class="fm-solid-cap">' + C.GRAD_CAP_SOLID + '</span>'
        : C.iconSVG(n, 20);
      return '<button class="fm-icon-cell' + (cur === n ? ' sel' : '') + '" data-i="' + n + '">' + sv + '</button>';
    }).join('');
  }

  function buildPillPanel() {
    var l = selLayer();
    var b = $('fm-sheet-body');
    if (!l || l.type !== 'pill') { b.innerHTML = '<div class="fm-hint">选中一个胶囊后可编辑</div>'; return; }
    var p = compPreset(l);
    var icons = (p && p.icons) || [];
    var colors = (p && p.colors) || [];
    b.innerHTML =
      '<div class="fm-sec"><div class="fm-sec-label">文字</div>' +
      '<input class="fm-input" id="fm-pill-text" data-testid="comp-text" value="' + esc(l.text || '') + '"></div>' +
      (icons.length ? '<div class="fm-sec"><div class="fm-sec-label">图标</div><div class="fm-icon-grid" style="grid-template-columns:repeat(' + Math.min(icons.length, 6) + ',1fr)" id="fm-icon-grid">' +
        iconGridHTML(icons, l.icon, false) + '</div></div>' : '') +
      (colors.length ? '<div class="fm-sec"><div class="fm-sec-label">颜色</div><div class="fm-pal" id="fm-pill-bg">' +
        compDots(colors, l.bg) + '</div></div>' : '');

    $('fm-pill-text').addEventListener('change', function () {
      l.text = $('fm-pill-text').value;
      pushHist(); render();
    });
    $('fm-pill-bg').querySelectorAll('.fm-swatch').forEach(function (sw) {
      sw.addEventListener('click', function () {
        l.bg = sw.dataset.c;
        sw.parentNode.querySelectorAll('.fm-swatch').forEach(function (x) { x.classList.remove('sel'); });
        sw.classList.add('sel');
        pushHist(); render();
      });
    });
    $('fm-icon-grid').querySelectorAll('.fm-icon-cell').forEach(function (cell) {
      cell.addEventListener('click', function () {
        l.icon = cell.dataset.i;
        cell.parentNode.querySelectorAll('.fm-icon-cell').forEach(function (x) { x.classList.remove('sel'); });
        cell.classList.add('sel');
        pushHist(); render();
      });
    });
  }

  // ---------- 图片面板：卡片样式 / 层级 / 换图 ----------
  function buildImagePanel() {
    var l = selLayer();
    var b = $('fm-sheet-body');
    if (!l || l.type !== 'image') { b.innerHTML = '<div class="fm-hint">选中一张图片后可编辑</div>'; return; }
    var cardPresets = P.components.filter(function (p) { return p.type === 'imageCard'; });
    var cards = cardPresets.map(function (p) {
      return '<button class="fm-card-style' + (l.presetId === p.id ? ' sel' : '') + '" data-p="' + p.id + '" data-testid="card-' + p.id + '">' + p.name + '</button>';
    }).join('');
    b.innerHTML =
      '<div class="fm-sec"><div class="fm-sec-label">卡片样式</div><div class="fm-card-row" id="fm-card-row">' + cards + '</div></div>' +
      '<div class="fm-sec"><div class="fm-sec-label">层级</div><div class="fm-zrow">' +
      '<button class="fm-zbtn" data-z="up">上移一层</button><button class="fm-zbtn" data-z="down">下移一层</button></div></div>' +
      '<div class="fm-sec"><div class="fm-sec-label">替换图片</div>' +
      '<button class="fm-btn-dark" id="fm-replace-img" data-testid="fm-replace-img">从相册选择</button></div>';

    $('fm-card-row').querySelectorAll('.fm-card-style').forEach(function (bt) {
      bt.addEventListener('click', function () {
        var d = CP(bt.dataset.p).defaults;
        l.presetId = bt.dataset.p;
        l.radius = d.radius; l.border = d.border;
        l.borderColor = d.borderColor; l.outline = d.outline; l.shadow = d.shadow;
        pushHist(); render(); buildImagePanel();
      });
    });
    $('fm-replace-img').addEventListener('click', function () {
      $('fm-file-input').click();
    });
    b.querySelectorAll('.fm-zbtn').forEach(function (zb) {
      zb.addEventListener('click', function () {
        var i = layerIndex(l);
        doc.layers.splice(i, 1);
        if (zb.dataset.z === 'up') doc.layers.splice(Math.min(doc.layers.length, i + 1), 0, l);
        else doc.layers.splice(Math.max(0, i - 1), 0, l);
        pushHist(); render();
      });
    });
  }

  // 换图文件选择：createImageBitmap 优先，失败降级 FileReader dataURL；
  // 缩到长边 ≤1600 存 dataURL（仅内存，不写 IndexedDB）
  function onFilePicked(e) {
    var file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    readImageFile(file).then(function (dataUrl) {
      var l = selLayer();
      if (l && l.type === 'image') {
        l.src = dataUrl;
        l.crop = { scale: 1, ox: 0, oy: 0 };
        pushHist(); render();
        toast('已替换');
      } else {
        var p = CP('card-soft');
        var nl = layerFromPreset(p, { src: dataUrl, name: '图片 我的图' });
        closeSheet();
        insertLayer(centerLayer(nl), true);
      }
    }).catch(function () {
      toast('图片读取失败');
    });
  }

  function readImageFile(file) {
    return new Promise(function (resolve, reject) {
      var URL_ = window.URL || window.webkitURL;
      var objUrl = null;
      var finish = function (bitmapOrImg, revoke) {
        try {
          var w = bitmapOrImg.width || bitmapOrImg.naturalWidth;
          var h = bitmapOrImg.height || bitmapOrImg.naturalHeight;
          var k = Math.min(1, 1600 / Math.max(w, h));
          var cv = document.createElement('canvas');
          cv.width = Math.round(w * k);
          cv.height = Math.round(h * k);
          cv.getContext('2d').drawImage(bitmapOrImg, 0, 0, cv.width, cv.height);
          resolve(cv.toDataURL('image/jpeg', 0.9));
        } catch (err) {
          reject(err);
        }
        if (bitmapOrImg.close) { try { bitmapOrImg.close(); } catch (e2) {} }
        if (revoke && URL_ && URL_.revokeObjectURL) URL_.revokeObjectURL(objUrl);
      };
      if (window.createImageBitmap && URL_ && URL_.createObjectURL) {
        objUrl = URL_.createObjectURL(file);
        window.createImageBitmap(objUrl).then(function (bmp) {
          finish(bmp, true);
        }).catch(function () {
          if (URL_.revokeObjectURL) URL_.revokeObjectURL(objUrl);
          fallback();
        });
      } else {
        fallback();
      }
      function fallback() {
        var fr = new FileReader();
        fr.onload = function () {
          var img = new Image();
          img.onload = function () { finish(img, false); };
          img.onerror = function () { reject(new Error('img')); };
          img.src = fr.result;
        };
        fr.onerror = function () { reject(new Error('read')); };
        fr.readAsDataURL(file);
      }
    });
  }

  // ---------- 徽章面板 ----------
  function buildBadgePanel() {
    var l = selLayer();
    var b = $('fm-sheet-body');
    if (!l || l.type !== 'badge') { b.innerHTML = '<div class="fm-hint">选中一个徽章后可编辑</div>'; return; }
    var p = compPreset(l);
    var icons = (p && p.icons) || ['graduation-cap', 'star', 'trophy', 'sparkles'];
    var colors = (p && p.colors) || [];
    b.innerHTML =
      '<div class="fm-sec"><div class="fm-sec-label">文字</div>' +
      '<input class="fm-input" id="fm-b-text" data-testid="comp-text" value="' + esc(l.text || '') + '"></div>' +
      '<div class="fm-sec"><div class="fm-sec-label">图标</div><div class="fm-icon-grid" style="grid-template-columns:repeat(4,1fr)" id="fm-b-icons">' +
      iconGridHTML(icons, l.icon, true) + '</div></div>' +
      (colors.length ? '<div class="fm-sec"><div class="fm-sec-label">颜色</div><div class="fm-pal" id="fm-b-fill">' +
        compDots(colors, l.fill) + '</div></div>' : '');

    $('fm-b-text').addEventListener('change', function () {
      l.text = $('fm-b-text').value;
      pushHist(); render();
    });
    $('fm-b-fill').querySelectorAll('.fm-swatch').forEach(function (sw) {
      sw.addEventListener('click', function () {
        l.fill = sw.dataset.c;
        sw.parentNode.querySelectorAll('.fm-swatch').forEach(function (x) { x.classList.remove('sel'); });
        sw.classList.add('sel');
        pushHist(); render();
      });
    });
    $('fm-b-icons').querySelectorAll('.fm-icon-cell').forEach(function (cell) {
      cell.addEventListener('click', function () {
        l.icon = cell.dataset.i;
        cell.parentNode.querySelectorAll('.fm-icon-cell').forEach(function (x) { x.classList.remove('sel'); });
        cell.classList.add('sel');
        pushHist(); render();
      });
    });
  }

  // ---------- 笔刷面板 ----------
  function buildBrushPanel() {
    var l = selLayer();
    var b = $('fm-sheet-body');
    if (!l || l.type !== 'brush') { b.innerHTML = '<div class="fm-hint">选中一个笔刷后可编辑</div>'; return; }
    var p = compPreset(l);
    var colors = (p && p.colors) || [l.color || '#FDD758'];
    b.innerHTML =
      '<div class="fm-sec"><div class="fm-sec-label">颜色</div><div class="fm-pal" id="fm-brush-color">' +
      compDots(colors, l.color) + '</div></div>';
    $('fm-brush-color').querySelectorAll('.fm-swatch').forEach(function (sw) {
      sw.addEventListener('click', function () {
        var cur = selLayer();
        if (!cur) return;
        cur.color = sw.dataset.c;
        sw.parentNode.querySelectorAll('.fm-swatch').forEach(function (x) { x.classList.remove('sel'); });
        sw.classList.add('sel');
        pushHist(); render();
      });
    });
  }

  // ---------- 图层面板 ----------
  var layerActions = null;
  function removeLayerActions() {
    if (layerActions) { layerActions.remove(); layerActions = null; }
  }
  /** 图层名随内容实时更新：类型 + 当前文字（无文字则用原名） */
  function layerLabel(l) {
    var kind = { text: '标题', pill: '胶囊', badge: '徽章', brush: '笔刷', image: '图片' }[l.type] || '';
    var t = '';
    if (l.type === 'text' && l.runs) t = l.runs.map(function (r) { return r.text; }).join('').replace(/\n/g, ' ');
    else if (l.text) t = l.text;
    t = String(t).trim();
    if (!t) return l.name || kind;
    if (t.length > 12) t = t.slice(0, 12) + '…';
    return kind + ' ' + t;
  }

  function buildLayersPanel() {
    var b = $('fm-sheet-body');
    var rows = '';
    for (var i = doc.layers.length - 1; i >= 0; i--) {
      var l = doc.layers[i];
      var th;
      if (l.type === 'image') th = l.src ? '<img src="' + l.src + '">' : C.uiIcon('image', 15);
      else if (l.type === 'text') th = C.uiIcon('text', 15);
      else if (l.type === 'pill') th = C.uiIcon('pill', 15);
      else if (l.type === 'badge') th = C.uiIcon('badge', 15);
      else th = C.uiIcon('brush', 15);
      rows += '<div class="fm-lrow' + (l.id === sel ? ' sel' : '') + '" data-id="' + l.id + '">' +
        '<span class="fm-lthumb">' + th + '</span>' +
        '<span class="fm-ln">' + esc(layerLabel(l)) + '</span>' +
        '<button class="fm-leye' + (l.visible === false ? ' off' : '') + '" data-eye="' + l.id + '">' +
        (l.visible === false ? C.uiIcon('eyeOff', 16) : C.uiIcon('eye', 16)) + '</button></div>';
    }
    b.innerHTML = '<div class="fm-layer-list" data-testid="fm-layers">' + rows + '</div>';

    b.querySelectorAll('.fm-lrow').forEach(function (r) {
      r.addEventListener('click', function (e) {
        if (e.target.closest('.fm-leye')) return;
        select(r.dataset.id);
        b.querySelectorAll('.fm-lrow').forEach(function (x) { x.classList.remove('sel'); });
        r.classList.add('sel');
      });
    });
    b.querySelectorAll('[data-eye]').forEach(function (ey) {
      ey.addEventListener('click', function () {
        var ly = findLayer(ey.dataset.eye);
        ly.visible = ly.visible === false;
        pushHist(); render(); buildLayersPanel();
      });
    });

    removeLayerActions();
    layerActions = document.createElement('div');
    layerActions.className = 'fm-layer-actions';
    layerActions.innerHTML =
      '<button class="fm-lact" data-a="copy">' + C.uiIcon('copy', 14) + '复制</button>' +
      '<button class="fm-lact danger" data-a="del">' + C.uiIcon('trash', 14) + '删除</button>' +
      '<button class="fm-lact" data-a="up">' + C.uiIcon('up', 14) + '上移</button>' +
      '<button class="fm-lact" data-a="down">' + C.uiIcon('down', 14) + '下移</button>';
    layerActions.querySelectorAll('.fm-lact').forEach(function (bt) {
      bt.addEventListener('click', function () { layerAction(bt.dataset.a); });
    });
    $('fm-sheet').appendChild(layerActions);
  }

  function layerAction(a) {
    var l = selLayer();
    if (!l) { toast('先选中一个图层'); return; }
    var i = layerIndex(l);
    if (a === 'copy') {
      var c = deep(l);
      c.id = uid();
      c.name = l.name.replace(/副本\d*$/, '') + '副本';
      c.x += 8; c.y += 8;
      doc.layers.splice(i + 1, 0, c);
      sel = c.id;
    } else if (a === 'del') {
      doc.layers.splice(i, 1);
      sel = null;
    } else if (a === 'up') {
      if (i < doc.layers.length - 1) doc.layers.splice(i + 1, 0, doc.layers.splice(i, 1)[0]);
    } else if (a === 'down') {
      if (i > 0) doc.layers.splice(i - 1, 0, doc.layers.splice(i, 1)[0]);
    }
    pushHist(); render(); buildLayersPanel();
  }

  // ---------- 添加组件（含模板切换） ----------
  function compThumb(p) {
    var l = layerFromPreset(p);
    l.id = 'th-' + p.id;
    if (l.type === 'image') l.crop = { scale: 1, ox: 0, oy: 0 };
    var R = { pill: renderPill, badge: renderBadge, brush: renderBrush, image: renderImage }[l.type];
    var s = Math.min(64 / l.w, 44 / l.h, 1);
    var el = document.createElement('div');
    el.className = 'fm-layer';
    el.style.cssText = 'left:0;top:0;width:' + l.w + 'px;height:' + l.h + 'px;' +
      'transform:scale(' + s + ');transform-origin:0 0;';
    el.appendChild(R(l));
    var box = document.createElement('div');
    box.className = 'fm-add-thumb';
    box.style.width = Math.max(30, l.w * s) + 'px';
    box.style.height = Math.max(24, l.h * s) + 'px';
    box.appendChild(el);
    return box;
  }

  function buildInsertSheet() {
    var b = $('fm-sheet-body');
    // 模板切换（可撤销）
    var tpls = '';
    P.layouts.forEach(function (ly) {
      tpls += '<button class="fm-tpl-btn' + (doc.layoutId === ly.id ? ' sel' : '') + '" data-tpl="' + ly.id + '" data-testid="tpl-' + ly.id + '">' +
        ly.name + '<span class="fm-tpl-src">' + ly.source + '</span></button>';
    });
    var items = '';
    P.components.forEach(function (p) {
      items += '<button class="fm-pick-card fm-add-card" data-p="' + p.id + '" data-testid="add-' + p.id + '">' +
        '<span class="fm-pc-thumb"></span><span class="fm-pc-n">' + p.name + '</span></button>';
    });
    b.innerHTML =
      '<div class="fm-sec"><div class="fm-sec-label">模板</div><div class="fm-tpl-row" id="fm-tpl-row">' + tpls + '</div></div>' +
      '<div class="fm-add-grid" style="padding-bottom:16px">' + items + '</div>';

    $('fm-tpl-row').querySelectorAll('.fm-tpl-btn').forEach(function (bt) {
      bt.addEventListener('click', function () {
        applyLayout(bt.dataset.tpl);
      });
    });
    b.querySelectorAll('.fm-add-card').forEach(function (pc) {
      pc.querySelector('.fm-pc-thumb').appendChild(compThumb(CP(pc.dataset.p)));
      pc.addEventListener('click', function () {
        var l = layerFromPreset(CP(pc.dataset.p));
        closeSheet();
        insertLayer(centerLayer(l), true);
      });
    });
  }

  function applyLayout(layoutId) {
    var keep = doc.layers.filter(function (l) { return l.type === 'image' && l.src; });
    var nd = buildDoc(layoutId);
    nd.layoutId = layoutId;
    // 保留用户已换过的图（按顺序回填到新模板的空卡片上）
    var ki = 0;
    nd.layers.forEach(function (l) {
      if (l.type === 'image' && !l.src && ki < keep.length) l.src = keep[ki++].src;
    });
    doc = nd;
    sel = null;
    closeSheet();
    pushHist();
    render();
  }

  // ---------- 导出：canvas 渲染 1242x1656 ----------
  var EXPORT_W = 1242, EXPORT_H = 1656, EXPORT_S = EXPORT_W / CW;

  var imgCache = {};
  function loadImage(src) {
    if (!src) return Promise.resolve(null);
    if (imgCache[src]) return imgCache[src];
    var p = new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { resolve(null); };
      img.src = src;
    });
    imgCache[src] = p;
    return p;
  }

  function preloadDocImages(d) {
    return Promise.all(d.layers.map(function (l) {
      return l.type === 'image' ? loadImage(l.src) : Promise.resolve(null);
    }));
  }

  // 圆角矩形路径
  function rr(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // GRAD_CAP_SOLID 里的 path d 串
  var GRAD_CAP_PATHS = (function () {
    var out = [];
    C.GRAD_CAP_SOLID.replace(/d="([^"]+)"/g, function (_, d) { out.push(d); });
    return out;
  })();

  function drawTextLayer(ctx, l) {
    var k = EXPORT_S;
    var f = C.FONTS.filter(function (x) { return x.id === l.font; })[0] || C.FONTS[0];
    var weight = l.weight || f.weight;
    var lines = buildTextLines(l);
    var strokeList = (l.strokes || []).filter(function (s) { return s.on !== false && s.width > 0; });
    var cums = [], cum = 0;
    strokeList.forEach(function (s) { cum += s.width; cums.push(cum); });
    var lineH = l.size * l.lineHeight;
    var ascent = l.size * 0.8;
    ctx.save();
    ctx.translate(l.x * k, l.y * k);
    ctx.rotate((l.rot || 0) * Math.PI / 180);
    ctx.scale(k, k); // 之后全部用文档坐标（300x400 逻辑像素）
    ctx.font = weight + ' ' + l.size + 'px ' + f.css;
    ctx.textBaseline = 'alphabetic';
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    // 从最外描边到填充；阴影只挂在最外层（对应 SVG feDropShadow 挂首副本）
    var pass = 0;
    for (var i = strokeList.length - 1; i >= -1; i--) {
      var isFill = i < 0;
      var w = isFill ? 0 : cums[i] * 2;
      pass++;
      lines.forEach(function (line, li) {
        var y = li * lineH + ascent;
        var x = 0;
        line.forEach(function (seg) {
          var color = isFill ? (seg.color || l.color || '#000') : strokeList[i].color;
          var useShadow = pass === 1 && l.shadow && l.shadow.on;
          ctx.save();
          if (useShadow) {
            ctx.shadowColor = l.shadow.color || 'rgba(0,0,0,.22)';
            ctx.shadowBlur = (l.shadow.blur || 0) / 2 * k;
            ctx.shadowOffsetX = (l.shadow.x || 0) * k;
            ctx.shadowOffsetY = (l.shadow.y || 0) * k;
          }
          if (!isFill && w > 0) {
            ctx.strokeStyle = color;
            ctx.lineWidth = w;
            ctx.strokeText(seg.text, x, y);
          } else if (isFill) {
            ctx.fillStyle = color;
            ctx.fillText(seg.text, x, y);
          }
          ctx.restore();
          x += ctx.measureText(seg.text).width;
        });
      });
    }
    ctx.restore();
  }

  function drawBrushLayer(ctx, l) {
    var k = EXPORT_S;
    ctx.save();
    ctx.translate(l.x * k, l.y * k);
    ctx.rotate((l.rot || 0) * Math.PI / 180);
    ctx.scale(l.w / 300 * k, l.h / 66 * k);
    ctx.globalAlpha = l.opacity == null ? 1 : l.opacity;
    ctx.fillStyle = l.color || '#FDD758';
    // 主形状 + 侧带（多层抖动近似 feTurbulence 毛边）
    var paths = [C.BRUSH_MAIN].concat(C.BRUSH_SIDE);
    var alphas = [1, .55, .5, .38, .35];
    paths.forEach(function (d, pi) {
      var p = new Path2D(d);
      ctx.globalAlpha = (l.opacity == null ? 1 : l.opacity) * alphas[pi] || 1;
      for (var j = 0; j < 4; j++) {
        ctx.save();
        ctx.translate((Math.sin(j * 12.9898 + pi * 7.7) * 1.6), (Math.sin(j * 78.233 + pi * 3.1) * 1.2));
        ctx.fill(p);
        ctx.restore();
      }
    });
    ctx.restore();
  }

  function drawIconPathsCentered(ctx, name, cx, cy, size, color, swScale) {
    var paths = C.iconPaths(name);
    if (!paths.length) return;
    ctx.save();
    var s = size / 24;
    ctx.translate(cx - size / 2, cy - size / 2);
    ctx.scale(s, s);
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 2; // viewBox 24 坐标系内的线性描边，随整体缩放
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    paths.forEach(function (d) {
      var p = new Path2D(d);
      ctx.stroke(p);
    });
    ctx.restore();
  }

  function drawGradCap(ctx, cx, cy, size) {
    ctx.save();
    var s = size / 64;
    ctx.translate(cx - size / 2, cy - size / 2);
    ctx.scale(s, s);
    // path 0 = 橙流苏（描边），path 1/2 = 黑帽体；圆点单独画
    GRAD_CAP_PATHS.forEach(function (d, i) {
      var p = new Path2D(d);
      if (i === 0) {
        ctx.strokeStyle = '#C1722D';
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke(p);
      } else {
        ctx.fillStyle = '#26252A';
        ctx.fill(p);
      }
    });
    ctx.beginPath();
    ctx.arc(58, 40, 3.4, 0, Math.PI * 2);
    ctx.fillStyle = '#C1722D';
    ctx.fill();
    ctx.restore();
  }

  function drawPillLayer(ctx, l) {
    var k = EXPORT_S;
    ctx.save();
    ctx.translate(l.x * k, l.y * k);
    ctx.rotate((l.rot || 0) * Math.PI / 180);
    ctx.scale(k, k);
    var pad = (l.halo || 0);
    if (C.SHADOWS[l.shadow] && l.shadow === 'soft') {
      ctx.shadowColor = 'rgba(0,0,0,.22)';
      ctx.shadowBlur = 6 * k;
      ctx.shadowOffsetY = 3 * k;
    }
    if (pad > 0) {
      ctx.fillStyle = '#FFFFFF';
      rr(ctx, -pad, -pad, l.w + pad * 2, l.h + pad * 2, l.h / 2 + pad);
      ctx.fill();
    }
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = l.bg || '#FFDA65';
    rr(ctx, 0, 0, l.w, l.h, l.h / 2);
    ctx.fill();
    if (l.strokeWidth > 0) {
      ctx.strokeStyle = l.strokeColor || '#0A0A0A';
      ctx.lineWidth = l.strokeWidth;
      ctx.stroke();
    }
    var f = C.FONTS.filter(function (x) { return x.id === l.font; })[0] || C.FONTS[0];
    var text = l.text || '';
    ctx.font = (l.weight || f.weight) + ' ' + l.size + 'px ' + f.css;
    ctx.textBaseline = 'middle';
    ctx.fillStyle = l.textColor || '#111110';
    var tw = ctx.measureText(text).width;
    var iconSize = Math.min(16, l.h - 10);
    var iconW = l.icon ? iconSize : 0;
    var gap = l.icon ? 4 : 0;
    var total = iconW + gap + tw;
    var x0 = (l.w - total) / 2;
    if (l.icon) {
      drawIconPathsCentered(ctx, l.icon, x0 + iconW / 2, l.h / 2, iconSize, '#1A1A1A');
    }
    ctx.textAlign = 'left';
    ctx.fillText(text, x0 + iconW + gap, l.h / 2 + l.size * 0.05);
    ctx.restore();
  }

  function drawBadgeLayer(ctx, l) {
    var k = EXPORT_S;
    ctx.save();
    ctx.translate(l.x * k, l.y * k);
    ctx.rotate((l.rot || 0) * Math.PI / 180);
    ctx.scale(k, k);
    var cx = l.w / 2, cy = l.h / 2;
    var r = l.r;
    var ow = (l.outer && l.outer.width) || 0;
    var iw = (l.inner && l.inner.width) || 0;
    if (C.SHADOWS[l.shadow] && l.shadow === 'soft') {
      ctx.shadowColor = 'rgba(0,0,0,.22)';
      ctx.shadowBlur = 6 * k;
      ctx.shadowOffsetY = 3 * k;
    }
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = l.fill || '#FFF5E9';
    ctx.fill();
    ctx.shadowColor = 'transparent';
    if (ow > 0) {
      ctx.strokeStyle = (l.outer && l.outer.color) || '#FFFFFF';
      ctx.lineWidth = ow;
      ctx.stroke();
    }
    if (iw > 0) {
      ctx.beginPath();
      ctx.arc(cx, cy, r - ow - iw / 2, 0, Math.PI * 2);
      ctx.strokeStyle = (l.inner && l.inner.color) || 'transparent';
      ctx.lineWidth = iw;
      ctx.stroke();
    }
    var isz = l.r - ow;
    var icy = cy - isz * 0.4;
    if (l.icon === 'graduation-cap') {
      drawGradCap(ctx, cx, icy, isz);
    } else {
      drawIconPathsCentered(ctx, l.icon || 'star', cx, icy, isz, l.iconColor || '#26252A');
    }
    var f = C.FONTS.filter(function (x) { return x.id === l.font; })[0] || C.FONTS[0];
    ctx.font = (l.weight || f.weight) + ' ' + (l.size || 15) + 'px ' + f.css;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = l.iconColor || '#26252A';
    ctx.fillText(l.text || '', cx, cy + 10 + (l.size || 15) * 0.5);
    ctx.restore();
  }

  function drawImageLayer(ctx, l, img) {
    var k = EXPORT_S;
    ctx.save();
    ctx.translate(l.x * k, l.y * k);
    ctx.rotate((l.rot || 0) * Math.PI / 180);
    ctx.scale(k, k);
    var w = l.w, h = l.h, b = l.border || 0, rad = l.radius || 0;
    if (C.SHADOWS[l.shadow] && l.shadow === 'soft') {
      ctx.shadowColor = 'rgba(0,0,0,.22)';
      ctx.shadowBlur = 6 * k;
      ctx.shadowOffsetY = 3 * k;
    }
    ctx.fillStyle = l.borderColor || '#fff';
    rr(ctx, 0, 0, w, h, rad);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    if (l.outline) {
      ctx.strokeStyle = l.outline;
      ctx.lineWidth = 1;
      rr(ctx, 0.5, 0.5, w - 1, h - 1, rad);
      ctx.stroke();
    }
    ctx.save();
    rr(ctx, b, b, w - b * 2, h - b * 2, Math.max(0, rad - b));
    ctx.clip();
    if (img) {
      var iw = img.width, ih = img.height;
      var cs = (l.crop && l.crop.scale) || 1;
      var cover = Math.max((w - b * 2) / iw, (h - b * 2) / ih) * cs;
      var dw = iw * cover, dh = ih * cover;
      var ox = ((l.crop && l.crop.ox) || 0) / 100 * (dw - (w - b * 2));
      var oy = ((l.crop && l.crop.oy) || 0) / 100 * (dh - (h - b * 2));
      ctx.drawImage(img, (w - b * 2 - dw) / 2 + ox, (h - b * 2 - dh) / 2 + oy, dw, dh);
    } else {
      ctx.fillStyle = '#E9E6DF';
      ctx.fillRect(b, b, w - b * 2, h - b * 2);
    }
    ctx.restore();
    ctx.restore();
  }

  function drawPaper(ctx) {
    // 纸纹：低透明度噪点（近似 CSS feTurbulence multiply .07）
    var n = 2600;
    ctx.save();
    ctx.globalAlpha = 0.05;
    for (var i = 0; i < n; i) {
      var x = (Math.sin(i * 12.9898) * 43758.5453) % 1;
      var y = (Math.sin(i * 78.233) * 43758.5453) % 1;
      x = Math.abs(x) * EXPORT_W;
      y = Math.abs(y) * EXPORT_H;
      ctx.fillStyle = i % 7 === 0 ? '#FFFFFF' : '#7A7468';
      ctx.fillRect(x, y, 2, 2);
      i++;
    }
    ctx.restore();
  }

  // image 层需要真实 img 对象：先 preload（与 layers 同序），再逐层渲染
  function renderExport(docSnap) {
    return preloadDocImages(docSnap).then(function (imgs) {
      var canvas = document.createElement('canvas');
      canvas.width = EXPORT_W;
      canvas.height = EXPORT_H;
      var ctx = canvas.getContext('2d');
      ctx.fillStyle = docSnap.bg.color || '#FCF8ED';
      ctx.fillRect(0, 0, EXPORT_W, EXPORT_H);
      docSnap.layers.forEach(function (l, i) {
        if (l.visible === false) return;
        if (l.type === 'text') drawTextLayer(ctx, l);
        else if (l.type === 'brush') drawBrushLayer(ctx, l);
        else if (l.type === 'pill') drawPillLayer(ctx, l);
        else if (l.type === 'badge') drawBadgeLayer(ctx, l);
        else if (l.type === 'image') drawImageLayer(ctx, l, imgs[i]);
      });
      if (docSnap.bg.paper) drawPaper(ctx);
      return canvas;
    });
  }

  function exportFileName() {
    var d = new Date();
    function p(n) { return n < 10 ? '0' + n : '' + n; }
    return '照着做-' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) +
      '-' + p(d.getHours()) + p(d.getMinutes()) + '.png';
  }

  function xhsMiniTool() {
    var mt = window.xhs && window.xhs.miniTool;
    if (mt && typeof mt.writeTempFile === 'function' && typeof mt.saveImageToPhotosAlbum === 'function') return mt;
    return null;
  }

  function canvasToBlob(canvas) {
    return new Promise(function (resolve) {
      if (canvas.toBlob) canvas.toBlob(function (b) { resolve(b); }, 'image/png');
      else resolve(null);
    });
  }

  function openExportView() {
    exportOpen = true;
    refOn = false; sel = null;
    closeSheet();
    $('fm-chip-ref').classList.remove('on');
    $('fm-toolbar').style.display = 'none';
    $('fm-chips-row').style.display = 'none';
    $('fm-stage-area').classList.add('exporting');
    var eu = $('fm-export-ui');
    eu.classList.add('on');
    eu.innerHTML =
      '<div class="fm-ex-meta">3:4 · 1242×1656</div>' +
      '<div class="fm-ex-btns">' +
      '<button class="fm-btn-dark" id="fm-save" data-testid="fm-save">存图</button>' +
      '<button class="fm-btn-ghost" id="fm-ex-back">继续编辑</button></div>';
    $('fm-save').addEventListener('click', doExport);
    $('fm-ex-back').addEventListener('click', closeExportView);
    layout();
    updateRef(); updateOverlay();
  }

  function closeExportView() {
    exportOpen = false;
    $('fm-toolbar').style.display = '';
    $('fm-chips-row').style.display = '';
    $('fm-stage-area').classList.remove('exporting');
    var eu = $('fm-export-ui');
    eu.classList.remove('on');
    eu.innerHTML = '';
    layout();
  }

  function doExport() {
    var snap = deep(doc);
    snap.layers.forEach(function (l) {
      if (l.type === 'text') delete l._c;
    });
    // 导出前确保字体已就绪
    ensureFonts().then(function () {
      return renderExport(snap);
    }).then(function (canvas) {
      if (opts && typeof opts.onExport === 'function') {
        opts.onExport(canvas);
        toast('已导出');
        return;
      }
      var mt = xhsMiniTool();
      if (mt) {
        var dataUrl = canvas.toDataURL('image/png');
        return mt.writeTempFile({ data: dataUrl }).then(function (res) {
          return mt.saveImageToPhotosAlbum({ filePath: res.filePath });
        }).then(function () {
          toast('已保存到相册');
        }).catch(function () {
          toast('导出失败');
        });
      }
      return canvasToBlob(canvas).then(function (blob) {
        if (!blob) { toast('导出失败'); return; }
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = exportFileName();
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
        toast('已保存');
      });
    }).catch(function () {
      toast('导出失败');
    });
  }

  // ---------- DOM 构建 ----------
  function svgIcon(paths, stroke) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="' + (stroke || 'currentColor') +
      '" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + paths + '</svg>';
  }

  function buildRoot() {
    root = document.createElement('div');
    root.id = 'fm-root';
    root.setAttribute('data-testid', 'fm-root');
    root.innerHTML =
      '<div class="fm-topbar">' +
      '<div class="fm-side">' +
      '<button class="fm-iconbtn" id="fm-back" data-testid="fm-back" aria-label="返回">' + svgIcon('<path d="M15 5l-7 7 7 7"/>') + '</button>' +
      '</div>' +
      '<div class="fm-tb-title">照着做</div>' +
      '<div class="fm-side fm-side-r">' +
      '<button class="fm-iconbtn" id="fm-undo" data-testid="fm-undo" aria-label="撤销" disabled>' + svgIcon('<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>') + '</button>' +
      '<button class="fm-iconbtn" id="fm-redo" data-testid="fm-redo" aria-label="重做" disabled>' + svgIcon('<path d="m15 14 5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/>') + '</button>' +
      '<button class="fm-export-btn" id="fm-export" data-testid="fm-export">导出</button>' +
      '</div>' +
      '</div>' +

      '<div class="fm-stage" id="fm-stage">' +
      '<div class="fm-chips-row" id="fm-chips-row">' +
      '<button class="fm-chip" id="fm-chip-ref" data-testid="fm-ref-toggle"><span class="fm-eye" id="fm-chip-ref-eye"></span>参考</button>' +
      '<button class="fm-chip fm-ghost" id="fm-chip-hold" data-testid="fm-hold-compare">按住对比</button>' +
      '</div>' +
      '<div class="fm-canvas-area" id="fm-stage-area">' +
      '<div class="fm-canvas-wrap" id="fm-canvas-wrap">' +
      '<div class="fm-canvas" id="fm-canvas"></div>' +
      '<div class="fm-ref-layer" id="fm-ref-layer"><img id="fm-ref-img" draggable="false" alt=""></div>' +
      '<div class="fm-guides" id="fm-guides"></div>' +
      '<div class="fm-overlay" id="fm-overlay"></div>' +
      '</div>' +
      '<div class="fm-export-ui" id="fm-export-ui"></div>' +
      '</div>' +
      '</div>' +

      '<div class="fm-toolbar" id="fm-toolbar">' +
      '<button class="fm-tool" id="fm-tool-text" data-testid="fm-tool-text"><span class="fm-ti">' + C.uiIcon('text', 22, 1.6) + '</span><span class="fm-tl">文字</span></button>' +
      '<button class="fm-tool" id="fm-tool-comp" data-testid="fm-tool-comp"><span class="fm-ti">' + C.uiIcon('shapes', 22, 1.6) + '</span><span class="fm-tl">组件</span></button>' +
      '<button class="fm-tool" id="fm-tool-layer"><span class="fm-ti">' + C.uiIcon('layers', 22, 1.6) + '</span><span class="fm-tl">图层</span></button>' +
      '<button class="fm-tool" id="fm-tool-ref"><span class="fm-ti">' + C.uiIcon('eye', 22, 1.6) + '</span><span class="fm-tl">参考</span></button>' +
      '</div>' +

      '<div class="fm-sheet-mask" id="fm-sheet-mask"></div>' +
      '<div class="fm-sheet" id="fm-sheet">' +
      '<div class="fm-sheet-grab" id="fm-sheet-grab"></div>' +
      '<div class="fm-sheet-titlebar">' +
      '<div class="fm-sheet-title" id="fm-sheet-title"></div>' +
      '<button class="fm-sheet-close" id="fm-sheet-close" data-testid="fm-sheet-close" aria-label="关闭面板">' + svgIcon('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>') + '</button>' +
      '</div>' +
      '<div class="fm-sheet-body" id="fm-sheet-body"></div>' +
      '</div>' +

      '<div class="fm-toast" id="fm-toast"></div>' +
      '<input type="file" accept="image/*" id="fm-file-input" data-testid="fm-file-input" hidden />';
    document.body.appendChild(root);
  }

  function bindSheetChrome() {
    $('fm-sheet-mask').addEventListener('click', closeSheet);
    $('fm-sheet-close').addEventListener('click', closeSheet);
    // 画布空白/画布区外空白按下时收起面板（面板开着也能拖动图层，见 mask 说明）
    $('fm-stage').addEventListener('pointerdown', function (e) {
      if (!sheetOpen()) return;
      if (e.target.closest('#fm-canvas-wrap') || e.target.closest('.fm-sheet')) return;
      closeSheet();
    });
    var sy0 = null;
    $('fm-sheet-grab').addEventListener('pointerdown', function (e) { sy0 = e.clientY; });
    window.addEventListener('pointermove', function (e) {
      if (sy0 == null) return;
      if (e.clientY - sy0 > 60) { closeSheet(); sy0 = null; }
    });
    window.addEventListener('pointerup', function () { sy0 = null; });
  }

  // ---------- open / close ----------
  function open(o) {
    opts = o || {};
    if (root) { close(); }
    ensureFonts().then(function () {
      buildRoot();
      $('fm-ref-img').src = opts.refSrc || '';
      doc = buildDoc();
      doc.layoutId = P.layouts[0].id;
      sel = null;
      refOn = false; refHold = false; exportOpen = false;
      hist = []; hi = -1;
      $('fm-chip-ref-eye').innerHTML = C.uiIcon('eyeOff', 14);
      bindChrome();
      bindCanvasInteract();
      bindSheetChrome();
      pushHist();
      render();
      var onResize = function () { if (root) layout(); };
      window.addEventListener('resize', onResize);
      root._onResize = onResize;
    });
  }

  function close() {
    if (!root) return;
    if (root._onResize) window.removeEventListener('resize', root._onResize);
    window.removeEventListener('pointerup', refHoldUp);
    window.removeEventListener('pointercancel', refHoldUp);
    root.remove();
    root = null;
    doc = null; sel = null; curSheet = null; layerActions = null;
  }

  window.FollowMake = { open: open, close: close };
})();
