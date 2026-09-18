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

---

## 2. 当前基线：v0.1 Alpha

当前代码已经不再是单文件原型，而具备比较清晰的模块边界：

- `server.js`：配置、core / transport 组合与 CLI 生命周期；
- `src/core/`：房间、session、消息、命令、领域事件；
- `src/transport/`：HTTP、WebSocket 生命周期与帧协议；
- `client/`：protocol / connection / state / pending / images / messages / composer / overlays / notifications / i18n / app；
- `test/`：Node 单元/集成测试和独立浏览器验收；
- `docs/architecture/`：当前架构、协议和状态契约。

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

### 当前需要马上修正的文档漂移

代码已经支持 `channels[].readOnly`，且默认频道为 `general + project`；README 与示例配置中的部分文字仍沿用旧语义。v0.2.0 必须先把这些契约重新对齐。

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
  - `docs/architecture/evolution.md` — 架构演进原则
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
- 生产环境跑 7 天 → v1.0 发布门槛
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

## v1.0.0 — Ephemeral Stable

v1.0 的产品定义：

> **一个极简、可靠、浏览器即用、默认无数据库的自托管网页聊天频道。**

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

- 更新 package.json 版本号为 v1.0.0
- 更新 CHANGELOG.md
- 创建 v1.0.0 Git 标签
- 发布 GitHub Release（**stable**，非 pre-release）
- 发布 GHCR 镜像（ghcr.io/caigg188/pavilo:latest, :1.0.0, :1.0, :1）
- 更新 README 徽章和版本信息
- 浏览器兼容性文档

### 明确不包含

- SQLite（v1.1+）
- 账号系统
- 角色权限
- 私聊
- 历史搜索
- Agent
- LLM 网关
- 插件市场

这些缺失不是 v1.0 “没做完”，而是产品边界。

### 发布门槛

- v0.9.0 RC 已发布，并在目标环境观察至少 7 天无阻塞性问题
- 所有 P0/P1 bug 已修复
- 文档完整且审查通过
- 测试覆盖充分（> 250 个测试）
- 安全审计通过
- GHCR 镜像成功发布
- 浏览器兼容性文档完成

---

# 5. 中期目标：v1.x 可选持久化与扩展基础

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
    retentionDays: 30
```

规则：

- 不使用 `database.enabled`；
- Config Schema v1 继续接受，并自动归一化为 `storage.driver: memory`；
- 开启 SQLite 不是”运行 v2”，只是当前 App 的 persistent mode；
- `retentionDays` 缺省表示不按时间自动删除；不要让 `0` 同时承担”关闭”和”永久”两种含义。

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
  “optionalDependencies”: {
    “better-sqlite3”: “^11.0.0”
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

## v1.2.0 — Persistence Hardening

目标：让 SQLite 从“能存”变成“可长期运行”。

### 功能

- retention 定期清理；
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

## v1.3.0 — Extension Foundation

目标：为 Bot、Webhook、Agent、Moderation 建立统一扩展边界，但不把具体 LLM 厂商塞进 core。

### 设计原则（ADR-0003）

**Extension as Trusted Scripts，而非沙箱插件系统**

- 用户编写 JavaScript 文件，通过配置路径加载
- 与 Pavilo 主进程同权限运行（类似 Vite plugin、Express middleware）
- 没有沙箱、没有权限系统、没有插件市场
- 文档明确："Extensions are trusted code. Only load scripts you trust."

### 配置方式

```yaml
version: 2

extensions:
  # Policy Hooks（同步拦截）
  policy: ./extensions/moderation.js
  
  # Event Handlers（异步监听）
  events:
    - ./extensions/discord-webhook.js
    - ./extensions/analytics.js
    - ./extensions/chatgpt-bot.js
```

### 1. Policy Hooks（同步，Pre-commit）

在命令提交前拦截，返回 allow/deny。

接口示例：
```js
// extensions/my-policy.js
module.exports = {
  async canSendMessage({ user, channel, message, core }) {
    if (message.text?.includes('spam')) {
      return { allowed: false, code: 'BLOCKED_WORD' };
    }
    return { allowed: true };
  },
  
  async canJoinChannel({ user, channel, core }) { ... },
  async canUploadImage({ user, channel, image, core }) { ... }
};
```

规则：

- 返回明确 `{ allowed: true/false, code?, message? }`
- 严格超时：5 秒未响应视为失败
- 失败策略可配置：fail-open（允许）/ fail-closed（拒绝）
- 不允许扩展绕过 core 直接写 Store

### 2. Domain Events（异步，Post-commit）

消息已提交后触发，失败不影响聊天。

接口示例：
```js
// extensions/chatgpt-bot.js
module.exports = {
  async onMessageCreated({ message, channel, api }) {
    if (message.text?.startsWith('@bot ')) {
      const response = await callOpenAI(message.text);
      await api.sendMessage({
        channelId: channel.id,
        text: response,
        replyTo: message.id
      });
    }
  },
  
  async onUserJoined({ user, channel, api }) { ... },
  async onUserLeft({ user, channel, api }) { ... }
};
```

事件类型：
- `message.created`
- `reaction.changed`
- `member.joined`
- `member.left`
- `channel.switched`

订阅者失败不能回滚已经成功提交的聊天消息。

### Extension API

扩展接收的 `api` 对象提供对 core 的受限访问：

```js
class ExtensionAPI {
  async sendMessage({ channelId, text, replyTo })
  getChannel(channelId)
  getOnlineUsers(channelId)
  // 不允许：直接操作 SQLite、绕过 Policy、访问其他扩展状态
}
```

### Bot / Agent 实现

Bot 本质上是"监听 Domain Event + 调用 Command API"：

- 不是独立服务，不需要 HTTP/gRPC 接口
- 不需要沙箱，用户自己审查代码后加载
- 用熟悉的 npm 包（OpenAI SDK、Discord.js 等）

### 生态策略

**不做插件市场，做示例 + 文档**

```
docs/extensions/
  README.md              # 如何编写扩展 + 安全警告
  api-reference.md       # Extension API 文档
  examples/
    word-filter.js       # 敏感词过滤
    discord-webhook.js   # Discord 同步
    openai-bot.js        # OpenAI 聊天机器人
    claude-bot.js        # Claude 机器人
    audit-log.js         # 审计日志
```

用户复制示例到自己的 `extensions/` 目录，修改配置后引用。

### Extension API 稳定性

此版本 Extension API 标记为 **experimental**。

- v1.3-v1.5 可能调整接口
- v1.6 稳定化后才承诺长期兼容

---

# 6. 中长期目标：Agent、权限与生态

## v1.4.0 — Agent & Gateway

目标：让 Pavilo 可以”长出智能能力”，但聊天核心仍然不依赖 AI。

**重要：根据 ADR-0003，Agent 只是特殊的 Extension Event Handler，不需要独立架构。**

### 功能

v1.3 的 Extension 机制已经足够实现 Bot/Agent，v1.4 主要是完善体验和提供官方示例：

- **Bot 身份标识**：
  - 协议增加可选 `author.isBot: true` 字段
  - 客户端 UI 显示 Bot 标识（徽章、颜色区分）
  
- **Agent 示例集**：
  - `examples/agents/openai-bot.js` — OpenAI GPT 集成
  - `examples/agents/claude-bot.js` — Anthropic Claude 集成
  - `examples/agents/ollama-bot.js` — 本地 Ollama 集成
  - `examples/agents/webhook-bot.js` — 通用 Webhook Bot 框架

- **Agent 配置增强**：
  ```yaml
  extensions:
    events:
      - path: ./extensions/chatgpt.js
        botIdentity:
          username: ChatGPT
          avatarSeed: chatgpt
          channels: [general, project]  # 限制 Bot 活跃频道
  ```

- **Streaming 输出**：
  - Agent 可以通过 `api.streamMessage()` 分块发送长消息
  - 客户端渐进式渲染（类似 ChatGPT 打字效果）

- **错误隔离**：
  - Agent 失败不影响正常聊天
  - Extension 崩溃时自动禁用，打印错误，不让主进程挂掉

### 架构约束（继续强制）

- `src/core` 不 import OpenAI/Anthropic/其他厂商 SDK
- Agent 不能直接操作 SQLite，必须通过 Command API
- LLM 调用不能阻塞 WebSocket transport
- Agent 默认关闭，显式启用

### 非目标

- ❌ 不做独立的”Agent Gateway”微服务
- ❌ 不做”模型路由”、”负载均衡”等企业功能
- ❌ 不做”Agent 市场”、”一键安装 Bot”
- ❌ 不做沙箱（Bot 是用户信任的代码）

---

## v1.5.0 — Access & Moderation

目标：在不破坏匿名局域网模式的前提下增加可选访问控制。

候选能力：

- access mode：
  - open；
  - shared password；
  - invite；
  - account（若真实需求证明必要）。
- role：
  - owner/admin；
  - channel manager；
  - member。
- role-based channel write；
- mute / kick / ban；
- 举报；
- audit event；
- moderation Policy Hook；
- 可信反向代理配置；
- 更完整的公网部署安全指南。

注意：

- 当前 `readOnly: true` 是静态频道属性，不等于角色权限；
- 未来“管理员可发、普通成员只读”属于 Access/Authorization 层。

只有认证、TLS 终止、可信代理和滥用防护形成完整基线后，文档才能谨慎扩大公网使用场景。

---

## v1.6.0 — Extension Ecosystem

目标：把已经验证过的扩展机制稳定下来。

### Extension API 稳定化

从 v1.6 开始，Extension API 遵循 SemVer：
- Breaking changes 只在 major 版本（v2.0）
- 新增可选字段/方法可以在 minor 版本
- 文档维护 “Extension API Changelog”

### 交付物

- **Stable Extension API**：
  - Policy Hooks 接口冻结
  - Domain Events 类型冻结
  - Extension API 方法签名冻结
  
- **文档完善**：
  - Extension 开发指南（从零开始）
  - 最佳实践（错误处理、性能优化、测试）
  - 安全检查清单（审查第三方扩展的要点）
  - 故障排查指南
  
- **示例扩展库**（15-20 个）：
  - Policy：敏感词过滤、上传限制、邀请制
  - Webhook：Discord、Slack、Telegram、Mattermost
  - Agent：OpenAI、Claude、Ollama、通用 HTTP Bot
  - Moderation：审计日志、举报系统、自动封禁
  - 工具：消息归档、统计分析、备份

- **社区分享机制**：
  - `docs/extensions/community/` 目录收录优秀社区扩展（经审查）
  - GitHub Discussions 标签：`extension-showcase`
  - 贡献指南：如何提交扩展示例

### 明确不做（ADR-0003）

- ❌ 插件市场 / npm 包发布机制
- ❌ 扩展 manifest / 版本声明系统
- ❌ scoped API token（扩展与主进程同权限）
- ❌ 独立的扩展包目录规范
- ❌ 沙箱运行时
- ❌ 权限模型

### 安全立场

文档中继续明确强调：

> **⚠️ Extensions are trusted code**
> 
> Pavilo extensions run in the same process with full system access. This is intentional — Pavilo is a self-hosted tool for technical users, not a SaaS platform.
> 
> Only load extensions you trust. Review the code before enabling.

参考 Vite、Rollup、Express 的插件模式，而不是 Chrome Extension、VS Code Extension 的沙箱模式。

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

如果 SQLite、Agent、权限都能以兼容的可选模块加入，它们完全可以留在 v1.x。

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
- 主题/插件市场。

进入主线前必须先回答：它是否强化 Pavilo 的核心定位？是否可以保持默认部署极简？

---

# 9. “明星开源项目”工程标准

功能不是 Star 项目的唯一指标。v1.0 前应逐步具备：

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

1. **P0：修正文档/实现漂移，补 CI。**
2. **P0：冻结 v1.0 产品定义——Ephemeral Stable。**
3. **P1：部署、Docker、反向代理和真实网络验收。**
4. **P1：安全默认值、压力测试和性能基线。**
5. **P1：v0.9 契约冻结与发布工程。**
6. **v1.0 之后才开始 SQLite。**
7. **SQLite 稳定后再开放 Agent/Policy/Event 扩展。**

这条顺序的核心目的不是“做得慢”，而是避免在架构仍快速变化时同时背上数据库、认证、Agent 和第三方扩展四种兼容债务。
