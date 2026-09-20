# Changelog

Pavilo 的重要变更都记在这份文件里。

格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Changed
- 更新 v1.x 规划：可选 SQLite（默认留存 30 天）、进程内 AI 网关与管理页、内容审核、独立玩法页与官方狼人杀样例。v1.0 发布不再要求生产观察期。

### Added
- [docs/play.md](docs/play.md)：玩法频道绑定与独立页面的贡献约束（v1.5 前为草案）

## [0.9.0] - 2026-09-18

### Removed
- **BREAKING: Protocol v1/v2/v3**。服务端只接受 `join.protocolVersion: 4`（必须为整数 4）。其他值返回 `PROTOCOL_NOT_SUPPORTED`，并以 WebSocket `1002 / protocol not supported` 关闭。请刷新内置网页客户端，或把第三方客户端升级到 v4。

### Added
- **图片先暂存再发送**：粘贴、选文件或拖入图片后，输入框内文字上方出现缩略图，可预览、删除，再点发送
- 图片消息可带可选配文与 `@` 提及，图和字显示在同一条气泡里（上图下字）
- GHCR 镜像发布 workflow（SemVer 标签含 `0.9.0`、`0.9`、`latest`；`1` 留给 v1.0）
- Release Checklist（`docs/version-management.md`）
- README 产品截图（登录、桌面聊天、移动端）

### Fixed
- 登录成功后先移走用户名框焦点，再给登录层加 `aria-hidden`，避免 Chrome 报 Blocked aria-hidden
- CHANGELOG v0.2.0 曾写「Paste from clipboard / Drag-and-drop」，当时并未落地；现已实现
- 图文混排仍上图下字，气泡按每张缩略图自己的显示宽度收紧（宽图宽、竖图窄），回复和回应按钮贴回气泡右侧
- 房间重启后的 pending 错误改走 i18n，不再写死中文

### Changed
- `/room-info.deprecatedProtocols` 改为 `[]`（字段保留）
- 纯 emoji 消息不再带气泡背景（与纯图片一致）；含文字时才显示气泡。混排时内联 emoji 略放大并对齐文字基线
- 聊天首页字号收成 caption 11 / label 12 / ui 13 / body 15 / title 22，去掉 9px 辅助文字；消息与输入框统一 15px
- 顶栏与频道头合并：当前频道名和连接状态进顶栏，重复的「临时/可信」文案只留左侧「只在此刻」卡片
- 1180px 以下先收成员栏、保留频道列表；成员改走抽屉。离开按钮改为幽灵/危险样式
- 输入区抬成主操作：发送按钮 40px（移动端 44px），登录卡补上亭标，空状态引导去输入框
- 附件按钮不再立刻发图；发送按钮在有待发图片或文字时可用
- 待发图片缩略图改到输入框内部、只占图片本身的宽度；删除叉在桌面悬停显示、手机常显
- 表情、提及、附加和发送按钮改到输入框右下角，左侧留给文字和图片
- 输入时高亮整个输入框（含图片和按钮），激活色从橙色改为青绿
- 表情面板右缘贴齐聊天列，避免按钮右移后面板探出输入区
- 消息改为独立气泡：同一人连续发言只在第一条显示头像，回复和表情按钮悬停出现在气泡右侧顶部
- 回应表情改到气泡内部底部，只显示 emoji 和数量
- 只读频道收起输入框，改为状态条
- GitHub Release 在测试失败时不再创建

### Tests
- 总测试数：286 个（285 通过，1 跳过）

## [0.8.0] - 2026-09-17

### Added
- **轻量 i18n**：无构建步骤的纯 JS 字典 + `{var}` 插值（`client/i18n.js`）
- 简体中文与英语界面，顶栏语言切换；选择写入 `localStorage`（`pavilo.language`）
- 配置项 `room.defaultLanguage`（仅 `zh-CN` / `en`），`/room-info` 公开 `defaultLanguage` 与 `supportedLanguages`
- `PROTOCOL_NOT_SUPPORTED` 升级提示文案（中英），为 v0.9 协议清理做准备

### Improved
- 静态文案通过 `data-i18n` / `data-i18n-html` 更新；动态文案统一走 `t()`
- 日期、时长、`html lang` 随当前语言切换

### Technical
- 客户端白名单 13 → 14 个文件（`i18n.js` 排在 `app.js` 之前）
- 总测试数：273 个（272 通过，1 跳过）

## [0.7.0] - 2026-09-12

### Added
- **用户文档**
  - 配置指南（docs/configuration.md）- 所有配置项详细说明
  - 故障排查指南（docs/troubleshooting.md）- 常见问题和解决方案
- **API 文档**
  - HTTP API 文档（docs/api/http-api.md）
  - WebSocket 协议文档（docs/api/websocket-protocol.md）
- **多语言**
  - 英文版 README（README.en.md）- 完整核心信息英文入口
  - 中英文 README 互相跳转

### Improved
- 文档体系完善
- 用户和开发者文档齐全
- 故障排查流程清晰
- README 版本号漂移修正（v0.1 Alpha → v0.7.0）

### Fixed
- **v0.5.0 遗留问题：`error-states.js` 与 `performance.js` 是死代码**（此前既未进静态白名单、也未被任何代码引用）
  - 两个模块加入 `src/transport/http.js` 的 `CLIENT_FILES` 白名单（11 → 13 个文件）
  - `index.html` 引入两个脚本，`performance.js` 排在 `overlays.js` 之前
  - 错误反馈统一接入 `app.js`：连接状态指示器由 `errorController` 单一维护，
    离线 / 重连彻底失败 / 恢复分别走 `handleError` / `showErrorOverlay` / `clearError`
  - 新增阻塞性错误覆盖层（`#errorOverlay`）：重连彻底失败时用整屏提示 + "刷新页面"按钮，
    取代原先一闪而过的 toast
  - `overlays.js` 的成员列表用 `shouldRebuildList` 跳过无变化的整表重建
  - `app.js` 的频道占用更新用 `smartUpdate`，人数未变时不重写 `innerHTML`
  - 裁剪 `performance.js`：移除 6 个没有任何调用点的 helper，只保留真正被使用的两个
  - 新增 `test/client-assets-wiring.test.js`：强制白名单与 `index.html` 保持一致
- 文档全部按代码核实，消除"文档漂移"：
  - 配置字段名与 `pavilo.example.yaml` / 配置加载器严格对齐（此前部分示例使用了 schema 之外的字段名，照抄会导致启动失败）
  - 默认端口统一为 `4173`（此前部分示例误用 `3000`）
  - 启动日志示例改为 `server.js` 的真实输出格式
  - `/healthz` 响应体改为真实的 `{ ok, users, messages, roomBytes, clients, ephemeral }`；
    并说明实现中**没有返回非 200 的分支**
  - 错误信息改为配置加载器的真实文案（如 `room.defaultChannel: 默认频道不能是只读频道`）
  - 文档中的完整配置示例已通过 `npm run config:check` 实测
- 既有文档的同类漂移：
  - `docs/architecture/chat-protocol.md`：频道公开字段补上遗漏的 `readOnly` 与 `welcome`，
    并补上 `deprecatedProtocols`
  - `docs/healthcheck.md`：删除不存在的 "503 Service Unavailable" 分支描述

### Technical
- 总测试数：260 个（259 通过，1 跳过）
- 新增 6 个文档文件、1 个接线回归测试
- 现有架构文档已完善（docs/architecture/）

## [0.6.0] - 2026-09-12

### Added
- Issue 模板系统
  - Bug 报告模板（.github/ISSUE_TEMPLATE/bug_report.md）
  - 功能请求模板（.github/ISSUE_TEMPLATE/feature_request.md）
  - 安全问题报告模板（.github/ISSUE_TEMPLATE/security_report.md）
  - Issue 模板配置文件（.github/ISSUE_TEMPLATE/config.yml）
- Bug 管理文档
  - Bug 分类和优先级标准（docs/bug-classification.md）
  - Bug 修复 Checklist（docs/bug-fix-checklist.md）
- 版本号管理流程文档（docs/version-management.md）
  - 语义化版本规则
  - 发布流程完整指南
  - Git 提交规范
  - 版本废弃策略
  - 热修复流程

### Improved
- 质量保证流程标准化
- Issue 管理更规范
- 版本发布流程更清晰

### Technical
- 测试保持稳定：254 个（253 通过，1 跳过）
- 新增 4 个 GitHub 模板文件
- 新增 3 个流程文档

## [0.5.0] - 2026-09-12

### Added
- 错误状态统一管理模块（client/error-states.js）
- 性能优化工具模块（client/performance.js）
- 浏览器兼容性验收清单（docs/v0.5.0-browser-compatibility.md）
- 错误状态测试套件（7 个测试）
- 性能工具测试套件（13 个测试）

### Improved
- 统一错误状态反馈系统（网络离线、连接失败、服务停止、频道不可用）
- 只读频道 UI 已完善（🔒 图标、禁用输入、明确提示）
- 图片懒加载已在 v0.3.0 实现（使用 loading="lazy" 属性）
- DOM 批量更新工具，减少大量数据下的性能开销
- 节流和防抖工具，优化频繁更新的性能

### Changed
- 错误提示文案更清晰、更易理解
- 连接状态指示器支持更多状态变体（离线、连接中、警告）

### Technical
- 新增 20 个测试用例
- 总测试数：254 个（253 通过，1 跳过）
- 测试覆盖率保持稳定

## [0.4.0] - 2026-09-12

### Added
- HTTP 安全响应头
  - `X-Frame-Options: DENY`（防止点击劫持）
  - `Referrer-Policy: strict-origin-when-cross-origin`（控制 Referrer 泄漏）
  - 统一加到所有 HTTP 响应（HTML / CSS / JS / JSON / vendor）
- 安全头测试套件（`test/security-headers.test.js`）
- 畸形输入测试套件（`test/malformed-input.test.js`）
  - 畸形 YAML 配置解析
  - 非法配置值校验
  - 深层嵌套频道配置
  - 特殊字符处理
- 按 Keep a Changelog 格式创建 `CHANGELOG.md`
  - 回溯记录 v0.1.0、v0.2.0、v0.3.0

### Changed
- `package.json` 版本号从 0.1.0 更新为 0.4.0
- 精简 `ROADMAP.md`（去掉性能测试，保持聚焦）

### Security
- 用额外响应头加强 HTTP 安全基线

### Tests
- 总测试数：234 个（233 通过）
- 新增 9 个测试（3 个安全头 + 4 个畸形输入 + 2 个配置校验）

## [0.3.0] - 2026-09-12

### Added
- **Docker 支持**：多阶段构建与安全加固
  - 基于 Node 22 Alpine 的 Dockerfile
  - 非 root 用户（pavilo:pavilo，uid/gid 1001）
  - 只读根文件系统
  - 内置健康检查（`/healthz`）
  - 安全选项（`no-new-privileges`、`cap_drop: ALL`）
- 可用于生产的 `docker-compose.yml`
- 优化构建上下文的 `.dockerignore`
- **更清晰的启动日志**
  - 应用版本
  - 协议版本（v4）
  - 存储模式（ephemeral）
  - 配置来源（文件路径或内置默认值）
  - 网络地址（本机 + 局域网）
  - 安全边界（Origin 检查、IP 可见性、容量上限）
- **部署文档**
  - Docker 部署指南（`docs/deployment/docker.md`）
  - Nginx / Caddy 反向代理配置（`docs/deployment/reverse-proxy.md`）
  - 健康检查契约（`docs/healthcheck.md`）
- **离线启动验证**：确认不依赖公网第三方资源

### Changed
- 启动日志展示更完整的系统信息
- README 增加 Docker 快速开始

### Fixed
- 配置加载时明确打印配置来源

## [0.2.0] - 2026-09-12

### Added
- **Protocol v4**：稳定 WebSocket 协议
  - 消息 ACK，客户端跟踪确认
  - `clientMessageId` 幂等去重
  - 断线自动重连与历史补齐
  - 基于序号的顺序保证
- **表情回应**：6 个快捷表情（👍 ❤️ 😂 🎉 👀 🔥）
- **图片上传与页内展示**
  - 拖放
  - 剪贴板粘贴
  - 单张上限 300 KB
  - 支持 JPEG、PNG、WebP
- **消息回复**
- **界面增强**
  - 深色模式，跟随系统主题
  - 玻璃态设计
  - 微交互动画
  - 响应式移动端布局
  - 键盘操作
- **只读频道**：适合公告与规则
- **在线成员列表**
- **输入状态提示**
- **浏览器通知**（需用户点击后申请权限）
- **未读提示**（标题角标、动态图标）
- 设计语言文档（`docs/design-language.md`）
- 测试策略文档（`docs/TEST_STRATEGY.md`）
- 测试套件（200+ 个）
  - 核心逻辑单元测试
  - WebSocket 协议集成测试
  - Playwright 浏览器验收

### Changed
- 升级到 Protocol v4（当时仍兼容 v1/v2/v3）
- 改善连接稳定性与错误处理
- Origin 校验加强安全
- Lucide 图标与表情选择器改为自托管

### Security
- WebSocket Origin 校验
- 消息与回应限流
- 输入校验
- 资源上限（人数、连接、消息、字节）

## [0.1.0] - 2026-09-12

### Added
- **首个版本**：默认临时的聊天系统
- **多频道**，可由配置定义
- **基于 WebSocket 的实时通信**
- 消息 Markdown
- YAML 配置（`pavilo.yaml`）
- 优雅停服（SIGINT / SIGTERM）
- 静态文件提供，支持 gzip
- 静态资源 ETag 缓存
- **内置默认值**：没有配置文件也能启动
- **安全边界**
  - 用户数与连接数上限
  - 消息大小上限
  - 频道容量上限
  - 写缓冲 backpressure
- **文档**
  - README 快速开始
  - 配置示例
  - 贡献指南（`CONTRIBUTING.md`）
  - 安全政策（`SECURITY.md`）
  - 行为准则（`CODE_OF_CONDUCT.md`）
  - 路线图（`ROADMAP.md`）

### Architecture
- 纯内存存储（仅 ephemeral 模式）
- 需要 Node.js 22+
- 运行时依赖只有 `yaml`
- core 与 transport 分层
- 协议版本协商

---

## 版本摘要

- **v0.3.0** — Docker 支持与可部署性
- **v0.2.0** — Protocol v4、回应、图片、界面增强
- **v0.1.0** — 首个临时聊天系统

## 链接

- [GitHub 仓库](https://github.com/caigg188/Pavilo)
- [Issue](https://github.com/caigg188/Pavilo/issues)
- [路线图](ROADMAP.md)
