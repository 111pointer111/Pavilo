# Pavilo 设计语言

Pavilo 的设计语言围绕**临时、轻盈、可信**三个核心概念构建，旨在传达"一座随处可搭的小亭"的产品理念。

## 设计原则

### 1. 临时性（Ephemeral）
通过微妙的视觉线索强化"只在此刻"的概念：
- 半透明背景与玻璃态效果
- 柔和的阴影暗示"浮在空中"的轻盈感
- 消息与状态的流动性动画

### 2. 可信赖（Trustworthy）
在局域网环境中建立安全感：
- 清晰的视觉层次和信息架构
- 高可读性的字体组合
- 明确的状态反馈与交互提示

### 3. 现代克制（Modern & Restrained）
避免过度设计，保持专业与优雅：
- 精心调校的色彩系统
- 一致的圆角和间距规范
- 有节制的动效使用

---

## 色彩系统

### 主色调（Primary）
```css
--teal: #0f7772          /* 主品牌色 - 深青色 */
--teal-deep: #075d5d     /* 深色变体 */
--teal-pale: #dceee9     /* 浅色背景 */
```

**使用场景**：
- 品牌标识、Logo
- 主要操作按钮
- 激活状态、选中状态
- 链接与强调元素

**情感传达**：沉稳、专业、可信赖

### 强调色（Accent）
```css
--coral: #e86f57         /* 珊瑚红 */
--coral-pale: #fbe4dc    /* 浅色背景 */
```

**使用场景**：
- 错误提示与警告
- 重要通知徽标
- 需要用户注意的元素
- 删除、离开等危险操作

**情感传达**：温暖、友好、需要关注

### 辅助色（Supporting）
```css
--yellow: #f4c85f        /* 明黄色 */
--yellow-pale: #fff3c8   /* 浅色背景 */
```

**使用场景**：
- @ 提及自己时的高亮
- 成功提示
- 温和的提醒

### 中性色（Neutral）
```css
--bg: #eef4f2            /* 页面背景 */
--bg-deep: #e3eeeb       /* 深色背景变体 */
--paper: #f9fbf8         /* 卡片/面板背景 */
--paper-warm: #fffdf6    /* 温暖纸质背景 */

--ink: #182d32           /* 主文字颜色 */
--ink-soft: #6b7d7d      /* 次要文字 */
--ink-faint: #9aa9a6     /* 弱化文字/提示 */

--line: #d3e0dd          /* 分割线 */
--line-strong: #b9cfca   /* 强调边框 */
```

### 深色模式（Dark Mode）
```css
@media (prefers-color-scheme: dark) {
  --bg: #0d1b1d
  --bg-deep: #091419
  --paper: #162a2e
  --ink: #e8f1f0
  --teal: #4dd4c7        /* 在深色背景上更明亮 */
  --coral: #ff8a6d
}
```

---

## 字体系统

### 字号阶梯
界面只用五级字号，禁止 9px 及以下。辅助说明用 `--ink-soft`，`--ink-faint` 只给占位符、分割线和图标。

```css
--font-caption: 11px;   /* 时间、状态、区块标签 */
--font-label: 12px;     /* 按钮、hint、次要 UI */
--font-ui: 13px;        /* 频道名、成员名、发送者 */
--font-body: 15px;      /* 消息正文与输入框（同一级） */
--font-title: 22px;     /* 当前频道名；登录大标题仍用 clamp */
```

登录页输入框固定 16px，避免 iOS 聚焦时缩放页面。

### Display - 展示型字体（衬线）
```css
--display: "Iowan Old Style", "Baskerville", "Songti SC", STSong, Georgia, serif;
```

**使用场景**：
- 登录页大标题
- 当前频道名（工作区标题，`--font-title`）
- 空状态标题、资料卡名字
- 需要仪式感的文案

**特征**：优雅、易读、有文化气息。进房后不再用封面级大标题。

### Body - 正文字体（无衬线）
```css
--body: "Avenir Next", "PingFang SC", "Noto Sans CJK SC", "Segoe UI", sans-serif;
```

**使用场景**：
- 消息正文
- 按钮文字
- 界面标签
- 大部分 UI 元素

**特征**：现代、清晰、跨平台兼容性好

### Mono - 等宽字体
```css
--mono: "SFMono-Regular", "Cascadia Code", "Roboto Mono", Menlo, monospace;
```

**使用场景**：
- 时间戳
- 技术标签（IP 地址、频道 ID）
- 人数统计
- 状态码与提示

**特征**：技术感、精确、易于对齐

---

## 间距系统

### 基础网格：4px
所有间距都是 4px 的倍数，确保视觉对齐。下列 token 写在 `chat.css` 的 `:root` 中：

```css
--space-1: 4px    /* 最小间距 */
--space-2: 8px    /* 紧凑间距 */
--space-3: 12px   /* 默认间距 */
--space-4: 16px   /* 舒适间距 */
--space-5: 24px   /* 区块间距 */
--space-6: 32px   /* 大区块间距 */
--space-8: 48px   /* 章节间距 */
```

### 组件内边距规范
- **按钮**：小按钮 `7px 11px`，大按钮 `9px 16px`
- **卡片**：`20px - 30px`
- **列表项**：`8px 10px`

---

## 圆角系统

```css
--radius-sm: 6px    /* 按钮、输入框 */
--radius-md: 8px    /* 卡片 */
--radius-lg: 12px   /* 面板、模态框 */
--radius-xl: 16px   /* 大型容器 */
--radius-full: 999px /* 圆形头像、徽标 */
```

### 特殊圆角：不对称设计
头像使用独特的不对称圆角增强品牌识别度：
```css
border-radius: 10px 10px 10px 3px;  /* 右下角更尖锐 */
```

---

## 阴影系统

### 标准阴影
```css
--shadow: 0 18px 48px rgba(40, 77, 77, .11);
```
**使用场景**：卡片、面板等表面元素

### 浮动阴影
```css
--shadow-float: 0 20px 56px rgba(24, 64, 64, .17);
```
**使用场景**：模态框、弹出菜单等浮动元素

### 玻璃态效果
```css
backdrop-filter: blur(24px) saturate(180%);
box-shadow: 
  0 8px 32px rgba(15, 119, 114, .08),
  inset 0 1px 0 rgba(255, 255, 255, .5);
```
**使用场景**：主工作区、登录卡片等核心容器

---

## 动效系统

### 时序规范
```css
--transition-fast: 150ms     /* 快速反馈（hover） */
--transition-base: 250ms     /* 标准过渡 */
--transition-slow: 400ms     /* 复杂动画 */
```

### 缓动曲线
```css
--ease-smooth: cubic-bezier(.4, 0, .2, 1)          /* 流畅过渡 */
--ease-bounce: cubic-bezier(.68, -0.55, .27, 1.55) /* 弹性动画 */
```

### 动效原则
1. **有意义**：只在需要反馈或引导注意力时使用
2. **快速**：大部分动画 < 300ms
3. **自然**：模拟物理世界的运动规律
4. **可关闭**：尊重 `prefers-reduced-motion`

---

## 图标系统

### 图标库
使用 [Lucide](https://lucide.dev) 图标集（ISC 许可，自托管）

### 尺寸规范
```css
--icon-sm: 12px   /* 小型图标（标签内） */
--icon-md: 15px   /* 标准图标（按钮） */
--icon-lg: 18px   /* 大型图标（主要操作） */
--icon-xl: 21px   /* 特大图标（导航） */
```

### 使用原则
- 图标与文字垂直居中对齐
- 图标颜色继承 `currentColor`
- 保持视觉重量一致（统一描边宽度）

---

## 响应式断点

```css
/* 桌面优先 */
@media (max-width: 1180px) { /* 中等屏幕：先收成员栏，频道栏保留；成员走抽屉 */ }
@media (max-width: 760px)  { /* 移动设备：单列布局，顶栏显示当前频道 */ }
@media (max-width: 480px)  { /* 小屏手机：进一步紧凑 */ }
@media (max-height: 560px) { /* 横屏/短屏优化 */ }
```

---

## 无障碍设计

### 焦点样式
```css
:focus-visible {
  outline: 3px solid rgba(232, 111, 87, .42);
  outline-offset: 3px;
}
```

### 对比度
- 主文字：4.5:1 以上
- 大标题：3:1 以上
- 交互元素：3:1 以上

### 语义化 HTML
- 正确使用 `<button>` vs `<a>`
- ARIA 属性完整（`aria-label`, `role`, `aria-live`）
- 键盘导航友好（Tab 顺序、快捷键）

---

## 品牌元素

### Logo
- 主标志：亭子造型 + 通知圆点
- 颜色：Teal (#0f7772) + Coral (#e86f57)
- 可在白色、浅色、深色背景上使用

### 品牌标语
**"进场，只留当下"** - 强调临时性与当下性

### 视觉隐喻
- **亭子**：临时、轻量、可移动的聚会场所
- **局域网波纹**：同一空间的连接感
- **玻璃态透明**：开放、无隐藏的沟通方式

---

## 组件设计模式

### 消息气泡
每条消息是独立气泡，而不是整行高亮。同一人连续发言时，只有第一条显示头像和名字；后续消息把头像槽让给悬停才出现的时间。回应与回复按钮出现在气泡右侧顶部，桌面悬停 / 键盘聚焦时出现，触摸设备常显。图文混排一律上图下字，气泡宽度跟每张缩略图的显示宽度走（宽图宽、方图中、竖图窄），配文折行贴合，不撑开空列。

```css
.message-bubble {
  padding: 8px 12px;
  border-radius: 4px 16px 16px 16px;
  background: var(--paper);
}
.message.self .message-bubble {
  background: color-mix(in srgb, var(--teal-pale) 72%, var(--paper));
}
.message-bubble.has-media {
  display: flex;
  flex-direction: column;
  width: max-content;
  max-width: 100%;
}
.message-bubble.has-media .message-image-link {
  width: var(--thumb-w, 390px);
}
.message-bubble.has-media .message-body,
.message-bubble.has-media .reply-quote {
  width: 0;
  min-width: 100%;
}
```

### 工作区页头
进房后只有一层功能头：顶栏显示品牌、当前频道名、连接状态和操作。频道自定义说明（若有）出现在消息区上方一行；没有说明时这行在桌面隐藏。「临时 / 不落盘」只由左侧「只在此刻」卡片承担。离开是幽灵/危险样式，与语言、分享、提醒分开。

发送是这一屏的主按钮：高度 40px（移动端 44px），输入框与消息正文同为 15px。

### 按钮层级
1. **Primary**：Teal 背景，白色文字（发送、进入频道、值班台保存）
2. **Secondary**：白色背景，Teal 边框（次要操作）
3. **Ghost**：透明背景，仅在 hover 时显示（辅助操作；离开用幽灵+珊瑚危险态）

值班台一屏只有一个实心主按钮。删除是幽灵珊瑚，确认对话框里才用实心珊瑚。

### 值班台
`/admin` 是部署者的值班室，不是另一套控制台。沿用本文件的色、字、间距；列表用账本行（一张纸、底边线），不用独立卡片墙。Lucide 只给显示口令、关闭之类的功能控件，导轨和列表不加装饰图标。页头 lead 一句，真源说明贴在徽章上。

### 输入框状态
```css
.input {
  border: 1px solid var(--line-strong);
}
.input:focus {
  border-color: var(--teal);
  box-shadow: 0 0 0 3px rgba(15, 119, 114, .1);
}
.input:invalid {
  border-color: var(--coral);
}
```

---

## 设计资源

### Figma 设计稿
（未来可补充社区设计稿链接）

### 色彩对比检查
- [WebAIM Contrast Checker](https://webaim.org/resources/contrastchecker/)
- 确保 WCAG AA 标准

### 动效参考
- [Easings.net](https://easings.net/) - 缓动函数可视化
- `prefers-reduced-motion` 检测

---

## 设计演进

### 当前
- ✅ 基础色彩系统与间距
- ✅ 浅色 / 深色模式
- ✅ 玻璃态与克制动效
- ✅ 响应式桌面与移动布局
- ✅ 简体中文 / 英语界面

社区主题市场、PWA 图标系统、任意组件替换不作为 v2.0 目标（见 ROADMAP 暂缓范围）。嵌入界面只规划品牌与布局配置，尚未交付。

---

## 贡献指南

### 修改设计语言时
1. 确保符合三大核心原则（临时、可信、克制）
2. 保持与现有组件的一致性
3. 测试深色模式和无障碍性
4. 更新本文档对应章节

### 提议新组件时
1. 先查阅现有设计模式是否可复用
2. 提供视觉稿或代码示例
3. 说明使用场景与设计决策
4. 考虑响应式和边缘情况

---

**Pavilo 设计语言是一个活文档**，随着项目演进持续更新。我们欢迎社区贡献更好的设计方案，但请保持产品核心理念的一致性。
