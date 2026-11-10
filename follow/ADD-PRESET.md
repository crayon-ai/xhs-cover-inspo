# 新增预设（照着做编辑器）

组件库在 `follow/presets.js`，往对应数组里**追加一条对象**即可，界面自动渲染，无需改 `follow/follow.js`。

## 新增字效预设（FMPRE.textStyles）

复制最接近的一条（如 `heavy3`），改：

- `id`：唯一，小写；`name`：卡片短名 2–4 字
- `font` / `weight`：字体 id 与字重（`FONTS`：SHSans / SHSerif / Smiley / KuaiLe）
- `strokes`：描边层，从**内到外** `[{color,width}]`；无描边填 `[]`
- `shadow`：`{x,y,blur,color}` 或 `null`
- `defaultColor`：默认填充色；`size` 可选
- `source`：对标封面写 `'封面名'`，通用款写 `'通用'`

## 新增组件预设（FMPRE.components）

复制同 type 的一条（pill / badge / brush / imageCard），改：

- `id`（唯一）、`name`（网格短名）、`source`（同上）
- `defaults`：该类型渲染字段，**必须含 `w`、`h`**（imageCard 的 `src` 留空 `''` 即灰色占位块）
- `colors`：3–6 个预设色圆点；`icons`：可选图标 id 列表

## 新增布局模板（FMPRE.layouts）

复制 `layouts` 里的一条，改 `id` / `name` / `source`，写 `build(ctx)` 返回 `{bg, layers}`。
`ctx` 提供：`headline` / `whyClick`（当前封面文案）、`bg`（自动取的纸底色）、
`uid()`、`deep(o)`、`CP(id)` / `TS(id)`（取预设）、`splitTitleRuns(text)`（标题分词换色）。
文字一律用 `ctx.headline` / `ctx.whyClick` 填，不要写死文案。

## 需要新图标

把 Lucide 的 SVG（24×24 viewBox、线性 stroke）拆成 `<path>/<rect>/<circle>` 字符串数组，
加到 `follow/components.js` 的 `ICONS`，再用 `I([...], [可填色元素下标])` 注册，然后在预设的 `icons` 里引用其 id。

## 需要新字体

先子集化出 woff2 放入 `assets/follow/fonts/`，在 `follow/follow.js` 顶部 `FACES` 数组加一条
（首次打开编辑器时按需加载 @font-face），再到 `follow/components.js` 的 `FONTS` 加一条
`{id,name,sample,css,weight}`，字效预设即可引用。许可证原文放 `assets/follow/licenses/`。
