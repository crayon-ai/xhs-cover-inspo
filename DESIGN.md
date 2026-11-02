# 封面灵感收集 · 设计规范

依据 Stack22 雾色底 + 参考站炭墨绿锚点（用户确认：**雾色渐变底 + 主色 `#27362f`**，非纯黑）。

## 参考来源

| 角色 | 来源 | 借什么 |
|------|------|--------|
| A 空态构图 | ★B 柔光舞台（Dabbit/Eight Shot/Monocle） | 雾底柔光环 + 炭墨绿圆 `+` + 2–3 张微堆（优先用户封面，假封面 fallback） |
| B 字色 / CTA | The stack 22 / 参考站品牌胶囊 | 炭墨绿 `#27362f` 锚点；米白字 `#f7f6f1`；大留白 |
| C 字阶 | #012 Eventually ❤ | 标题粗 / 副文细灰；字阶落差 |
| D 工作台 | #064 Mintlify ❤ | 清晰层级；主按钮同色锚点 |
| E 手机感 | Things / Notion 空态 | 顶栏短标题；灰字层级 |
| F 底色 | The stack 22 演示页墙纸 | 淡紫灰 × 雾绿 × 暖米慢渐变（仅导入页） |

上一版「纯白底 + `#111` 近黑」已弃用；奶油底 + Proof 森林绿亦已弃用。

## CSS 变量（实现以 `styles.css` `:root` 为准）

```css
--bg: #FFFFFF;
--bg-soft: #F7F6F1;
--card: #FFFFFF;
--card-solid: #FFFFFF;
--ink: #27362f;              /* 炭墨绿 · 标题 / Tab / CTA */
--ink-body: #3A3A3A;
--muted: #8A8A8A;
--faint: #B0B0B0;
--line: #EBEBEB;
--accent: #27362f;           /* CTA · 同 ink */
--accent-soft: #ECEFEA;
--accent-ink: #27362f;
--blue: #2F80ED;             /* 辅色，克制 */
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

## 字体阶梯（390 宽）

- Wordmark：17–18px / 650；色 `#27362f`
- 区块 h2：17px / 650
- 正文 / 表单：15px / 400；色 `#3A3A3A`
- 次要：12–13px / `#8A8A8A`
- 导入炭墨绿圆钮 `+`：约 68px 钮 / 34px 字 / 米白 `#f7f6f1` 于 `#27362f`
- 主 CTA 文案：15–16px / 600 / 米白字
- **禁 CDN / 外链字体**

## 间距 / 布局

- 内容最大宽 480px；左右 padding 20px
- 导入舞台偏中上（约 `padding-top: 16vh`）；假封面仅装饰
- 候选 / 库：双列 gap 12px
- 主断点：手机 390 优先

## 组件

### 顶栏
- 左对齐短 wordmark「封面灵感」（炭墨绿）；一行极淡缓存提示
- 无邮票徽章 / 蜜桃黄点

### Tab
- 底部分割线；选中 = 炭墨绿字 + 2px 同色下划；未选 = `#8A8A8A`

### 按钮
- Primary：炭墨绿胶囊 `#27362f` + 米白字 `#f7f6f1`，高 ≈ 48
- Ghost：白底 + `#EBEBEB` 边 + `#27362f` 字
- Danger：珊瑚字色

### 导入（★B 柔光舞台 + Soft Breath + 真图微堆）
- 空态底：The stack 22 式纯色慢渐变（淡紫灰×雾绿×暖米，仅 `#view-import`；无噪点/额外阴影层）
- 对比策略：**大面积低饱和雾色底 + 少量炭墨绿锚点**（主 CTA / 激活 Tab / 关键文字一色贯穿），非黑白高反差
- 中央大环：`rgba(247,246,241,0.72)` 雾米半透明 + 绿灰阴影 `0 18px 40px rgba(39,54,47,0.08)`
- 中心圆钮 `#27362f` + 米白 `+`（0 字）
- 幽灵卡片：`#ecefea`～`#e8e7eb` 淡雾色，同绿灰软阴影
- 背后 2–3 张 3:4 微堆（旋转 ≤6°，`pointer-events:none`）。**空态微堆优先用户封面**：灵感库有封面 Blob 时取最近最多 3 张；不足则真卡+假卡混用，0 张全假封面 CSS fallback
- **Soft Breath**：2 圈极淡扩环（约 7s，绿灰描边；预览态/`prefers-reduced-motion` 关）
- 选图后：白边预览卡 → 炭墨绿「开始切封面」+ 淡「换一张」（逻辑不变）

### 封面卡
- 白边拍立得 + 细线；选中微抬起 / ±1–2°（reduced-motion 关倾斜）

### 表单 / 库 / 提示词
- 白底细线；chip 选中炭墨绿底米白字；提示词展板可截图

## 动效

- 仅 `transform` / `opacity`；150–220ms ease-out
- 空态可选：假封面入场 stagger、圆环极慢呼吸；**Soft Breath**：导入舞台 2 圈极淡扩环（约 7s）
- 不做跑马灯 / 强模糊 / 紫光球 / 高饱和假封面

## 禁用

视觉：纯黑 `#111` 主 CTA；纯白死板空态无层次；奶油底 `#F6F3EC` 旧 Proof；紫主色；大段说明；黑白高反差杂志风  
容器：内联 script / 行内事件 / eval / Worker / WASM / fetch / clipboard / download / 外链 / iframe / CDN
