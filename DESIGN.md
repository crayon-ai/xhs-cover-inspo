# 封面灵感收集 · 设计规范

导入页按用户确认对齐 **How We Feel · Check in**（黑底 + 彩虹环 + 白圆加号）。导入后在同一页用 **Pinterest 式卡片堆叠**挑选封面，再记笔记。灵感库、记笔记同近黑底。没有单独的候选页，也没有提示词页（2026-11-03 用户确认删除）。

## 参考来源

| 角色 | 来源 | 借什么 |
|------|------|--------|
| A 导入空态 | **How We Feel** Check in（用户截图确认） | 纯黑/近黑全屏；彩虹渐变发光圆环（橙→黄→绿→蓝→紫）；环心白实心圆 + 黑符号；钮下短 label |
| B 字色 / CTA（非导入） | The stack 22 / 参考站品牌胶囊 | 炭墨绿 `#27362f`；米白字 `#f7f6f1` |
| C 字阶 | #012 Eventually ❤ | 标题粗 / 副文细灰；字阶落差 |
| D 工作台 | #064 Mintlify ❤ | 清晰层级；库页 |
| E 手机感 | Things / Notion 空态 | 顶栏短标题；灰字层级 |
| F 微堆 | ★B 柔光舞台 | 环后 2–3 张 3:4 微堆（压暗不抢环） |
| G 候选选卡 | **Pinterest** feed-tuning 卡片动效（用户录屏确认 2026-11-03） | 近黑底；横排铺满屏幕，每张卡自带倾斜，滚动时翻转/缩放随位置变化 |

**审美例外（全页近黑）**：用户确认突破「禁用大面积黑底」——导入 How We Feel 暗色，选封面时同页卡片堆；灵感库、记笔记同套近黑。彩虹高饱和仅导入环。

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

深色 chrome（`#app.is-dark-chrome` / `is-import` / `is-library` / `is-note`，不进 `:root`）：
- 底 `#0a0a0a`；顶栏/Tab/脚注与导入同套半透明深色
- 导入环：`conic-gradient` 低饱和橙 `#c8885e` → 黄 `#c9ae6a` → 绿 `#6aab88` → 蓝 `#5a8fbf` → 紫 `#8a78b8` → 粉 `#b87898`；bloom ~0.28、arc ~0.58
- 导入主钮：白圆 + 黑 `+`；选卡 CTA 白胶囊黑字
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
- 导入选封面：切出的封面在导入页内以卡片堆轮换，见下方组件说明。未导入时不出现
- 库：分类横滑行单一视图（封面原比例，右缘露出）；无「全部」看板、无模式切换
- 主断点：手机 390 优先

## 组件

### 顶栏 / Tab（共屏）
- **深色同屏**（`is-dark-chrome`：导入、灵感库、记笔记）：近黑底。没有顶栏说明和页面标题。Tab 默认不占位，上下滑动时半透明深色条淡入，约 1.5 秒后淡出；点选后立刻收回。Tab 只有「导入」「灵感库」。

### 按钮
- Primary（深色页）：近白胶囊 + 黑字
- Ghost：半透明白字，细边或无边（导入「换一张」无边）

### 导入（How We Feel）
- 全屏近黑 `#0a0a0a`（`#view-import` + chrome）
- 中央彩虹环：外层 bloom 模糊 conic + 内层 mask 细弧；环心白圆黑 `+`
- Soft Breath：2 圈彩虹浅描边扩环（约 7s；预览/`prefers-reduced-motion` 关）
- 微堆：压暗 `brightness ~0.72`，能读出是封面但不抢环；库内真图优先，假卡 fallback；三张卡错相位缓慢漂浮（7–10s 周期，位移 ≤11px、旋转 ≤1.4°，`prefers-reduced-motion` 关）
- 选图后：直接切分，卡片堆出现在导入页

### 导入后选封面（同页 · 横排铺满 + 翻动动效）
- 没有「候选」tab。未导入只显示圆环
- 导入后立刻切分，全部封面排成一条**横向铺满屏幕的长排**（snap 居中，邻卡向两侧出血）；侧边距 `calc(50vw - 卡宽/2)`，首卡初始即精确居中
- 每张卡有固定随机静置倾斜（±5° 内，按索引确定），不是呆板直排
- 滚动联动动效（`updateRailMotion`，rAF 跟帧）：偏离居中越远，额外翻转越大（±9°/卡宽）、缩放越小（至 0.86）、交替上下漂移（≤12px）、亮度压暗（至 0.55）；居中卡恢复本卡静置倾斜、原尺寸、`is-center` 高亮
- 交互：点居中卡选中（白✓徽标）；点边卡 `scrollIntoView` 滚到居中；横滑自由滚动 + snap；页码 `i / n` 随滚动更新
- `prefers-reduced-motion`：关过渡，位移定位保留
- 主按钮「收藏」（未选中时禁用，2026-11-03 由「记笔记」更名）；「换一张」为 ghost，点击清空当前选择**回到 + 空态**（不直接弹文件选择，由用户重新点加号，2026-11-03 用户确认，同时删除「清空重来」）
- 记完笔记进入灵感库

### 灵感库（分类横滑行 · 单一视图）
- 只有分类横滑行一种视图：每个分类一条横向卡片带，行内左右滑、上下换分类。没有「全部」网格看板，没有模式切换 Tab
- 分类规划：后续固定为 5 类——情绪共鸣型 / 结果反差型 / 信息差干货型 / 结果展示型 / 身份认同型（当前仍为用户自定义分类，结构不变）
- 行结构：首行「最近收藏」（全部按时间倒序，仅分类多于一个时出现），其后分类行按收藏数降序、`未分类` 恒排最后；空分类不出行。行头 = 分类名 + 数量徽章
- 行内卡片：统一行高（`clamp(150px, 46vw, 230px)`）、宽度随封面原比例、不裁切（`object-fit: contain` 兜极宽图）；行轨道 CSS `scroll-snap`（x mandatory，start 对齐、`scroll-padding-left` 与库 12px 内边距一致），右缘露出半张卡作滑动暗示；`overscroll-behavior-x: contain` 防 iOS 侧滑误触前进/后退
- 行级懒渲染：`IntersectionObserver` 以 `.lib-scroll` 为 root（rootMargin 120%），行接近视口才建卡；无 IO 环境全部直渲
- 底 / chrome：与导入、候选同 `#0a0a0a`（`#app.is-library` + `is-dark-chrome`）。整页锁在一屏（`100dvh`，不支持时用铺满视口的 fixed；含 safe-area）。只有封面区域纵向滚动，页脚（清空）始终可见
- 封面：圆角约 18px，阴影适配黑底；点封面开底部弹层
- 弹层：更大的封面 + 当时记下的字段（为何想点、感觉、结构亮点、画面可学点、分类/标签、日期）；点遮罩或关闭钮收起；可删除
- 分类和笔记在弹层里先改、不立刻写入。有改动才出现「确认修改」；再经深色确认框后才写入 IndexedDB。直接关掉弹层则丢弃改动
- 清空全部：页脚旁极淡文字，不占主视觉
- 空态一句短字，同深色

### 记笔记（近黑）
- 底 / chrome：同 `#0a0a0a`（`#app.is-note` + `is-dark-chrome`）
- 封面：大圆角竖卡，阴影同候选/库，无拍立得白边
- 字段：短标签；深色输入，细边，聚焦时白边
- 分类：深色胶囊，当前项白底；输入框 +「添加」
- 主按钮近白胶囊，跳过为 ghost；进度仅 `2 / 5`
- 记录写入 `category`，标签作为检索字段。旧记录无 `category` 时用第一个标签，否则「未分类」

## 动效

- 仅 `transform` / `opacity` / 轻 `filter`；150–220ms ease-out（卡片堆轮换 460ms）
- Soft Breath + 环极慢呼吸 + 微堆漂浮；卡片堆轮换用 transform 过渡；不做跑马灯 / 强模糊轰炸

## 禁用

视觉（工作台页）：紫主色；大段说明；黑白杂志风空态  
视觉（深色例外已批准）：近黑底用于导入、灵感库、记笔记；彩虹环仅导入  
容器：内联 script / 行内事件 / eval / Worker / WASM / fetch / clipboard / download / 外链 / iframe / CDN
