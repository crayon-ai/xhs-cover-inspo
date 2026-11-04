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
    noteCategory: '',
    coverType: '',
    extraCategories: [],
    sheetId: null,
    sheetBase: null,
    sheetDraft: null,
    sheetExtraCats: []
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
    var onLibrary = name === 'library';
    var onNote = name === 'note';
    var darkChrome = onImport || onLibrary || onNote;
    var appRoot = document.getElementById('app');
    if (appRoot) {
      appRoot.classList.toggle('is-import', onImport);
      appRoot.classList.toggle('is-library', onLibrary);
      appRoot.classList.toggle('is-note', onNote);
      appRoot.classList.toggle('is-dark-chrome', darkChrome);
    }
    document.documentElement.classList.toggle('is-import', onImport);
    document.documentElement.classList.toggle('is-library', onLibrary);
    document.documentElement.classList.toggle('is-note', onNote);
    document.documentElement.classList.toggle('is-dark-chrome', darkChrome);
    if (document.body) {
      document.body.classList.toggle('is-import', onImport);
      document.body.classList.toggle('is-library', onLibrary);
      document.body.classList.toggle('is-note', onNote);
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

  function showPick(on) {
    if (el.importHit) el.importHit.classList.toggle('is-hidden', !!on);
    if (el.pickStage) el.pickStage.classList.toggle('is-hidden', !on);
    if (el.importStage) el.importStage.classList.toggle('is-pick', !!on);
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

  /** Horizontal rail of all candidates, Pinterest-pile motion while
   *  scrolling: each card keeps its own tilt at rest, rotation/scale/drift
   *  shift with distance from center so cards tumble as the strip moves. */
  var railTiltRaf = 0;

  function updateRailMotion() {
    var rail = el.pickRail;
    if (!rail) return;
    var slides = rail.querySelectorAll('.cover-card');
    var n = slides.length;
    if (!n) return;
    var rect = rail.getBoundingClientRect();
    var mid = rect.left + rail.clientWidth / 2;
    var centered = 0;
    var bestDist = Infinity;
    for (var i = 0; i < n; i++) {
      var slide = slides[i];
      var r = slide.getBoundingClientRect();
      var c = (r.left + r.right) / 2;
      var o = (c - mid) / Math.max(1, r.width);
      if (o > 1.6) o = 1.6;
      if (o < -1.6) o = -1.6;
      var ao = Math.abs(o);
      // Rest tilt at center, extra tumble toward the edges
      var tilt = (slide.__tilt || 0) * (1 - ao * 0.55) + o * 9;
      var sc = 1 - ao * 0.09;
      if (sc < 0.86) sc = 0.86;
      var ty = ao * 12 * (i % 2 ? -0.6 : 1); // subtle alternating drift
      slide.style.transform =
        'translateY(' + ty.toFixed(1) + 'px) rotate(' + tilt.toFixed(2) + 'deg) scale(' + sc.toFixed(3) + ')';
      slide.style.filter = ao > 0.4 ? 'brightness(' + Math.max(0.55, 1 - ao * 0.3).toFixed(2) + ')' : '';
      slide.classList.toggle('is-center', ao < 0.32);
      var d = Math.abs(c - mid);
      if (d < bestDist) {
        bestDist = d;
        centered = i;
      }
    }
    if (el.pickPager) {
      el.pickPager.classList.toggle('is-hidden', n === 0);
      el.pickPager.textContent = n ? (centered + 1) + ' / ' + n : '';
    }
  }

  function onRailScroll() {
    if (railTiltRaf) return;
    if (window.requestAnimationFrame) {
      railTiltRaf = window.requestAnimationFrame(function () {
        railTiltRaf = 0;
        updateRailMotion();
      });
    } else {
      updateRailMotion();
    }
  }

  function isCardCentered(slide) {
    var rail = el.pickRail;
    if (!rail || !slide) return false;
    var mid = rail.getBoundingClientRect().left + rail.clientWidth / 2;
    var r = slide.getBoundingClientRect();
    var c = (r.left + r.right) / 2;
    return Math.abs(c - mid) < Math.max(36, r.width * 0.32);
  }

  function renderCandidates() {
    var rail = el.pickRail;
    if (!rail) return;
    rail.innerHTML = '';
    var n = state.candidates.length;
    rail.classList.toggle('is-empty', !n);
    updateSaveSelectedBtn();

    if (!rail.__scrollBound) {
      rail.__scrollBound = true;
      rail.addEventListener('scroll', onRailScroll, { passive: true });
    }

    state.candidates.forEach(function (c, i) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cover-card' + (state.selectedIds[c.id] ? ' is-selected' : '');
      btn.setAttribute('data-id', c.id);
      btn.setAttribute('aria-label', '封面 ' + (i + 1));
      btn.__tilt = ((i * 47) % 11) - 5; // deterministic per-card rest tilt, -5..5deg
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

      var originX = 0;
      var moved = false;
      btn.addEventListener('pointerdown', function (ev) {
        originX = ev.clientX;
        moved = false;
      });
      btn.addEventListener('pointermove', function (ev) {
        if (Math.abs(ev.clientX - originX) > 10) moved = true;
      });
      btn.addEventListener('click', function () {
        if (moved) return;
        if (!isCardCentered(btn)) {
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
      updateRailMotion();
    }
    if (window.requestAnimationFrame) {
      window.requestAnimationFrame(afterLayout);
    } else {
      afterLayout();
    }
  }

  function updateSaveSelectedBtn() {
    if (!el.btnNote) return;
    var count = Object.keys(state.selectedIds).length;
    el.btnNote.disabled = count === 0;
  }

  function startNoteFlow() {
    var queue = state.candidates.filter(function (c) {
      return state.selectedIds[c.id];
    });
    if (!queue.length) return;
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

  var COVER_TYPES = [
    {
      id: 'result',
      name: '结果展示型',
      a: { key: 'coreResult', label: '核心结果', ph: '3个月瘦20斤、0粉→10万粉' },
      b: { key: 'evidence', label: '证据形式', ph: '前后对比照 / 后台数据截图 / 收益图' }
    },
    {
      id: 'emotion',
      name: '情绪共鸣型',
      a: { key: 'emotion', label: '主打情绪', ph: '破防——成年人的崩溃是静音的' },
      b: { key: 'hook', label: '戳人手法', ph: '第一人称独白 / 反问句 / 深夜氛围' }
    },
    {
      id: 'identity',
      name: '身份认同型',
      a: { key: 'audience', label: '锁定人群', ph: '30+裸辞的打工人、考研二战的人' },
      b: { key: 'identityDetail', label: '对号入座细节', ph: '周报、挤地铁、体检报告' }
    },
    {
      id: 'contrast',
      name: '认知反差型',
      a: { key: 'contrast', label: '认知反差', ph: '以为多喝水养胃 / 其实喝太多伤肾' },
      b: { key: 'support', label: '反差支撑', ph: '专业身份 / 具体数据 / 亲身经历' }
    },
    {
      id: 'info',
      name: '信息差干货型',
      a: { key: 'benefit', label: '具体好处', ph: '5个免费去水印工具、1个排版公式' },
      b: { key: 'gap', label: '信息差点', ph: '小众渠道 / 内部规则 / 没人整理过' }
    }
  ];

  function coverTypeById(id) {
    for (var i = 0; i < COVER_TYPES.length; i++) {
      if (COVER_TYPES[i].id === id) return COVER_TYPES[i];
    }
    return null;
  }

  function renderCoverTypes() {
    if (!el.noteTypeList) return;
    el.noteTypeList.innerHTML = '';
    COVER_TYPES.forEach(function (type) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'note-type__btn' + (state.coverType === type.id ? ' is-on' : '');
      btn.textContent = type.name;
      btn.setAttribute('role', 'option');
      btn.setAttribute('aria-selected', state.coverType === type.id ? 'true' : 'false');
      btn.addEventListener('click', function () {
        chooseCoverType(type.id);
      });
      el.noteTypeList.appendChild(btn);
    });
  }

  function showNoteStep() {
    var chosen = coverTypeById(state.coverType);
    if (el.noteType) el.noteType.hidden = !!chosen;
    if (el.noteForm) el.noteForm.hidden = !chosen;
    if (el.btnNoteSkipType) el.btnNoteSkipType.hidden = !!chosen;
    if (!chosen) return;
    if (el.fieldALabel) el.fieldALabel.textContent = chosen.a.label;
    if (el.fieldBLabel) el.fieldBLabel.textContent = chosen.b.label;
    if (el.fieldA) el.fieldA.placeholder = chosen.a.ph;
    if (el.fieldB) el.fieldB.placeholder = chosen.b.ph;
    if (el.btnTypeBack) el.btnTypeBack.textContent = chosen.name;
  }

  function chooseCoverType(id) {
    if (!coverTypeById(id)) return;
    if (state.coverType !== id) {
      if (el.fieldA) el.fieldA.value = '';
      if (el.fieldB) el.fieldB.value = '';
    }
    state.coverType = id;
    renderCoverTypes();
    showNoteStep();
    if (window.scrollTo) window.scrollTo(0, 0);
  }

  function clearCoverType() {
    state.coverType = '';
    if (el.fieldA) el.fieldA.value = '';
    if (el.fieldB) el.fieldB.value = '';
    renderCoverTypes();
    showNoteStep();
    if (window.scrollTo) window.scrollTo(0, 0);
  }

  function fitNoteCanvas(canvas) {
    var nw = canvas.width;
    var nh = canvas.height;
    if (!nw || !nh) return;
    var maxW = Math.min(148, Math.max(112, window.innerWidth * 0.36));
    var maxH = Math.min(176, Math.round(window.innerHeight * 0.22));
    var scale = Math.min(maxW / nw, maxH / nh);
    canvas.style.width = Math.max(1, Math.round(nw * scale)) + 'px';
    canvas.style.height = Math.max(1, Math.round(nh * scale)) + 'px';
  }

  /** 是否队列最后一张（含队列只有 1 张）：noteIndex + 1 >= noteQueue.length */
  function isLastNote() {
    return state.noteIndex + 1 >= state.noteQueue.length;
  }

  function fillNoteForm() {
    var item = state.noteQueue[state.noteIndex];
    // 切到下一张：复位折痕预演状态与按钮文案
    planeState = 'idle';
    if (el.noteCoverWrap) el.noteCoverWrap.classList.remove('is-confirming');
    if (el.btnNoteSave) el.btnNoteSave.textContent = '保存并下一张';
    el.noteProgress.textContent =
      (state.noteIndex + 1) + ' / ' + state.noteQueue.length;
    state.coverType = '';
    if (el.fieldHeadline) el.fieldHeadline.value = '';
    el.fieldWhy.value = '';
    if (el.fieldA) el.fieldA.value = '';
    if (el.fieldB) el.fieldB.value = '';
    if (el.fieldExtra) el.fieldExtra.value = '';
    renderCoverTypes();
    showNoteStep();
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
      var type = coverTypeById(state.coverType);
      if (!type) return;
      var record = {
        id: uid(),
        imageBlob: item.blob,
        width: item.width,
        height: item.height,
        coverType: type.id,
        headline: el.fieldHeadline ? (el.fieldHeadline.value || '').trim() : '',
        whyClick: (el.fieldWhy.value || '').trim(),
        extra: el.fieldExtra ? (el.fieldExtra.value || '').trim() : '',
        tags: [],
        category: type.name,
        createdAt: Date.now()
      };
      record[type.a.key] = el.fieldA ? (el.fieldA.value || '').trim() : '';
      record[type.b.key] = el.fieldB ? (el.fieldB.value || '').trim() : '';
      try {
        var db = await openDb();
        await idbPut(db, record);
        db.close();
        demoTrackIds.push(record.id);
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
      state.candidates = [];
      state.pendingFiles = [];
      state.pendingBitmaps = [];
      state.noteQueue = [];
      if (el.fileInput) el.fileInput.value = '';
      if (el.pickRail) el.pickRail.innerHTML = '';
      showPick(false);
      await refreshLibrary();
      showView('library');
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
    if (explicit === UNCATEGORIZED) explicit = '';
    if (explicit) return explicit;
    var tags = item && item.tags ? item.tags : [];
    if (tags.length) {
      var first = String(tags[0] || '').trim();
      if (first && first !== UNCATEGORIZED) return first;
    }
    return '';
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
    return Object.keys(counts).filter(function (name) {
      return name && name !== UNCATEGORIZED;
    }).sort(function (a, b) {
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
    if (!name || name === '全部' || name === UNCATEGORIZED) return '';
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

  function makeLibraryCard(item, extraClass) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'lib-card' + (extraClass ? ' ' + extraClass : '');
    if (extraClass === 'lib-row-card') {
      var w = item && item.width ? item.width : 0;
      var h = item && item.height ? item.height : 0;
      btn.style.aspectRatio = (w > 0 && h > 0) ? (w + ' / ' + h) : '3 / 4';
    }
    var label = item.headline || item.whyClick || recordCategory(item);
    if (item.feeling && !item.coverType) label += '，' + item.feeling;
    btn.setAttribute('aria-label', label || '封面');
    var canvas = document.createElement('canvas');
    btn.appendChild(canvas);
    var originX = 0;
    var originY = 0;
    var moved = false;
    btn.addEventListener('pointerdown', function (ev) {
      originX = ev.clientX;
      originY = ev.clientY;
      moved = false;
    });
    btn.addEventListener('pointermove', function (ev) {
      if (Math.abs(ev.clientX - originX) > 8 || Math.abs(ev.clientY - originY) > 8) moved = true;
    });
    btn.addEventListener('click', function () {
      if (moved) return;
      openLibrarySheet(item);
    });
    if (item.imageBlob) {
      paintBlobToCanvas(item.imageBlob, canvas).catch(function () {});
    }
    return btn;
  }

  function renderLibrary() {
    var isEmpty = !(state.library && state.library.length);
    if (el.libraryRows) el.libraryRows.hidden = isEmpty;
    if (el.libraryEmpty) {
      el.libraryEmpty.hidden = !isEmpty;
      el.libraryEmpty.textContent = '空';
    }
    if (el.btnClearAll) el.btnClearAll.hidden = isEmpty;
    if (isEmpty) return;
    renderLibraryRows();
  }

  function buildLibRow(sec) {
    var row = document.createElement('section');
    row.className = 'lib-row';
    var head = document.createElement('div');
    head.className = 'lib-row-head';
    var title = document.createElement('span');
    title.className = 'lib-row-title';
    title.textContent = sec.title;
    head.appendChild(title);
    var count = document.createElement('span');
    count.className = 'lib-row-count';
    count.textContent = sec.items.length;
    head.appendChild(count);
    row.appendChild(head);
    var track = document.createElement('div');
    track.className = 'lib-row-track';
    row.appendChild(track);
    row.__items = sec.items;
    row.__rendered = false;
    return row;
  }

  function renderLibRowItems(row) {
    if (!row || row.__rendered) return;
    row.__rendered = true;
    var track = row.querySelector('.lib-row-track');
    if (!track) return;
    (row.__items || []).forEach(function (item) {
      track.appendChild(makeLibraryCard(item, 'lib-row-card'));
    });
  }

  var libRowObserver = null;

  function observeLibRows() {
    if (!el.libraryRows) return;
    if (libRowObserver) {
      libRowObserver.disconnect();
      libRowObserver = null;
    }
    var rows = qsAll('.lib-row', el.libraryRows);
    if (typeof IntersectionObserver !== 'function') {
      rows.forEach(renderLibRowItems);
      return;
    }
    libRowObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        renderLibRowItems(en.target);
        if (libRowObserver) libRowObserver.unobserve(en.target);
      });
    }, { root: el.libScroll || null, rootMargin: '120% 0px' });
    rows.forEach(function (r) {
      libRowObserver.observe(r);
    });
  }

  function renderLibraryRows() {
    if (!el.libraryRows) return;
    el.libraryRows.innerHTML = '';
    var names = sortedCategoryNames(false);
    var sections = [];
    sections.push({ name: '', title: '最近收藏', items: state.library || [] });
    names.forEach(function (name) {
      sections.push({
        name: name,
        title: name,
        items: (state.library || []).filter(function (it) {
          return recordCategory(it) === name;
        })
      });
    });
    sections.forEach(function (sec) {
      el.libraryRows.appendChild(buildLibRow(sec));
    });
    observeLibRows();
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
    state.sheetId = null;
    state.sheetBase = null;
    state.sheetDraft = null;
    state.sheetExtraCats = [];
    hideSheetConfirm();
    if (el.sheetSave) el.sheetSave.hidden = true;
    if (el.sheetPanel) el.sheetPanel.style.transform = '';
    if (el.sheetCover) el.sheetCover.innerHTML = '';
    if (el.libSheet) el.libSheet.hidden = true;
  }

  function legacyExtra(item) {
    if (!item || item.coverType || item.extra) return String((item && item.extra) || '');
    var bits = [];
    if (item.feeling) bits.push(String(item.feeling));
    if (item.structure) bits.push(String(item.structure));
    if (item.learnable) bits.push(String(item.learnable));
    return bits.join('\n');
  }

  function sheetSnapshot(item) {
    var type = coverTypeById(item && item.coverType);
    var snap = {
      coverType: type ? type.id : '',
      headline: String((item && item.headline) || ''),
      whyClick: String((item && item.whyClick) || ''),
      extra: legacyExtra(item)
    };
    if (type) {
      snap[type.a.key] = String(item[type.a.key] || '');
      snap[type.b.key] = String(item[type.b.key] || '');
    }
    return snap;
  }

  function sheetNorm(value) {
    return String(value || '').trim();
  }

  function isSheetDirty() {
    var base = state.sheetBase;
    var draft = state.sheetDraft;
    if (!base || !draft) return false;
    var seen = {};
    var keys = Object.keys(base).concat(Object.keys(draft));
    for (var i = 0; i < keys.length; i++) {
      if (seen[keys[i]]) continue;
      seen[keys[i]] = true;
      if (sheetNorm(draft[keys[i]]) !== sheetNorm(base[keys[i]])) return true;
    }
    return false;
  }

  function syncSheetSaveBtn() {
    if (!el.sheetSave) return;
    el.sheetSave.hidden = !isSheetDirty();
  }

  function hideSheetConfirm() {
    if (el.sheetConfirm) el.sheetConfirm.hidden = true;
  }

  function showSheetConfirm() {
    if (!isSheetDirty() || !el.sheetConfirm) return;
    el.sheetConfirm.hidden = false;
  }

  function sheetCategoryOptions() {
    var names = sheetCategoryNames();
    (state.sheetExtraCats || []).forEach(function (name) {
      if (name && names.indexOf(name) === -1) names.push(name);
    });
    return names;
  }

  function paintSheetChips() {
    if (!el.sheetChips || !state.sheetDraft) return;
    var current = sheetNorm(state.sheetDraft.category);
    if (current === UNCATEGORIZED) current = '';
    el.sheetChips.innerHTML = '';
    sheetCategoryOptions().forEach(function (name) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'cat-chip' + (current === name ? ' is-active' : '');
      b.textContent = name;
      b.setAttribute('aria-pressed', current === name ? 'true' : 'false');
      b.addEventListener('click', function () {
        state.sheetDraft.category = name;
        paintSheetChips();
        syncSheetSaveBtn();
      });
      el.sheetChips.appendChild(b);
    });
  }

  /** Keep a textarea as tall as its content (min stays at rows). */
  function autoGrowTextarea(area) {
    area.style.height = 'auto';
    area.style.height = area.scrollHeight + 'px';
  }

  /** Detail-sheet field, styled like the note page's notch-label box. */
  function sheetAddEditor(parent, label, key) {
    var box = document.createElement('label');
    box.className = 'sheet-field';
    var k = document.createElement('span');
    k.textContent = label;
    var area = document.createElement('textarea');
    area.className = 'sheet-input';
    area.rows = 2;
    area.value = state.sheetDraft[key] || '';
    autoGrowTextarea(area);
    area.addEventListener('input', function () {
      state.sheetDraft[key] = area.value;
      autoGrowTextarea(area);
      syncSheetSaveBtn();
    });
    box.appendChild(k);
    box.appendChild(area);
    parent.appendChild(box);
  }

  /** Read-only type display: only the record's own chosen type. */
  function sheetAddType(parent, name) {
    var box = document.createElement('div');
    box.className = 'sheet-field sheet-field--static';
    var k = document.createElement('span');
    k.textContent = '封面类型';
    var v = document.createElement('p');
    v.className = 'sheet-v';
    v.textContent = name;
    box.appendChild(k);
    box.appendChild(v);
    parent.appendChild(box);
  }

  function sheetCategoryNames() {
    return sortedCategoryNames(true).filter(function (name) {
      return name && name !== UNCATEGORIZED;
    });
  }

  /** Detail sheet mirrors the note page: 封面主文案 → 为什么想点 →
   *  the record's own type's two fields → 补充想法. Legacy records
   *  without a coverType only show the common fields (their old
   *  feeling/structure/learnable text lives in extra). */
  function fillSheetFields(item) {
    if (!el.sheetFields || !item || !state.sheetDraft) return;
    el.sheetFields.innerHTML = '';
    var type = coverTypeById(state.sheetDraft.coverType);
    if (type) sheetAddType(el.sheetFields, type.name);
    sheetAddEditor(el.sheetFields, '封面主文案', 'headline');
    sheetAddEditor(el.sheetFields, '为什么想点', 'whyClick');
    if (type) {
      sheetAddEditor(el.sheetFields, type.a.label, type.a.key);
      sheetAddEditor(el.sheetFields, type.b.label, type.b.key);
    }
    sheetAddEditor(el.sheetFields, '补充想法', 'extra');
    sheetAddField(el.sheetFields, '保存', formatSavedAt(item.createdAt));
    syncSheetSaveBtn();
  }

  function commitSheetEdits() {
    var item = libraryItemById(state.sheetId);
    if (!item || !state.sheetDraft || !isSheetDirty()) return;
    var draft = state.sheetDraft;
    var prev = {};
    Object.keys(draft).forEach(function (key) {
      prev[key] = item[key];
      item[key] = sheetNorm(draft[key]);
    });
    var savedType = coverTypeById(item.coverType);
    if (savedType) item.category = savedType.name;
    (state.sheetExtraCats || []).forEach(rememberCategory);
    openDb().then(function (db) {
      return idbPut(db, item).then(function () {
        db.close();
        state.sheetBase = sheetSnapshot(item);
        state.sheetDraft = sheetSnapshot(item);
        state.sheetExtraCats = [];
        hideSheetConfirm();
        syncSheetSaveBtn();
        renderLibrary();
      });
    }).catch(function () {
      Object.keys(prev).forEach(function (key) {
        item[key] = prev[key];
      });
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
    state.sheetBase = sheetSnapshot(item);
    state.sheetDraft = sheetSnapshot(item);
    state.sheetExtraCats = [];
    hideSheetConfirm();
    fillSheetFields(item);
    el.libSheet.hidden = false;
    // scrollHeight is only valid once the sheet is visible in the DOM.
    requestAnimationFrame(function () {
      if (!el.sheetFields) return;
      var areas = el.sheetFields.querySelectorAll('textarea');
      for (var i = 0; i < areas.length; i++) autoGrowTextarea(areas[i]);
    });
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
    await slicePending();
  }

  function resetPick() {
    state.pendingFiles = [];
    state.pendingBitmaps = [];
    state.candidates = [];
    state.selectedIds = {};
    if (el.fileInput) el.fileInput.value = '';
    if (el.pickRail) el.pickRail.innerHTML = '';
    updateSaveSelectedBtn();
    showPick(false);
  }

  async function slicePending() {
    if (!state.pendingBitmaps.length) {
      showPick(false);
      return;
    }
    var all = [];
    try {
      for (var i = 0; i < state.pendingBitmaps.length; i++) {
        var part = await sliceFeed(state.pendingBitmaps[i]);
        all = all.concat(part);
      }
    } catch (e) {
      alert('切分失败：' + (e && e.message ? e.message : '未知错误'));
      showPick(false);
      return;
    }
    state.candidates = all;
    state.selectedIds = {};
    if (!all.length) {
      alert('没有切出可用封面，请换一张更接近双列信息流的整屏截图试试');
      showPick(false);
      if (el.pickRail) el.pickRail.innerHTML = '';
      return;
    }
    showView('import');
    showPick(true);
    renderCandidates();
  }

  /* ================= 折痕预演 · 纸飞机（记笔记确认动效） =================
   * idle --保存并下一张(末张/单张)--> animating（折痕前奏→折叠→飞行→save）
   * animating: 短暂折痕预演(~180ms) → 折叠(~1s) → 贝塞尔飞行(~0.9s) → 落地反馈 → saveCurrentNote(false)
   * 一次点击连贯完成，不停在确认等待态；「跳过这张」/返回类型选择确认态取消逻辑保留（无害）。 */
  var planeState = 'idle'; // idle -> animating
  var demoTrackIds = []; // 演示期间写入灵感库的记录 id，prepare 时清掉以便反复播放
  var PLANE_W = 150;
  var PLANE_H = 94;
  var FLY_MS = 900;

  function onNoteSubmit() {
    if (planeState === 'animating') return;
    if (planeState === 'confirming') { startFold(); return; }
    if (!coverTypeById(state.coverType)) return; // 未选类型：维持原早退行为
    // 折痕预演只在队列最后一张触发；非最后一张直接保存并切下一张
    if (!isLastNote()) { saveCurrentNote(false); return; }
    startFold();
  }

  function cancelConfirm() {
    if (planeState !== 'confirming') return;
    planeState = 'idle';
    if (el.noteCoverWrap) el.noteCoverWrap.classList.remove('is-confirming');
    if (el.btnNoteSave) el.btnNoteSave.textContent = '保存并下一张';
  }

  /** 折叠切片：以当前封面 canvas 为面，clip-path 切 3 片（左半 + 右上/右下翼）。 */
  function buildFoldSlices() {
    if (!el.ppStage) return null;
    var src = el.noteCover ? el.noteCover.querySelector('canvas') : null;
    if (!src || !src.width || !src.height) return null;
    var r = src.getBoundingClientRect();
    var wr = el.noteCoverWrap.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    el.ppStage.style.left = (r.left - wr.left) + 'px';
    el.ppStage.style.top = (r.top - wr.top) + 'px';
    el.ppStage.style.width = r.width + 'px';
    el.ppStage.style.height = r.height + 'px';
    el.ppStage.style.setProperty('--cw', r.width.toFixed(1));
    el.ppStage.style.setProperty('--ch', r.height.toFixed(1));
    el.ppStage.innerHTML = '';
    // 切片形状直接烘进 canvas（clip-path 会压 flat / 破坏 backface 剔除）
    var regions = {
      'fp-l': [[0, 0], [0.5, 0], [0.5, 1], [0, 1]],
      'fp-wt': [[0.5, 0], [1, 0], [1, 0.5]],
      'fp-wb': [[0.5, 1], [1, 1], [1, 0.5]]
    };
    var W = src.width;
    var H = src.height;
    function sliceCanvas(cls, isBack) {
      var cv = document.createElement('canvas');
      cv.width = W;
      cv.height = H;
      var ctx = cv.getContext('2d');
      var pts = regions[cls];
      ctx.beginPath();
      for (var i = 0; i < pts.length; i++) {
        var x = pts[i][0] * W;
        var y = pts[i][1] * H;
        if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      }
      ctx.closePath();
      if (isBack) { // 纸背：白纸打底叠印封面，折过去仍认得出「这张封面」
        var g = ctx.createLinearGradient(0, 0, W, H);
        g.addColorStop(0, '#fbfbfb');
        g.addColorStop(1, '#e3e3e3');
        ctx.fillStyle = g;
        ctx.fill();
        ctx.save();
        ctx.clip(); // 只在切片区域内叠印
        ctx.globalAlpha = 0.8;
        ctx.drawImage(src, 0, 0);
        ctx.globalAlpha = 0.1; // 薄薄一层白，保住「纸感」和明暗
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, W, H);
        ctx.restore();
      } else { // 正面：封面内容 + 裁出切片区域
        ctx.drawImage(src, 0, 0);
        ctx.globalCompositeOperation = 'destination-in';
        ctx.fill();
      }
      return cv;
    }
    ['fp-l', 'fp-wt', 'fp-wb'].forEach(function (cls) {
      var p = document.createElement('div');
      p.className = 'fp ' + cls;
      var face = document.createElement('div');
      face.className = 'pp-face';
      face.appendChild(sliceCanvas(cls, false));
      p.appendChild(face);
      var back = document.createElement('div');
      back.className = 'pp-back';
      back.appendChild(sliceCanvas(cls, true));
      p.appendChild(back);
      el.ppStage.appendChild(p);
    });
    return r;
  }

  function startFold() {
    if (planeState === 'animating') return;
    if (planeState !== 'idle' && planeState !== 'confirming') return; // 兼容旧 confirming 状态
    var rect = buildFoldSlices();
    if (!rect) { // 无可用封面（理论上不会发生）：退回原保存逻辑
      planeState = 'idle';
      if (el.noteCoverWrap) el.noteCoverWrap.classList.remove('is-confirming');
      if (el.btnNoteSave) el.btnNoteSave.textContent = '保存并下一张';
      saveCurrentNote(false);
      return;
    }
    planeState = 'animating';
    // 折痕作为同一次点击动画的前奏：短暂浮现，随即折叠起飞
    if (el.noteCoverWrap) el.noteCoverWrap.classList.add('is-confirming');
    if (el.btnNoteSave) el.btnNoteSave.textContent = '保存并下一张'; // 文案始终保持不变
    holdTabsVisible(); // 飞行目标 tab 持续可见（不受 1.5s 定时器影响）
    setTimeout(function () {
      if (el.noteCoverWrap) {
        el.noteCoverWrap.classList.remove('is-confirming');
        el.noteCoverWrap.classList.add('is-folding');
      }
      if (el.noteCover) el.noteCover.style.visibility = 'hidden'; // 原封面隐身留占位
      el.ppStage.classList.add('is-fold1'); // 第一折：沿中线对折
    }, 180);
    setTimeout(function () {
      el.ppStage.classList.add('is-fold2'); // 第二折：双翼沿对角折
    }, 680);
    setTimeout(settleAndFly, 1180);
  }

  function stageCenter() {
    var r = el.ppStage.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  function settleAndFly() {
    var from = stageCenter();
    el.ppStage.classList.add('is-settled'); // 折成飞机姿态
    setTimeout(function () {
      if (el.noteCoverWrap) el.noteCoverWrap.classList.add('is-flying');
      if (el.ppPlane) {
        el.ppPlane.style.opacity = '1';
        el.ppPlane.style.transform =
          'translate(' + (from.x - PLANE_W / 2) + 'px,' + (from.y - PLANE_H / 2) + 'px)';
      }
      flyToLibrary(from);
    }, 160);
  }

  /** 二次贝塞尔弧线飞向底部导航「灵感库」tab。 */
  function flyToLibrary(from) {
    holdTabsVisible(); // 测量前强制显示，且此刻动画位移已完成，rect 即真实位置
    var tab = document.querySelector('.tab[data-view="library"]');
    var to = { x: window.innerWidth / 2, y: window.innerHeight - 30 };
    if (tab) {
      var tr = tab.getBoundingClientRect();
      if (tr.width && tr.height && tr.top > 0) { // rect 有效才用，防御 tab 未就绪
        to = { x: tr.left + tr.width / 2, y: tr.top + tr.height / 2 };
      }
    }
    var cx = (from.x + to.x) / 2 + 40;
    var cy = from.y + (to.y - from.y) * 0.3 - 40; // 轻微上拱，整体向下/斜下飞向底部 tab

    function bez(p0, p1, p2, t) {
      var u = 1 - t;
      return u * u * p0 + 2 * u * t * p1 + t * t * p2;
    }

    var start = null;
    function step(now) {
      if (!el.ppPlane) return;
      if (!start) start = now;
      var t = Math.min((now - start) / FLY_MS, 1);
      var e = t * t * (3 - 2 * t); // smoothstep
      var x = bez(from.x, cx, to.x, e);
      var y = bez(from.y, cy, to.y, e);
      var dx = 2 * (1 - e) * (cx - from.x) + 2 * e * (to.x - cx);
      var dy = 2 * (1 - e) * (cy - from.y) + 2 * e * (to.y - cy);
      var ang = Math.atan2(dy, dx) * 180 / Math.PI;
      var scale = 1 - 0.5 * e; // 全程保持轮廓清楚，落地前仍约半尺寸
      el.ppPlane.style.transform =
        'translate(' + (x - PLANE_W / 2) + 'px,' + (y - PLANE_H / 2) + 'px) rotate(' +
        ang.toFixed(2) + 'deg) scale(' + scale.toFixed(3) + ')';
      if (t < 1) {
        requestAnimationFrame(step);
      } else {
        el.ppPlane.style.opacity = '0';
        landOnLibrary();
      }
    }
    requestAnimationFrame(step);
  }

  function landOnLibrary() {
    revealTabs(); // 落地时保证 tab 可见并轻弹
    var tab = document.querySelector('.tab[data-view="library"]');
    if (tab) {
      tab.classList.add('pp-hit');
      setTimeout(function () { tab.classList.remove('pp-hit'); }, 650);
    }
    if (el.ppToast) el.ppToast.classList.add('show');
    setTimeout(function () {
      if (el.ppToast) el.ppToast.classList.remove('show');
    }, 2600);

    // 落地反馈后走原有保存逻辑（真正写库并下一张 / 切灵感库）
    setTimeout(function () {
      saveCurrentNote(false).then(function () {
        cleanupFold();
      }).catch(function () {
        cleanupFold();
      });
    }, 380);
  }

  function cleanupFold() {
    planeState = 'idle';
    if (el.noteCoverWrap) el.noteCoverWrap.classList.remove('is-folding', 'is-flying');
    if (el.ppStage) {
      el.ppStage.classList.remove('is-fold1', 'is-fold2', 'is-settled');
      el.ppStage.innerHTML = '';
      el.ppStage.style.left = '';
      el.ppStage.style.top = '';
      el.ppStage.style.width = '';
      el.ppStage.style.height = '';
    }
    if (el.noteCover) el.noteCover.style.visibility = '';
    if (el.ppPlane) el.ppPlane.style.opacity = '0';
    if (el.btnNoteSave) el.btnNoteSave.textContent = '保存并下一张';
  }

  /* ---------- 录屏钩子 __demo ---------- */
  var DEMO_THEMES = [
    {
      stops: [['0', '#ffd9c2'], ['0.45', '#f7a8b8'], ['1', '#b8c6f7']],
      lines: ['裸辞3个月', '我后悔了吗'],
      type: 'result',
      headline: '裸辞3个月，我后悔了吗',
      why: '数字太夸张了、感觉在说我',
      a: '0粉→10万粉，用了90天',
      b: '后台数据截图',
      extra: '高饱和渐变 + 大字标题'
    },
    {
      stops: [['0', '#c2f7d9'], ['0.45', '#8fe3b0'], ['1', '#3f8ef7']],
      lines: ['成年人的崩溃', '是静音的'],
      type: 'emotion',
      headline: '成年人的崩溃，是静音的',
      why: '第一句就破防了',
      a: '破防——深夜加班回家的地铁上',
      b: '第一人称独白 + 深夜氛围',
      extra: '低饱和冷色 + 大留白'
    },
    {
      stops: [['0', '#f7f3c2'], ['0.45', '#f7c94b'], ['1', '#f78c5a']],
      lines: ['以为多喝水养胃', '其实喝太多伤肾'],
      type: 'contrast',
      headline: '以为多喝水养胃，其实伤肾',
      why: '反常识，想点进去看依据',
      a: '以为多喝水养胃 / 其实喝太多伤肾',
      b: '三甲医院医生亲述',
      extra: '高对比撞色 + 划线纠错排版'
    }
  ];

  function makeDemoCoverBlob(theme) {
    var canvas = document.createElement('canvas');
    canvas.width = 300;
    canvas.height = 400;
    var ctx = canvas.getContext('2d');
    var g = ctx.createLinearGradient(0, 0, 300, 400);
    theme.stops.forEach(function (s) { g.addColorStop(Number(s[0]), s[1]); });
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 300, 400);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = '700 34px sans-serif';
    ctx.fillText(theme.lines[0], 40, 170);
    ctx.fillText(theme.lines[1], 40, 220);
    return canvasToBlob(canvas, 'image/jpeg', 0.92);
  }

  /** 为当前 noteIndex 的封面预填类型与字段（fillNoteForm 之后调用）。 */
  function prefillDemoNote() {
    var theme = DEMO_THEMES[state.noteIndex] || DEMO_THEMES[0];
    chooseCoverType(theme.type);
    if (el.fieldHeadline) el.fieldHeadline.value = theme.headline;
    if (el.fieldWhy) el.fieldWhy.value = theme.why;
    if (el.fieldA) el.fieldA.value = theme.a;
    if (el.fieldB) el.fieldB.value = theme.b;
    if (el.fieldExtra) el.fieldExtra.value = theme.extra;
  }

  function prepareDemo() {
    return Promise.all(DEMO_THEMES.map(makeDemoCoverBlob)).then(function (blobs) {
      cleanupFold();
      if (el.ppToast) el.ppToast.classList.remove('show');
      var tab = document.querySelector('.tab[data-view="library"]');
      if (tab) tab.classList.remove('pp-hit');
      var clearPrev = Promise.resolve();
      if (demoTrackIds.length) { // 清掉上一次演示写入的记录，保证可反复播放
        clearPrev = openDb().then(function (db) {
          var chain = Promise.resolve();
          demoTrackIds.forEach(function (id) {
            chain = chain.then(function () { return idbDelete(db, id); });
          });
          return chain.then(function () {
            db.close();
            demoTrackIds = [];
            return refreshLibrary();
          });
        }).catch(function () { demoTrackIds = []; });
      }
      return clearPrev.then(function () {
        var items = blobs.map(function (blob, i) {
          return blob ? { id: uid(), blob: blob, width: 300, height: 400 } : null;
        }).filter(Boolean);
        if (!items.length) return;
        state.candidates = items;
        state.selectedIds = {};
        items.forEach(function (it) { state.selectedIds[it.id] = true; });
        state.noteQueue = items;
        state.noteIndex = 0;
        showView('note');
        fillNoteForm();
        prefillDemoNote();
      });
    });
  }

  /** 非最后一张：等同点一次「保存并下一张」（直接保存并预填下一张）；
   *  已是最后一张：no-op，返回 false。 */
  function demoSaveNext() {
    if (isLastNote()) return Promise.resolve(false);
    return saveCurrentNote(false).then(function () {
      if (state.noteQueue[state.noteIndex]) prefillDemoNote();
      return true;
    });
  }

  /** 最后一张直接启动折叠→飞行动效（一次到位）；否则串行 saveNext 直到最后一张。 */
  function demoStart() {
    function step() {
      if (isLastNote()) { startFold(); return true; }
      return demoSaveNext().then(step);
    }
    return Promise.resolve(step());
  }

  function bind() {
    el.importHit = $('import-hit');
    el.importStage = $('import-stage');
    el.importFakeStack = $('import-fake-stack');
    el.pickStage = $('pick-stage');
    el.pickRail = $('pick-rail');
    el.pickPager = $('pick-pager');
    el.btnNote = $('btn-note');
    el.fileInput = $('file-input');
    el.tabs = $('tabs');
    el.ask = $('ask');
    el.askText = $('ask-text');
    el.askCancel = $('ask-cancel');
    el.askOk = $('ask-ok');
    el.askBackdrop = $('ask-backdrop');
    el.noteCover = $('note-cover-preview');
    el.noteType = $('note-type');
    el.noteTypeList = $('note-type-list');
    el.btnTypeBack = $('btn-type-back');
    el.noteForm = $('note-form');
    el.fieldHeadline = $('field-headline');
    el.fieldWhy = $('field-why');
    el.fieldA = $('field-a');
    el.fieldB = $('field-b');
    el.fieldALabel = $('field-a-label');
    el.fieldBLabel = $('field-b-label');
    el.fieldExtra = $('field-extra');
    el.noteProgress = $('note-progress');
    el.noteCoverWrap = $('note-cover-wrap');
    el.ppCreases = $('pp-creases');
    el.ppStage = $('pp-stage');
    el.ppPlane = $('pp-plane');
    el.ppToast = $('pp-toast');
    el.btnNoteSave = $('btn-note-save');
    el.btnNoteSkip = $('btn-note-skip');
    el.btnNoteSkipType = $('btn-note-skip-type');
    el.libraryRows = $('library-rows');
    el.libraryEmpty = $('library-empty');
    el.libScroll = $('lib-scroll');
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
    el.sheetSave = $('sheet-save');
    el.sheetConfirm = $('sheet-confirm');
    el.sheetConfirmCancel = $('sheet-confirm-cancel');
    el.sheetConfirmOk = $('sheet-confirm-ok');
    el.sheetConfirmBackdrop = $('sheet-confirm-backdrop');
    el.btnRepick = $('btn-repick');

    qsAll('.tab').forEach(function (tab) {
      tab.addEventListener('click', function () {
        hideTabs();
        var name = tab.getAttribute('data-view');
        if (name === 'library') {
          refreshLibrary().then(function () {
            showView('library');
          });
        } else {
          showView(name);
          if (name === 'import') refreshImportStack();
        }
      });
    });

    el.fileInput.addEventListener('change', function () {
      onFilesChosen(el.fileInput.files);
    });

    el.btnNote.addEventListener('click', function () {
      startNoteFlow();
    });

    if (el.btnRepick) {
      el.btnRepick.addEventListener('click', function () {
        resetPick();
      });
    }

    el.noteForm.addEventListener('submit', function (ev) {
      ev.preventDefault();
      onNoteSubmit();
    });

    el.btnNoteSkip.addEventListener('click', function () {
      if (planeState === 'confirming') { cancelConfirm(); return; }
      if (planeState === 'animating') return;
      saveCurrentNote(true);
    });

    if (el.btnNoteSkipType) {
      el.btnNoteSkipType.addEventListener('click', function () {
        if (planeState === 'confirming') { cancelConfirm(); return; }
        if (planeState === 'animating') return;
        saveCurrentNote(true);
      });
    }

    if (el.btnTypeBack) {
      el.btnTypeBack.addEventListener('click', function () {
        cancelConfirm();
        clearCoverType();
      });
    }

    renderCoverTypes();
    showNoteStep();

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

    if (el.sheetSave) {
      el.sheetSave.addEventListener('click', function () {
        showSheetConfirm();
      });
    }

    if (el.sheetConfirmCancel) {
      el.sheetConfirmCancel.addEventListener('click', function () {
        hideSheetConfirm();
      });
    }

    if (el.sheetConfirmBackdrop) {
      el.sheetConfirmBackdrop.addEventListener('click', function () {
        hideSheetConfirm();
      });
    }

    if (el.sheetConfirmOk) {
      el.sheetConfirmOk.addEventListener('click', function () {
        commitSheetEdits();
      });
    }

    if (el.sheetDelete) {
      el.sheetDelete.addEventListener('click', function () {
        var id = state.sheetId;
        if (!id) return;
        askConfirm('删除这张？', function () {
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
      });
    }

    if (el.sheetHandle) {
      el.sheetHandle.addEventListener('pointerdown', onSheetPointerDown);
      el.sheetHandle.addEventListener('pointermove', onSheetPointerMove);
      el.sheetHandle.addEventListener('pointerup', onSheetPointerUp);
      el.sheetHandle.addEventListener('pointercancel', onSheetPointerUp);
    }

    document.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Escape' || !el.libSheet || el.libSheet.hidden) return;
      if (el.sheetConfirm && !el.sheetConfirm.hidden) {
        hideSheetConfirm();
        return;
      }
      closeLibrarySheet();
    });

    el.btnClearAll.addEventListener('click', function () {
      askConfirm('清空全部？', function () {
        openDb().then(function (db) {
          return idbClear(db).then(function () {
            db.close();
            closeLibrarySheet();
            return refreshLibrary();
          });
        }).catch(function () {
          alert('清空失败');
        });
      });
    });
  }

  var tabTimer = 0;
  var askHandler = null;
  var gestureY = 0;

  /** 折叠/飞行期间强制底部导航持续可见：清掉 1.5s 自动隐藏定时器并同步显示。 */
  function holdTabsVisible() {
    if (!el.tabs) return;
    if (tabTimer) clearTimeout(tabTimer);
    tabTimer = 0;
    el.tabs.hidden = false;
    el.tabs.classList.add('is-shown'); // 同步加类，保证随后 getBoundingClientRect 已是真实位置
  }

  function revealTabs() {
    if (!el.tabs) return;
    if (tabTimer) clearTimeout(tabTimer);
    el.tabs.hidden = false;
    if (window.requestAnimationFrame) {
      window.requestAnimationFrame(function () {
        if (el.tabs) el.tabs.classList.add('is-shown');
      });
    } else {
      el.tabs.classList.add('is-shown');
    }
    tabTimer = setTimeout(function () {
      tabTimer = 0;
      if (!el.tabs) return;
      el.tabs.classList.remove('is-shown');
      setTimeout(function () {
        if (el.tabs && !el.tabs.classList.contains('is-shown')) el.tabs.hidden = true;
      }, 220);
    }, 1500);
  }

  function hideTabs() {
    if (tabTimer) clearTimeout(tabTimer);
    tabTimer = 0;
    if (!el.tabs) return;
    el.tabs.classList.remove('is-shown');
    el.tabs.hidden = true;
  }

  function askConfirm(message, onOk) {
    if (!el.ask) return;
    askHandler = onOk;
    if (el.askText) el.askText.textContent = message;
    el.ask.hidden = false;
  }

  function closeAsk() {
    askHandler = null;
    if (el.ask) el.ask.hidden = true;
  }

  function bindScrollReveal(node) {
    if (!node || node.__xhsTabBound) return;
    node.__xhsTabBound = true;
    node.addEventListener('scroll', revealTabs, false);
    node.addEventListener('touchmove', function (ev) {
      if (!ev.touches || !ev.touches[0]) return;
      var y = ev.touches[0].clientY;
      if (Math.abs(y - gestureY) > 10) revealTabs();
      gestureY = y;
    }, false);
    node.addEventListener('wheel', function (ev) {
      if (ev.deltaY) revealTabs();
    }, false);
  }

  function bindChromeMotion() {
    document.addEventListener('touchstart', function (ev) {
      if (ev.touches && ev.touches[0]) gestureY = ev.touches[0].clientY;
    }, false);
    bindScrollReveal(window);
    bindScrollReveal(document);
    bindScrollReveal(document.body);
    bindScrollReveal(document.getElementById('app'));
    bindScrollReveal(document.getElementById('lib-scroll'));
    bindScrollReveal(document.getElementById('pick-rail'));
    bindScrollReveal(document.getElementById('note-scroll'));

    if (el.askCancel) el.askCancel.addEventListener('click', closeAsk);
    if (el.askBackdrop) el.askBackdrop.addEventListener('click', closeAsk);
    if (el.askOk) {
      el.askOk.addEventListener('click', function () {
        var fn = askHandler;
        closeAsk();
        if (fn) fn();
      });
    }
  }

  function init() {
    bind();
    bindChromeMotion();
    showView('import');
    refreshLibrary().catch(function () {});
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // 录屏钩子：默认页面仍从导入页开始，不自动播放。
  window.__demo = {
    prepare: function () { return prepareDemo(); },
    saveNext: function () { return demoSaveNext(); },
    start: function () { return demoStart(); },
    confirm: startFold,
    reset: function () { return prepareDemo(); }
  };

  // 仅供无交互录屏 / 回归：?__demo=play 才自动预填并播放完整多封面流程；
  // 默认打开不受影响（仍是导入页）。
  if (/[?&]__demo=play/.test(window.location.search)) {
    var bootDemo = function () {
      window.__demo.prepare().then(function () {
        return window.__demo.saveNext(); // 第 1 → 2 张：直接保存切下一张
      }).then(function () {
        return window.__demo.saveNext(); // 第 2 → 3 张（最后一张）
      }).then(function () {
        window.__demo.start(); // 已在最后一张，直接 startFold：折痕前奏 → 折叠 → 飞灵感库
      });
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', bootDemo);
    } else {
      bootDemo();
    }
  }
})();
