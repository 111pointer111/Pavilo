# Pavilo / 语亭路线图

> 一条命令，给身边的人一间聊天室。

这份路线图定义 Pavilo 从 Alpha 到稳定开源项目的版本边界。它不是固定发布日期承诺；版本只有在对应的工程门槛达到后才发布。

## 1. 长期产品原则

Pavilo 的核心不是“功能越来越多的聊天系统”，而是一个**默认极简、按需生长的自托管通信核心**。

长期必须保持以下不变量：

1. **Ephemeral First**  
   默认安装和启动不需要数据库、账号系统或第三方云服务。停止服务后聊天记录回到空白是第一等产品模式，而不是“阉割版”。

2. **One Mainline**  
   Pavilo 永远只有一套主代码和一条版本主线。`memory`、未来的 `sqlite` 等是运行模式，不是两套产品。

3. **Optional Means Optional**  
   持久化、Agent、网关、认证、风控等能力默认关闭；未启用时不应显著增加启动成本、运行依赖和认知负担。

4. **Core Before Platform**  
   聊天领域内核保持小、确定、可测试。Transport、Storage、Agent、Webhook、Moderation 等通过边界与内核交互，不把厂商 SDK、SQL、HTTP request/socket 塞回 `src/core`。

5. **Compatibility Is a Feature**  
   应用版本、配置 Schema、WebSocket 协议和数据库 Schema 分别演进，不能用同一个“版本号”表达所有兼容性。

6. **Safe by Construction**  
   在认证、TLS、可信代理和滥用防护未形成完整基线前，不宣称可以把裸端口直接暴露到公网。

7. **No Premature Generalization**  
   不为了“未来可能支持 PostgreSQL / 分布式 / 插件市场”提前复杂化当前架构。真实需求出现后再扩展边界。  
   玩法亦然：只把**狼人杀当下用到的**能力写成 Play 契约。不为「以后所有 Agent 游戏」发明引擎、DSL 或商店。

---

## 2. 当前基线：v1.0.0 Ephemeral Stable

当前版本 **v1.0.0**。无存储群聊作为默认产品已经稳定：Protocol v4 only、Config Schema v1 冻结、中英 UI、Docker / 反向代理 / CI / 文档齐备。

模块边界：

- `server.js`：配置、core / transport 组合与 CLI 生命周期；
- `src/core/`：房间、session、消息、命令、领域事件；
- `src/storage/`：ConversationStore 端口（当前仅 memory 驱动）；
- `src/transport/`：HTTP、WebSocket 生命周期与帧协议；
- `client/`：protocol / connection / state / pending / images / messages / composer / overlays / notifications / i18n / app；
- `test/`：Node 单元/集成测试和独立浏览器验收；
- `docs/architecture/`：当前架构、协议和状态契约；
- `docs/evolution.md`：后续演进原则（不是当前实现说明书）。

已经具备：

- 多频道临时群聊；
- 文字、图片、回复、回应、@、输入状态、成员状态；
- ACK、`clientMessageId` 幂等、历史分块、房间 epoch；
- 刷新/短暂断线恢复；
- Origin、心跳、加入时限、频率、连接数、帧/缓冲/频道容量控制；
- 版本化严格 YAML 配置；
- 静态资源白名单和 gzip/ETag；
- 静态 `readOnly` 频道；
- 可注入时钟/ID/定时器的无网络 core 测试。

v0.2–v1.0 的工程门槛均已完成，见下文各版本记录。v1.0 不包含 SQLite、网关、审核或玩法。

---

## 3. 版本号规则

Pavilo 从 v1.0.0 开始遵循 SemVer：

- `PATCH`：兼容性修复；
- `MINOR`：向后兼容的新能力；
- `MAJOR`：需要用户迁移的不兼容变更。

因此：

- **SQLite 本身不等于 v2.0。**
- 如果旧配置继续可运行、默认行为仍为 memory mode，那么加入 SQLite 更适合成为 `v1.1.0`。
- `v2.0.0` 只在真正需要 breaking change 时发布。

Pavilo 同时维护四类版本：

| 版本 | 示例 | 作用 |
| --- | --- | --- |
| App Version | `1.2.0` | Pavilo 发布版本 |
| Config Schema | `version: 1 / 2` | 配置文件结构 |
| WebSocket Protocol | `4 / 5 ...` | 浏览器/客户端与服务端协议 |
| Database Schema | `1 / 2 ...` | SQLite 内部迁移版本 |

未来 Extension API 稳定后，再独立记录 Extension API 兼容版本。

---

# 4. 短期目标：从 Alpha 到 v1.0

短期只做一件事：**把 Ephemeral Pavilo 做成可以长期维护、放心发布的稳定产品。**

SQLite、Agent、账号系统不阻塞 v1.0。

## v0.2.0 — Contract & Quality（已完成）

目标：冻结正确的产品边界，消除”代码能跑但契约漂移”。

### 功能与文档（✅ 已完成）

- ✅ 完成静态 `readOnly` 频道的 UI、错误提示、测试和文档：
  - `enabled: false`：不可加入；
  - `readOnly: true`：可进入/阅读，但普通参与者不能发消息；
  - 当前没有”管理员例外”，不要把它描述成角色权限。
- ✅ 修正 README 中默认频道为 `general + project`。
- ✅ README、`pavilo.example.yaml`、配置测试、协议文档对齐。
- ✅ 现有架构决策记录（ADR）：
  - `docs/evolution.md` — 架构演进原则
  - `docs/adr/` — 架构决策记录
    - ADR-0001：Protocol v4 only for v1.0
    - ADR-0002：SQLite pragmatic hybrid
    - ADR-0003：Extension as trusted scripts

### 工程质量（✅ 已完成）

- ✅ GitHub Actions：
  - Node 22、24、26 矩阵测试
  - `npm ci`、`npm test`、`npm run config:check`
  - `node --check`
  - 浏览器验收 job
- ✅ “示例配置可被当前配置加载器接受”的自动测试（config-example.test.js）
- ✅ 协议与配置兼容矩阵测试
- ✅ Core / client contract 失败路径测试
- ✅ `CONTRIBUTING.md`、`SECURITY.md`、Issue / PR 模板
- ✅ `TEST_STRATEGY.md` 测试策略文档

### 协议废弃声明（ADR-0001）（✅ 已完成）

- ✅ 在 `docs/architecture/chat-protocol.md` 中明确标记 Protocol v1/v2/v3 为 deprecated
- ✅ 在 `/room-info` 响应中增加 `deprecatedProtocols: [1, 2, 3]` 字段
- ✅ 当 v1/v2/v3 客户端连接时，在 `stateStart` 返回 `deprecationWarning` 字段
- ✅ 文档说明：v0.9.0 将删除 v1/v2/v3 支持，第三方客户端应迁移到 v4

### 非目标

- SQLite；
- 账号；
- 私聊；
- 搜索；
- Agent；
- 插件系统。

### 发布门槛（✅ 全部满足）

- ✅ CI 主分支全绿；
- ✅ README、示例配置与实现无已知漂移；
- ✅ core/transport/client 边界不因新增小功能重新耦合；
- ✅ ADR 文档已审查并合并到主分支。

**v0.2.0 已完成所有目标，可以发布。**

---

## v0.3.0 — Deployability（已完成）

目标：从”源码能启动”升级到”别人能可靠部署”。

### 功能（✅ 已完成）

- ✅ 官方 Dockerfile（多阶段构建，非 root 用户，安全加固）
- ✅ 最小 `docker compose` 示例（包含安全选项和健康检查）
- ✅ 明确数据/配置挂载方式（环境变量 + 卷挂载）
- ✅ 反向代理部署文档（Nginx / Caddy 完整配置和通用原则）
- ✅ `/healthz` 契约稳定化（完整的契约文档和示例脚本）
- ✅ 正常 SIGINT/SIGTERM 停服验证
- ✅ 启动日志统一格式，清晰打印：
  - ✅ App version
  - ✅ Protocol version
  - ✅ Config source
  - ✅ Storage mode（ephemeral）
  - ✅ Listen address（本地和局域网）
  - ✅ 安全边界提示（Origin 检查、IP 可见性、容量限制）

### 运维（✅ 已完成）

- ✅ Docker 构建和运行验证
- ✅ 健康检查验证
- ✅ SIGTERM 优雅停止验证
- ✅ 不依赖公网第三方资源的离线启动验证

### 文档（✅ 已完成）

- ✅ [Docker 部署文档](docs/deployment/docker.md)
- ✅ [反向代理配置文档](docs/deployment/reverse-proxy.md)
- ✅ [健康检查契约文档](docs/healthcheck.md)

### 非目标（明确范围）

- Kubernetes（未来版本考虑）
- 多实例（未来版本考虑）
- Redis（未来版本考虑）
- 服务发现（未来版本考虑）
- GHCR 镜像发布（推迟到 v1.0，当前通过源码构建）

### 发布门槛（✅ 全部满足）

- ✅ Dockerfile 可正常构建并运行
- ✅ 启动日志清晰展示关键信息
- ✅ 健康检查稳定可用
- ✅ 反向代理文档覆盖主流方案
- ✅ 离线启动验证通过
- ✅ 所有测试通过（224/225）

**v0.3.0 已完成所有目标，可以发布。**

---

## v0.4.0 — Security Hardening（已完成）

目标：在 v1.0 之前把安全默认值做实。

### 安全（✅ 已完成）

- ✅ 补充 HTTP 安全响应头（X-Frame-Options: DENY, Referrer-Policy: strict-origin-when-cross-origin）
- ✅ WebSocket frame / JSON / 配置解析的畸形输入测试

### 工程质量（✅ 已完成）

- ✅ 创建 CHANGELOG.md（回溯 v0.1-v0.3，建立变更日志习惯）
- ✅ 更新 package.json 版本号为 v0.4.0

### 发布门槛（✅ 全部满足）

- ✅ HTTP 安全头添加完成
- ✅ 畸形输入测试用例通过
- ✅ CHANGELOG.md 创建并包含历史版本
- ✅ package.json 版本号已更新
- ✅ 所有测试通过（234/234）

**v0.4.0 已完成所有目标，可以发布。**

---

## v0.5.0 — UX & Performance Polish（已完成）

目标：完成稳定版前的体验收口。

### 体验（✅ 已完成）

- ✅ `readOnly` 频道在 UI 上有清晰状态（🔒 图标、禁用输入框）
- ✅ 断网、停服、重连、频道不可用等状态统一反馈
- ✅ 错误状态管理模块（client/error-states.js）
- ✅ 浏览器兼容性验收清单（docs/v0.5.0-browser-compatibility.md）
- ✅ 错误边界测试（断网、超时、服务停止等场景）

### 性能（✅ 已完成）

- ✅ 性能优化工具模块（client/performance.js）
- ✅ DOM 批量更新工具（减少大 roster / history 下的性能开销）
- ✅ 节流和防抖工具
- ✅ 图片懒加载（已在 v0.3.0 实现，使用 loading="lazy" 属性）

### 测试（✅ 已完成）

- ✅ 错误状态测试套件（7 个测试）
- ✅ 性能工具测试套件（12 个测试）
- ✅ 总测试数：260 个（259 通过，1 跳过）

### ⚠️ 事后修正（v0.7.0 补充）

v0.5.0 发布时，`client/error-states.js` 与 `client/performance.js` **实际上是死代码**：
既没有进 `src/transport/http.js` 的静态白名单，也没有被 `index.html` 或任何客户端代码引用。
单元测试全绿掩盖了这一点。

已在 **v0.7.0** 修正：两个模块已接入白名单与页面，错误反馈和 roster/占用更新已真正使用它们，
并新增 `test/client-assets-wiring.test.js` 强制白名单与 `index.html` 保持一致。
因此上面"体验"与"性能"两节的完成状态自 v0.7.0 起才真正成立。

### 非目标（明确范围）

- 新娱乐功能
- 主题市场
- PWA 离线消息
- 历史持久化

### 发布门槛（✅ 全部满足）

- ✅ 只读频道 UI 清晰可识别
- ✅ 错误状态统一且友好
- ✅ 浏览器兼容性验收清单已创建
- ✅ 性能优化工具已实现
- ✅ 所有测试通过（254/254，1 跳过）
- ✅ CHANGELOG.md 已更新
- ✅ package.json 版本号已更新

**v0.5.0 已完成所有目标，可以发布。**

---

## v0.6.0 — Quality Assurance（已完成）

目标：建立完善的质量保证流程。

### Bug 修复流程（✅ 已完成）

- ✅ Issue 模板系统
  - ✅ Bug 报告模板（清晰的问题描述和复现步骤）
  - ✅ 功能请求模板（使用场景和优先级评估）
  - ✅ 安全问题报告模板（私密报告引导）
  - ✅ Issue 模板配置文件（禁用空白 Issue，引导到 Discussions）
- ✅ Bug 分类和优先级标准文档（docs/bug-classification.md）
  - ✅ 按严重程度分类（Critical/High/Medium/Low）
  - ✅ 按影响范围分类（Widespread/Common/Edge Case）
  - ✅ 优先级矩阵（P0-P3）
  - ✅ Bug 生命周期定义
  - ✅ 快速分类指南和示例
- ✅ Bug 修复 Checklist（docs/bug-fix-checklist.md）
  - ✅ 修复前准备（理解问题、复现、根因分析）
  - ✅ 修复中流程（分支管理、测试、验证）
  - ✅ 修复后质量保证（代码审查、文档更新）
  - ✅ 提交和发布流程
  - ✅ 特殊情况处理指南

### 工程规范（✅ 已完成）

- ✅ 版本号管理流程文档（docs/version-management.md）
  - ✅ 语义化版本规则（MAJOR/MINOR/PATCH）
  - ✅ 四类版本管理（App/Config/Protocol/Database）
  - ✅ 完整发布流程（准备、提交、打标签、验证）
  - ✅ Git 提交规范（Conventional Commits）
  - ✅ 版本分支策略
  - ✅ 热修复流程
  - ✅ 版本废弃策略和迁移指南

### 发布门槛（✅ 全部满足）

- ✅ Issue 模板完善（4 个文件）
- ✅ Bug 修复流程文档化（2 个文档）
- ✅ 版本号管理流程明确（1 个文档）
- ✅ 所有测试通过（254/254，1 跳过）
- ✅ CHANGELOG.md 已更新
- ✅ package.json 版本号已更新

**v0.6.0 已完成所有目标，可以发布。**

---

## v0.7.0 — Documentation（已完成）

目标：完善所有面向用户和开发者的文档。

### 用户文档（✅ 已完成）

- ✅ 配置指南（docs/configuration.md）- 所有配置项详解
  - 配置文件位置与优先级
  - 全部 30+ 配置项逐项说明（类型、默认值、取值范围、示例）
  - 配置验证方法
  - 多种场景的完整示例（最小、小型团队、公共聊天室、开发环境）
  - 最佳实践与故障排查
- ✅ 故障排查指南（docs/troubleshooting.md）- 常见问题和解决方案
  - 快速诊断步骤
  - 启动/连接/功能/性能/Docker 五类问题
  - 日志分析方法
  - 调试技巧与预防性维护

### 开发者文档（✅ 已完成）

- ✅ 架构文档（docs/architecture/overview.md）- 系统架构和模块划分（已完善）
- ✅ 协议规范（docs/architecture/chat-protocol.md）- Protocol v4 完整规范（已完善）
- ✅ 贡献指南（CONTRIBUTING.md）- 开发流程和规范（已完善）
- ✅ API 文档（docs/api/）
  - HTTP API 文档（docs/api/http-api.md）- 端点、响应格式、安全头、反向代理配置
  - WebSocket 协议文档（docs/api/websocket-protocol.md）- 命令、事件、心跳、错误码、示例

### 多语言（✅ 已完成）

- ✅ 核心文档英文版
  - 英文版 README（README.en.md）- 完整核心信息
  - 中英文互相跳转入口

### 修正（✅ 已完成）

- ✅ 全部新增文档按代码逐字段核实，消除"文档漂移"
  - 配置字段名与严格 schema 对齐（错误字段名会导致启动失败）
  - 默认端口、启动日志、`/healthz` 响应体、错误文案、错误码、关闭码均改为真实值
- ✅ 修复既有文档的同类漂移
  - `docs/architecture/chat-protocol.md`：补上 `readOnly`、`welcome`、`deprecatedProtocols`
  - `docs/healthcheck.md`：删除不存在的 503 分支
- ✅ 修复 v0.5.0 遗留的死代码（见 v0.5.0 的"事后修正"）

### 发布门槛（✅ 全部满足）

- ✅ 用户文档完成（2 个文档）
- ✅ 开发者文档完成（2 个新增 + 3 个已存在）
- ✅ 英文 README 完成
- ✅ 文档中的配置示例通过 `npm run config:check` 实测
- ✅ 所有测试通过（260/260，1 跳过）
- ✅ CHANGELOG.md 已更新
- ✅ package.json 版本号已更新

**v0.7.0 已完成所有目标，可以发布。**

---

## v0.8.0 — Internationalization（已完成）

目标：支持多语言 UI。

### i18n 实现（✅ 已完成）

- ✅ 国际化架构（轻量级，纯 JS，无构建步骤）
- ✅ 简体中文 + 英语 UI
- ✅ 语言切换功能（顶栏按钮，选择写入 `localStorage`）
- ✅ 配置支持（`room.defaultLanguage`；`/room-info` 公开 `defaultLanguage` 与 `supportedLanguages`）
- ✅ 服务器升级提示消息（`upgrade.*` / `PROTOCOL_NOT_SUPPORTED`，为 v0.9 协议清理做准备）

### 发布门槛（✅ 全部满足）

- ✅ i18n 架构实现完成
- ✅ 中英文翻译质量审查通过（catalog 键集合对等）
- ✅ 语言切换功能正常
- ✅ 升级提示消息已准备
- ✅ 所有测试通过（267/267，1 跳过）
- ✅ CHANGELOG.md 已更新
- ✅ package.json 版本号已更新

**v0.8.0 已完成所有目标，可以发布。**

---

## v0.9.0 — Release Candidate（已完成）

目标：冻结 v1.0 契约。v0.9.x 只修 blocker，不再新增大功能。

### 协议清理（ADR-0001）（✅ 已完成）

**BREAKING CHANGE**：删除 Protocol v1/v2/v3 支持，只接受整数 `4`。

- ✅ 删除 core / transport 中的版本分支、`legacyMessages` 与 `effect.legacy`
- ✅ `join.protocolVersion` 必须为 `4`；其他值返回 `PROTOCOL_NOT_SUPPORTED` 并以 `1002 / protocol not supported` 关闭
- ✅ 内置客户端 overlay：服务器已升级，请刷新页面
- ✅ `/room-info.deprecatedProtocols` 保留字段，值为 `[]`
- ✅ 测试覆盖 v4 行为与拒绝路径

### 冻结项（✅ 按真实行为）

- ✅ **Config Schema v1**：文件必须声明 `version: 1`，未知 version 拒绝（不为 v1.1 预做 `version: 2` 迁移器）
- ✅ **Protocol v4**：唯一支持的协议
- ✅ **`/room-info` 公开字段**：`protocolVersion`, `deprecatedProtocols`, `roomEpoch`, `roomTitle`, `defaultChannelId`, `defaultLanguage`, `supportedLanguages`, `channels`, `limits`, `ephemeral`（另有 transport 追加的 `localUrl` / `lanUrls`）
- ✅ **`/healthz` 契约**：进程能响应即 `200 OK` 且 `ok: true`（不返回 503）
- ✅ **CLI**：现有启动 banner；停服 `1001 / server stopped`
- ✅ **默认配置**：general + project、人数/超时/限额
- ✅ **core / transport 边界**

### 开源工程与发布（✅）

- ✅ CHANGELOG 覆盖全部 v0.x
- ✅ Release Checklist（`docs/version-management.md`）
- ✅ 贡献指南与安全报告流程
- ✅ 中英文 README
- ✅ Docker 与源码两套 Quick Start
- ✅ GHCR workflow（SemVer 标签含 `latest`；`1` 留给 v1.0）
- ✅ Release workflow 测试失败即失败
- ✅ `npm audit` 进入 CI

推迟 / 不作为本版本门槛：

- Config Schema v2 迁移器 → v1.1
- GitHub Topics / Description → 打标签时手工设置
- 跳过的 SYNC_IN_PROGRESS 集成测试 → 已知限制

### 发布门槛（✅ 代码可打标签）

- ✅ Protocol v1/v2/v3 已完全删除
- ✅ Config Schema v1 冻结
- ✅ CHANGELOG 完整
- ✅ 无 npm 高危漏洞
- ✅ GHCR workflow 已落地

**v0.9.0 已完成所有目标，可以发布。**

---

## v1.0.0 — Ephemeral Stable（已完成）

v1.0 的产品定义：

> **一个极简、可靠、浏览器即用、默认无数据库的自托管网页聊天频道。**

v0.9.x / v1.0.x 不启动四大支柱（存储、网关、审核、玩法）。无存储聊天已经基本完成；到稳定标签只做小修小改、基础聊天收口和发布工程。

### 必须保证

- 一键启动（npm start）
- Docker 一键部署
- 多频道
- 静态只读频道
- ACK / 幂等 / reconnect
- 资源上限和 backpressure
- 严格配置验证
- 桌面/移动端可用（浏览器兼容性文档）
- 源码与容器部署
- CI / 安全 / 文档 / 发布流程成熟
- memory mode 行为稳定

### 发布执行

- ✅ 更新 package.json 版本号为 v1.0.0
- ✅ 更新 CHANGELOG.md
- ✅ 更新 README 徽章和版本信息
- ✅ 浏览器兼容性文档
- 创建 `v1.0.0` Git 标签后，Actions 会发 GitHub Release（stable）并推送 GHCR：`latest`、`1.0.0`、`1.0`、`1`

### 明确不包含

- SQLite（v1.1+）
- 账号系统
- 角色权限
- 私聊
- 历史搜索
- Agent
- LLM 网关
- 插件市场
- 内容审核
- 官方玩法

这些缺失不是 v1.0 “没做完”，而是产品边界。

### 发布门槛（✅ 代码与文档已收口）

Pavilo 是给外部部署者用的开源软件，维护者不自建生产观察期。质量靠测试和契约，不靠挂机天数。

- ✅ 现有测试全绿（285 通过，1 跳过：SYNC_IN_PROGRESS 集成窗口，core 已覆盖契约）
- ✅ README / 示例配置 / 协议文档无已知漂移
- ✅ 无已知 P0/P1
- ✅ CHANGELOG、GHCR / Release workflow 已按 v1.x stable 调整
- ✅ `npm audit` 无高危
- ✅ 浏览器兼容性文档完成（自动化基线为 Playwright + Chrome）

打 `v1.0.0` 标签后由 GitHub Actions 创建 stable Release，并推送 GHCR `latest` / `1.0.0` / `1.0` / `1`。

**v1.0.0 已完成产品与工程收口，可以发布。**

---

# 5. 中期目标：v1.x 存储、网关、审核与玩法

v1.x 主线按依赖推进，不把存储、网关、审核、玩法、访问控制同时做成未冻结的公共契约：

```text
存储 → 网关/管理页 → 内容审核 → Play 契约 + 官方狼人杀 → 访问控制
```

职责切开，避免把 Pavilo 做成游戏平台：

- **我们做基础设施**：存储、网关、审核、一层薄的 Play 契约（含玩法页宿主与 URL 约定）。
- **我们做官方样例**：文字狼人杀（服务端状态机 + 自己的页面），用来把契约跑通。
- **社区做更多玩法**：一个玩法 = 一个（或一组）频道；进入频道即加载该玩法自己的页面。不另造商店、沙箱或第二套插件系统。

页面约束见 [docs/play.md](docs/play.md)。聊天页只是「未绑定玩法」的默认投影，不是所有玩法的底板。

访问控制不挡局域网玩法，但挡「可以安全暴露公网」的宣传。

## v1.1.0 — Persistence Foundation

目标：让”聊天记录可保存”成为**可选能力**，不改变默认体验。

### Storage Port

新增内部 `ConversationStore` 边界：

- `MemoryConversationStore`：默认；
- `SQLiteConversationStore`：显式启用。

核心业务只面向 Store 接口，不感知 SQL。

推荐配置：

```yaml
version: 2

storage:
  driver: memory
```

持久化模式：

```yaml
version: 2

storage:
  driver: sqlite
  sqlite:
    path: ./data/pavilo.db
    engine: auto  # auto | node | better-sqlite3
    retentionDays: 30  # sqlite 模式下默认 30；省略时也按 30
```

规则：

- 不使用 `database.enabled`；
- Config Schema v1 继续接受，并自动归一化为 `storage.driver: memory`；
- 开启 SQLite 不是”运行 v2”，只是当前 App 的 persistent mode；
- `driver: memory`：不留存，重启即空；
- `driver: sqlite`：`retentionDays` **默认 30**（最近 30 天）；
- 永久留存必须用显式值（如 `retentionDays: null` 或文档约定的 `forever`），**禁止用 `0` 表示永久或关闭**；
- 本期存储只走 YAML，不做管理页改留存配置；
- 过期删除在 v1.1 就要按 `retentionDays` 生效（启动时或简单周期即可）。v1.2 再补可运维的 prune、备份与统计，而不是把「能按天删」推迟到 v1.2。

### SQLite Driver 策略（ADR-0002）

**实用主义混合方案**：默认 `node:sqlite`，性能后备 `better-sqlite3`

- **`engine: auto`（默认）**：
  - Node 22.5+ → 使用 `node:sqlite`（零编译依赖）
  - Node < 22.5 → 尝试 `better-sqlite3`，未安装则提示升级 Node
- **`engine: node`**：强制使用 `node:sqlite`
- **`engine: better-sqlite3`**：强制使用高性能驱动

package.json 策略：
```json
{
  "optionalDependencies": {
    "better-sqlite3": "^11.0.0"
  }
}
```

Dockerfile 策略：
- 默认镜像：零编译，适合大多数场景
- `performance.Dockerfile`：包含编译工具链，适合高负载

### SQLite MVP 持久化

保存：

- 消息；
- reply 关系；
- reaction；
- 频道 epoch；
- 最新 seq；
- 幂等记录；
- 数据库 Schema version。

不保存：

- socket / peer；
- 在线成员；
- typing；
- heartbeat；
- rate-limit counter；
- pending write buffer；
- 临时连接状态。

### 关键一致性语义

Memory mode：

- 进程重启产生新 epoch；
- 历史清空；
- ACK 表示当前进程已接受。

SQLite mode：

- 正常重启保留频道 epoch 与 seq；
- 幂等记录与消息事务一致；
- ACK 只能在 SQLite transaction commit 后发送；
- 数据库被重置/替换时生成新 epoch。

### 技术决策

根据 ADR-0002，确认以下技术选型：

- **同步接口**：保持 core 同步，不改成 async pipeline
- **WAL mode**：开启（提升并发性能）
- **`foreign_keys=ON`**：强制引用完整性
- **`busy_timeout`**：5000ms（避免并发写入时立即失败）
- **Transaction 边界**：每条消息 + 幂等记录在一个事务
- **Crash consistency**：依赖 SQLite 的 WAL checkpoint
- **单进程限制**：不支持多个 Pavilo 实例共享同一个 SQLite 文件

不要为了”未来可能支持远程数据库”在 v1.1 把整个 core 改成 async。

### 数据库迁移

从第一版 SQLite 就必须存在 migration 机制；不能等到第二个数据库版本才补。

```
src/storage/migrations/
  001-initial-schema.sql
  002-add-index-on-seq.sql
```

启动时自动检查并执行未应用的 migration。

---

## v1.2.0 — Persistence Operations

目标：让 SQLite 从“能按天留存”变成“可长期运行”。网关用量、管理页编辑和玩法对局都依赖这一层运维能力。v1.1 已按 `retentionDays` 删除过期消息；本期补分页、备份、完整性与统计。

### 功能

- 可运维的 retention / prune（进度、日志、不长时间阻塞聊天）；
- 历史分页；
- 文本历史搜索（优先 SQLite FTS，是否启用由实现评估）；
- backup；
- restore；
- DB integrity check；
- 数据库大小 / 消息数量统计；
- storage health；
- maintenance 命令；
- 迁移回归测试；
- 大数据库启动和历史加载性能测试。

### 原则

- 不在启动时一次性把全部历史读回内存；
- SQLite 是历史真源，内存只保留实时工作集；
- 删除历史后 seq 不复用；
- VACUUM/维护不能阻塞实时聊天太久。

---

## v1.3.0 — Operator Console & AI Gateway

目标：让部署者能在一个页面里配置模型渠道、查看用量；聊天核心仍然不依赖 AI。

这是对旧规划「不做 Agent Gateway」的收窄修正：**不做独立微服务，不做企业级模型路由/负载均衡**；做进程内统一网关 + 可编辑管理页。

实现前补 ADR-0004（operator 配置双源）和 ADR-0005（进程内网关）。

### 网关

- 新模块（如 `src/gateway/`）：渠道 preset、OpenAI 兼容调用、超时/重试、usage。
- `src/core` 不 import 任何厂商 SDK。
- 第一阶段官方渠道：**DeepSeek**。选择 preset 后自动填充 base URL，管理员只填 key。
- 协议按 OpenAI compatible 走，后续加渠道主要是加 preset，而不是新造一套调用层。
- 密钥不进日志、不进公开 `/room-info`。
- 网关故障或未启用时，普通聊天必须不受影响。

### 管理页

- 启用后提供管理页（路径如 `/admin`，实现时再定）。
- 能力：查看与编辑网关渠道、填 key（只写 / 掩码回显）、按网关渠道查看用量、综合 dashboard。
- 保护：`operator.token` 或管理密码。本期不做账号系统。
- 默认关闭；未启用时不增加 ephemeral 用户的启动成本。

### 配置双源

- YAML / 环境变量可以引导启动（选**网关渠道**、填 key）。这里的渠道是模型供应商，不是聊天频道。
- 管理页保存某个网关渠道后，以 SQLite 为准。
- 未开 SQLite：YAML 配的网关仍可调用模型，但不记用量，管理页不可编辑。
- 必须写清优先级，避免部署者改了 yaml 却不生效。

### 非目标

- 独立网关微服务；
- 模型市场、一键安装 Bot；
- 负载均衡、自动故障转移；
- 完整账号系统。

---

# 6. 中长期目标：审核、玩法与公网基线

## v1.4.0 — Content Safety

目标：在存储意味着可能面向更广用户之后，先审「能说什么」，再谈「谁能进来」。

- 走 Policy（pre-commit）端口，但是 **一等功能**，不是「请用户自己写 word-filter.js」。
- **文本**：可启用屏蔽词库。腾讯游戏屏蔽词库仅作候选数据源，落地前必须核对许可证，不能默认假定可直接放进仓库；同时支持自定义词库路径。
- **图片**：可选，调用网关里具备视觉能力的模型；网关未配置则图片审计不可开启。
- 明确 fail-open / fail-closed：局域网默认可 fail-open；面向公网的配置应 fail-closed。
- 超时、结构化拒绝码（如 `POLICY_DENIED`），不允许审核模块绕过 core 直写 Store。
- 本期 **不** 把文档改成「可以安全把裸端口暴露到公网」。

### 非目标

- 账号、邀请制、角色权限（v1.6）；
- 把 `readOnly` 改成管理员例外。

---

## v1.5.0 — Play 契约、玩法页与官方狼人杀

目标：用狼人杀这一个真实需求，抽出**最薄**的 Play 契约（服务端 host + 独立玩法页）；狼人杀既是产品功能，也是贡献者的参考实现。

实现前补 ADR-0006。契约只写狼人杀用到的东西。页面约束先见 [docs/play.md](docs/play.md)。

### 频道即玩法

```yaml
channels:
  - id: general          # 无 play → 聊天页
  - id: village
    name: 狼人杀
    play: werewolf       # 进入 → /plays/werewolf/?channel=village
```

管理员启用玩法 = 安装该玩法的 `host.js` + `page/`，再把某个频道的 `play` 指过去。同一 `play` 可绑多桌（多个频道，同一页面）。

聊天页点到玩法频道应跳转玩法页，不要在气泡流里塞选人器。

### 服务端契约（狼人杀需要这些，所以才存在）

- 稳定 `playId`，host 是确定性状态机；LLM 不裁决规则。
- 人与 Agent 都是演员，进入同一 roster。
- Agent 局内私密记忆落 SQLite，作用域为「这一局」。
- 结构化动作走 `playAction`，经主持人校验；私密结果只回当事 peer。
- 模型调用全部走 v1.3 网关。公开发言可走现有 `message`，以便沿用审核与限额。
- 玩法或某个 Agent 故障时，普通聊天频道不受影响。

### 页面契约

- 每个玩法是**自己的 HTML/CSS/JS**，不是聊天页插槽。
- 主线只提供宿主：会话、Protocol v4、频道切换、`playAction` / `playState`。
- 交互与样式由该玩法自己定义（投票、选人、夜间操作气泡都可以是玩法自己的弹层）。
- 不强制使用 `chat.css` 或消息气泡组件。
- 静态文件只从该玩法的 `page/` 目录提供。

### 官方交付

- 更新后的 [docs/play.md](docs/play.md)（实现时补函数名）。
- 文字狼人杀：host + 独立页面；人可以和 Agent 混编开局。

### 贡献路径

按 `docs/play.md` 提交 `host.js` + `page/`。想进主仓库：先 Issue，再按狼人杀的目录边界发 PR。也可以只在自己的实例加载。

### 非目标（奥卡姆）

- 在现有聊天页上堆玩法按钮；
- 通用游戏引擎、规则 DSL、组件平台、玩法商店；
- 强制前端框架或 iframe 市场；
- 沙箱或第二套插件系统；
- 语音/视频狼人杀。

---

## v1.6.0 — Access & Public Baseline

目标：在不破坏匿名局域网模式的前提下增加可选访问控制，并给出谨慎的公网基线。

- access mode：open / shared password / invite（account 仍要有真实需求才上）；
- 可信反向代理配置；
- 管理端鉴权加固；
- 滥用防护；
- 公网部署清单：TLS 终止 + 访问控制 + 内容审核 + 留存策略。

注意：

- 当前 `readOnly: true` 是静态频道属性，不等于角色权限；
- 未来「管理员可发、普通成员只读」属于 Authorization 层，不改变 `readOnly` 旧语义；
- 只有认证入口、TLS、审核和访问控制齐了，文档才谨慎扩大公网场景。

---

## 其后 — 贡献面稳定化（不挡主线）

v1.5 之后，贡献者主要加两类东西：Policy/Event 脚本，以及一个玩法（服务端 host + 自己的页面，绑到频道）。二者都是 trusted code（ADR-0003）。页面规范见 [docs/play.md](docs/play.md)。

公开契约在狼人杀跑通后再按 SemVer 冻结，不让「先做生态」挡住网关和官方样例。

仍然明确不做：

- 插件市场 / npm 包发布机制 / 玩法商店；
- 沙箱运行时；
- scoped API token（与主进程同权限）。

文档继续强调：只加载你信任的脚本。想贡献进主仓库，先 Issue 后代码。

---

# 7. v2.0 的进入条件

**不要提前把某个功能叫 v2。**

只有以下类型的变化真正发生时才进入 v2：

- 必须删除/重定义 v1 公共配置字段；
- 必须不兼容地重做 WebSocket 协议；
- 必须改变已稳定的 Extension API；
- 远程/分布式存储迫使同步 core 变成 async application pipeline；
- 身份模型发生无法兼容的重构；
- 其他无法通过兼容层解决的重大架构迁移。

如果 SQLite、网关、审核、玩法和权限都能以兼容的可选模块加入，它们完全可以留在 v1.x。

---

# 8. 明确暂缓的功能池

以下能力不是“永远不做”，但不应抢占当前主线：

- 私聊；
- 群组/工作区多租户；
- 文件管理；
- 语音/视频通话；
- 端到端加密；
- 联邦协议；
- 原生 iOS / Android；
- 多实例共享 session；
- Redis；
- PostgreSQL/MySQL；
- Kubernetes operator；
- 主题/插件市场；
- 玩法商店 / 通用游戏引擎。

进入主线前必须先回答：它是否强化 Pavilo 的核心定位？是否可以保持默认部署极简？

---

# 9. “明星开源项目”工程标准

功能不是 Star 项目的唯一指标。下列工程标准在 v0.9 已基本具备，v1.0 起维持，不因新支柱回退：

### 代码

- 清晰 dependency direction；
- core 无网络对象；
- 关键 IO 可注入；
- 小模块；
- 无不必要 runtime dependency；
- 公开契约有 contract test。

### CI

- Node 版本矩阵；
- 单元测试；
- 网络集成测试；
- 浏览器验收；
- 示例配置校验；
- 安全/依赖检查；
- 发布前 smoke test。

### 文档

- README 只讲用户最需要的入口；
- architecture 文档解释“为什么”；
- config / protocol 文档解释稳定契约；
- Roadmap 只讲版本边界，不充当待办垃圾桶；
- 重要架构决策使用 ADR。

### 社区

- CONTRIBUTING；
- SECURITY；
- Code of Conduct（社区开始扩大后补齐）；
- Issue 模板；
- PR 模板；
- Good First Issue；
- 清晰 Release Note；
- 不让贡献者必须先理解整个仓库才能提交一个小改动。

### 可观测与性能

- 健康检查；
- 结构化日志；
- benchmark 基线；
- 明确容量边界；
- 不用“支持高并发”之类无法验证的宣传语。

---

# 10. 当前优先级

当前从高到低：

1. **打 v1.0.0 标签并确认 GHCR / GitHub Release**（代码与文档已收口）。
2. **v1.1 SQLite 可选留存**（默认最近 30 天）。
3. **v1.2 持久化运维**（prune、分页、备份、统计）。
4. **v1.3 进程内 AI 网关 + 可编辑管理页**（DeepSeek 为首个官方渠道）。
5. **v1.4 内容审核**（文本词库 + 可选图片视觉审计）。
6. **v1.5 Play 契约 + 独立玩法页 + 官方狼人杀**（频道绑定玩法；社区按 [docs/play.md](docs/play.md) 接入）。
7. **v1.6 访问控制与公网基线**。
8. **其后**冻结 Play / Extension 贡献面。

这条顺序的核心目的不是“做得慢”，而是先把会改变 epoch / ACK / 配置真源的地基铺好，再用一个真实玩法把贡献契约跑通，而不是先造生态再找需求。
