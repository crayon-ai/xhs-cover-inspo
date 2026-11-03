# 封面灵感收集 · 设计规范

导入页按用户确认对齐 **How We Feel · Check in**（黑底 + 彩虹环 + 白圆加号）。导入后在同一页用 **Craft Your Postcard** 倾斜卡挑选封面，再记笔记。灵感库、记笔记、提示词同近黑底。没有单独的候选页。

## 参考来源

| 角色 | 来源 | 借什么 |
|------|------|--------|
| A 导入空态 | **How We Feel** Check in（用户截图确认） | 纯黑/近黑全屏；彩虹渐变发光圆环（橙→黄→绿→蓝→紫）；环心白实心圆 + 黑符号；钮下短 label |
| B 字色 / CTA（非导入） | The stack 22 / 参考站品牌胶囊 | 炭墨绿 `#27362f`；米白字 `#f7f6f1` |
| C 字阶 | #012 Eventually ❤ | 标题粗 / 副文细灰；字阶落差 |
| D 工作台 | #064 Mintlify ❤ | 清晰层级；候选/库/提示词页 |
| E 手机感 | Things / Notion 空态 | 顶栏短标题；灰字层级 |
| F 微堆 | ★B 柔光舞台 | 环后 2–3 张 3:4 微堆（压暗不抢环） |
| G 候选轮播 | Craft Your Postcard（swipe-ref f08/f12/f16） | 近黑底；居中竖卡轻微 rotateZ；邻卡 rotateY/Z 透视倾斜 + 左右 peek；无拍立得白边；浅字控件 |

**审美例外（全页近黑）**：用户确认突破「禁用大面积黑底」——导入 How We Feel 暗色，选封面时同页倾斜卡；灵感库、记笔记、提示词同套近黑。彩虹高饱和仅导入环。

## CSS 变量（实现以 `styles.css` `:root` 为准）

```css
--bg: #FFFFFF;
--bg-soft: #F7F6F1;
--card: #FFFFFF;
--card-solid: #FFFFFF;
--ink: #27362f;              /* 炭墨绿 · 非导入页标题 / Tab / CTA */
--ink-body: #3A3A3A;
--muted: #8A8A8A;
--faint: #B0B0B0;
--line: #EBEBEB;
--accent: #27362f;
--accent-soft: #ECEFEA;
--accent-ink: #27362f;
--blue: #2F80ED;
--coral: #E2483D;
--danger: #C45C5C;
--shadow: 0 1px 2px rgba(39,54,47,0.04), 0 8px 24px rgba(39,54,47,0.06);
--shadow-lift: 0 4px 16px rgba(39,54,47,0.10);
--radius-card: 16px;
--radius-inner: 10px;
--radius-pill: 999px;
--font: -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB",
        "Microsoft YaHei", "Noto Sans SC", sans-serif;
--ease-out: cubic-bezier(0.22, 1, 0.36, 1);
--dur: 200ms;
```

深色 chrome（`#app.is-dark-chrome` / `is-import` / `is-library` / `is-note` / `is-export`，不进 `:root`）：
- 底 `#0a0a0a`；顶栏/Tab/脚注与导入同套半透明深色
- 导入环：`conic-gradient` 低饱和橙 `#c8885e` → 黄 `#c9ae6a` → 绿 `#6aab88` → 蓝 `#5a8fbf` → 紫 `#8a78b8` → 粉 `#b87898`；bloom ~0.28、arc ~0.58
- 导入主钮：白圆 + 黑 `+`；预览 CTA 白胶囊黑字
- 候选控件：浅字 / 半透明 ghost；主 CTA 近白胶囊 + 黑字

## 字体阶梯（390 宽）

- Wordmark：17–18px / 650；深色页白字
- 区块 h2：17px / 650
- 正文 / 表单：15px / 400；色 `#3A3A3A`
- 次要：12–13px / `#8A8A8A`
- 导入白圆钮 `+`：约 72px 钮 / 36px 字 / 黑于白
- 导入 label「导入」：13px / 500 / letter-spacing 0.08em / 半透明白
- **禁 CDN / 外链字体**

## 间距 / 布局

- 内容最大宽 480px；左右 padding 20px
- 导入舞台偏中上（约 `padding-top: 14vh`）；假封面仅装饰
- 导入选封面：切出的封面在导入页内横向倾斜 snap，点中间卡选中，再进记笔记。未导入时不出现这组卡
- 库：近黑双列瀑布流（封面原比例）；底部分类胶囊横向滚动，`全部` 在最前
- 主断点：手机 390 优先

## 组件

### 顶栏 / Tab（共屏）
- **深色同屏**（`is-dark-chrome`：导入、灵感库、记笔记、提示词）：近黑底；白字标题；半透明灰副文；Tab 深色半透明条 + 白字激活 + 白下划

### 按钮
- Primary（深色页）：近白胶囊 + 黑字
- Ghost：半透明白字，细边或无边（导入「换一张」无边）

### 导入（How We Feel）
- 全屏近黑 `#0a0a0a`（`#view-import` + chrome）
- 中央彩虹环：外层 bloom 模糊 conic + 内层 mask 细弧；环心白圆黑 `+`
- Soft Breath：2 圈彩虹浅描边扩环（约 7s；预览/`prefers-reduced-motion` 关）
- 微堆：压暗 `brightness ~0.42`，不抢环；库内真图优先，假卡 fallback
- 选图后：深色预览卡 → 白「开始切封面」+ 淡「换一张」

### 导入后选封面（同页 · 倾斜卡）
- 没有「候选」tab。未导入只显示圆环
- 导入后立刻切分，封面横轨出现在导入页：`perspective` + `rotateY` / `rotateZ`，中心卡微倾，邻卡 peek
- 卡：圆角封面，无拍立得白边；点居中卡选中（白✓），点 peek 滚到该卡
- 页码 `1 / n`；主按钮「记笔记」；「换一张」为淡字
- 记完笔记进入提示词页

### 灵感库（近黑双列）
- 底 / chrome：与导入、候选同 `#0a0a0a`（`#app.is-library` + `is-dark-chrome`）。整页锁在一屏（`100dvh`，不支持时用铺满视口的 fixed；含 safe-area）。只有封面双列区域纵向滚动，分类条和页脚始终可见
- 封面：两列瀑布流，保持原比例，圆角约 18px，阴影适配黑底；点封面开底部弹层
- 弹层：更大的封面 + 当时记下的字段（为何想点、感觉、结构亮点、画面可学点、分类/标签、日期）；点遮罩或关闭钮收起；可删除
- 分类行可改：已有分类做成深色胶囊，当前项高亮；输入框 +「添加」新建。点选立即写入 `category`。若正在筛选且改后不再匹配，关上弹层后该封面离开此筛选
- 底部分类条：胶囊芯片，`全部` 在最前，横向 `scroll-snap`、不显示滚动条；贴在页脚之上，避开 safe-area。选中项为白胶囊黑字
- 清空全部：页脚旁极淡文字，不占主视觉
- 空态一句短字，同深色

### 记笔记（近黑）
- 底 / chrome：同 `#0a0a0a`（`#app.is-note` + `is-dark-chrome`）
- 封面：大圆角竖卡，阴影同候选/库，无拍立得白边
- 字段：短标签；深色输入，细边，聚焦时白边
- 分类：深色胶囊，当前项白底；输入框 +「添加」
- 主按钮近白胶囊，跳过为 ghost；进度仅 `2 / 5`
- 记录写入 `category`，标签仍给提示词页。旧记录无 `category` 时用第一个标签，否则「未分类」

### 提示词（近黑）
- 底同深色（`#app.is-export`）
- 「长按截图保存」一行极淡小字；主按钮「生成汇总」
- 汇总卡：圆角深色块 + 封面 + 可选中的浅色提示词，层级对齐库弹层
- 空态短字，无说明段

## 动效

- 仅 `transform` / `opacity` / 轻 `filter`；150–220ms ease-out
- Soft Breath + 环极慢呼吸；候选轨 smooth scroll + 滚动中更新倾斜；不做跑马灯 / 强模糊轰炸

## 禁用

视觉（工作台页）：紫主色；大段说明；黑白杂志风空态  
视觉（深色例外已批准）：近黑底用于导入、灵感库、记笔记、提示词；彩虹环仅导入  
容器：内联 script / 行内事件 / eval / Worker / WASM / fetch / clipboard / download / 外链 / iframe / CDN
