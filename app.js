(function () {
  'use strict';

  // Flex-gap 行为检测（css-compatibility §4）：语法检测不能证明 Flex 布局中 gap 生效，
  // 必须实测布局。检测一次加 class，驱动 .supports-flex-gap 样式层。
  (function supportsFlexGap() {
    var flex = document.createElement('div');
    flex.style.position = 'absolute';
    flex.style.visibility = 'hidden';
    flex.style.display = 'flex';
    flex.style.flexDirection = 'column';
    flex.style.rowGap = '1px';
    flex.appendChild(document.createElement('div'));
    flex.appendChild(document.createElement('div'));
    document.body.appendChild(flex);
    var supported = flex.scrollHeight === 1;
    flex.parentNode.removeChild(flex);
    if (supported) document.documentElement.classList.add('supports-flex-gap');
  })();

  var DB_NAME = 'xhs-cover-inspo';
  var DB_VERSION = 1;
  var STORE = 'inspirations';
  // 自建分类持久化：customs 稳定 id 只存在这份列表；封面记录仍用 category: 名字字符串
  var CATS_KEY = 'xhs-cover-inspo-cats-v1';
  // Projection analysis tuning (validated on real feed screenshots)
  var PROJ_STEP = 3;      // px stride when sampling projections
  var WHITE_BRIGHT = 245; // pixel brightness >= this counts as "white"
  var GAP_ROW = 0.02;     // row counts as near-empty below this non-white ratio
  // Note: near-empty gaps come in two flavours — page gutters render at
  // ~250 brightness (gray), while whitespace INSIDE a cover (collage
  // seams, white-background text covers) is pure white (>=253). Only the
  // first kind should split covers; see findCoverBlocksInColumn.

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
    customCategories: [],
    deletedDefaults: [],   // 已删除默认类型 id（result/emotion/...），持久化防复活
    deletedCustoms: [],    // 已删自建分类名（normalize 后），防扫库同名补回
    libFilter: 'all',
    sheetId: null,
    sheetBase: null,
    sheetDraft: null,
    sheetExtraCats: [],
    viewerId: null,
    viewerIndex: -1
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

  // —— 自建分类：localStorage 读写全部 try/catch，失败降级内存（收藏只在 IndexedDB）——

  function syncExtraCategories() {
    state.extraCategories = (state.customCategories || []).map(function (c) {
      return c.name;
    }).filter(Boolean);
  }

  function persistCustomCategories() {
    try {
      localStorage.setItem(CATS_KEY, JSON.stringify({
        version: 2,
        customs: state.customCategories || [],
        deletedDefaults: state.deletedDefaults || [],
        deletedCustoms: state.deletedCustoms || [],
        filter: state.libFilter || 'all'
      }));
    } catch (e) {
      // 写失败：内存保留，轻提示不打断主流程
      appToast('分类暂未保存到本地');
    }
  }

  function loadCustomCategories() {
    try {
      var raw = localStorage.getItem(CATS_KEY);
      if (raw) {
        var data = JSON.parse(raw);
        // version 1 旧格式无删除记录；version 2 起带 deletedDefaults/deletedCustoms
        if (data && (data.version === 1 || data.version === 2) && Array.isArray(data.customs)) {
          state.customCategories = data.customs.filter(function (c) {
            return c && c.name;
          }).map(function (c) {
            return { id: String(c.id || 'custom_' + uid()), name: String(c.name), createdAt: Number(c.createdAt) || 0 };
          });
        }
        if (data && Array.isArray(data.deletedDefaults)) {
          state.deletedDefaults = data.deletedDefaults.map(function (id) { return String(id); });
        }
        if (data && Array.isArray(data.deletedCustoms)) {
          state.deletedCustoms = data.deletedCustoms.map(function (n) { return String(n); });
        }
        state.libFilter = typeof data.filter === 'string' && data.filter ? data.filter : 'all';
      }
    } catch (e) {
      // 读失败：空列表 + all，内存降级
    }
    // 兼容脏数据：剔除与默认类型重名的 custom（历史 bug 误写入）
    var removed = false;
    if (state.customCategories && state.customCategories.length) {
      var defaults = defaultTypeNames();
      var kept = state.customCategories.filter(function (c) {
        if (defaults[normalizeCategoryName(c.name)]) {
          removed = true;
          return false;
        }
        return true;
      });
      if (removed) state.customCategories = kept;
    }
    syncExtraCategories();
    // 刷新后筛选不得是被删类型名：回落到「全部」
    if (state.libFilter && state.libFilter !== 'all' && isDeletedCategoryName(state.libFilter)) {
      state.libFilter = 'all';
    }
    if (removed) persistCustomCategories();
  }

  /** 默认五类 name 集合：library 里出现同名分类时不补录 custom，避免与默认类型重名 */
  function defaultTypeNames() {
    var names = {};
    COVER_TYPES.forEach(function (t) {
      names[normalizeCategoryName(t.name)] = true;
    });
    return names;
  }

  function findCustomByName(name) {
    var norm = normalizeCategoryName(name);
    var list = state.customCategories || [];
    for (var i = 0; i < list.length; i++) {
      if (normalizeCategoryName(list[i].name) === norm) return list[i];
    }
    return null;
  }

  /** 该默认类型 id 是否已被用户删除（管理类型面板里删掉的不再出现/补录） */
  function isDeletedDefault(id) {
    return (state.deletedDefaults || []).indexOf(String(id)) !== -1;
  }

  /** 该分类名是否是被删默认类型名或已删自建名：均不得再进入任何类型列表 */
  function isDeletedCategoryName(name) {
    var norm = normalizeCategoryName(name);
    if (!norm) return false;
    for (var i = 0; i < COVER_TYPES.length; i++) {
      if (COVER_TYPES[i].id && isDeletedDefault(COVER_TYPES[i].id) &&
          normalizeCategoryName(COVER_TYPES[i].name) === norm) return true;
    }
    return (state.deletedCustoms || []).indexOf(norm) !== -1;
  }

  /** 删除类型：默认按 id 记入 deletedDefaults；自建按 normalize 名记入 deletedCustoms。
   *  只删类型，绝不动 IndexedDB 封面。 */
  function deleteCoverType(id) {
    var def = null;
    for (var i = 0; i < COVER_TYPES.length; i++) {
      if (COVER_TYPES[i].id === id) def = COVER_TYPES[i];
    }
    if (def) {
      if ((state.deletedDefaults || []).indexOf(id) === -1) state.deletedDefaults.push(id);
    } else {
      var custom = null;
      var list = state.customCategories || [];
      for (var j = 0; j < list.length; j++) {
        if (list[j].id === id) custom = list[j];
      }
      if (!custom) return;
      var norm = normalizeCategoryName(custom.name);
      if (norm && (state.deletedCustoms || []).indexOf(norm) === -1) state.deletedCustoms.push(norm);
      state.customCategories = list.filter(function (c) { return c.id !== id; });
    }
    // 当前筛选正好是被删类型名：回落到「全部」
    if (state.libFilter && state.libFilter !== 'all' &&
        (def ? state.libFilter === def.name : state.libFilter === custom.name)) {
      state.libFilter = 'all';
    }
    syncExtraCategories();
    persistCustomCategories();
    if (state.coverType === id) clearCoverType();
    renderLibrary();
    renderNoteCategories();
    renderCoverTypes();
    renderTypeSheet();
  }

  /** 兼容「历史里已有但未入 customs 的分类名」：扫库补录，绝不清空 library */
  function syncCustomCategoriesFromLibrary() {
    var seen = {};
    (state.library || []).forEach(function (item) {
      var name = recordCategory(item);
      if (name && !seen[name]) seen[name] = true;
    });
    var added = false;
    var defaults = defaultTypeNames();
    Object.keys(seen).forEach(function (name) {
      if (defaults[normalizeCategoryName(name)]) return; // 默认类型名不补录
      if (isDeletedCategoryName(name)) return; // 已删默认/自建：封面仍在库，但类型不复活
      rememberCategory(name);
      if (!findCustomByName(name)) {
        state.customCategories.push({ id: 'custom_' + uid(), name: name, createdAt: Date.now() });
        added = true;
      }
    });
    if (added || state.extraCategories.length !== (state.customCategories || []).length) {
      syncExtraCategories();
      persistCustomCategories();
    }
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
    if (!onLibrary) {
      closeLibrarySheet();
      closeViewer();
    }
  }

  function revokeUrls(list) {
    (list || []).forEach(function (u) {
      try {
        URL.revokeObjectURL(u);
      } catch (e) {}
    });
  }

  // 兜底弹窗：msg 转字符串并 trim，空则直接 return，绝不 alert('')/alert(undefined)。
  // 背景：小工具容器对异步续体（await 之后）里调用的原生 alert 存在桥接缺陷，
  // 文案可能丢失 → 弹出「空白系统框 + 红色确定」；这里至少保证不传空文案。
  function safeAlert(msg) {
    var s = String(msg == null ? '' : msg).trim();
    if (!s) return;
    alert(s);
  }

  // 极简轻提示（.app-toast）：替代 alert 做非阻塞反馈
  var appToastTimer = 0;
  function appToast(text) {
    var node = document.getElementById('app-toast');
    var s = String(text == null ? '' : text).trim();
    if (!node || !s) return;
    node.textContent = s;
    node.hidden = false;
    if (appToastTimer) clearTimeout(appToastTimer);
    appToastTimer = setTimeout(function () {
      appToastTimer = 0;
      node.hidden = true;
    }, 1500);
  }

  // 相册文件 MIME 可能为空字符串，此时按扩展名判断是否图片，避免误报「请选择图片文件」
  function isImageFile(f) {
    if (!f) return false;
    if (f.type && f.type.indexOf('image/') === 0) return true;
    var name = (f.name || '').toLowerCase();
    return /\.(jpe?g|png|gif|webp|bmp|heic|heif)$/.test(name);
  }

  // 超时包装：部分 WebView 对相册 File 解码可能挂起，超时后降级；
  // 超时以 TimeoutError reject，晚到的原 promise 结果不再消费。
  function withTimeout(promise, ms) {
    var settled = false;
    var p = Promise.resolve(promise).then(
      function (v) { settled = true; return v; },
      function (e) { settled = true; throw e; }
    );
    var to = new Promise(function (_resolve, reject) {
      setTimeout(function () {
        if (!settled) {
          var err = new Error('timeout');
          err.name = 'TimeoutError';
          reject(err);
        }
      }, ms);
    });
    return Promise.race([p, to]);
  }

  // 导入运行状态：runId 防并发 change 互相清 state；busy 导入锁；
  // activeBitmaps 记录本 run 持有的、需要 close() 的 ImageBitmap。
  var IMPORT = {
    runId: 0,
    busy: false,
    failShown: false,
    activeBitmaps: [],
    timeouts: { cib: 1200, img: 3000, reader: 5000, total: 45000 }
  };

  // ---- bitmap 登记/释放：run 边界兜底 close，slice 用完即 close ----
  function registerBitmap(bmp) {
    if (bmp && bmp.close && IMPORT.activeBitmaps.indexOf(bmp) < 0) IMPORT.activeBitmaps.push(bmp);
  }
  function releaseBitmap(bmp) {
    var i = IMPORT.activeBitmaps.indexOf(bmp);
    if (i >= 0) IMPORT.activeBitmaps.splice(i, 1);
    if (bmp && bmp.close) {
      try { bmp.close(); } catch (e) {}
    }
  }
  function closeAllBitmaps() {
    var n = IMPORT.activeBitmaps.length;
    for (var i = 0; i < n; i++) {
      var b = IMPORT.activeBitmaps[i];
      if (b && b.close) { try { b.close(); } catch (e) {} }
    }
    IMPORT.activeBitmaps = [];
  }

  // ---- 加载/失败状态卡（非阻塞，替代 alert 主路径） ----
  function showImportLoading(text) {
    var card = document.getElementById('import-status');
    if (!card) return;
    card.hidden = false;
    card.className = 'import-status is-loading';
    card.textContent = text || '导入中…';
  }
  function showImportFail(text) {
    var card = document.getElementById('import-status');
    IMPORT.failShown = true;
    if (!card) { appToast(text); return; }
    card.hidden = false;
    card.className = 'import-status is-fail';
    card.textContent = '';
    var span = document.createElement('span');
    span.textContent = text;
    card.appendChild(span);
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'import-retry';
    btn.className = 'import-status__retry';
    btn.textContent = '再试一次';
    btn.addEventListener('click', function () {
      hideImportStatus();
      if (el.fileInput) el.fileInput.click();
    });
    card.appendChild(btn);
  }
  function hideImportStatus() {
    IMPORT.failShown = false;
    var card = document.getElementById('import-status');
    if (card) { card.hidden = true; card.textContent = ''; }
  }
  function clearImportFail() { hideImportStatus(); }

  async function fileToBitmap(file, runId) {
    // 优先 createImageBitmap；部分 WebView 对相册 File 解码可能挂起或 reject，
    // 有界超时后顺序降级到 Image(blob:)，再不行降级 FileReader → dataURL
    //（App 对 blob: 更严时），避免中断导入链路。
    runId = runId == null ? IMPORT.runId : runId;
    // 第 1 步：createImageBitmap，有界；超时后置 cibCancelled，
    // 晚到的结果只 close 不交给业务（不做「CIB 与 Image 双成功竞争」）。
    if (typeof createImageBitmap === 'function') {
      var cibCancelled = false;
      var cibPromise = createImageBitmap(file);
      cibPromise.then(function (bmp) {
        // 超时降级后晚到的结果：只 close、不交给业务
        if (cibCancelled) {
          if (bmp && bmp.close) { try { bmp.close(); } catch (e) {} }
        }
      }, function () {
        // late reject 由 race/sidecar 吞掉，避免 unhandledrejection
      });
      try {
        var bmp = await withTimeout(cibPromise, IMPORT.timeouts.cib);
        if (runId !== IMPORT.runId) {
          // 迟到结果属于旧 run：close，禁止写入 state
          if (bmp && bmp.close) { try { bmp.close(); } catch (e) {} }
          var err = new Error('stale run');
          err.name = 'StaleRunError';
          throw err;
        }
        registerBitmap(bmp);
        return bmp;
      } catch (e) {
        if (e && e.name === 'StaleRunError') throw e;
        cibCancelled = true; // 先置位，再降级；late CIB 只 close
      }
    }
    // 第 2 步：Image(blob:)，3000ms 有界；超时 revokeObjectURL 后走第 3 步
    try {
      return await decodeViaBlobImage(file, runId);
    } catch (e) {
      if (e && e.name === 'StaleRunError') throw e;
    }
    // 第 3 步：FileReader → dataURL → Image，整体 5000ms 有界
    return await decodeViaFileReader(file, runId);
  }

  function decodeViaBlobImage(file, runId) {
    return new Promise(function (resolve, reject) {
      var finished = false;
      var url = URL.createObjectURL(file);
      var img = new Image();
      var to = setTimeout(function () {
        if (finished) return;
        finished = true;
        try { URL.revokeObjectURL(url); } catch (e) {}
        reject(new Error('image timeout'));
      }, IMPORT.timeouts.img);
      img.onload = function () {
        if (finished) return;
        finished = true;
        clearTimeout(to);
        URL.revokeObjectURL(url);
        if (runId !== IMPORT.runId) {
          var err = new Error('stale run');
          err.name = 'StaleRunError';
          reject(err);
          return;
        }
        resolve(img);
      };
      img.onerror = function () {
        if (finished) return;
        finished = true;
        clearTimeout(to);
        URL.revokeObjectURL(url);
        reject(new Error('image error'));
      };
      img.src = url;
    });
  }

  function decodeViaFileReader(file, runId) {
    return new Promise(function (resolve, reject) {
      var finished = false;
      var fail = function (msg) {
        if (finished) return;
        finished = true;
        clearTimeout(to);
        reject(new Error(msg));
      };
      var to = setTimeout(function () {
        fail('reader timeout');
      }, IMPORT.timeouts.reader);
      var reader = new FileReader();
      reader.onload = function () {
        if (finished) return;
        var img2 = new Image();
        img2.onload = function () {
          if (finished) return;
          finished = true;
          clearTimeout(to);
          if (runId !== IMPORT.runId) {
            var err = new Error('stale run');
            err.name = 'StaleRunError';
            reject(err);
            return;
          }
          resolve(img2);
        };
        img2.onerror = function () { fail('dataurl image error'); };
        img2.src = reader.result;
      };
      reader.onerror = function () { fail('reader error'); };
      reader.readAsDataURL(file);
    });
  }

  function canvasToBlob(canvas, type, quality) {
    // 同步 toDataURL 主路径（部分 WebView 的 canvas.toBlob 会静默不出回调）：
    // 校验 data URI 头与 payload，任何一步失败 resolve(null)，消费方按失败处理。
    var t = type || 'image/jpeg';
    var q = quality == null ? 0.92 : quality;
    return new Promise(function (resolve) {
      var data;
      try {
        data = canvas.toDataURL(t, q);
      } catch (e) {
        resolve(null);
        return;
      }
      var comma = data.indexOf(',');
      var head = comma >= 0 ? data.slice(0, comma) : '';
      var payload = comma >= 0 ? data.slice(comma + 1) : '';
      if (!/^data:image\/[a-z0-9.+-]+;base64$/i.test(head) || !payload) {
        resolve(null);
        return;
      }
      var bin, arr;
      try {
        bin = atob(payload);
        arr = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      } catch (e2) {
        resolve(null);
        return;
      }
      var blob;
      try {
        blob = new Blob([arr], { type: t });
      } catch (e3) {
        resolve(null);
        return;
      }
      resolve(blob);
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

  // True when a near-empty gap is a pure-white interior seam (merge the
  // blocks it separates) rather than containing gray page-gutter rows
  // (real card boundary). Per-row test: white padding around a card
  // boundary must not dilute a gutter row (~250 across ~97% of the column)
  // into passing; light JPEG halos around dark cover edges stay well under.
  function gapIsWhiteSeam(data, imgW, gy0, gy1, x0, x1) {
    var found = false;
    for (var y = gy0; y <= gy1; y += PROJ_STEP) {
      found = true;
      if (gutterFracInXRange(data, imgW, y, x0, x1) > 0.6) return false;
    }
    return found;
  }

  // Build density blocks over [x0, x1] and merge neighbours separated by
  // pure-white interior seams. mergeFromY: gaps starting above it are never
  // merged (sticky top bar / chrome region where a partial cover may sit
  // right below the bar — merging there glues unrelated strips together).
  // Merges that would exceed maxMergedH are refused, so a cover never grows
  // into the title/author rows of the next card. Each block records its
  // tallest raw piece: a block made only of short text rows is a caption
  // strip, not a cover (callers filter it out).
  function blocksWithWhiteMerge(data, imgW, imgH, dens, x0, x1, mergeFromY, yBase, maxMergedH) {
    var colW = x1 - x0 + 1;
    var gapRows = Math.max(4, Math.round(imgH * 0.002));
    var raw = [];
    var y = 0;
    while (y < dens.length) {
      if (dens[y] > GAP_ROW) {
        var s = y;
        var e = y;
        var run = 0;
        while (y < dens.length) {
          if (dens[y] <= GAP_ROW) {
            run++;
            if (run >= gapRows) break;
          } else {
            run = 0;
            e = y;
          }
          y++;
        }
        raw.push({ y0: yBase + s, y1: yBase + e });
      } else {
        y++;
      }
    }
    if (maxMergedH == null) {
      maxMergedH = Math.round(colW * 1.35);
    }
    var maxSeam = Math.round(colW * 0.25);
    var blocks = [];
    for (var b = 0; b < raw.length; b++) {
      var blk = raw[b];
      var prev = blocks.length ? blocks[blocks.length - 1] : null;
      if (prev) {
        var gy0 = prev.y1 + 1;
        var gy1 = blk.y0 - 1;
        if (gy0 >= mergeFromY && gy1 - gy0 + 1 <= maxSeam &&
            blk.y1 - prev.y0 + 1 <= maxMergedH &&
            gapIsWhiteSeam(data, imgW, gy0, gy1, x0, x1)) {
          prev.y1 = blk.y1;
          prev.pieces.push(blk.y1 - blk.y0 + 1);
          continue;
        }
      }
      blocks.push({ y0: blk.y0, y1: blk.y1, pieces: [blk.y1 - blk.y0 + 1] });
    }
    return blocks;
  }

  function findCoverBlocksInColumn(data, imgW, imgH, x0, x1, mergeFromY) {
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
    if (mergeFromY == null) {
      mergeFromY = Math.max(80, Math.round(imgH * 0.11));
    }
    var blocks = blocksWithWhiteMerge(data, imgW, imgH, dens, x0, x1, mergeFromY, 0);
    var covers = [];
    var minCoverH = Math.round(colW * 0.35);
    for (var b = 0; b < blocks.length; b++) {
      var blk = blocks[b];
      // Blocks touching the very top are the fixed chrome (status bar, nav,
      // tabs); real covers never start at y=0 inside the app.
      if (blk.y0 <= 1) continue;
      // Cover blocks are tall; title/author/like rows are short strips.
      // White-background covers still segment correctly because the gaps
      // around them are pure white while their interior is not.
      if (blk.y1 - blk.y0 + 1 < minCoverH) continue;
      // A merged block whose every raw piece is short is a caption strip
      // (title + author rows fused across white gaps), not a cover.
      var maxPiece = 0;
      for (var p = 0; p < blk.pieces.length; p++) {
        if (blk.pieces[p] > maxPiece) maxPiece = blk.pieces[p];
      }
      if (maxPiece < Math.round(colW * 0.25)) continue;
      covers.push({ y0: blk.y0, y1: blk.y1 });
    }
    return covers;
  }

  // --- Card-based detection ----------------------------------------------
  // Some screenshots render the page gutter at ~250 brightness while card
  // backgrounds are pure white (255). There the projection logic above is
  // blind to white-background covers and splits them at interior near-white
  // rows. When that 250-vs-255 distinction exists, detect complete cards
  // (white regions bounded above AND below by gutter rows) and cut each
  // cover at its title block instead. Images without the distinction (or
  // cards cut off by chrome) fall through to the projection logic below.

  function gutterFracAtRow(data, imgW, y) {
    // Page-gutter brightness is ~250; card/pure white is >=253.
    var cnt = 0;
    var total = 0;
    for (var x = 0; x < imgW; x += PROJ_STEP) {
      total++;
      var i = (y * imgW + x) * 4;
      var v = (data[i] + data[i + 1] + data[i + 2]) / 3;
      if (v >= 248 && v <= 252) cnt++;
    }
    return cnt / total;
  }

  function findGutterRuns(data, imgW, imgH) {
    var minLen = Math.max(4, Math.round(imgH * 0.002));
    var runs = [];
    var start = -1;
    for (var y = 0; y <= imgH; y++) {
      var on = y < imgH && gutterFracAtRow(data, imgW, y) > 0.8;
      if (on && start < 0) start = y;
      if (!on && start >= 0) {
        if (y - start >= minLen) runs.push({ y0: start, y1: y - 1 });
        start = -1;
      }
    }
    return runs;
  }

  function cardRunsInXRange(data, imgW, y, x0, x1) {
    var runs = [];
    var start = -1;
    for (var x = x0; x <= x1 + 1; x++) {
      var on = false;
      if (x <= x1 && x < imgW) {
        var i = (y * imgW + x) * 4;
        on = (data[i] + data[i + 1] + data[i + 2]) / 3 >= 253;
      }
      if (on && start < 0) start = x;
      if (!on && start >= 0) {
        runs.push({ x0: start, x1: x - 1, w: x - start });
        start = -1;
      }
    }
    var minW = Math.round(imgW * 0.2);
    var cards = [];
    for (var r = 0; r < runs.length; r++) {
      if (runs[r].w >= minW) cards.push(runs[r]);
    }
    return cards;
  }

  function cardRunsAtRow(data, imgW, y) {
    return cardRunsInXRange(data, imgW, y, 0, imgW - 1);
  }

  function textRunsInBand(data, imgW, imgH, band, x0, x1) {
    var dens = [];
    for (var y = band.y0; y <= band.y1; y++) {
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
    var runs = [];
    var yy = 0;
    while (yy < dens.length) {
      if (dens[yy] > GAP_ROW) {
        var s = yy;
        var e = yy;
        var run = 0;
        while (yy < dens.length) {
          if (dens[yy] <= GAP_ROW) {
            run++;
            if (run >= gapRows) break;
          } else {
            run = 0;
            e = yy;
          }
          yy++;
        }
        runs.push({ y0: band.y0 + s, y1: band.y0 + e });
      } else {
        yy++;
      }
    }
    return runs;
  }

  // Column-local gutter fraction: share of ~250 pixels inside [x0, x1] only.
  function gutterFracInXRange(data, imgW, y, x0, x1) {
    var cnt = 0;
    var total = 0;
    for (var x = x0; x <= x1; x += PROJ_STEP) {
      total++;
      var i = (y * imgW + x) * 4;
      var v = (data[i] + data[i + 1] + data[i + 2]) / 3;
      if (v >= 248 && v <= 252) cnt++;
    }
    return cnt / total;
  }

  // Vertical gutters: columns that are ~250 down most of the image. In a
  // staggered waterfall these separate the card columns; the page margins
  // show up as narrow edge gutters too and are dropped by the width filter.
  function findColGutters(data, imgW, imgH) {
    var minW = Math.max(3, Math.round(imgW * 0.01));
    var runs = [];
    var start = -1;
    for (var x = 0; x <= imgW; x++) {
      var on = false;
      if (x < imgW) {
        var cnt = 0;
        var total = 0;
        for (var y = 0; y < imgH; y += PROJ_STEP) {
          total++;
          var i = (y * imgW + x) * 4;
          var v = (data[i] + data[i + 1] + data[i + 2]) / 3;
          if (v >= 248 && v <= 252) cnt++;
        }
        on = cnt / total > 0.5;
      }
      if (on && start < 0) start = x;
      if (!on && start >= 0) {
        if (x - start >= minW) runs.push({ x0: start, x1: x - 1 });
        start = -1;
      }
    }
    return runs;
  }

  function findGutterRunsInCol(data, imgW, imgH, x0, x1) {
    var minLen = Math.max(4, Math.round(imgH * 0.002));
    var runs = [];
    var start = -1;
    for (var y = 0; y <= imgH; y++) {
      // Stricter than the full-width test: near-white rows INSIDE a light
      // cover can reach ~0.97 of the column in the gutter range, while a
      // real page-gutter row is a clean run of ~250 (fraction ~1.0).
      var on = y < imgH && gutterFracInXRange(data, imgW, y, x0, x1) > 0.97;
      if (on && start < 0) start = y;
      if (!on && start >= 0) {
        if (y - start >= minLen) runs.push({ y0: start, y1: y - 1 });
        start = -1;
      }
    }
    return runs;
  }

  // Detect complete cards inside one band (bounded above and below by
  // gutter rows) within the x-range [bx0, bx1]: measure card x-extents on
  // the whitest background row of the band, then cut each cover at its
  // title block.
  function cardTilesInBand(data, imgW, imgH, band, bx0, bx1) {
    var bandH = band.y1 - band.y0 + 1;
    var best = null;
    for (var y = band.y0; y <= band.y1; y++) {
      var rs = cardRunsInXRange(data, imgW, y, bx0, bx1);
      var tw = 0;
      for (var r = 0; r < rs.length; r++) tw += rs[r].w;
      if (!best || tw > best.tw) best = { tw: tw, rs: rs };
    }
    if (!best) return [];
    var tiles = [];
    for (r = 0; r < best.rs.length; r++) {
      var card = best.rs[r];
      // Bands shorter than a realistic card (chrome strips) are not cards.
      if (bandH < card.w * 0.6) continue;
      var runs = textRunsInBand(data, imgW, imgH, band, card.x0, card.x1);
      // Need author/like row + at least one title line to anchor the cut.
      if (runs.length < 2) continue;
      var pad = Math.round(card.w * 0.055);
      // Walk upward from the last run (author/like row): up to 2 short
      // title lines with small gaps, then locate the cover bottom.
      var idx = runs.length - 1;
      var titleTop = -1;
      var lines = 0;
      while (lines < 2 && idx - 1 >= 0) {
        var cand = runs[idx - 1];
        if (runs[idx].y0 - cand.y1 > pad * 1.5) break;
        if (cand.y1 - cand.y0 + 1 > pad * 1.6) break;
        titleTop = cand.y0;
        idx--;
        lines++;
      }
      if (titleTop < 0) continue;
      var coverBottom;
      if (idx - 1 >= 0 && titleTop - runs[idx - 1].y1 <= pad * 1.5) {
        // Non-white cover ends right above the title: snap to its bottom.
        coverBottom = runs[idx - 1].y1;
      } else {
        coverBottom = titleTop - pad;
      }
      if (coverBottom <= band.y0) continue;
      tiles.push({ x: card.x0, w: card.w, y0: band.y0, y1: coverBottom, band: band });
    }
    return tiles;
  }

  // Open-band cover (leading / trailing fallback): when no ~250 gutter
  // bounds a card above (or cardTilesInBand fails on a white/text cover),
  // build density blocks and merge across pure-white interior seams. Collage
  // / text covers often have white gaps >> title-line pad, so a pad-limited
  // grow from the tallest run stops at the first panel — white-seam merge
  // with a cover-height cap is the generic fix. Reject blocks glued to the
  // band top (chrome) and blocks that leave no title/author room at the
  // band bottom (chrome-cut partials).
  function coverTileInOpenBand(data, imgW, imgH, band, bx0, bx1) {
    var colW = bx1 - bx0 + 1;
    var dens = [];
    for (var y = band.y0; y <= band.y1; y++) {
      var cnt = 0;
      var total = 0;
      for (var x = bx0; x <= bx1; x += PROJ_STEP) {
        total++;
        var i = (y * imgW + x) * 4;
        if ((data[i] + data[i + 1] + data[i + 2]) / 3 < WHITE_BRIGHT) cnt++;
      }
      dens.push(cnt / total);
    }
    var chromeTop = Math.max(80, Math.round(imgH * 0.11));
    var mergeFromY = Math.max(band.y0, chromeTop);
    // Allow taller merge then trim title/author; collage covers need room
    // for white interior seams without prematurely hitting maxMergedH.
    var maxMergedH = Math.round(colW * 1.6);
    var blocks = blocksWithWhiteMerge(
      data, imgW, imgH, dens, bx0, bx1, mergeFromY, band.y0, maxMergedH
    );
    var pad = Math.round(colW * 0.055);
    var minCoverH = Math.round(colW * 0.35);
    var minPiece = Math.round(colW * 0.25);
    var best = null;
    for (var b = 0; b < blocks.length; b++) {
      var blk = blocks[b];
      if (blk.y0 <= band.y0 + 1) continue;
      var h = blk.y1 - blk.y0 + 1;
      if (h < minCoverH) continue;
      var maxPiece = 0;
      for (var p = 0; p < blk.pieces.length; p++) {
        if (blk.pieces[p] > maxPiece) maxPiece = blk.pieces[p];
      }
      if (maxPiece < minPiece) continue;
      if (!best || h > best.h) best = { y0: blk.y0, y1: blk.y1, h: h };
    }
    if (!best) return [];
    // Snap top to the first substantial content piece so chrome/label
    // crumbs above a short complete cover are not kept.
    var coverTop = best.y0;
    var acc = best.y0;
    // Re-scan pieces via text runs overlapping the block: first run taller
    // than minPiece becomes the cover top.
    var allRuns = textRunsInBand(data, imgW, imgH, band, bx0, bx1);
    for (var ri = 0; ri < allRuns.length; ri++) {
      if (allRuns[ri].y1 < best.y0 || allRuns[ri].y0 > best.y1) continue;
      if (allRuns[ri].y1 - allRuns[ri].y0 + 1 >= minPiece) {
        coverTop = allRuns[ri].y0;
        break;
      }
    }
    // Trim external title/author/like: only walk short runs in the bottom
    // caption zone near the gutter. Cover-internal text lines further up
    // must not be mistaken for the note title (white text covers).
    var coverBottom = best.y1;
    var captionZone = band.y1 - Math.round(colW * 0.4);
    var cap = [];
    for (ri = 0; ri < allRuns.length; ri++) {
      if (allRuns[ri].y0 >= captionZone) cap.push(allRuns[ri]);
    }
    if (cap.length >= 2) {
      var idx = cap.length - 1;
      var titleTop = -1;
      var lines = 0;
      while (lines < 2 && idx - 1 >= 0) {
        var cand = cap[idx - 1];
        if (cap[idx].y0 - cand.y1 > pad * 1.5) break;
        if (cand.y1 - cand.y0 + 1 > pad * 1.6) break;
        titleTop = cand.y0;
        idx--;
        lines++;
      }
      if (titleTop >= coverTop && titleTop <= best.y1 + pad) {
        // Cover ends at the last content run above the title cluster.
        var above = -1;
        for (ri = 0; ri < allRuns.length; ri++) {
          if (allRuns[ri].y1 < titleTop && allRuns[ri].y1 > above) {
            above = allRuns[ri].y1;
          }
        }
        if (above >= coverTop) coverBottom = above;
        else coverBottom = titleTop - pad;
      }
    }
    if (coverBottom <= coverTop) return [];
    if (band.y1 - coverBottom < pad * 1.5) return [];
    if (coverBottom - coverTop + 1 < minCoverH) return [];
    return [{ x: bx0, w: colW, y0: coverTop, y1: coverBottom, band: band }];
  }

  function leadingTileInBand(data, imgW, imgH, band, bx0, bx1) {
    return coverTileInOpenBand(data, imgW, imgH, band, bx0, bx1);
  }

  function detectCardTiles(data, imgW, imgH) {
    var tiles = [];
    var gut = findGutterRuns(data, imgW, imgH);
    if (gut.length >= 2) {
      // Full-width gutters: rows of page gutter spanning the whole image.
      for (var g = 0; g + 1 < gut.length; g++) {
        var band = { y0: gut[g].y1 + 1, y1: gut[g + 1].y0 - 1 };
        tiles = tiles.concat(cardTilesInBand(data, imgW, imgH, band, 0, imgW - 1));
      }
      return tiles;
    }
    // Staggered waterfall: horizontal gutters exist per column only and
    // never span the full width. Detect the card columns from vertical
    // ~250 gutters, then run the same band logic per column.
    var vgs = findColGutters(data, imgW, imgH);
    if (!vgs.length) return [];
    var edges = [0];
    for (var v = 0; v < vgs.length; v++) {
      edges.push(vgs[v].x0, vgs[v].x1 + 1);
    }
    edges.push(imgW);
    var minColW = Math.round(imgW * 0.2);
    for (var e = 0; e + 1 < edges.length; e += 2) {
      var cx0 = edges[e];
      var cx1 = edges[e + 1] - 1;
      if (cx1 - cx0 + 1 < minColW) continue;
      var cg = findGutterRunsInCol(data, imgW, imgH, cx0, cx1);
      if (cg.length < 1) continue;
      // Leading card above the first per-column gutter (mirrors the
      // trailing case below).
      var chromeH = Math.max(80, Math.round(imgH * 0.08));
      if (cg[0].y0 - 1 - chromeH > Math.round(imgW * 0.12)) {
        var bandL = { y0: chromeH, y1: cg[0].y0 - 1 };
        tiles = tiles.concat(leadingTileInBand(data, imgW, imgH, bandL, cx0, cx1));
      }
      for (var g2 = 0; g2 + 1 < cg.length; g2++) {
        var band2 = { y0: cg[g2].y1 + 1, y1: cg[g2 + 1].y0 - 1 };
        var midTiles = cardTilesInBand(data, imgW, imgH, band2, cx0, cx1);
        if (!midTiles.length) {
          midTiles = coverTileInOpenBand(data, imgW, imgH, band2, cx0, cx1);
        }
        tiles = tiles.concat(midTiles);
      }
      // Trailing card below the last per-column gutter. Bottom cards often
      // have no following ~250 gutter (only title/author white, then the
      // tab-bar chrome), so the between-gutter loop never sees them and the
      // light-cover projection fallback crops an embedded dark island.
      var trailY1 = imgH - 1 - chromeH;
      var lastG = cg[cg.length - 1];
      if (trailY1 - lastG.y1 > Math.round(imgW * 0.12)) {
        var bandT = { y0: lastG.y1 + 1, y1: trailY1 };
        var trailTiles = cardTilesInBand(data, imgW, imgH, bandT, cx0, cx1);
        if (!trailTiles.length) {
          trailTiles = coverTileInOpenBand(data, imgW, imgH, bandT, cx0, cx1);
        }
        tiles = tiles.concat(trailTiles);
      }
    }
    return tiles;
  }

  function detectGridCovers(data, imgW, imgH) {
    var cols = findColumns(data, imgW, imgH);
    var tiles = [];
    var cardTiles = detectCardTiles(data, imgW, imgH);
    for (var k = 0; k < cardTiles.length; k++) {
      var ct = cardTiles[k];
      // Assign each card tile to the projection column it overlaps most.
      var bestCol = 0;
      var bestOv = -1;
      for (var c2 = 0; c2 < cols.length; c2++) {
        var ov = Math.min(ct.x + ct.w, cols[c2].x1 + 1) - Math.max(ct.x, cols[c2].x0);
        if (ov > bestOv) {
          bestOv = ov;
          bestCol = c2;
        }
      }
      ct.col = bestCol;
      tiles.push(ct);
    }
    for (var c = 0; c < cols.length; c++) {
      var col = cols[c];
      // Merge white seams anywhere below the sticky chrome. Gray page
      // gutters still refuse merge via gapIsWhiteSeam; do not gate at the
      // first column gutter or leading collages above it stay oversplit.
      var mergeFromY = Math.max(80, Math.round(imgH * 0.11));
      var blocks = findCoverBlocksInColumn(data, imgW, imgH, col.x0, col.x1, mergeFromY);
      for (var b = 0; b < blocks.length; b++) {
        var blk = blocks[b];
        // Blocks already covered by a card tile (its cover spans the whole
        // card) would duplicate the split pieces — drop them; blocks in
        // partial rows keep the projection behaviour.
        var dup = false;
        for (var k2 = 0; k2 < cardTiles.length; k2++) {
          var t2 = cardTiles[k2];
          var ovY = Math.min(blk.y1, t2.y1) - Math.max(blk.y0, t2.y0) + 1;
          var ovX = Math.min(col.x1 + 1, t2.x + t2.w) - Math.max(col.x0, t2.x);
          var blkH = blk.y1 - blk.y0 + 1;
          var cardH = t2.y1 - t2.y0 + 1;
          // Half of either side: a projection tail that only partly overlaps
          // a card (cover fragment + glued title) must still be dropped.
          if (ovX > 0 && ovY > 0 && (ovY > blkH * 0.3 || ovY > cardH * 0.5)) {
            dup = true;
            break;
          }
        }
        if (dup) continue;
        tiles.push({
          col: c,
          x: col.x0,
          w: col.x1 - col.x0 + 1,
          y0: blk.y0,
          y1: blk.y1
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

  async function sliceFeed(bitmap, runId) {
    runId = runId == null ? IMPORT.runId : runId;
    var imgW = bitmap.width || bitmap.naturalWidth;
    var imgH = bitmap.height || bitmap.naturalHeight;
    var results = [];
    if (!imgW || !imgH) {
      releaseBitmap(bitmap);
      return results;
    }
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
    // 本 bitmap 已切完：用完即 close，从本 run 持有列表移除
    releaseBitmap(bitmap);
    return results;
  }

  function showPick(on) {
    if (el.importHit) el.importHit.classList.toggle('is-hidden', !!on);
    if (el.pickStage) el.pickStage.classList.toggle('is-hidden', !on);
    if (el.importStage) el.importStage.classList.toggle('is-pick', !!on);
  }

  function paintBlobToCanvas(blob, targetCanvas) {
    // 与 fileToBitmap 同策略：优先 CIB，失败降级 Image(blob:)，再降级
    // FileReader → dataURL，避免小工具 WebView 对 canvas.toBlob 的 JPEG
    // 调 CIB reject 时中断预览链路。
    return fileToBitmap(blob).then(function (bmpOrImg) {
      var w = bmpOrImg.width || bmpOrImg.naturalWidth;
      var h = bmpOrImg.height || bmpOrImg.naturalHeight;
      targetCanvas.width = w;
      targetCanvas.height = h;
      var ctx = targetCanvas.getContext('2d');
      ctx.drawImage(bmpOrImg, 0, 0);
      releaseBitmap(bmpOrImg);
    }, function (e) {
      // 失败路径：fileToBitmap 内部已 close 迟到的 CIB/降级产物，这里只透传
      throw e;
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

  /** 默认五类命中；否则查自建分类，合成 custom type（只有三共用字段，无 a/b）。
   *  已删除的默认/自建类型一律返回 null（不出现、不可选）。 */
  function getCoverType(id) {
    for (var i = 0; i < COVER_TYPES.length; i++) {
      if (COVER_TYPES[i].id === id && !isDeletedDefault(COVER_TYPES[i].id)) return COVER_TYPES[i];
    }
    var list = state.customCategories || [];
    for (var j = 0; j < list.length; j++) {
      if (list[j].id === id) {
        return {
          id: id,
          name: list[j].name,
          custom: true
        };
      }
    }
    return null;
  }

  function renderCoverTypes() {
    if (!el.noteTypeList) return;
    el.noteTypeList.innerHTML = '';
    COVER_TYPES.filter(function (t) {
      return !isDeletedDefault(t.id); // 已删默认类不进录入可选类型
    }).concat(state.customCategories || []).forEach(function (type) {
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
    var chosen = getCoverType(state.coverType);
    if (el.noteType) el.noteType.hidden = !!chosen;
    if (el.noteForm) el.noteForm.hidden = !chosen;
    if (el.btnNoteSkipType) el.btnNoteSkipType.hidden = !!chosen;
    // 自建类型只有三共用字段：隐藏 field-a / field-b 两个 label 容器
    var hideAB = !!(chosen && chosen.custom);
    if (el.fieldA && el.fieldA.parentNode) el.fieldA.parentNode.hidden = hideAB;
    if (el.fieldB && el.fieldB.parentNode) el.fieldB.parentNode.hidden = hideAB;
    if (!chosen) return;
    if (el.btnTypeBack) el.btnTypeBack.textContent = chosen.name;
    if (hideAB) return; // 自建无 a/b，勿读 chosen.a/b
    if (el.fieldALabel) el.fieldALabel.textContent = chosen.a.label;
    if (el.fieldBLabel) el.fieldBLabel.textContent = chosen.b.label;
    if (el.fieldA) el.fieldA.placeholder = chosen.a.ph;
    if (el.fieldB) el.fieldB.placeholder = chosen.b.ph;
  }

  function chooseCoverType(id) {
    if (!getCoverType(id)) return;
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
    var maxW = Math.min(200, Math.max(140, window.innerWidth * 0.5));
    var maxH = Math.min(260, Math.round(window.innerHeight * 0.3));
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
      var type = getCoverType(state.coverType);
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
        liked: false,
        createdAt: Date.now()
      };
      // 自建类型不写 a/b 字段；默认五类照常写入各自的两个字段
      if (!type.custom) {
        record[type.a.key] = el.fieldA ? (el.fieldA.value || '').trim() : '';
        record[type.b.key] = el.fieldB ? (el.fieldB.value || '').trim() : '';
      }
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
    syncCustomCategoriesFromLibrary();
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
      return name && name !== UNCATEGORIZED && !isDeletedCategoryName(name);
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
    if (isDeletedCategoryName(name)) return; // 已删类型名不再补回
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
    if (item.liked) {
      var heart = document.createElement('span');
      heart.className = 'lib-card__like';
      heart.setAttribute('aria-label', '已喜欢');
      heart.appendChild(svgIcon('heart-fill'));
      btn.appendChild(heart);
    }
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
      openViewer(item, btn.getBoundingClientRect());
    });
    if (item.imageBlob) {
      paintBlobToCanvas(item.imageBlob, canvas).catch(function () {});
    }
    return btn;
  }

  function renderLibrary() {
    var isEmpty = !(state.library && state.library.length);
    var filtered = !!(state.libFilter && state.libFilter !== 'all');
    if (el.libraryRows) el.libraryRows.hidden = isEmpty && !filtered;
    if (el.libraryEmpty) {
      el.libraryEmpty.hidden = !isEmpty || filtered;
      el.libraryEmpty.textContent = '空';
    }
    if (el.btnClearAll) el.btnClearAll.hidden = isEmpty;
    renderLibFilterChips();
    if (isEmpty && !filtered) return;
    if (filtered) {
      renderLibFilteredRow(state.libFilter);
    } else {
      renderLibraryRows();
    }
  }

  // —— 灵感库分类筛选条（白底胶囊 + ＋ 创建）——

  function libFilterNames() {
    var names = ['全部'];
    COVER_TYPES.forEach(function (t) {
      if (isDeletedDefault(t.id)) return; // 已删默认类不出现在筛选条
      if (names.indexOf(t.name) === -1) names.push(t.name);
    });
    (state.customCategories || []).forEach(function (c) {
      if (!c.name || isDeletedCategoryName(c.name)) return;
      if (names.indexOf(c.name) === -1) names.push(c.name);
    });
    return names;
  }

  function renderLibFilterChips() {
    var bar = el.libChipBar;
    if (!bar) return;
    qsAll('.lib-chip', bar).forEach(function (n) {
      bar.removeChild(n);
    });
    var addBtn = el.btnLibCatAdd;
    libFilterNames().forEach(function (name) {
      var isAll = name === '全部';
      var active = isAll ? (!state.libFilter || state.libFilter === 'all') : state.libFilter === name;
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'cat-chip lib-chip' + (active ? ' is-active' : '');
      b.textContent = name;
      b.setAttribute('aria-pressed', active ? 'true' : 'false');
      b.addEventListener('click', function () {
        var next = isAll ? 'all' : name;
        if (state.libFilter === next) return;
        state.libFilter = next;
        persistCustomCategories();
        renderLibrary();
        if (el.libScroll) el.libScroll.scrollTop = 0;
      });
      bar.insertBefore(b, addBtn);
    });
  }

  /** 筛选单个分类：只渲染该分类一行；0 张时显示「还没有封面」空态 */
  function renderLibFilteredRow(name) {
    if (!el.libraryRows) return;
    el.libraryRows.innerHTML = '';
    var items = (state.library || []).filter(function (it) {
      return recordCategory(it) === name;
    });
    if (!items.length) {
      var p = document.createElement('p');
      p.className = 'lib-row-empty';
      p.textContent = '还没有封面';
      el.libraryRows.appendChild(p);
      return;
    }
    var row = buildLibRow({ name: name, title: name, items: items });
    el.libraryRows.appendChild(row);
    renderLibRowItems(row); // 单行视图直接渲染，无需懒加载
  }

  // —— 创建分类弹层（cat-sheet）——

  function openCatSheet() {
    if (!el.catSheet) return;
    if (el.catSheetInput) el.catSheetInput.value = '';
    if (el.catSheetMsg) el.catSheetMsg.textContent = '';
    el.catSheet.hidden = false;
    if (el.catSheetInput) {
      try { el.catSheetInput.focus(); } catch (e) {}
    }
  }

  function closeCatSheet() {
    if (!el.catSheet) return;
    el.catSheet.hidden = true;
    if (el.catSheetMsg) el.catSheetMsg.textContent = '';
  }

  function submitCatSheet() {
    if (!el.catSheetInput) return;
    var name = normalizeCategoryName(el.catSheetInput.value);
    if (!name) {
      if (el.catSheetMsg) el.catSheetMsg.textContent = '请输入分类名';
      return;
    }
    // 与默认类型或已有自定义重名（忽略多余空白）：关闭并选中已有
    if (isDeletedCategoryName(name)) {
      if (el.catSheetMsg) el.catSheetMsg.textContent = '「' + name + '」已在管理类型里删除，换个名字吧';
      return;
    }
    var existing = null;
    COVER_TYPES.forEach(function (t) {
      if (!existing && normalizeCategoryName(t.name) === name) existing = t.name;
    });
    var custom = findCustomByName(name);
    if (custom && !existing) existing = custom.name;
    if (existing) {
      closeCatSheet();
      state.libFilter = existing;
      persistCustomCategories();
      renderLibrary();
      appToast('已有「' + existing + '」，已为你选中');
      return;
    }
    state.customCategories.push({
      id: 'custom_' + uid(),
      name: name,
      createdAt: Date.now()
    });
    syncExtraCategories();
    state.libFilter = name;
    persistCustomCategories();
    closeCatSheet();
    renderLibrary();
  }

  // —— 管理类型面板（type-sheet）：默认五类 + 自建均可删，只删类型不删封面 ——

  function openTypeSheet() {
    if (!el.typeSheet) return;
    renderTypeSheet();
    el.typeSheet.hidden = false;
  }

  function closeTypeSheet() {
    if (!el.typeSheet) return;
    el.typeSheet.hidden = true;
  }

  function renderTypeSheet() {
    if (!el.typeSheetList) return;
    el.typeSheetList.innerHTML = '';
    var counts = categoryCounts();
    var rows = [];
    COVER_TYPES.forEach(function (t) {
      if (!isDeletedDefault(t.id)) rows.push({ id: t.id, name: t.name, kind: '默认', count: counts[t.name] || 0 });
    });
    (state.customCategories || []).forEach(function (c) {
      if (!isDeletedCategoryName(c.name)) rows.push({ id: c.id, name: c.name, kind: '自建', count: counts[c.name] || 0 });
    });
    if (!rows.length) {
      var p = document.createElement('p');
      p.className = 'type-sheet__empty';
      p.textContent = '暂无类型';
      el.typeSheetList.appendChild(p);
      return;
    }
    rows.forEach(function (r) {
      var row = document.createElement('div');
      row.className = 'type-sheet__row';
      var body = document.createElement('div');
      body.className = 'type-sheet__body';
      var name = document.createElement('b');
      name.textContent = r.name;
      var meta = document.createElement('small');
      meta.textContent = r.kind + ' · ' + r.count + ' 张';
      body.appendChild(name);
      body.appendChild(meta);
      var del = document.createElement('button');
      del.type = 'button';
      del.className = 'type-sheet__del';
      del.textContent = '删除';
      del.addEventListener('click', function () {
        askConfirm(
          '删除类型「' + r.name + '」？',
          function () { deleteCoverType(r.id); },
          '类型删除后：封面不会删除，自动保留在「最近收藏」；之后可重新分类。'
        );
      });
      row.appendChild(body);
      row.appendChild(del);
      el.typeSheetList.appendChild(row);
    });
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
    var type = getCoverType(item && item.coverType);
    var snap = {
      coverType: type ? type.id : '',
      headline: String((item && item.headline) || ''),
      whyClick: String((item && item.whyClick) || ''),
      extra: legacyExtra(item)
    };
    if (type && !type.custom) {
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
    var type = getCoverType(state.sheetDraft.coverType);
    if (type) sheetAddType(el.sheetFields, type.name);
    sheetAddEditor(el.sheetFields, '封面主文案', 'headline');
    sheetAddEditor(el.sheetFields, '为什么想点', 'whyClick');
    if (type && !type.custom) {
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
    // 用户在 chips 里选的归档分类优先；没选（空/未分类）才回退类型默认名
    var savedType = getCoverType(item.coverType);
    var chosenCat = sheetNorm(draft.category);
    if (chosenCat && chosenCat !== UNCATEGORIZED) {
      item.category = chosenCat;
      rememberCategory(chosenCat);
    } else if (savedType) {
      item.category = savedType.name;
    }
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

  // ——— Fullscreen viewer + 底部固定四钮横排 ———
  // 点击库卡片进入全屏查看（纯图无文字）；顶栏返回/点空白关闭，
  // 横滑切换；底部固定「喜欢/导出/查详情/删除」四钮 click 直接触发。

  var viewerPress = null;  // {x,y,t,moved,id,onBar}
  var toastTimer = 0;

  var askShieldUntil = 0; // ask 开窗武装期：吞掉开窗瞬间落下的幽灵 click/pointerup/touchend

  function askShieldActive() {
    return Date.now() < askShieldUntil;
  }

  function armAskShield() {
    askShieldUntil = Date.now() + 480;
    if (el.ask && el.ask.classList) {
      el.ask.classList.add('is-arming');
      setTimeout(function () {
        if (el.ask) el.ask.classList.remove('is-arming');
      }, 480);
    }
  }

  function viewerItem() {
    return libraryItemById(state.viewerId);
  }

  /** 圆润软心（2026-11-04 用户选定），随容器 currentColor 上色（库卡片角标用） */
  function svgIcon() {
    var ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    var hf = document.createElementNS(ns, 'path');
    hf.setAttribute('fill', 'currentColor');
    hf.setAttribute('d', 'M12 20.7c-.42 0-.84-.15-1.17-.44C6.5 16.6 2.6 13.1 2.6 9.1 2.6 6.2 4.8 4.1 7.4 4.1c1.86 0 3.55 1.03 4.6 2.72 1.05-1.69 2.74-2.72 4.6-2.72 2.6 0 4.8 2.1 4.8 5 0 4-3.9 7.5-8.43 11.16-.33.29-.75.44-1.17.44z');
    svg.appendChild(hf);
    return svg;
  }

  function fitViewerCanvas(canvas) {
    var vw = canvas.width;
    var vh = canvas.height;
    if (!vw || !vh) return null;
    var maxW = window.innerWidth * 0.88;
    var maxH = window.innerHeight * 0.62; // 给顶栏/底栏留空，封面不被遮挡
    var s = Math.min(maxW / vw, maxH / vh);
    return { w: Math.round(vw * s), h: Math.round(vh * s) };
  }

  function paintViewerCanvas(item) {
    if (!el.viewerCanvas || !item) return;
    el.viewerCanvas.style.opacity = '0';
    if (!item.imageBlob) {
      el.viewerCanvas.style.opacity = '';
      return;
    }
    paintBlobToCanvas(item.imageBlob, el.viewerCanvas).then(function () {
      if (!el.viewerCanvas) return;
      var fit = fitViewerCanvas(el.viewerCanvas);
      if (fit) {
        el.viewerCanvas.style.width = fit.w + 'px';
        el.viewerCanvas.style.height = fit.h + 'px';
      }
      el.viewerCanvas.style.opacity = '';
    }).catch(function () {
      if (el.viewerCanvas) el.viewerCanvas.style.opacity = '';
    });
  }

  /** 底栏喜欢钮状态：已喜欢时心形填珊瑚红实心 */
  function syncViewerLike(item) {
    if (el.viewerLike) el.viewerLike.classList.toggle('is-liked', !!(item && item.liked));
  }

  function openViewer(item, fromRect) {
    if (!el.imgViewer || !item || !item.imageBlob) return;
    hideTabs();
    state.viewerId = item.id;
    var list = state.library || [];
    state.viewerIndex = list.indexOf(item);
    paintViewerCanvas(item);
    syncViewerLike(item);
    if (el.viewerCanvas) el.viewerCanvas.style.transform = '';
    el.imgViewer.hidden = false;

    // FLIP：从被点击卡片的位置放大到屏幕中心
    if (fromRect && el.viewerCanvas && el.viewerCanvas.width) {
      var fit = fitViewerCanvas(el.viewerCanvas);
      if (fit) {
        var vw = window.innerWidth;
        var vh = window.innerHeight;
        var sx = fromRect.width / fit.w;
        var sy = fromRect.height / fit.h;
        var dx = fromRect.left + fromRect.width / 2 - vw / 2;
        var dy = fromRect.top + fromRect.height / 2 - vh / 2;
        el.viewerCanvas.style.transition = 'none';
        el.viewerCanvas.style.transform =
          'translate(' + dx.toFixed(1) + 'px,' + dy.toFixed(1) + 'px) scale(' +
          sx.toFixed(3) + ',' + sy.toFixed(3) + ')';
        if (window.requestAnimationFrame) {
          window.requestAnimationFrame(function () {
            if (!el.viewerCanvas) return;
            el.viewerCanvas.style.transition = '';
            el.viewerCanvas.style.transform = '';
          });
        } else {
          el.viewerCanvas.style.transition = '';
          el.viewerCanvas.style.transform = '';
        }
      }
    }
  }

  function closeViewer() {
    if (!state.viewerId || !el.imgViewer || el.imgViewer.hidden) return;
    viewerPress = null;
    state.viewerId = null;
    el.imgViewer.classList.add('is-closing');
    setTimeout(function () {
      if (!state.viewerId && el.imgViewer) {
        el.imgViewer.hidden = true;
        el.imgViewer.classList.remove('is-closing');
        if (el.viewerCanvas) el.viewerCanvas.style.transform = '';
      }
    }, 210);
  }

  function navigateViewer(dir) {
    var list = state.library || [];
    if (!list.length) return;
    var next = state.viewerIndex + dir;
    if (next < 0 || next >= list.length) return;
    state.viewerIndex = next;
    var item = list[next];
    state.viewerId = item.id;
    paintViewerCanvas(item);
    syncViewerLike(item);
  }

  // —— 底栏四钮 ——

  /** 触感反馈：容器 vibrateShort(9.50+) 优先，网页/低版本回退 navigator.vibrate */
  function hapticTick() {
    var xhs = window.xhs;
    var mt = xhs && xhs.miniTool;
    var ver = Number(xhs && xhs.launchOptions && xhs.launchOptions.miniToolEnv &&
      xhs.launchOptions.miniToolEnv.buildVersion) || 0;
    if (mt && typeof mt.vibrateShort === 'function' && ver >= 9500) {
      try { mt.vibrateShort({ type: 'light' }); return; } catch (e) {}
    }
    try { if (navigator.vibrate) navigator.vibrate(12); } catch (e2) {}
  }

  /** 底栏按钮 click 分发：复用原操作环四动作，不改业务语义 */
  function onViewerBarButton(action) {
    if (!state.viewerId) return;
    hapticTick();
    if (action === 'like') ringLike();
    else if (action === 'export') ringExport();
    else if (action === 'desc') ringDesc();
    else if (action === 'delete') ringDelete();
  }

  // —— 四个动作 ——

  function ringLike() {
    var item = viewerItem();
    if (!item) return;
    item.liked = !item.liked;
    syncViewerLike(item);
    renderLibrary();
    openDb().then(function (db) {
      return idbPut(db, item).then(function () { db.close(); });
    }).catch(function () {
      item.liked = !item.liked;
      syncViewerLike(item);
      renderLibrary();
      alert('保存失败');
    });
  }

  /** 底栏删除钮：二次确认后才删当前查看的封面（取消保留） */
  function ringDelete() {
    var item = viewerItem();
    if (!item) return;
    askConfirm('确定删除这张？', function () {
      var id = item.id;
      openDb().then(function (db) {
        return idbDelete(db, id).then(function () {
          db.close();
          closeViewer();
          return refreshLibrary();
        });
      }).catch(function () {
        alert('删除失败');
      });
    });
  }

  function exportFileName() {
    var d = new Date();
    function p(n) { return n < 10 ? '0' + n : '' + n; }
    return '封面-' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) +
      '-' + p(d.getHours()) + p(d.getMinutes()) + '.jpg';
  }

  function ringExport() {
    askConfirm('下载这张？', doRingExport);
  }

  /** 小工具容器检测：平台 JS API 可用才返回 miniTool，否则 null（网页版降级） */
  function xhsMiniTool() {
    var mt = window.xhs && window.xhs.miniTool;
    if (mt &&
        typeof mt.writeTempFile === 'function' &&
        typeof mt.saveImageToPhotosAlbum === 'function') {
      return mt;
    }
    return null;
  }

  /** 关注作者能力检测：miniTool 关注 API + 客户端 ≥ 9.51（buildVersion 9510），否则 null */
  function xhsFollowApi() {
    var xhs = window.xhs;
    var mt = xhs && xhs.miniTool;
    var ver = Number(xhs && xhs.launchOptions && xhs.launchOptions.miniToolEnv &&
      xhs.launchOptions.miniToolEnv.buildVersion) || 0;
    if (!mt || ver < 9510) return null;
    if (typeof mt.followAuthor !== 'function' || typeof mt.getFollowStatus !== 'function') return null;
    return mt;
  }

  /** 解析 getFollowStatus 返回：兼容 res.follow_status / res.followStatus / 纯数字 */
  function parseFollowStatus(res) {
    if (res == null) return NaN;
    if (typeof res === 'number') return res;
    var v = res.follow_status != null ? res.follow_status : res.followStatus;
    return Number(v);
  }

  /** 从 reject/返回对象取错误码：errCode 或 code */
  function parseErrCode(err) {
    if (!err) return 0;
    var v = err.errCode != null ? err.errCode : err.code;
    return Number(v) || 0;
  }

  /** 极简轻提示：短暂改按钮文案，1s 后恢复 */
  var followTipTimer = null;
  function followTip(text) {
    var btn = el.btnFollowAuthor;
    if (!btn) return;
    clearTimeout(followTipTimer);
    btn.textContent = text;
    followTipTimer = setTimeout(function () {
      if (!btn.disabled) btn.textContent = '关注';
    }, 1000);
  }

  /** follow_status → 按钮文案/可用态；-1 或未知保持「关注」可用，不留死按钮 */
  function renderFollowStatus(status) {
    var btn = el.btnFollowAuthor;
    if (!btn) return;
    if (status === 1) {
      btn.textContent = '已关注';
      btn.disabled = true;
    } else if (status === 2) {
      btn.textContent = '作者';
      btn.disabled = true;
    } else {
      btn.textContent = '关注';
      btn.disabled = false;
    }
  }

  function refreshFollowStatus() {
    var api = xhsFollowApi();
    var btn = el.btnFollowAuthor;
    if (!api || !btn) return;
    Promise.resolve().then(function () { return api.getFollowStatus(); }).then(function (res) {
      var status = parseFollowStatus(res != null && res.data != null ? res.data : res);
      if (!isNaN(status)) renderFollowStatus(status);
    }).catch(function () {
      // 查询失败保持默认「关注」可用
    });
  }

  function setupFollowAuthor() {
    var api = xhsFollowApi();
    var btn = el.btnFollowAuthor;
    if (!api || !btn) return; // 不可用保持 hidden
    btn.hidden = false;
    refreshFollowStatus();
  }

  async function onFollowAuthorClick() {
    var api = xhsFollowApi();
    var btn = el.btnFollowAuthor;
    if (!api || !btn || btn.disabled) return;
    btn.disabled = true; // 防抖：确认弹窗期间不可重复点
    try {
      await api.followAuthor();
      var status = NaN;
      try {
        var res = await api.getFollowStatus();
        status = parseFollowStatus(res != null && res.data != null ? res.data : res);
      } catch (e2) {}
      renderFollowStatus(status); // NaN/-1 → 恢复「关注」可用
    } catch (e) {
      var code = parseErrCode(e);
      renderFollowStatus(NaN); // 失败恢复「关注」可用
      if (code === 20002) {
        // 取消确认/拒登：静默
      } else if (code === 15404) {
        followTip('今天太多次了');
      } else if (code === 10003) {
        followTip('请稍候');
      }
    } finally {
      if (btn.textContent !== '已关注' && btn.textContent !== '作者') btn.disabled = false;
    }
  }

  async function doRingExport() {
    var item = viewerItem();
    if (!item || !item.imageBlob) return;
    var canvas = document.createElement('canvas');
    try {
      await paintBlobToCanvas(item.imageBlob, canvas);
      var mt = xhsMiniTool();
      if (mt) {
        // 容器版：dataURL → writeTempFile 换 filePath → 存系统相册（官方链路）
        var dataUrl = canvas.toDataURL('image/jpeg', 0.92);
        var res = await mt.writeTempFile({ data: dataUrl });
        await mt.saveImageToPhotosAlbum({ filePath: res.filePath });
        showViewerToast('已保存到相册');
      } else {
        // 网页版降级：a[download]（容器内被拦截，不会走到这里）
        var blob = await canvasToBlob(canvas, 'image/jpeg', 0.92);
        if (!blob) {
          showViewerToast('导出失败');
          return;
        }
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = exportFileName();
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
        showViewerToast('已保存');
      }
    } catch (e) {
      showViewerToast('导出失败');
    }
  }

  function ringDesc() {
    var item = viewerItem();
    if (!item) return;
    openLibrarySheet(item);
  }

  function showViewerToast(text) {
    if (!el.viewerToast) return;
    el.viewerToast.textContent = text;
    el.viewerToast.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toastTimer = 0;
      if (el.viewerToast) el.viewerToast.hidden = true;
    }, 1100);
  }

  // —— 查看器手势：点空白关闭 / 横滑切换（顶栏/底栏交给 click，不参与手势） ——

  function onViewerPointerDown(ev) {
    if (!state.viewerId || !el.imgViewer || el.imgViewer.hidden) return;
    if (el.ask && !el.ask.hidden) return; // ask 弹层打开期间暂停查看器手势，避免误关
    viewerPress = {
      x: ev.clientX,
      y: ev.clientY,
      t: Date.now(),
      moved: false,
      id: ev.pointerId,
      // 起点在顶栏/底栏上：交给按钮 click，不关闭不切换
      onBar: !!(ev.target && ev.target.closest &&
        ev.target.closest('.viewer-bar, .viewer-topbar'))
    };
    if (viewerPress.onBar) return; // 不抢 pointer capture，保证按钮正常 click
    if (el.imgViewer.setPointerCapture) {
      try { el.imgViewer.setPointerCapture(ev.pointerId); } catch (e) {}
    }
  }

  function onViewerPointerMove(ev) {
    if (!viewerPress || ev.pointerId !== viewerPress.id) return;
    var dx = ev.clientX - viewerPress.x;
    var dy = ev.clientY - viewerPress.y;
    if (!viewerPress.moved && Math.hypot(dx, dy) > 10) {
      viewerPress.moved = true;
    }
  }

  function onViewerPointerUp(ev) {
    if (!viewerPress || ev.pointerId !== viewerPress.id) return;
    if (el.ask && !el.ask.hidden) { viewerPress = null; return; } // ask 打开期间不动查看器状态
    var p = viewerPress;
    viewerPress = null;
    if (p.onBar) return; // 底栏/顶栏按钮 click 已自行处理
    var dx = ev.clientX - p.x;
    var dy = ev.clientY - p.y;
    if (!p.moved && Date.now() - p.t < 500) {
      closeViewer();
      return;
    }
    if (p.moved && Math.abs(dx) > 56 && Math.abs(dx) > Math.abs(dy) * 1.2) {
      navigateViewer(dx < 0 ? 1 : -1);
    }
  }

  function onViewerPointerCancel() {
    // cancel 后通常没有配套 pointerup，清掉按压状态避免误触
    viewerPress = null;
  }


  // 导入总入口（含锁 + runId + 总闸）。失败/成功都保证清 busy，
  // 绝不永久卡 loading；失败出口走页面内状态卡，不用 alert 主路径。
  async function onFilesChosen(fileList) {
    // 入口分流：先判 busy，再判空 —— 不用 fileList||[] 吞掉真实空选择；
    // 清 input.value 只发生在 resetPick()，本函数不清不改。
    var rawEmpty = fileList == null || !fileList.length;
    if (IMPORT.busy) {
      appToast('正在导入，请稍候');
      return; // 不动进行中的 run
    }
    if (rawEmpty) {
      appToast('未获取到文件，请重新选择');
      return; // 不增 run，不产生假 decode / no-image-file
    }
    IMPORT.busy = true;
    IMPORT.runId++;
    var runId = IMPORT.runId;
    closeAllBitmaps(); // 清上一 run 残留
    clearImportFail();
    var snapshot = Array.prototype.slice.call(fileList); // snapshot 后才消费，业务引用不再依赖 fileList
    var accepted = [];
    for (var k = 0; k < snapshot.length; k++) {
      if (isImageFile(snapshot[k])) accepted.push(snapshot[k]);
    }
    if (!accepted.length) {
      showImportFail('请选择图片文件');
      IMPORT.busy = false;
      return;
    }
    var files = accepted;
    showImportLoading('导入中…');
    try {
      await Promise.race([
        importWork(files, runId),
        new Promise(function (_resolve, reject) {
          setTimeout(function () {
            var err = new Error('import total timeout');
            err.name = 'TotalTimeoutError';
            reject(err);
          }, IMPORT.timeouts.total);
        })
      ]);
    } catch (e) {
      // 统一失败出口：页面内非阻塞状态卡 + 再试按钮，不依赖 alert 主路径
      if (e && e.name === 'TotalTimeoutError') {
        // 总超时：作废本 run（后台残留回调按 stale 丢弃），清理资源
        closeAllBitmaps();
        IMPORT.runId++;
        showImportFail('导入超时，请重试');
        showPick(false);
      } else {
        showImportFail('导入异常，请重试');
        showPick(false);
      }
    } finally {
      // 若期间用户已开新 run（理论上锁下不可能），不动新 run 的资源
      if (IMPORT.runId === runId) {
        closeAllBitmaps();
        // 失败卡保留给用户看（含「再试一次」），只清 loading
        if (!IMPORT.failShown) hideImportStatus();
        IMPORT.busy = false;
      } else {
        IMPORT.busy = false;
      }
    }
  }

  async function importWork(files, runId) {
    state.pendingFiles = files;
    state.pendingBitmaps = [];
    // 单张读取失败静默跳过，绝不在这里 alert：
    // 该路径仍可能 slicePending 成功出结果（如 1/4）。
    for (var i = 0; i < files.length; i++) {
      try {
        var bmp = await fileToBitmap(files[i], runId);
        if (runId !== IMPORT.runId) {
          // 旧 run 迟到结果：close，禁止写入 state、禁止 showPick
          releaseBitmap(bmp);
          continue;
        }
        state.pendingBitmaps.push(bmp);
      } catch (e) {
        if (e && e.name === 'StaleRunError') throw e;
        // 静默跳过无法读取的文件
      }
    }
    if (runId !== IMPORT.runId) return;
    if (!state.pendingBitmaps.length) {
      showImportFail('图片读取失败，请换一张截图试试');
      showPick(false);
      return;
    }
    await slicePending(runId);
  }

  function resetPick() {
    state.pendingFiles = [];
    state.pendingBitmaps = [];
    state.candidates = [];
    state.selectedIds = {};
    closeAllBitmaps();
    if (el.fileInput) el.fileInput.value = '';
    if (el.pickRail) el.pickRail.innerHTML = '';
    updateSaveSelectedBtn();
    showPick(false);
  }

  async function slicePending(runId) {
    runId = runId == null ? IMPORT.runId : runId;
    if (!state.pendingBitmaps.length) {
      showPick(false);
      return;
    }
    var all = [];
    try {
      for (var i = 0; i < state.pendingBitmaps.length; i++) {
        var part = await sliceFeed(state.pendingBitmaps[i], runId);
        all = all.concat(part);
      }
    } catch (e) {
      closeAllBitmaps();
      // 固定中文前缀，不把可能为空的 e.message 单独弹窗
      showImportFail('切分失败：' + (e && e.message ? e.message : '未知错误'));
      showPick(false);
      return;
    }
    if (runId !== IMPORT.runId) {
      // 旧 run 切出的结果丢弃，不写 state、不进 PICK
      return;
    }
    state.candidates = all;
    state.selectedIds = {};
    if (!all.length) {
      showImportFail('没有切出可用封面，请换一张更接近双列信息流的整屏截图试试');
      showPick(false);
      if (el.pickRail) el.pickRail.innerHTML = '';
      return;
    }
    showView('import');
    clearImportFail();
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
    if (!getCoverType(state.coverType)) return; // 未选类型：维持原早退行为
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
    el.askSub = $('ask-sub');
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
    el.libChipBar = $('lib-chip-bar');
    el.btnLibCatAdd = $('btn-lib-cat-add');
    el.catSheet = $('cat-sheet');
    el.catSheetInput = $('cat-sheet-input');
    el.catSheetMsg = $('cat-sheet-msg');
    el.catSheetCancel = $('cat-sheet-cancel');
    el.catSheetOk = $('cat-sheet-ok');
    el.catSheetBackdrop = $('cat-sheet-backdrop');
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
    el.btnFollowAuthor = $('btn-follow-author');
    el.imgViewer = $('img-viewer');
    el.viewerCanvas = $('viewer-canvas');
    el.viewerLike = $('viewer-like');
    el.viewerBack = $('viewer-back');
    el.viewerBar = $('viewer-bar');
    el.viewerToast = $('viewer-toast');
    el.btnLibManage = $('btn-lib-manage');
    el.typeSheet = $('type-sheet');
    el.typeSheetList = $('type-sheet-list');
    el.typeSheetClose = $('type-sheet-close');
    el.typeSheetBackdrop = $('type-sheet-backdrop');

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
      onFilesChosen(el.fileInput.files).catch(function () {
        showImportFail('导入异常，请重试');
      });
    });

    el.btnNote.addEventListener('click', function () {
      startNoteFlow();
    });

    if (el.btnRepick) {
      el.btnRepick.addEventListener('click', function () {
        resetPick();
      });
    }

    if (el.btnFollowAuthor) {
      el.btnFollowAuthor.addEventListener('click', function () {
        onFollowAuthorClick();
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

    if (el.btnLibCatAdd) {
      el.btnLibCatAdd.addEventListener('click', function () {
        openCatSheet();
      });
    }
    if (el.btnLibManage) {
      el.btnLibManage.addEventListener('click', function () {
        openTypeSheet();
      });
    }
    if (el.typeSheetClose) el.typeSheetClose.addEventListener('click', closeTypeSheet);
    if (el.typeSheetBackdrop) el.typeSheetBackdrop.addEventListener('click', closeTypeSheet);
    if (el.catSheetCancel) el.catSheetCancel.addEventListener('click', closeCatSheet);
    if (el.catSheetBackdrop) el.catSheetBackdrop.addEventListener('click', closeCatSheet);
    if (el.catSheetOk) el.catSheetOk.addEventListener('click', submitCatSheet);
    if (el.catSheetInput) {
      el.catSheetInput.addEventListener('input', function () {
        if (el.catSheetMsg) el.catSheetMsg.textContent = '';
      });
      el.catSheetInput.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') {
          ev.preventDefault();
          submitCatSheet();
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

    if (el.imgViewer) {
      el.imgViewer.addEventListener('pointerdown', onViewerPointerDown);
      el.imgViewer.addEventListener('pointermove', onViewerPointerMove);
      el.imgViewer.addEventListener('pointerup', onViewerPointerUp);
      el.imgViewer.addEventListener('pointercancel', onViewerPointerCancel);
      el.imgViewer.addEventListener('contextmenu', function (ev) {
        ev.preventDefault();
      });
      // 触摸侧硬抑制系统长按菜单/选区（夸克等浏览器无视 CSS callout）
      function viewerVisible() {
        return !!(state.viewerId && el.imgViewer && !el.imgViewer.hidden);
      }
      el.imgViewer.addEventListener('touchstart', function (ev) {
        if (!viewerVisible()) return;
        // 顶栏/底栏按钮需保留原生 click（preventDefault 会吞掉 click）
        if (ev.target && ev.target.closest &&
            ev.target.closest('.viewer-bar, .viewer-topbar')) return;
        ev.preventDefault();
        ev.stopPropagation();
      }, { passive: false });
      el.imgViewer.addEventListener('selectstart', function (ev) {
        if (viewerVisible()) ev.preventDefault();
      });
      el.imgViewer.addEventListener('dragstart', function (ev) {
        if (viewerVisible()) ev.preventDefault();
      });
    }

    // 底栏四钮 + 顶栏返回：click 触发，无长按
    if (el.viewerBar) {
      el.viewerBar.addEventListener('click', function (ev) {
        var btn = ev.target && ev.target.closest ? ev.target.closest('.viewer-bar__btn') : null;
        if (!btn) return;
        ev.stopPropagation();
        onViewerBarButton(btn.getAttribute('data-action'));
      });
    }
    if (el.viewerBack) {
      el.viewerBack.addEventListener('click', function (ev) {
        ev.stopPropagation();
        closeViewer();
      });
    }

    document.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Escape') return;
      if (!el.libSheet || el.libSheet.hidden) {
        if (el.catSheet && !el.catSheet.hidden) {
          closeCatSheet();
          return;
        }
        if (el.typeSheet && !el.typeSheet.hidden) {
          closeTypeSheet();
          return;
        }
        if (state.viewerId) closeViewer();
        return;
      }
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
    if (state.viewerId) return; // 全屏查看时不弹出 Tab
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

  /** message 主文案；detail 可选副文案（删除类型时说明封面保留） */
  function askConfirm(message, onOk, detail) {
    if (!el.ask) return;
    askHandler = onOk;
    if (el.askText) el.askText.textContent = message;
    if (el.askSub) {
      if (detail) {
        el.askSub.textContent = detail;
        el.askSub.hidden = false;
      } else {
        el.askSub.textContent = '';
        el.askSub.hidden = true;
      }
    }
    el.ask.hidden = false;
    armAskShield();
  }

  function closeAsk() {
    askHandler = null;
    if (el.askSub) {
      el.askSub.textContent = '';
      el.askSub.hidden = true;
    }
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
    // ask 武装期：捕获阶段吞掉落向确认/取消/遮罩的事件，防长按松手合成 click 误触「确认」
    ['click', 'pointerup', 'touchend'].forEach(function (type) {
      document.addEventListener(type, function (ev) {
        if (!askShieldActive()) return;
        var t = ev.target && ev.target.closest ? ev.target.closest('#ask-ok,#ask-cancel,#ask-backdrop') : null;
        if (!t) return;
        ev.preventDefault();
        ev.stopPropagation();
      }, true);
    });
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
    setupFollowAuthor();
    loadCustomCategories();
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
