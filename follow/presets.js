/* 照着做 — 预设配置（挂 window.FMPRE）
 *
 * 字段说明
 * -------
 * textStyles（字效预设）：往数组里追加一条对象即可，UI 自动渲染卡片。
 *   id          唯一 id（小写字母数字）
 *   name        卡片下方的短名字（2–4 字）
 *   source      字效来源；对标封面写法如 '秋招封面'，通用款写 '通用'
 *   font        字体 id（见 components.js 的 FONTS：SHSans / SHSerif / Smiley / KuaiLe）
 *   weight      字重（SHSans/SHSerif 支持 900，其它字体填 null）
 *   size        可选，默认字号；不填则用新建文字的默认字号
 *   strokes     描边层数组，从内到外 [{color,width}]；不需要描边填 []
 *   shadow      投影 {x,y,blur,color}；不需要填 null
 *   defaultColor 不选分词颜色时的文字填充色
 *
 * highlightColors（高亮色）：分词点色用的少量预设色，最多 8 个（十六进制，含 #）。
 *
 * components（组件预设）：往数组里追加一条对象即可，「添加组件」网格自动出现。
 *   id        唯一 presetId
 *   type      'pill' | 'badge' | 'brush' | 'imageCard'
 *   name      网格里极短名称（如 胶囊 / 徽章）
 *   source    对标封面来源，同上；通用款写 '通用'
 *   defaults  该类型渲染所需的全部字段（必须含 w、h）。imageCard 的 src 留空 ''
 *             表示灰色占位块（提示换自己的图）。
 *   colors    3–6 个预设色（十六进制），面板里显示为圆点
 *   icons     可选，可换的图标 id 列表（须已在 components.js 注册）
 *
 * layouts（布局模板）：build(ctx) 返回 {bg, layers}；
 *   ctx = { headline, whyClick, bg, uid, deep, CP(id), TS(id), splitTitleRuns(text) }
 */
(function () {
  'use strict';

  var REF_QZ = '秋招封面';

  function deep(o) { return JSON.parse(JSON.stringify(o)); }

  // 由组件预设生成图层（defaults 深拷贝 + 补齐通用字段）；uid 由 ctx 提供
  function layerFrom(p, uid, overrides) {
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

  // 标题 runs：按 splitTitleRuns 给的分段换色
  function titleLayer(ctx, x, y, w, h, size) {
    var ts = ctx.TS('heavy3');
    var runs = ctx.splitTitleRuns(ctx.headline);
    return {
      id: ctx.uid(), type: 'text', name: '标题 ' + ctx.headline.slice(0, 8), x: x, y: y, w: w, h: h, rot: 0,
      visible: true, locked: false,
      presetId: ts.id, textStyle: ts.id,
      runs: runs,
      autoFit: true, stackAnchor: true,
      color: ts.defaultColor, font: ts.font, weight: ts.weight, size: size || ts.size,
      letterSpacing: 0, lineHeight: 1.08, align: 'left',
      strokes: (function () { var s = deep(ts.strokes); s.forEach(function (st) { st.on = true; }); return s; })(),
      shadow: (function () { var s = deep(ts.shadow); if (s) s.on = true; return s; })()
    };
  }

  window.FMPRE = {

    // ---------- 字效预设 ----------
    textStyles: [
      {
        id: 'heavy3', name: '特粗三层', source: REF_QZ,
        font: 'SHSans', weight: 900, size: 48,
        strokes: [
          { color: '#000000', width: 0.8 },
          { color: '#FFFFFF', width: 2.6 },
          { color: '#000000', width: 1.6 }
        ],
        shadow: { x: 0, y: 2.5, blur: 4, color: 'rgba(0,0,0,.22)' },
        defaultColor: '#000000'
      },
      {
        id: 'heavyWhite', name: '特粗白边', source: REF_QZ,
        font: 'SHSans', weight: 900,
        strokes: [{ color: '#FFFFFF', width: 2.4 }],
        shadow: { x: 0, y: 2, blur: 4, color: 'rgba(0,0,0,.18)' },
        defaultColor: '#0C44F9'
      },
      {
        id: 'serifBold', name: '宋体大标', source: '通用',
        font: 'SHSerif', weight: 900,
        strokes: [],
        shadow: { x: 0, y: 1.5, blur: 3, color: 'rgba(0,0,0,.14)' },
        defaultColor: '#1A1A1A'
      },
      {
        id: 'smiley', name: '潮酷斜体', source: '通用',
        font: 'Smiley', weight: null,
        strokes: [
          { color: '#000000', width: 1 },
          { color: '#FFFFFF', width: 2.2 }
        ],
        shadow: null,
        defaultColor: '#EF5714'
      },
      {
        id: 'cute', name: '可爱圆体', source: '通用',
        font: 'KuaiLe', weight: null,
        strokes: [
          { color: '#FFFFFF', width: 2.4 },
          { color: '#000000', width: 1.2 }
        ],
        shadow: null,
        defaultColor: '#0C44F9'
      }
    ],

    // ---------- 分词高亮色 ----------
    highlightColors: [
      '#000000', '#0C44F9', '#EF5714', '#FFFFFF',
      '#FDD758', '#FF4D8D', '#12A150', '#7B5CFF'
    ],

    // ---------- 组件预设 ----------
    components: [
      {
        id: 'pill-outline', type: 'pill', name: '胶囊', source: REF_QZ,
        defaults: {
          text: '卖点词', font: 'SHSans', weight: 900, size: 15,
          icon: 'sparkles', iconFill: '',
          bg: '#FFDA65', strokeColor: '#0A0A0A', strokeWidth: 2.2,
          halo: 3, shadow: 'soft', w: 110, h: 28
        },
        colors: ['#FFDA65', '#FEC4D2', '#D1CFFE', '#BFF0D4', '#FFFFFF'],
        icons: ['search', 'landmark', 'pencil', 'columns-3', 'circle-check', 'sparkles']
      },
      {
        id: 'pill-solid', type: 'pill', name: '实心胶囊', source: '通用',
        defaults: {
          text: '卖点词', font: 'SHSans', weight: 900, size: 15,
          icon: 'zap', iconFill: '',
          bg: '#1E1E1E', textColor: '#FFFFFF',
          strokeColor: '#0A0A0A', strokeWidth: 0,
          halo: 0, shadow: 'soft', w: 104, h: 28
        },
        colors: ['#1E1E1E', '#0C44F9', '#EF5714', '#12A150', '#FF4D8D'],
        icons: ['zap', 'sparkles', 'star']
      },
      {
        id: 'badge-round', type: 'badge', name: '徽章', source: REF_QZ,
        defaults: {
          r: 48, fill: '#FFF5E9',
          outer: { color: '#FFFFFF', width: 6 },
          inner: { color: '#FCDFA3', width: 2 },
          icon: 'graduation-cap', iconColor: '#26252A',
          text: '标签', font: 'SHSerif', weight: 900, size: 14,
          shadow: 'soft', w: 96, h: 96
        },
        colors: ['#FFF5E9', '#FFDA65', '#FEC4D2', '#D1CFFE', '#BFF0D4'],
        icons: ['graduation-cap', 'star', 'trophy', 'sparkles']
      },
      {
        id: 'brush-sweep', type: 'brush', name: '笔刷', source: REF_QZ,
        defaults: {
          shape: 'sweep', color: '#FDD758', opacity: 1, w: 280, h: 60
        },
        colors: ['#FDD758', '#FEC4D2', '#9EC2FF', '#BFF0D4']
      },
      {
        id: 'card-soft', type: 'imageCard', name: '卡片图', source: REF_QZ,
        defaults: {
          src: '', radius: 8, border: 0,
          borderColor: '#FFFFFF', outline: '#E6E0D8', shadow: 'soft',
          w: 170, h: 116
        },
        colors: ['#FFFFFF', '#FCF8ED', '#F4F2EC']
      },
      {
        id: 'card-white', type: 'imageCard', name: '白边图', source: '通用',
        defaults: {
          src: '', radius: 6, border: 4,
          borderColor: '#FFFFFF', outline: '', shadow: 'soft',
          w: 170, h: 116
        },
        colors: ['#FFFFFF', '#FCF8ED', '#FDD758']
      },
      {
        id: 'card-plain', type: 'imageCard', name: '直角图', source: '通用',
        defaults: {
          src: '', radius: 0, border: 0,
          borderColor: '#FFFFFF', outline: '', shadow: 'none',
          w: 170, h: 116
        },
        colors: ['#FFFFFF', '#FCF8ED']
      }
    ],

    // ---------- 布局模板 ----------
    layouts: [
      {
        id: 'simple', name: '简排', source: '通用',
        build: function (ctx) {
          // 纸底 + 标题（headline 分词）+ 一个胶囊（whyClick 前 4–6 字）
          var pPill = ctx.CP('pill-outline');
          var why = (ctx.whyClick || '').replace(/\s+/g, '');
          var pillText = why ? why.slice(0, why.length > 4 ? 6 : 4) : '重点';
          // 胶囊宽随字数自适应：icon 16 + gap 4 + 字宽 ~15/字 + 左右内距 24
          var pillW = 44 + pillText.length * 15;
          return {
            bg: { color: ctx.bg || '#FCF8ED', paper: true },
            layers: [
              titleLayer(ctx, 14, 30, 276, 112, 48),
              layerFrom(pPill, ctx.uid, { text: pillText, x: 14, y: 156, w: pillW, h: 28, stackAfterTitle: 10, stackAlignX: true, name: '胶囊 ' + pillText })
            ]
          };
        }
      },
      {
        id: 'qiuzhao', name: '秋招', source: REF_QZ,
        build: function (ctx) {
          // 笔刷 + 标题 + 3 胶囊 + 3 卡片图 + 徽章；文字取当前封面 headline/whyClick
          var pPill = ctx.CP('pill-outline'), pBadge = ctx.CP('badge-round');
          var pBrush = ctx.CP('brush-sweep'), pCard = ctx.CP('card-soft');
          function pill(text, bg, icon, iconFill, x, w) {
            return layerFrom(pPill, ctx.uid, { text: text, bg: bg, icon: icon, iconFill: iconFill || '', x: x, y: 118, w: w, h: 28, stackAfterTitle: 8 });
          }
          function card(x, y, w, h, rot) {
            return layerFrom(pCard, ctx.uid, { x: x, y: y, w: w, h: h, rot: rot });
          }
          var why = (ctx.whyClick || '').replace(/\s+/g, '');
          var w1 = why.slice(0, 4) || '重点';
          var w2 = why.slice(4, 8) || '收藏';
          var w3 = why.slice(8, 11) || '照做';
          return {
            bg: { color: ctx.bg || '#FCF8ED', paper: true },
            layers: [
              layerFrom(pBrush, ctx.uid, { x: -10, y: 26, w: 320, h: 78, rot: -3, name: '笔刷 黄色横扫' }),
              card(4, 150, 204, 133, 0),
              card(4, 282, 162, 112, -1),
              card(152, 276, 144, 116, 2),
              titleLayer(ctx, 14, 8, 276, 112, 44),
              pill(w1, '#FFDA65', 'search', '#FFE9A8', 6, 99),
              pill(w2, '#FEC4D2', 'landmark', '', 109, 95),
              pill(w3, '#D1CFFE', 'pencil', '#B3ACF5', 207, 84),
              layerFrom(pBadge, ctx.uid, {
                x: 197, y: 157, w: 102, h: 102, rot: 0,
                r: 51, text: w1, size: 15, stackAfterTitle: 37, name: '徽章 ' + w1
              })
            ]
          };
        }
      }
    ]
  };
})();
