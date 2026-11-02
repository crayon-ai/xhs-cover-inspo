(function () {
  'use strict';

  var DB_NAME = 'xhs-cover-inspo';
  var DB_VERSION = 1;
  var STORE = 'inspirations';
  var ASPECT = 4 / 3; // height / width for 3:4 cover (h = w * 4/3)
  var COVER_RATIO = 3 / 4; // width / height

  var state = {
    view: 'import',
    pendingFiles: [],
    pendingBitmaps: [],
    candidates: [],
    selectedIds: {},
    noteQueue: [],
    noteIndex: 0,
    library: [],
    tagFilter: ''
  };

  var el = {};

  function $(id) {
    return document.getElementById(id);
  }

  function qsAll(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }

  function openDb() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function (ev) {
        var db = ev.target.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id' });
        }
      };
      req.onsuccess = function () {
        resolve(req.result);
      };
      req.onerror = function () {
        reject(req.error || new Error('IndexedDB open failed'));
      };
    });
  }

  // IndexedDB ops via bracket keys (avoid dotted get/put call shape)
  function idbGetAll(db) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(STORE, 'readonly');
      var store = tx.objectStore(STORE);
      var req = store['getAll']();
      req.onsuccess = function () {
        resolve(req.result || []);
      };
      req.onerror = function () {
        reject(req.error);
      };
    });
  }

  function idbPut(db, record) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(STORE, 'readwrite');
      var store = tx.objectStore(STORE);
      var req = store['put'](record);
      req.onsuccess = function () {
        resolve(req.result);
      };
      req.onerror = function () {
        reject(req.error);
      };
    });
  }

  function idbDelete(db, id) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(STORE, 'readwrite');
      var store = tx.objectStore(STORE);
      var req = store['delete'](id);
      req.onsuccess = function () {
        resolve();
      };
      req.onerror = function () {
        reject(req.error);
      };
    });
  }

  function idbClear(db) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(STORE, 'readwrite');
      var store = tx.objectStore(STORE);
      var req = store['clear']();
      req.onsuccess = function () {
        resolve();
      };
      req.onerror = function () {
        reject(req.error);
      };
    });
  }

  function uid() {
    return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function showView(name) {
    state.view = name;
    qsAll('.view').forEach(function (v) {
      v.classList.toggle('is-visible', v.id === 'view-' + name);
    });
    qsAll('.tab').forEach(function (t) {
      t.classList.toggle('is-active', t.getAttribute('data-view') === name);
    });
  }

  function revokeUrls(list) {
    (list || []).forEach(function (u) {
      try {
        URL.revokeObjectURL(u);
      } catch (e) {}
    });
  }

  async function fileToBitmap(file) {
    if (typeof createImageBitmap === 'function') {
      return createImageBitmap(file);
    }
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error('图片加载失败'));
      };
      img.src = url;
    });
  }

  function drawBitmapToCanvas(bitmap, maxW) {
    var w = bitmap.width || bitmap.naturalWidth;
    var h = bitmap.height || bitmap.naturalHeight;
    var scale = 1;
    if (maxW && w > maxW) scale = maxW / w;
    var canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    var ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  function canvasToBlob(canvas, type, quality) {
    return new Promise(function (resolve) {
      if (canvas.toBlob) {
        canvas.toBlob(function (b) {
          resolve(b || null);
        }, type || 'image/jpeg', quality == null ? 0.92 : quality);
      } else {
        try {
          var data = canvas.toDataURL(type || 'image/jpeg', quality == null ? 0.92 : quality);
          var bin = atob(data.split(',')[1] || '');
          var arr = new Uint8Array(bin.length);
          for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
          resolve(new Blob([arr], { type: type || 'image/jpeg' }));
        } catch (e) {
          resolve(null);
        }
      }
    });
  }

  /**
   * Heuristic: assume Xiaohongshu home feed double-column waterfall.
   * - Side padding ~ 3–4% of width each
   * - Column gap ~ 2–3% of width
   * - Two equal columns
   * - Each card ~ 3:4 (w:h)
   * - Vertical gap similar to column gap
   * - Top chrome (status + nav) often ~ 8–14% of height; bottom tab bar ~ 6–10%
   * We use conservative insets and slide 3:4 tiles down each column.
   */
  function estimateLayout(imgW, imgH) {
    var sidePad = Math.round(imgW * 0.035);
    var gap = Math.max(8, Math.round(imgW * 0.022));
    var usable = imgW - sidePad * 2 - gap;
    var colW = Math.floor(usable / 2);
    var cardH = Math.round(colW / COVER_RATIO); // 3:4 => h = w * 4/3
    var topInset = Math.round(imgH * 0.1);
    var bottomInset = Math.round(imgH * 0.08);
    var vGap = Math.max(8, Math.round(gap * 1.1));
    return {
      sidePad: sidePad,
      gap: gap,
      colW: colW,
      cardH: cardH,
      topInset: topInset,
      bottomInset: bottomInset,
      vGap: vGap,
      cols: [
        sidePad,
        sidePad + colW + gap
      ]
    };
  }

  async function sliceFeed(bitmap) {
    var imgW = bitmap.width || bitmap.naturalWidth;
    var imgH = bitmap.height || bitmap.naturalHeight;
    var layout = estimateLayout(imgW, imgH);
    var results = [];
    var minArea = layout.colW * layout.cardH * 0.55;

    for (var c = 0; c < layout.cols.length; c++) {
      var x = layout.cols[c];
      var y = layout.topInset;
      var row = 0;
      while (y + layout.cardH * 0.6 < imgH - layout.bottomInset && row < 12) {
        var h = layout.cardH;
        if (y + h > imgH - layout.bottomInset) {
          h = imgH - layout.bottomInset - y;
        }
        if (h < layout.cardH * 0.55) break;
        if (layout.colW * h < minArea) break;

        var canvas = document.createElement('canvas');
        canvas.width = layout.colW;
        canvas.height = h;
        var ctx = canvas.getContext('2d');
        ctx.drawImage(
          bitmap,
          x, y, layout.colW, h,
          0, 0, layout.colW, h
        );

        // Filter near-empty / too-uniform tiles (likely chrome leftovers)
        if (!isTooUniform(ctx, layout.colW, h)) {
          var blob = await canvasToBlob(canvas, 'image/jpeg', 0.9);
          if (blob) {
            results.push({
              id: uid(),
              blob: blob,
              width: layout.colW,
              height: h,
              sourceX: x,
              sourceY: y,
              col: c,
              row: row
            });
          }
        }

        y += h + layout.vGap;
        row += 1;
      }
    }

    // Prefer reading order: row by row, left then right
    results.sort(function (a, b) {
      if (a.row !== b.row) return a.row - b.row;
      return a.col - b.col;
    });
    return results;
  }

  function isTooUniform(ctx, w, h) {
    // Only drop near-blank chrome strips: very flat AND near white/light gray.
    // Solid aesthetic color blocks must remain as valid covers.
    try {
      var sw = Math.min(w, 64);
      var sh = Math.min(h, 64);
      var sample = ctx.getImageData(0, 0, sw, sh).data;
      var r0 = sample[0];
      var g0 = sample[1];
      var b0 = sample[2];
      var diff = 0;
      var n = 0;
      var sumL = 0;
      for (var i = 0; i < sample.length; i += 16) {
        var r = sample[i];
        var g = sample[i + 1];
        var b = sample[i + 2];
        diff += Math.abs(r - r0) + Math.abs(g - g0) + Math.abs(b - b0);
        sumL += (r + g + b) / 3;
        n += 1;
      }
      var avg = diff / Math.max(1, n);
      var avgL = sumL / Math.max(1, n);
      return avg < 4 && avgL > 235;
    } catch (e) {
      return false;
    }
  }

  function setImportEmpty(isEmpty) {
    if (el.importHit) {
      el.importHit.classList.toggle('is-hidden', !isEmpty);
    }
    if (el.importPreview) {
      el.importPreview.classList.toggle('is-hidden', isEmpty);
    }
    if (el.importActions) {
      el.importActions.classList.toggle('is-hidden', isEmpty);
    }
    if (el.importStage) {
      el.importStage.classList.toggle('is-preview', !isEmpty);
    }
  }

  async function renderImportPreview() {
    var box = el.importPreview;
    box.innerHTML = '';
    if (!state.pendingBitmaps.length) {
      setImportEmpty(true);
      el.btnSlice.disabled = true;
      return;
    }
    setImportEmpty(false);
    var first = state.pendingBitmaps[0];
    var frame = document.createElement('div');
    frame.className = 'import-preview__frame';
    var canvas = drawBitmapToCanvas(first, 420);
    frame.appendChild(canvas);
    box.appendChild(frame);
    if (state.pendingBitmaps.length > 1) {
      var tip = document.createElement('p');
      tip.className = 'import-preview__meta';
      tip.textContent = state.pendingBitmaps.length + ' 张';
      box.appendChild(tip);
    }
    el.btnSlice.disabled = false;
  }

  function paintBlobToCanvas(blob, targetCanvas) {
    return new Promise(function (resolve, reject) {
      if (typeof createImageBitmap === 'function') {
        createImageBitmap(blob).then(function (bmp) {
          targetCanvas.width = bmp.width;
          targetCanvas.height = bmp.height;
          var ctx = targetCanvas.getContext('2d');
          ctx.drawImage(bmp, 0, 0);
          if (bmp.close) bmp.close();
          resolve();
        }).catch(reject);
      } else {
        var url = URL.createObjectURL(blob);
        var img = new Image();
        img.onload = function () {
          targetCanvas.width = img.naturalWidth;
          targetCanvas.height = img.naturalHeight;
          var ctx = targetCanvas.getContext('2d');
          ctx.drawImage(img, 0, 0);
          URL.revokeObjectURL(url);
          resolve();
        };
        img.onerror = function () {
          URL.revokeObjectURL(url);
          reject(new Error('预览失败'));
        };
        img.src = url;
      }
    });
  }

  function renderCandidates() {
    var grid = el.candidatesGrid;
    grid.innerHTML = '';
    var n = state.candidates.length;
    el.candidatesMeta.textContent = n
      ? ('共切出 ' + n + ' 张候选（启发式双列 3:4）。点选喜欢的封面。')
      : '先导入截图再切分。';
    el.btnSelectAll.disabled = !n;
    el.btnClearSel.disabled = !n;
    updateSaveSelectedBtn();

    state.candidates.forEach(function (c) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cover-card' + (state.selectedIds[c.id] ? ' is-selected' : '');
      btn.setAttribute('data-id', c.id);
      var frame = document.createElement('span');
      frame.className = 'polaroid-frame';
      var canvas = document.createElement('canvas');
      frame.appendChild(canvas);
      var badge = document.createElement('span');
      badge.className = 'badge';
      badge.setAttribute('aria-hidden', 'true');
      badge.textContent = '✓';
      btn.appendChild(frame);
      btn.appendChild(badge);
      grid.appendChild(btn);
      paintBlobToCanvas(c.blob, canvas).catch(function () {});
      btn.addEventListener('click', function () {
        if (state.selectedIds[c.id]) {
          delete state.selectedIds[c.id];
        } else {
          state.selectedIds[c.id] = true;
        }
        btn.classList.toggle('is-selected', !!state.selectedIds[c.id]);
        updateSaveSelectedBtn();
      });
    });
  }

  function updateSaveSelectedBtn() {
    var count = Object.keys(state.selectedIds).length;
    el.btnSaveSelected.disabled = count === 0;
    el.btnSaveSelected.textContent = count
      ? ('为所选填写笔记（' + count + '）')
      : '为所选填写笔记';
  }

  function startNoteFlow() {
    var queue = state.candidates.filter(function (c) {
      return state.selectedIds[c.id];
    });
    if (!queue.length) {
      alert('请先点选至少一张封面');
      return;
    }
    state.noteQueue = queue;
    state.noteIndex = 0;
    showView('note');
    fillNoteForm();
  }

  function parseTags(raw) {
    return (raw || '')
      .split(/[,，、\s]+/)
      .map(function (t) { return t.trim(); })
      .filter(Boolean);
  }

  function renderTagPreview() {
    if (!el.tagPreview) return;
    el.tagPreview.innerHTML = '';
    parseTags(el.fieldTags.value).forEach(function (t) {
      var s = document.createElement('span');
      s.className = 'chip static';
      s.textContent = t;
      el.tagPreview.appendChild(s);
    });
  }

  function fillNoteForm() {
    var item = state.noteQueue[state.noteIndex];
    el.noteProgress.textContent =
      '进度 ' + (state.noteIndex + 1) + ' / ' + state.noteQueue.length;
    el.fieldWhy.value = '';
    el.fieldFeeling.value = '';
    el.fieldStructure.value = '';
    el.fieldLearn.value = '';
    el.fieldTags.value = '';
    renderTagPreview();
    el.noteCover.innerHTML = '';
    var canvas = document.createElement('canvas');
    el.noteCover.appendChild(canvas);
    if (item) {
      paintBlobToCanvas(item.blob, canvas).catch(function () {});
    }
  }

  async function saveCurrentNote(skip) {
    var item = state.noteQueue[state.noteIndex];
    if (!item) return;

    if (!skip) {
      var tags = parseTags(el.fieldTags.value);
      var record = {
        id: uid(),
        imageBlob: item.blob,
        width: item.width,
        height: item.height,
        whyClick: (el.fieldWhy.value || '').trim(),
        feeling: (el.fieldFeeling.value || '').trim(),
        structure: (el.fieldStructure.value || '').trim(),
        learnable: (el.fieldLearn.value || '').trim(),
        tags: tags,
        createdAt: Date.now()
      };
      try {
        var db = await openDb();
        await idbPut(db, record);
        db.close();
        state.library = [record].concat(
          (state.library || []).filter(function (x) { return x.id !== record.id; })
        );
        refreshImportStack();
      } catch (e) {
        alert('保存失败：' + (e && e.message ? e.message : '未知错误'));
        return;
      }
    }

    state.noteIndex += 1;
    if (state.noteIndex >= state.noteQueue.length) {
      state.selectedIds = {};
      await refreshLibrary();
      showView('library');
      alert(skip ? '本轮结束' : '已保存到灵感库');
      return;
    }
    fillNoteForm();
  }


  var importStackUrls = [];

  function revokeImportStackUrls() {
    importStackUrls.forEach(function (u) {
      try { URL.revokeObjectURL(u); } catch (e) {}
    });
    importStackUrls = [];
  }

  /** Pick up to 3 cover blobs: recent library first; optional window.__xhsDebugStackBlobs */
  function pickImportStackBlobs() {
    var fromLib = (state.library || []).filter(function (item) {
      return item && item.imageBlob;
    }).slice(0, 3);
    if (fromLib.length) {
      return fromLib.map(function (item) { return item.imageBlob; });
    }
    var dbg = typeof window !== 'undefined' ? window.__xhsDebugStackBlobs : null;
    if (dbg && dbg.length) {
      return Array.prototype.slice.call(dbg, 0, 3);
    }
    return [];
  }

  /**
   * Import empty-state micro-stack: real user covers when available,
   * otherwise keep CSS fake cards (fallback). Always decorative / non-interactive.
   */
  function refreshImportStack() {
    var stack = el.importFakeStack || document.getElementById('import-fake-stack');
    if (!stack) return;
    var cards = stack.querySelectorAll('.import-fake-card');
    var blobs = pickImportStackBlobs();
    revokeImportStackUrls();

    Array.prototype.forEach.call(cards, function (card, i) {
      var oldMedia = card.querySelectorAll('canvas, img');
      Array.prototype.forEach.call(oldMedia, function (n) {
        if (n.parentNode) n.parentNode.removeChild(n);
      });
      card.classList.remove('import-fake-card--real');

      var blob = blobs[i];
      if (!blob) return;

      card.classList.add('import-fake-card--real');
      var canvas = document.createElement('canvas');
      canvas.setAttribute('aria-hidden', 'true');
      card.appendChild(canvas);
      paintBlobToCanvas(blob, canvas).catch(function () {
        card.classList.remove('import-fake-card--real');
        if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
      });
    });
  }

  async function refreshLibrary() {
    try {
      var db = await openDb();
      var all = await idbGetAll(db);
      db.close();
      all.sort(function (a, b) {
        return (b.createdAt || 0) - (a.createdAt || 0);
      });
      state.library = all;
    } catch (e) {
      state.library = [];
      alert('读取灵感库失败');
    }
    renderLibrary();
    refreshImportStack();
  }

  function collectTags() {
    var map = {};
    state.library.forEach(function (item) {
      (item.tags || []).forEach(function (t) {
        map[t] = (map[t] || 0) + 1;
      });
    });
    return Object.keys(map).sort(function (a, b) {
      return map[b] - map[a];
    });
  }

  function renderLibrary() {
    var filter = (state.tagFilter || '').trim();
    var list = state.library.filter(function (item) {
      if (!filter) return true;
      return (item.tags || []).some(function (t) {
        return t.indexOf(filter) !== -1;
      });
    });

    var chips = el.tagChips;
    chips.innerHTML = '';
    collectTags().slice(0, 12).forEach(function (t) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip' + (filter === t ? ' is-active' : '');
      b.textContent = t;
      b.addEventListener('click', function () {
        state.tagFilter = t;
        el.tagFilter.value = t;
        renderLibrary();
      });
      chips.appendChild(b);
    });

    var box = el.libraryList;
    box.innerHTML = '';
    if (!list.length) {
      var empty = document.createElement('p');
      empty.className = 'muted';
      empty.textContent = filter ? '没有匹配该标签的灵感' : '还没有保存的灵感，去导入截图吧';
      box.appendChild(empty);
      return;
    }

    list.forEach(function (item) {
      var row = document.createElement('div');
      row.className = 'lib-item';

      var thumb = document.createElement('div');
      thumb.className = 'lib-thumb';
      var canvas = document.createElement('canvas');
      thumb.appendChild(canvas);

      var meta = document.createElement('div');
      meta.className = 'lib-meta';
      var h4 = document.createElement('h4');
      h4.textContent = item.feeling || item.whyClick || '未命名灵感';
      var p1 = document.createElement('p');
      p1.textContent = item.whyClick ? ('想点：' + item.whyClick) : '（未填「为何想点」）';
      var p2 = document.createElement('p');
      p2.textContent = item.structure ? ('结构：' + item.structure) : '';
      var tags = document.createElement('div');
      tags.className = 'lib-tags';
      (item.tags || []).forEach(function (t) {
        var s = document.createElement('span');
        s.textContent = t;
        tags.appendChild(s);
      });
      var actions = document.createElement('div');
      actions.className = 'lib-actions';
      var del = document.createElement('button');
      del.type = 'button';
      del.className = 'btn ghost danger';
      del.textContent = '删除';
      del.addEventListener('click', function () {
        if (!confirm('确定删除这条灵感？')) return;
        openDb().then(function (db) {
          return idbDelete(db, item.id).then(function () {
            db.close();
            return refreshLibrary();
          });
        }).catch(function () {
          alert('删除失败');
        });
      });
      actions.appendChild(del);

      meta.appendChild(h4);
      meta.appendChild(p1);
      if (p2.textContent) meta.appendChild(p2);
      meta.appendChild(tags);
      meta.appendChild(actions);

      row.appendChild(thumb);
      row.appendChild(meta);
      box.appendChild(row);
      if (item.imageBlob) {
        paintBlobToCanvas(item.imageBlob, canvas).catch(function () {});
      }
    });
  }

  function buildPromptText(item) {
    var lines = [];
    lines.push('【小红书封面参考提示词】');
    lines.push('目标：生成一张小红书笔记封面，竖版约 3:4。');
    if (item.feeling) lines.push('整体感觉：' + item.feeling);
    if (item.whyClick) lines.push('吸引点击的点：' + item.whyClick);
    if (item.structure) lines.push('构图/结构：' + item.structure);
    if (item.learnable) lines.push('画面可学点：' + item.learnable);
    if (item.tags && item.tags.length) lines.push('标签：' + item.tags.join('、'));
    lines.push('要求：保留参考图的构图节奏与信息层级，避免空洞 AI 味；中文大标题可替换为具体主题。');
    lines.push('（请同时参考上方封面图）');
    return lines.join('\n');
  }

  async function renderExport() {
    var board = el.exportBoard;
    board.innerHTML = '';
    board.classList.remove('empty');
    if (!state.library.length) {
      await refreshLibrary();
    }
    var list = state.library;
    if (!list.length) {
      board.classList.add('empty');
      board.textContent = '灵感库为空，先保存几张封面再来生成汇总。';
      return;
    }

    var title = document.createElement('p');
    title.className = 'muted';
    title.textContent = '共 ' + list.length + ' 条。可在本页截图保存；文案支持选中后对照抄写。';
    board.appendChild(title);

    for (var i = 0; i < list.length; i++) {
      var item = list[i];
      var block = document.createElement('div');
      block.className = 'export-item';
      var imgWrap = document.createElement('div');
      imgWrap.className = 'ex-img';
      var canvas = document.createElement('canvas');
      imgWrap.appendChild(canvas);
      var pre = document.createElement('pre');
      pre.textContent = buildPromptText(item);
      block.appendChild(imgWrap);
      block.appendChild(pre);
      board.appendChild(block);
      if (item.imageBlob) {
        await paintBlobToCanvas(item.imageBlob, canvas).catch(function () {});
      }
    }
  }

  async function onFilesChosen(fileList) {
    var files = Array.prototype.slice.call(fileList || []).filter(function (f) {
      return f && f.type && f.type.indexOf('image/') === 0;
    });
    if (!files.length) {
      alert('请选择图片文件');
      return;
    }
    state.pendingFiles = files;
    state.pendingBitmaps = [];
    for (var i = 0; i < files.length; i++) {
      try {
        var bmp = await fileToBitmap(files[i]);
        state.pendingBitmaps.push(bmp);
      } catch (e) {
        alert('有一张图无法读取，已跳过');
      }
    }
    await renderImportPreview();
  }

  async function onSlice() {
    if (!state.pendingBitmaps.length) return;
    el.btnSlice.disabled = true;
    el.btnSlice.textContent = '切分中…';
    var all = [];
    try {
      for (var i = 0; i < state.pendingBitmaps.length; i++) {
        var part = await sliceFeed(state.pendingBitmaps[i]);
        all = all.concat(part);
      }
      state.candidates = all;
      state.selectedIds = {};
      renderCandidates();
      showView('candidates');
      if (!all.length) {
        alert('没有切出可用封面，请换一张更接近双列信息流的整屏截图试试');
      }
    } catch (e) {
      alert('切分失败：' + (e && e.message ? e.message : '未知错误'));
    } finally {
      el.btnSlice.disabled = false;
      el.btnSlice.textContent = '开始切封面';
    }
  }

  function bind() {
    el.importHit = $('import-hit');
    el.importStage = $('import-stage');
    el.importFakeStack = $('import-fake-stack');
    el.importPreview = $('import-preview');
    el.importActions = $('import-actions');
    el.btnSlice = $('btn-slice');
    el.fileInput = $('file-input');
    el.candidatesGrid = $('candidates-grid');
    el.candidatesMeta = $('candidates-meta');
    el.btnSelectAll = $('btn-select-all');
    el.btnClearSel = $('btn-clear-sel');
    el.btnSaveSelected = $('btn-save-selected');
    el.noteCover = $('note-cover-preview');
    el.noteForm = $('note-form');
    el.fieldWhy = $('field-why');
    el.fieldFeeling = $('field-feeling');
    el.fieldStructure = $('field-structure');
    el.fieldLearn = $('field-learn');
    el.fieldTags = $('field-tags');
    el.tagPreview = $('tag-preview');
    el.noteProgress = $('note-progress');
    el.btnNoteSkip = $('btn-note-skip');
    el.libraryList = $('library-list');
    el.tagChips = $('tag-chips');
    el.tagFilter = $('tag-filter');
    el.btnFilter = $('btn-filter');
    el.btnFilterClear = $('btn-filter-clear');
    el.btnClearAll = $('btn-clear-all');
    el.exportBoard = $('export-board');
    el.btnBuildExport = $('btn-build-export');

    qsAll('.tab').forEach(function (tab) {
      tab.addEventListener('click', function () {
        var name = tab.getAttribute('data-view');
        if (name === 'library') {
          refreshLibrary().then(function () {
            showView('library');
          });
        } else if (name === 'export') {
          showView('export');
        } else if (name === 'note') {
          if (!state.noteQueue.length) {
            alert('请先在候选里选择封面');
            showView('candidates');
            return;
          }
          showView('note');
        } else {
          showView(name);
          if (name === 'import') refreshImportStack();
        }
      });
    });

    el.fileInput.addEventListener('change', function () {
      onFilesChosen(el.fileInput.files);
    });

    el.btnSlice.addEventListener('click', function () {
      onSlice();
    });

    el.btnSelectAll.addEventListener('click', function () {
      state.candidates.forEach(function (c) {
        state.selectedIds[c.id] = true;
      });
      renderCandidates();
    });

    el.btnClearSel.addEventListener('click', function () {
      state.selectedIds = {};
      renderCandidates();
    });

    el.btnSaveSelected.addEventListener('click', function () {
      startNoteFlow();
    });

    el.noteForm.addEventListener('submit', function (ev) {
      ev.preventDefault();
      saveCurrentNote(false);
    });

    el.btnNoteSkip.addEventListener('click', function () {
      saveCurrentNote(true);
    });

    el.fieldTags.addEventListener('input', function () {
      renderTagPreview();
    });

    el.btnFilter.addEventListener('click', function () {
      state.tagFilter = (el.tagFilter.value || '').trim();
      renderLibrary();
    });

    el.btnFilterClear.addEventListener('click', function () {
      state.tagFilter = '';
      el.tagFilter.value = '';
      renderLibrary();
    });

    el.btnClearAll.addEventListener('click', function () {
      if (!confirm('确定清空全部灵感？此操作不可恢复。')) return;
      openDb().then(function (db) {
        return idbClear(db).then(function () {
          db.close();
          return refreshLibrary();
        });
      }).catch(function () {
        alert('清空失败');
      });
    });

    el.btnBuildExport.addEventListener('click', function () {
      renderExport();
    });
  }

  function init() {
    bind();
    showView('import');
    refreshLibrary().catch(function () {});
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
