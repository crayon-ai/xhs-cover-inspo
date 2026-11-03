(function () {
  'use strict';

  var DB_NAME = 'xhs-cover-inspo';
  var DB_VERSION = 1;
  var STORE = 'inspirations';
  // Projection analysis tuning (validated on real feed screenshots)
  var PROJ_STEP = 3;      // px stride when sampling projections
  var WHITE_BRIGHT = 245; // pixel brightness >= this counts as "white"
  var GAP_ROW = 0.02;     // row counts as near-empty below this non-white ratio

  var state = {
    view: 'import',
    pendingFiles: [],
    pendingBitmaps: [],
    candidates: [],
    selectedIds: {},
    noteQueue: [],
    noteIndex: 0,
    library: [],
    categoryFilter: '',
    noteCategory: '',
    extraCategories: [],
    sheetId: null
  };

  var el = {};

  // Test hook: lets the regression driver inspect slicing output. No behavior change.
  window.__xhs_state = state;

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
    var onImport = name === 'import';
    var onCandidates = name === 'candidates';
    var onLibrary = name === 'library';
    var onNote = name === 'note';
    var onExport = name === 'export';
    var darkChrome = onImport || onCandidates || onLibrary || onNote || onExport;
    var appRoot = document.getElementById('app');
    if (appRoot) {
      appRoot.classList.toggle('is-import', onImport);
      appRoot.classList.toggle('is-candidates', onCandidates);
      appRoot.classList.toggle('is-library', onLibrary);
      appRoot.classList.toggle('is-note', onNote);
      appRoot.classList.toggle('is-export', onExport);
      appRoot.classList.toggle('is-dark-chrome', darkChrome);
    }
    document.documentElement.classList.toggle('is-import', onImport);
    document.documentElement.classList.toggle('is-candidates', onCandidates);
    document.documentElement.classList.toggle('is-library', onLibrary);
    document.documentElement.classList.toggle('is-note', onNote);
    document.documentElement.classList.toggle('is-export', onExport);
    document.documentElement.classList.toggle('is-dark-chrome', darkChrome);
    if (document.body) {
      document.body.classList.toggle('is-import', onImport);
      document.body.classList.toggle('is-candidates', onCandidates);
      document.body.classList.toggle('is-library', onLibrary);
      document.body.classList.toggle('is-note', onNote);
      document.body.classList.toggle('is-export', onExport);
      document.body.classList.toggle('is-dark-chrome', darkChrome);
    }
    if (!onLibrary) closeLibrarySheet();
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
   * Grid detection via row/column projection (offline pixel analysis, no ML).
   * Cover heights vary row by row and paddings differ per screenshot, so a
   * fixed grid always drifts; projections measure the actual layout instead.
   */
  function buildPixelData(bitmap, imgW, imgH) {
    var canvas = document.createElement('canvas');
    canvas.width = imgW;
    canvas.height = imgH;
    var ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0);
    return ctx.getImageData(0, 0, imgW, imgH).data;
  }

  function findColumns(data, imgW, imgH) {
    var rows = Math.floor(imgH / PROJ_STEP);
    var thr = Math.max(2, rows * 0.15);
    var dens = [];
    for (var x = 0; x < imgW; x++) {
      var cnt = 0;
      for (var y = 0; y < imgH; y += PROJ_STEP) {
        var i = (y * imgW + x) * 4;
        if ((data[i] + data[i + 1] + data[i + 2]) / 3 < WHITE_BRIGHT) cnt++;
      }
      dens.push(cnt);
    }
    var runs = [];
    var start = -1;
    for (x = 0; x <= imgW; x++) {
      var on = x < imgW && dens[x] > thr;
      if (on && start < 0) start = x;
      if (!on && start >= 0) {
        runs.push({ x0: start, x1: x - 1, w: x - start });
        start = -1;
      }
    }
    runs.sort(function (a, b) { return b.w - a.w; });
    var minW = Math.round(imgW * 0.25);
    runs = runs.slice(0, 2).filter(function (r) { return r.w >= minW; });
    runs.sort(function (a, b) { return a.x0 - b.x0; });
    return runs;
  }

  function findCoverBlocksInColumn(data, imgW, imgH, x0, x1) {
    var colW = x1 - x0 + 1;
    var dens = [];
    for (var y = 0; y < imgH; y++) {
      var cnt = 0;
      var total = 0;
      for (var x = x0; x <= x1; x += PROJ_STEP) {
        total++;
        var i = (y * imgW + x) * 4;
        if ((data[i] + data[i + 1] + data[i + 2]) / 3 < WHITE_BRIGHT) cnt++;
      }
      dens.push(cnt / total);
    }
    var gapRows = Math.max(4, Math.round(imgH * 0.002));
    var blocks = [];
    y = 0;
    while (y < imgH) {
      if (dens[y] > GAP_ROW) {
        var s = y;
        var e = y;
        var run = 0;
        while (y < imgH) {
          if (dens[y] <= GAP_ROW) {
            run++;
            if (run >= gapRows) break;
          } else {
            run = 0;
            e = y;
          }
          y++;
        }
        blocks.push({ y0: s, y1: e });
      } else {
        y++;
      }
    }
    var covers = [];
    var minCoverH = Math.round(colW * 0.3);
    for (var b = 0; b < blocks.length; b++) {
      var blk = blocks[b];
      // Blocks touching the very top are the fixed chrome (status bar, nav,
      // tabs); real covers never start at y=0 inside the app.
      if (blk.y0 <= 1) continue;
      // Cover blocks are tall; title/author/like rows are short strips.
      // White-background covers still segment correctly because the gaps
      // around them are pure white while their interior is not.
      if (blk.y1 - blk.y0 + 1 < minCoverH) continue;
      covers.push({ y0: blk.y0, y1: blk.y1 });
    }
    return covers;
  }

  function detectGridCovers(data, imgW, imgH) {
    var cols = findColumns(data, imgW, imgH);
    var tiles = [];
    for (var c = 0; c < cols.length; c++) {
      var col = cols[c];
      var blocks = findCoverBlocksInColumn(data, imgW, imgH, col.x0, col.x1);
      for (var b = 0; b < blocks.length; b++) {
        tiles.push({
          col: c,
          x: col.x0,
          w: col.x1 - col.x0 + 1,
          y0: blocks[b].y0,
          y1: blocks[b].y1
        });
      }
    }
    // Reading order: sort top-down, split into rows by vertical overlap
    tiles.sort(function (a, b) { return a.y0 - b.y0; });
    var row = 0;
    for (var t = 0; t < tiles.length; t++) {
      if (t > 0) {
        var prev = tiles[t - 1];
        var overlap = Math.min(prev.y1, tiles[t].y1) - Math.max(prev.y0, tiles[t].y0);
        if (overlap < (prev.y1 - prev.y0 + 1) * 0.5) row++;
      }
      tiles[t].row = row;
    }
    return tiles;
  }

  async function sliceFeed(bitmap) {
    var imgW = bitmap.width || bitmap.naturalWidth;
    var imgH = bitmap.height || bitmap.naturalHeight;
    var results = [];
    if (!imgW || !imgH) return results;
    var data = buildPixelData(bitmap, imgW, imgH);
    var tiles = detectGridCovers(data, imgW, imgH);
    for (var t = 0; t < tiles.length; t++) {
      var tile = tiles[t];
      var h = tile.y1 - tile.y0 + 1;
      var canvas = document.createElement('canvas');
      canvas.width = tile.w;
      canvas.height = h;
      var ctx = canvas.getContext('2d');
      ctx.drawImage(bitmap, tile.x, tile.y0, tile.w, h, 0, 0, tile.w, h);
      var blob = await canvasToBlob(canvas, 'image/jpeg', 0.9);
      if (blob) {
        results.push({
          id: uid(),
          blob: blob,
          width: tile.w,
          height: h,
          sourceX: tile.x,
          sourceY: tile.y0,
          col: tile.col,
          row: tile.row
        });
      }
    }
    // Prefer reading order: row by row, left then right
    results.sort(function (a, b) {
      if (a.row !== b.row) return a.row - b.row;
      return a.col - b.col;
    });
    return results;
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

  var candidatesRailScrollBound = false;
  var candidatesTiltRaf = 0;

  function getCenteredSlideIndex() {
    var rail = el.candidatesRail;
    if (!rail) return 0;
    var slides = rail.querySelectorAll('.cover-card');
    if (!slides.length) return 0;
    var mid = rail.getBoundingClientRect().left + rail.clientWidth / 2;
    var best = 0;
    var bestDist = Infinity;
    for (var i = 0; i < slides.length; i++) {
      var r = slides[i].getBoundingClientRect();
      var c = (r.left + r.right) / 2;
      var d = Math.abs(c - mid);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    return best;
  }

  function isSlideCentered(slide) {
    var rail = el.candidatesRail;
    if (!rail || !slide) return false;
    var mid = rail.getBoundingClientRect().left + rail.clientWidth / 2;
    var r = slide.getBoundingClientRect();
    var c = (r.left + r.right) / 2;
    return Math.abs(c - mid) < Math.max(36, r.width * 0.32);
  }

  /** Craft Your Postcard-style tilt: center slight Z, neighbors rotateY away */
  function updateCandidateTilts() {
    var rail = el.candidatesRail;
    if (!rail) return;
    var slides = rail.querySelectorAll('.cover-card');
    if (!slides.length) return;
    var mid = rail.getBoundingClientRect().left + rail.clientWidth / 2;
    for (var i = 0; i < slides.length; i++) {
      var slide = slides[i];
      var r = slide.getBoundingClientRect();
      var c = (r.left + r.right) / 2;
      var o = (c - mid) / Math.max(1, r.width);
      if (o > 1.35) o = 1.35;
      if (o < -1.35) o = -1.35;
      /* keep neighbor faces readable (Craft peek), not edge-on */
      var rotY = o * -34;
      var rotZ = 5.5 - o * 7;
      var sc = 1 - Math.abs(o) * 0.06;
      if (sc < 0.88) sc = 0.88;
      var ty = Math.abs(o) * 8;
      slide.style.transform =
        'perspective(900px) translateY(' + ty + 'px) rotateY(' + rotY + 'deg) rotateZ(' + rotZ + 'deg) scale(' + sc + ')';
      slide.classList.toggle('is-center', Math.abs(o) < 0.28);
    }
  }

  function updateCandidatesPager() {
    if (!el.candidatesPager) return;
    var n = state.candidates.length;
    if (!n) {
      el.candidatesPager.classList.add('is-hidden');
      el.candidatesPager.textContent = '';
      return;
    }
    el.candidatesPager.classList.remove('is-hidden');
    var idx = getCenteredSlideIndex();
    el.candidatesPager.textContent = (idx + 1) + ' / ' + n;
    updateCandidateTilts();
  }

  function onCandidatesRailScroll() {
    if (candidatesTiltRaf) return;
    if (window.requestAnimationFrame) {
      candidatesTiltRaf = window.requestAnimationFrame(function () {
        candidatesTiltRaf = 0;
        updateCandidatesPager();
      });
    } else {
      updateCandidatesPager();
    }
  }

  function renderCandidates() {
    var rail = el.candidatesRail;
    rail.innerHTML = '';
    var n = state.candidates.length;
    el.candidatesMeta.textContent = n
      ? ('共切出 ' + n + ' 张。左右滑切换，点中间卡选中。')
      : '先导入截图再切分。';
    el.btnSelectAll.disabled = !n;
    el.btnClearSel.disabled = !n;
    rail.classList.toggle('is-empty', !n);
    updateSaveSelectedBtn();

    if (!candidatesRailScrollBound && rail) {
      rail.addEventListener('scroll', onCandidatesRailScroll, { passive: true });
      candidatesRailScrollBound = true;
    }

    state.candidates.forEach(function (c) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cover-card' + (state.selectedIds[c.id] ? ' is-selected' : '');
      btn.setAttribute('data-id', c.id);
      btn.setAttribute('aria-label', '候选封面');
      var face = document.createElement('span');
      face.className = 'cover-face';
      var canvas = document.createElement('canvas');
      face.appendChild(canvas);
      var badge = document.createElement('span');
      badge.className = 'badge';
      badge.setAttribute('aria-hidden', 'true');
      badge.textContent = '✓';
      btn.appendChild(face);
      btn.appendChild(badge);
      rail.appendChild(btn);
      paintBlobToCanvas(c.blob, canvas).catch(function () {});

      var dragOriginX = 0;
      var dragMoved = false;
      btn.addEventListener('pointerdown', function (ev) {
        dragOriginX = ev.clientX;
        dragMoved = false;
      });
      btn.addEventListener('pointermove', function (ev) {
        if (Math.abs(ev.clientX - dragOriginX) > 10) dragMoved = true;
      });
      btn.addEventListener('click', function () {
        if (dragMoved) return;
        if (!isSlideCentered(btn)) {
          if (btn.scrollIntoView) {
            btn.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
          }
          return;
        }
        if (state.selectedIds[c.id]) {
          delete state.selectedIds[c.id];
        } else {
          state.selectedIds[c.id] = true;
        }
        btn.classList.toggle('is-selected', !!state.selectedIds[c.id]);
        updateSaveSelectedBtn();
      });
    });

    function afterLayout() {
      rail.scrollLeft = 0;
      updateCandidatesPager();
    }
    if (window.requestAnimationFrame) {
      window.requestAnimationFrame(afterLayout);
    } else {
      afterLayout();
    }
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

  function fitNoteCanvas(canvas) {
    var nw = canvas.width;
    var nh = canvas.height;
    if (!nw || !nh) return;
    var maxW = Math.min(260, Math.max(160, window.innerWidth - 96));
    var maxH = Math.round(window.innerHeight * 0.42);
    var scale = Math.min(maxW / nw, maxH / nh);
    canvas.style.width = Math.max(1, Math.round(nw * scale)) + 'px';
    canvas.style.height = Math.max(1, Math.round(nh * scale)) + 'px';
  }

  function fillNoteForm() {
    var item = state.noteQueue[state.noteIndex];
    el.noteProgress.textContent =
      (state.noteIndex + 1) + ' / ' + state.noteQueue.length;
    el.fieldWhy.value = '';
    el.fieldFeeling.value = '';
    el.fieldStructure.value = '';
    el.fieldLearn.value = '';
    el.fieldTags.value = '';
    state.noteCategory = '';
    if (el.fieldNewCat) el.fieldNewCat.value = '';
    renderTagPreview();
    renderNoteCategories();
    el.noteCover.innerHTML = '';
    var canvas = document.createElement('canvas');
    el.noteCover.appendChild(canvas);
    if (item) {
      paintBlobToCanvas(item.blob, canvas).then(function () {
        fitNoteCanvas(canvas);
      }).catch(function () {});
    }
    if (window.scrollTo) window.scrollTo(0, 0);
  }

  async function saveCurrentNote(skip) {
    var item = state.noteQueue[state.noteIndex];
    if (!item) return;

    if (!skip) {
      var tags = parseTags(el.fieldTags.value);
      var category = (state.noteCategory || '').trim();
      if (category.length > 20) category = category.slice(0, 20);
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
        category: category,
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
    renderNoteCategories();
    refreshImportStack();
  }

  var UNCATEGORIZED = '未分类';

  function recordCategory(item) {
    var explicit = item && item.category ? String(item.category).trim() : '';
    if (explicit) return explicit;
    var tags = item && item.tags ? item.tags : [];
    if (tags.length) {
      var first = String(tags[0] || '').trim();
      if (first) return first;
    }
    return UNCATEGORIZED;
  }

  function categoryCounts() {
    var counts = {};
    (state.library || []).forEach(function (item) {
      var name = recordCategory(item);
      counts[name] = (counts[name] || 0) + 1;
    });
    return counts;
  }

  function sortedCategoryNames(includeEmpty) {
    var counts = categoryCounts();
    (state.extraCategories || []).forEach(function (name) {
      if (includeEmpty && name && counts[name] == null) counts[name] = 0;
    });
    return Object.keys(counts).sort(function (a, b) {
      if (a === UNCATEGORIZED) return 1;
      if (b === UNCATEGORIZED) return -1;
      if (counts[b] !== counts[a]) return counts[b] - counts[a];
      return a < b ? -1 : a > b ? 1 : 0;
    });
  }

  function formatSavedAt(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    if (isNaN(d.getTime())) return '';
    function pad(n) { return n < 10 ? '0' + n : '' + n; }
    return d.getFullYear() + '.' + pad(d.getMonth() + 1) + '.' + pad(d.getDate());
  }

  function normalizeCategoryName(raw) {
    var name = String(raw || '').trim().replace(/\s+/g, ' ');
    if (!name || name === '全部') return '';
    if (name.length > 20) name = name.slice(0, 20);
    return name;
  }

  function rememberCategory(name) {
    if (!name) return;
    if (state.extraCategories.indexOf(name) === -1) state.extraCategories.push(name);
  }

  function addNoteCategory() {
    if (!el.fieldNewCat) return;
    var name = normalizeCategoryName(el.fieldNewCat.value);
    el.fieldNewCat.value = '';
    if (!name) return;
    rememberCategory(name);
    state.noteCategory = name;
    renderNoteCategories();
  }

  function renderNoteCategories() {
    if (!el.noteCatChips) return;
    var selected = (state.noteCategory || '').trim();
    var names = sortedCategoryNames(true);
    if (names.indexOf(UNCATEGORIZED) === -1) names.push(UNCATEGORIZED);
    el.noteCatChips.innerHTML = '';
    names.forEach(function (name) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'cat-chip' + (selected === name ? ' is-active' : '');
      b.textContent = name;
      b.setAttribute('role', 'option');
      b.setAttribute('aria-selected', selected === name ? 'true' : 'false');
      b.addEventListener('click', function () {
        state.noteCategory = state.noteCategory === name ? '' : name;
        renderNoteCategories();
      });
      el.noteCatChips.appendChild(b);
    });
  }

  function coverRatio(item) {
    var w = item && item.width ? item.width : 0;
    var h = item && item.height ? item.height : 0;
    if (w > 0 && h > 0) return h / w;
    return 4 / 3;
  }

  function makeLibraryCard(item) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'lib-card';
    var label = recordCategory(item);
    if (item.feeling) label += '，' + item.feeling;
    btn.setAttribute('aria-label', label);
    var canvas = document.createElement('canvas');
    btn.appendChild(canvas);
    btn.addEventListener('click', function () {
      openLibrarySheet(item);
    });
    if (item.imageBlob) {
      paintBlobToCanvas(item.imageBlob, canvas).catch(function () {});
    }
    return btn;
  }

  function passesCategoryFilter(item) {
    var filter = state.categoryFilter || '';
    if (!filter) return true;
    if (state.sheetId && item && item.id === state.sheetId) return true;
    return recordCategory(item) === filter;
  }

  function renderLibrary() {
    var names = sortedCategoryNames(false);
    if (state.categoryFilter && names.indexOf(state.categoryFilter) === -1) {
      names.push(state.categoryFilter);
    }
    var filter = state.categoryFilter || '';
    var list = (state.library || []).filter(passesCategoryFilter);

    if (el.catBar) {
      var keepScroll = el.catBar.scrollLeft || 0;
      el.catBar.innerHTML = '';
      var options = [''].concat(names);
      options.forEach(function (name) {
        var label = name || '全部';
        var active = filter === name;
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'cat-chip' + (active ? ' is-active' : '');
        b.textContent = label;
        b.setAttribute('role', 'tab');
        b.setAttribute('aria-selected', active ? 'true' : 'false');
        b.addEventListener('click', function () {
          state.categoryFilter = name;
          renderLibrary();
          if (el.libScroll) el.libScroll.scrollTop = 0;
        });
        el.catBar.appendChild(b);
      });
      el.catBar.scrollLeft = keepScroll;
    }

    if (el.btnClearAll) el.btnClearAll.hidden = !(state.library && state.library.length);

    var box = el.libraryList;
    if (!box) return;
    box.innerHTML = '';
    var empty = !list.length;
    box.hidden = empty;
    if (el.libraryEmpty) {
      el.libraryEmpty.hidden = !empty;
      el.libraryEmpty.textContent = filter ? '这个分类是空的' : '还没有封面';
    }
    if (empty) return;

    var cols = [document.createElement('div'), document.createElement('div')];
    var heights = [0, 0];
    cols[0].className = 'lib-col';
    cols[1].className = 'lib-col';
    list.forEach(function (item) {
      var side = heights[0] <= heights[1] ? 0 : 1;
      heights[side] += coverRatio(item);
      cols[side].appendChild(makeLibraryCard(item));
    });
    box.appendChild(cols[0]);
    box.appendChild(cols[1]);
  }

  function sheetAddField(parent, label, value) {
    var text = value ? String(value).trim() : '';
    if (!text) return;
    var row = document.createElement('div');
    row.className = 'sheet-row';
    var k = document.createElement('p');
    k.className = 'sheet-k';
    k.textContent = label;
    var v = document.createElement('p');
    v.className = 'sheet-v';
    v.textContent = text;
    row.appendChild(k);
    row.appendChild(v);
    parent.appendChild(row);
  }

  function tagsLine(item) {
    var tags = (item && item.tags ? item.tags : []).map(function (t) {
      return String(t || '').trim();
    }).filter(Boolean);
    if (!tags.length) return '';
    var cat = recordCategory(item);
    if (tags.length === 1 && tags[0] === cat) return '';
    return tags.join('、');
  }

  function libraryItemById(id) {
    var list = state.library || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) return list[i];
    }
    return null;
  }

  function closeLibrarySheet() {
    var id = state.sheetId;
    var dropFromFilter = false;
    if (id && state.categoryFilter) {
      var openItem = libraryItemById(id);
      if (openItem && recordCategory(openItem) !== state.categoryFilter) dropFromFilter = true;
    }
    state.sheetId = null;
    if (el.sheetPanel) el.sheetPanel.style.transform = '';
    if (el.sheetCover) el.sheetCover.innerHTML = '';
    if (el.libSheet) el.libSheet.hidden = true;
    if (dropFromFilter) renderLibrary();
  }

  function sheetCategoryNames() {
    var names = sortedCategoryNames(true);
    if (names.indexOf(UNCATEGORIZED) === -1) names.push(UNCATEGORIZED);
    return names;
  }

  function fillSheetFields(item) {
    if (!el.sheetFields || !item) return;
    el.sheetFields.innerHTML = '';
    sheetAddField(el.sheetFields, '为何想点', item.whyClick);
    sheetAddField(el.sheetFields, '感觉', item.feeling);
    sheetAddField(el.sheetFields, '结构亮点', item.structure);
    sheetAddField(el.sheetFields, '画面可学点', item.learnable);

    var row = document.createElement('div');
    row.className = 'sheet-row sheet-row--cat';
    var k = document.createElement('p');
    k.className = 'sheet-k';
    k.textContent = '分类';
    var chips = document.createElement('div');
    chips.className = 'sheet-cat-chips';
    var current = recordCategory(item);
    sheetCategoryNames().forEach(function (name) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'cat-chip' + (current === name ? ' is-active' : '');
      b.textContent = name;
      b.setAttribute('aria-pressed', current === name ? 'true' : 'false');
      b.addEventListener('click', function () {
        saveSheetCategory(item, name);
      });
      chips.appendChild(b);
    });
    var add = document.createElement('div');
    add.className = 'sheet-cat-add';
    var input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 20;
    input.placeholder = '新分类';
    input.setAttribute('aria-label', '新分类');
    input.autocomplete = 'off';
    var addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.textContent = '添加';
    function addSheetCategory() {
      var name = normalizeCategoryName(input.value);
      if (!name) return;
      input.value = '';
      rememberCategory(name);
      saveSheetCategory(item, name);
    }
    addBtn.addEventListener('click', addSheetCategory);
    input.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        addSheetCategory();
      }
    });
    add.appendChild(input);
    add.appendChild(addBtn);
    row.appendChild(k);
    row.appendChild(chips);
    row.appendChild(add);
    el.sheetFields.appendChild(row);

    sheetAddField(el.sheetFields, '标签', tagsLine(item));
    sheetAddField(el.sheetFields, '保存', formatSavedAt(item.createdAt));
  }

  function saveSheetCategory(item, name) {
    if (!item || !name || recordCategory(item) === name) return;
    var prev = item.category;
    item.category = name;
    openDb().then(function (db) {
      return idbPut(db, item).then(function () {
        db.close();
        var fresh = libraryItemById(item.id) || item;
        fresh.category = name;
        renderLibrary();
        if (state.sheetId === item.id && el.libSheet && !el.libSheet.hidden) {
          fillSheetFields(fresh);
        }
      });
    }).catch(function () {
      item.category = prev;
      alert('保存失败');
    });
  }

  function fitSheetCanvas(canvas) {
    var nw = canvas.width;
    var nh = canvas.height;
    if (!nw || !nh || !el.sheetCover) return;
    var maxW = el.sheetCover.clientWidth || Math.min(360, window.innerWidth - 32);
    var maxH = Math.round(window.innerHeight * 0.32);
    if (maxW < 80) maxW = 80;
    if (maxH < 120) maxH = 120;
    var scale = Math.min(maxW / nw, maxH / nh);
    canvas.style.width = Math.max(1, Math.round(nw * scale)) + 'px';
    canvas.style.height = Math.max(1, Math.round(nh * scale)) + 'px';
  }

  function openLibrarySheet(item) {
    if (!el.libSheet || !item) return;
    state.sheetId = item.id;
    if (el.sheetPanel) {
      el.sheetPanel.style.transform = '';
      el.sheetPanel.scrollTop = 0;
    }
    if (el.sheetCover) {
      el.sheetCover.innerHTML = '';
      var canvas = document.createElement('canvas');
      el.sheetCover.appendChild(canvas);
      if (item.imageBlob) {
        paintBlobToCanvas(item.imageBlob, canvas).then(function () {
          fitSheetCanvas(canvas);
        }).catch(function () {});
      }
    }
    fillSheetFields(item);
    el.libSheet.hidden = false;
  }

  var sheetDrag = null;

  function onSheetPointerDown(ev) {
    if (!el.sheetHandle) return;
    if (ev.target !== el.sheetHandle) return;
    sheetDrag = { y: ev.clientY, id: ev.pointerId };
    if (el.sheetHandle.setPointerCapture) {
      try { el.sheetHandle.setPointerCapture(ev.pointerId); } catch (e) {}
    }
  }

  function onSheetPointerMove(ev) {
    if (!sheetDrag || ev.pointerId !== sheetDrag.id || !el.sheetPanel) return;
    var dy = ev.clientY - sheetDrag.y;
    if (dy < 0) dy = 0;
    el.sheetPanel.style.transform = 'translateY(' + dy + 'px)';
  }

  function onSheetPointerUp(ev) {
    if (!sheetDrag || ev.pointerId !== sheetDrag.id) return;
    var dy = ev.clientY - sheetDrag.y;
    sheetDrag = null;
    if (el.sheetPanel) el.sheetPanel.style.transform = '';
    if (dy > 72) closeLibrarySheet();
  }

  function buildPromptText(item) {
    var lines = [];
    lines.push('【小红书封面参考提示词】');
    lines.push('目标：生成一张小红书笔记封面，竖版约 3:4。');
    var explicitCat = item.category ? String(item.category).trim() : '';
    if (explicitCat) lines.push('分类：' + explicitCat);
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
      board.textContent = '还没有封面';
      return;
    }

    var title = document.createElement('p');
    title.className = 'export-count';
    title.textContent = list.length + ' 条';
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

  function resetImport() {
    state.pendingFiles = [];
    state.pendingBitmaps = [];
    if (el.fileInput) el.fileInput.value = '';
    renderImportPreview();
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
    el.btnResetImport = $('btn-reset-import');
    el.fileInput = $('file-input');
    el.candidatesRail = $('candidates-rail');
    el.candidatesPager = $('candidates-pager');
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
    el.libraryEmpty = $('library-empty');
    el.libScroll = $('lib-scroll');
    el.catBar = $('cat-bar');
    el.noteCatChips = $('note-cat-chips');
    el.fieldNewCat = $('field-new-cat');
    el.btnAddCat = $('btn-add-cat');
    el.btnClearAll = $('btn-clear-all');
    el.libSheet = $('lib-sheet');
    el.sheetPanel = $('lib-sheet-panel');
    el.sheetHandle = $('lib-sheet-handle');
    el.sheetCover = $('lib-sheet-cover');
    el.sheetFields = $('lib-sheet-fields');
    el.sheetClose = $('lib-sheet-close');
    el.sheetBackdrop = $('lib-sheet-backdrop');
    el.sheetDelete = $('lib-sheet-delete');
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

    el.btnResetImport.addEventListener('click', function () {
      resetImport();
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

    if (el.btnAddCat) {
      el.btnAddCat.addEventListener('click', function () {
        addNoteCategory();
      });
    }

    if (el.fieldNewCat) {
      el.fieldNewCat.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') {
          ev.preventDefault();
          addNoteCategory();
        }
      });
    }

    if (el.sheetBackdrop) {
      el.sheetBackdrop.addEventListener('click', function () {
        closeLibrarySheet();
      });
    }

    if (el.sheetClose) {
      el.sheetClose.addEventListener('click', function () {
        closeLibrarySheet();
      });
    }

    if (el.sheetDelete) {
      el.sheetDelete.addEventListener('click', function () {
        var id = state.sheetId;
        if (!id) return;
        if (!confirm('确定删除这张封面？')) return;
        openDb().then(function (db) {
          return idbDelete(db, id).then(function () {
            db.close();
            closeLibrarySheet();
            return refreshLibrary();
          });
        }).catch(function () {
          alert('删除失败');
        });
      });
    }

    if (el.sheetHandle) {
      el.sheetHandle.addEventListener('pointerdown', onSheetPointerDown);
      el.sheetHandle.addEventListener('pointermove', onSheetPointerMove);
      el.sheetHandle.addEventListener('pointerup', onSheetPointerUp);
      el.sheetHandle.addEventListener('pointercancel', onSheetPointerUp);
    }

    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && el.libSheet && !el.libSheet.hidden) closeLibrarySheet();
    });

    el.btnClearAll.addEventListener('click', function () {
      if (!confirm('确定清空全部灵感？此操作不可恢复。')) return;
      openDb().then(function (db) {
        return idbClear(db).then(function () {
          db.close();
          state.categoryFilter = '';
          closeLibrarySheet();
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
