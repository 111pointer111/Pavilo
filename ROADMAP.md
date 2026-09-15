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
- `client/`：protocol / connection / state / pending / images / messages / composer / overlays / notifications / app；
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

## v0.2.0 — Contract & Quality

目标：冻结正确的产品边界，消除“代码能跑但契约漂移”。

### 功能与文档

- 完成静态 `readOnly` 频道的 UI、错误提示、测试和文档：
  - `enabled: false`：不可加入；
  - `readOnly: true`：可进入/阅读，但普通参与者不能发消息；
  - 当前没有“管理员例外”，不要把它描述成角色权限。
- 修正 README 中默认频道为 `general + project`。
- README、`pavilo.example.yaml`、配置测试、协议文档对齐。
- 新增本文档 `docs/architecture/evolution.md`，明确后续 Storage / Extension 边界。

### 工程质量

- GitHub Actions：
  - Node 22；
  - Node 24 LTS；
  - Node 26 Current；
  - `npm ci`；
  - `npm test`；
  - `npm run config:check`；
  - `node --check`；
  - 可选浏览器验收 job。
- 增加“示例配置可被当前配置加载器接受”的自动测试。
- 建立协议与配置兼容矩阵测试。
- 为 core / client contract 增加失败路径测试，而不仅是 happy path。
- 增加 `CONTRIBUTING.md`、`SECURITY.md`、Issue / PR 模板。
- 确定 Alpha 协议生命周期：
  - v1.0 前可以清理无真实使用价值的旧协议兼容；
  - v1.0 后再把公开支持范围视为稳定契约。

### 非目标

- SQLite；
- 账号；
- 私聊；
- 搜索；
- Agent；
- 插件系统。

### 发布门槛

- CI 主分支全绿；
- README、示例配置与实现无已知漂移；
- core/transport/client 边界不因新增小功能重新耦合。

---

## v0.3.0 — Deployability

目标：从“源码能启动”升级到“别人能可靠部署”。

### 功能

- 官方 Dockerfile；
- 最小 `docker compose` 示例；
- 可选 GHCR 镜像发布；
- 明确数据/配置挂载方式；
- 反向代理部署文档（Nginx / Caddy 至少给出通用原则）；
- `/healthz` 契约稳定化；
- 正常 SIGINT/SIGTERM 停服验证；
- 启动日志统一格式，清晰打印：
  - App version；
  - config source；
  - storage mode（此阶段固定 memory）；
  - listen address；
  - 安全边界提示。

### 运维

- 真实局域网部署验收；
- 反向代理 WebSocket 验收；
- Docker smoke test；
- 不依赖公网第三方资源的离线启动验证。

### 非目标

- Kubernetes；
- 多实例；
- Redis；
- 服务发现。

---

## v0.4.0 — Security & Load Beta

目标：在 v1.0 之前把安全默认值和资源边界做实。

### 安全

- 重新评审 `allowNoOrigin` 默认值。Pavilo 的主要客户端是浏览器，建议在 v1.0 前把安全默认值收紧；非浏览器客户端需要时显式放开。
- 建立 Threat Model 文档：
  - 未认证访问；
  - Origin 绕过；
  - 慢连接；
  - 超大 payload；
  - 图片解码；
  - IP 隐私；
  - 反向代理；
  - 配置泄露；
  - 资源耗尽。
- 不盲目信任 `X-Forwarded-For`。若未来支持可信代理，必须使用显式 trust proxy 配置，而不是“看到头就信”。
- 补充 HTTP 安全响应头。
- WebSocket frame / JSON / 配置解析的畸形输入测试。

### 压力与性能

建立可复现的 benchmark/stress 工具，至少覆盖：

- 大成员列表；
- 多频道同时活跃；
- 大量文本；
- 300 KB 图片；
- 慢连接与 backpressure；
- reconnect storm；
- history chunk；
- 频道 FIFO 淘汰。

首次只建立基线，不急于设“漂亮数字”。

### 发布门槛

- 不出现未受控的进程内存增长；
- 慢客户端不会拖垮正常客户端；
- 所有资源上限都能通过测试证明被执行。

---

## v0.5.0 — UX & Performance Polish

目标：完成稳定版前的体验收口，不再扩产品面。

### 体验

- 真机移动端验收；
- IME/中文输入法专项回归；
- 键盘导航、焦点、ARIA、减少动态效果继续完善；
- `readOnly` 频道在 UI 上有清晰状态；
- 断网、停服、重连、频道不可用等状态统一反馈。

### 性能

- 根据 v0.4 benchmark 决定是否做增量消息渲染；
- 大 roster / 大 history 下避免无必要的 DOM 全量工作；
- 不为了“看起来先进”提前引入前端框架。

### 非目标

- 新娱乐功能；
- 主题市场；
- PWA 离线消息；
- 历史持久化。

---

## v0.9.0 — Release Candidate

目标：冻结 v1.0 契约。

### 冻结项

- Config Schema v1；
- v1.0 支持的 WebSocket Protocol 范围；
- `/room-info` 与 `/healthz` 的公开字段；
- CLI 启动和退出行为；
- 默认配置；
- core / transport 的责任边界。

### 开源工程

- `CHANGELOG.md`；
- Release Checklist；
- 贡献指南；
- 安全报告流程；
- 中英文项目介绍（至少首页核心信息具备英文入口）；
- 清晰截图 / GIF；
- Docker 与源码两套 Quick Start；
- GitHub Topics、Description、Release Notes 统一。

### RC 原则

`v0.9.x` 只修 blocker，不再新增大功能。

---

## v1.0.0 — Ephemeral Stable

v1.0 的产品定义：

> **一个极简、可靠、浏览器即用、默认无数据库的自托管网页聊天频道。**

### 必须保证

- 一键启动；
- 多频道；
- 静态只读频道；
- ACK / 幂等 / reconnect；
- 资源上限和 backpressure；
- 严格配置；
- 桌面/移动端可用；
- 源码与容器部署；
- CI / 安全 / 文档 / 发布流程成熟；
- memory mode 行为稳定。

### 明确不包含

- SQLite；
- 账号；
- 角色权限；
- 私聊；
- 历史搜索；
- Agent；
- LLM 网关；
- 插件市场。

这些缺失不是 v1.0 “没做完”，而是产品边界。

---

# 5. 中期目标：v1.x 可选持久化与扩展基础

## v1.1.0 — Persistence Foundation

目标：让“聊天记录可保存”成为**可选能力**，不改变默认体验。

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
    retentionDays: 30
```

规则：

- 不使用 `database.enabled`；
- Config Schema v1 继续接受，并自动归一化为 `storage.driver: memory`；
- 开启 SQLite 不是“运行 v2”，只是当前 App 的 persistent mode；
- `retentionDays` 缺省表示不按时间自动删除；不要让 `0` 同时承担“关闭”和“永久”两种含义。

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

### 技术选择

优先评估 Node 原生 `node:sqlite`：

- 与当前 Node-only、少依赖理念一致；
- `DatabaseSync` 与当前同步 core 很契合；
- 通过 Store Adapter 隔离，未来仍可替换实现。

在正式实现前写 ADR，确认：

- 最低 Node 小版本；
- WAL；
- `busy_timeout`；
- `foreign_keys=ON`；
- transaction 边界；
- crash consistency；
- 单进程写入限制。

不要为了“未来可能支持远程数据库”在 v1.1 把整个 core 改成 async。

### 数据库迁移

从第一版 SQLite 就必须存在 migration 机制；不能等到第二个数据库版本才补。

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

新增两个方向：

### 1. Policy Hooks（提交前）

用于：

- 消息是否允许发送；
- 上传是否允许；
- 加入是否允许；
- 后续 moderation/access policy。

规则：

- 返回明确 allow / deny；
- 有严格超时；
- 默认失败策略必须显式定义；
- 不允许插件绕过 core 直接写 Store。

### 2. Domain Events（提交后）

示例：

- `message.created`
- `reaction.changed`
- `member.joined`
- `member.left`
- `channel.switched`

用于：

- Webhook；
- Bot；
- Agent；
- 审计；
- 外部自动化。

订阅者失败不能回滚已经成功提交的聊天消息。

### Bot / Automation

Bot 也必须通过统一 Command API 进入 core，而不是直接操作 SQLite。

此版本 Extension API 标记为 experimental。

---

# 6. 中长期目标：Agent、权限与生态

## v1.4.0 — Agent & Gateway

目标：让 Pavilo 可以“长出智能能力”，但聊天核心仍然不依赖 AI。

### 功能

- 可选 Agent/Bot Adapter；
- OpenAI-compatible HTTP 作为第一种统一模型接口候选；
- Bot 有明确 actor 类型和展示身份；
- @Bot / 命令式触发；
- 可配置 Agent 允许加入的频道；
- streaming 输出通过标准消息路径呈现；
- 模型错误、超时、限流与聊天服务隔离；
- Agent 默认关闭。

### 禁止

- `src/core` import OpenAI/Anthropic/其他厂商 SDK；
- Agent 直接写数据库；
- LLM 调用阻塞 WebSocket transport；
- 因 Agent 不可用导致正常聊天不可用。

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

候选：

- Stable Extension API；
- 扩展 manifest；
- scoped API token；
- Management API；
- Webhook 管理；
- 独立扩展包目录规范；
- Agent / moderation / gateway 示例扩展；
- 兼容矩阵；
- 第三方扩展安全声明。

插件若以同进程 JavaScript 运行，必须明确它是“受信任代码”，不宣传为安全沙箱。

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
