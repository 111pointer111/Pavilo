# Pavilo 架构演进与版本策略

本文描述 Pavilo 从当前 Ephemeral Core 演进到可选持久化、统一 AI 网关、内容审核与可贡献玩法时的目标架构。版本边界见 [ROADMAP.md](../ROADMAP.md)。

它不是对未来实现的强行抽象。任何新增边界都应遵循：

> **先有真实需求，再引入抽象；但在真实需求到来之前，不要让现有代码形成无法拆开的耦合。**
>
> **只保留当下有调用方的端口。** 不为「以后所有 Agent 游戏」发明引擎、DSL、商店或通用 UI 组件平台。狼人杀用到的，才写进 Play 契约。玩法页是独立文档，不是聊天页的皮肤。

---

## 1. 当前架构判断

当前代码已经有一条健康的依赖链：

```text
Browser
  │
  │ HTTP / WebSocket
  ▼
src/transport
  │
  │ command / effect
  ▼
src/core
```

前端也已经从页面脚本拆成：

```text
protocol
connection
state / pending
images
messages / composer / overlays / notifications
app (composition)
```

`server.js` 是 composition root：加载配置、创建 core、创建 HTTP/WS transport、处理 CLI 生命周期。

这是后续演进最值得保护的资产。

### 当前不应该推翻的设计

- 不重新把业务逻辑塞回 WebSocket handler；
- 不让 core 接触 socket / request / response；
- 不让 reducer 做 IO；
- 不因为 SQLite 引入 ORM 后让 SQL model 变成领域模型；
- 不因为 Agent 引入 SDK 后让模型厂商 API 进入 core；
- 不把游戏状态机、网关 HTTP 客户端或管理页路由塞进 `src/core`；
- 不因为未来“可能分布式”现在就加入消息队列、Redis 或 async everywhere。

---

# 2. 目标架构

中期目标：

```text
  `/` 聊天页                 `/plays/<id>/` 玩法页
  (未绑定 play 的频道)        (channel.play = id)
           │                           │
           └──── 同一会话 + Protocol v4 ─┘
                           │
                    Transport HTTP / WS
                           │
                    Application
                    (core · policy · play host)
                      │         │          │
                   Store     Gateway     Play 模块
                memory/sqlite  presets   host.js + page/

  `/admin` 管理页：另一条 HTTP 面，用 operator token，不走聊天会话。
```

聊天页和玩法页共用身份与协议，不共用 DOM。玩法 host 与 trusted script 同一加载模型。谁都不能直写 Store 或 socket。

---

# 3. 依赖方向规则

允许：

```text
server/composition
      ↓
transport / adapters
      ↓
core/application
      ↓
domain contracts
```

Storage Adapter 可以依赖 SQLite；core 只能依赖 Storage Port。

禁止：

```text
core -> websocket
core -> HTTP request
core -> node:sqlite
core -> OpenAI SDK / DeepSeek SDK
core -> webhook URL
core -> play state machine
SQLite adapter -> browser payload routing
Gateway -> raw ConversationStore writes
Agent / Play host -> raw database
Play page -> AI Gateway
Play page -> core internal Maps
Operator UI -> core internal Maps
```

代码评审遇到这些依赖应默认视为架构告警。

---

# 4. Runtime State 与 Durable State 必须分开

即使启用 SQLite，Pavilo 也不是“所有状态都写数据库”。

## 4.1 永远属于运行时的状态

这些数据与当前进程/连接生命周期绑定：

- socket / peer；
- join timer；
- heartbeat；
- writable buffer；
- sync queue；
- 在线连接；
- typing；
- session lease timer；
- rate-limit counter；
- transport backpressure；
- 前端 pending；
- 当前 DOM / 阅读位置。

这些继续留在内存。

## 4.2 SQLite 持久化状态

v1.1 建议只保存聊天耐久状态：

- channel durable cursor；
- epoch；
- latest seq；
- message；
- reply relation；
- reactions；
- idempotency record；
- retention metadata；
- DB schema migration。

后续版本按需增加，仍然是耐久状态，不是把 runtime Map 搬进表：

- v1.3：gateway channel 配置、API key 密文、usage 计数；
- v1.5：play 对局、Agent 局内记忆；
- Access 成熟后：account/identity、invite、ban、audit。

不要为了“既然有数据库”把所有 Map 机械搬进表。

---

# 5. ConversationStore：SQLite 的正确边界

`src/storage` 已经抽出面向聊天领域的 `ConversationStore` 端口；当前默认实现是 `memory-store.js`。`room.js` 只保留频道配置目录与历史分块。

引入 SQLite 时，不要改成“一张表一个 Repository”的通用 CRUD 层，让 sqlite 实现同一端口即可。

概念接口：

```js
class ConversationStore {
  getChannelState(channelId) {}
  loadHistory(channelId, options) {}

  findIdempotentResult(scope, clientMessageId) {}

  appendMessage(channelId, message, options) {}
  updateReactions(channelId, messageId, nextState, options) {}

  prune(options) {}
  stats() {}
  close() {}
}
```

最终方法名可以根据实现调整，但需要坚持：

- 输入输出是领域对象，不是 SQL row；
- adapter 决定如何保存；
- core 决定消息是否合法；
- transport 不知道 Store 存在；
- Store 不负责 socket broadcast。

## 为什么 v1.1 先保持同步接口

当前 core 的命令处理链是同步的；Node 原生 SQLite 也提供同步接口。

Pavilo 的已知需求是“本机/自部署 SQLite”，不是远程 PostgreSQL。

因此 v1.1 推荐：

```text
sync core
  + sync MemoryConversationStore
  + sync SQLiteConversationStore
```

优点：

- 改动面小；
- command/effect 顺序更容易证明；
- ACK 事务语义清楚；
- 不因为假想需求破坏现在好用的测试模型。

如果未来真实的 remote storage / multi-instance 需求要求 async，则把它作为重大架构决策；必要时进入 v2。

---

# 6. SQLite 模式的数据一致性

## 6.1 Epoch

Memory mode：

```text
process restart
    ↓
new epoch
history = []
seq = 0
```

SQLite mode：

```text
normal restart
    ↓
same durable epoch
same monotonically increasing seq
history remains
```

数据库被明确 reset / replace 后生成新 epoch。

这样 epoch 继续表示“一条可比较的消息序列生命周期”，而不是简单等价于 process PID。

## 6.2 ACK

Memory：

> ACK = 当前服务进程已经接受并写入权威内存状态。

SQLite：

> ACK = 对应消息事务已经 commit。

不能先 ACK 再异步落库，否则崩溃会出现“客户端认为成功、数据库没有”的窗口。

ACK 仍然不表示：

- 所有客户端已收到；
- 对方已读；
- webhook 已成功；
- Agent 已处理。

## 6.3 Idempotency

`clientMessageId` 的幂等状态必须和 durable message 一致提交。

SQLite 下应该持久化：

- scope；
- clientMessageId；
- payload fingerprint；
- resulting messageId；
- expiration / cleanup metadata。

重启后同一客户端重试：

- 相同 ID + 相同 fingerprint → 返回原结果；
- 相同 ID + 不同 fingerprint → 拒绝冲突；
- 不重新创建第二条消息。

## 6.4 Sequence

seq：

- 单频道单调增加；
- 不要求连续；
- retention 删除历史后不复用；
- crash/restart 后继续增加；
- 不跨 channel/epoch 比较。

---

# 7. SQLite Schema 原则

概念表可以类似：

```text
schema_migrations
channels
messages
reactions
idempotency
```

v1.3+ 按需增加 `gateway_channels` / `gateway_usage` / `play_games` 等，仍由对应 adapter 拥有，不把它提前写成通用 ORM。不把它当作最终 SQL DDL；真正实现前通过 ADR 固化。

建议：

- foreign keys 开启；
- WAL：v1.1 默认开启，若实现时有反证再写 ADR 调整；
- 有明确 busy timeout；
- 所有 message + idempotency mutation 使用 transaction；
- 不支持多个 Pavilo 进程同时把同一个 SQLite 文件当共享数据库，除非未来专门设计；
- migration 只向前；
- 每次 migration 有 fixture test；
- 应用升级前后都能读真实旧版 DB fixture。

### 图片

v1.1 不急于引入独立对象存储。

可以由 SQLite adapter 把图片 payload 保存为 BLOB，并在读取时重建当前公开消息对象，避免 core 感知存储格式。

对象存储只有在真实的大附件/外部存储需求出现后，再抽 `BlobStore`。

---

# 8. Config 演进

不要：

```yaml
database:
  enabled: true
```

推荐：

```yaml
version: 2

storage:
  driver: memory
```

或：

```yaml
version: 2

storage:
  driver: sqlite
  sqlite:
    path: ./data/pavilo.db
    retentionDays: 30
```

`retentionDays` 在 sqlite 模式下 **默认 30**（最近 30 天）。省略该字段也按 30。永久留存必须用显式值（如 `null` / `forever`），禁止用 `0` 同时表示「关闭」和「永久」。

原因：

- driver 是可扩展枚举；
- 不把“开数据库”写成产品代际；
- 将来真有其他 driver 时结构不需要推倒；
- memory 是显式一等实现。

## 8.1 配置双源（v1.3 起）

YAML 继续负责「怎么启动」：监听地址、频道、是否开 sqlite、是否开网关。

管理页保存的**网关渠道**（模型供应商配置，不是聊天频道）、key 和用量落在 SQLite。某个网关渠道被管理页保存后，以 SQLite 为准；必须在文档里写清优先级，避免改 yaml 不生效。

未开 sqlite 时：YAML/环境变量仍可调用模型，但不记用量，管理页也不可编辑。用量与管理页写入以 sqlite 为前提。

密钥：不进日志、不进 `/room-info`、不进公开协议。operator token / 管理密码保护管理页，不是账号系统。

实现前用 ADR-0004 固化优先级。

## Config Compatibility

App v1.1+：

```text
Config Schema v1
       ↓ normalize
storage.driver = memory
       ↓
current internal config
```

Config Schema v2 才允许声明 `storage`。

因此：

- App version ≠ config version；
- 升级 Pavilo 不强迫所有 ephemeral 用户改 YAML；
- deprecated 字段必须先警告，再跨 major 删除。

---

# 9. 协议兼容策略

当前浏览器与服务端只使用 Protocol v4（ADR-0001）。v1.0 后对文档明确承诺的协议做兼容。

第三方 Bot/Agent 不应依赖伪装成浏览器 WebSocket 客户端；它们应走 Command API / 官方模块，而不是再开一套协议。

---

# 10. Policy、官方模块与用户扩展

分清「我们维护的基础设施」和「可以贡献的模块」：

| 层 | 谁来做 | 例子 |
| --- | --- | --- |
| 基础设施 | 主线 | Store、Gateway、Safety、Play 契约 |
| 官方样例 | 主线 | 文字狼人杀（把契约跑通） |
| 可贡献模块 | 社区 / 部署者 | 新玩法、webhook、自定义词库策略 |

可贡献模块是 trusted script（ADR-0003）：配置指向文件，与主进程同权。不另造沙箱或商店。

Policy 与 Play 不是同一个端口：Policy 回答「这条命令能不能提交」；Play 拥有一局状态机和 Agent 演员。不要用万能 Hook 混在一起。官方审核走 Policy，默认随配置启用，不要求用户写代码。

## 10.1 Pre-commit Policy

用途：

```text
join
message
upload
reaction
future moderation/access
```

流程：

```text
command
   ↓
parse / validate
   ↓
Policy Pipeline
   ↓ allow
domain mutation
   ↓
Store commit
```

Policy 应返回结构化结果：

```js
{
  allowed: false,
  code: 'POLICY_DENIED',
  message: '...'
}
```

原则：

- timeout；
- 明确 fail-open / fail-closed；
- 不允许任意修改 core 内部 Map；
- 不允许绕过正常消息校验。

## 10.2 Post-commit Domain Event

流程：

```text
Store commit
   ↓
ACK / realtime effect
   ↓
Domain event
   ├─ webhook
   ├─ bot
   ├─ analytics
   └─ agent
```

Event subscriber 失败：

- 不能让已 commit 的用户消息消失；
- 不能阻塞普通聊天；
- 需要自己的重试/错误策略。

---

# 11. 统一 AI 网关

网关是进程内模块，不是微服务，也不是「每个扩展自己握一把 key」。

`src/core` 不 import 任何 LLM SDK。官方 Play、内容审核的视觉调用、以及未来用户脚本，都通过 Gateway 发请求。

```text
Play / Safety / 用户脚本
      ↓
AI Gateway（preset · timeout · retry · usage）
      ↓
provider (first: DeepSeek, OpenAI-compatible)
```

第一阶段：官方 DeepSeek 渠道。选择 preset 后自动填充 base URL，管理员只填 key。后续渠道以 preset 扩展，不新造调用层。

管理页（如 `/admin`）可查看和编辑渠道、掩码回显 key、按渠道看用量、看综合 dashboard。管理页属于 Operator HTTP，不进入 core。

Usage 计入 SQLite（v1.3，依赖持久化）。网关未启用或调用失败时：

```text
normal Pavilo chat = unaffected
```

这是架构验收条件。实现前用 ADR-0005 固化边界。

## 11.1 Play 契约

Play 是独立应用层，不把任何一款游戏的规则或页面塞进 `src/core`，也不把玩法交互塞进聊天页。

第一性：管理员增加一个玩法 = 给一个频道绑定 `playId`。进入该频道，打开该玩法自己的页面。聊天页只是 `play` 为空时的默认投影。

```text
频道（配置 play: werewolf）
  ├─ 页面 /plays/werewolf/     贡献者自己的 HTML/CSS/交互
  └─ host（确定性状态机）
        ├─ human / agent actors
        ├─ playAction / playState（同一 Protocol v4）
        └─ 需要模型时 → AI Gateway（仅服务端）
```

硬约束：

- 主持人裁决规则，LLM 只发言和推理；
- 浏览器的 `playAction` 仍是 Protocol v4 命令，由 core 分发给 host；host 只能再走 Command API，不直写 SQLite、不碰 socket；
- 记忆与对局状态的作用域是「这一局」；
- 公开发言可走现有 `message`，以便沿用审核与限额；玩法页自行决定怎么渲染；
- 浏览器不调网关；玩法崩溃 ≠ 聊天崩溃。

页面约定的单一真源是 [docs/play.md](play.md)。实现前用 ADR-0006 冻结信封字段，不写通用游戏引擎，不写组件平台。

## 11.2 官方样例：文字狼人杀

狼人杀交付两样东西：host，以及独立玩法页（阶段、选人、夜间操作气泡都在这个页里，不在 `client/messages.js`）。人和 Agent 混编开局。新玩法抄这个目录边界。

## 11.3 社区玩法怎么接入

一个玩法 = `host.js` + `page/`，绑到频道。加载模型仍是 trusted module（ADR-0003）。主仓库可收符合 [docs/play.md](play.md) 的 PR；部署者也可以只在自己的实例加载。

不提供：商店、iframe 市场、强制 UI 框架、规则 DSL、把玩法嵌进聊天气泡。需要新能力时，先证明现有信封不够用，再扩大端口。

---

# 12. Content Safety 与 Access

顺序：先内容审核（v1.4），后访问控制（v1.6）。审核完成仍不宣称可以把裸端口暴露到公网。

## 12.1 内容审核

官方模块走 §10 的 Pre-commit Policy：

- 文本：可启用屏蔽词库。腾讯游戏词库只是候选数据源，落地前核对许可证；同时支持自定义词库路径。
- 图片：可选，调用网关里具备视觉能力的模型；网关未配则不可开。
- 局域网默认可 fail-open；面向公网的配置应 fail-closed。
- 超时、结构化 `{ allowed, code, message }`，不能绕过 core。

## 12.2 Access / Authorization

不要把当前 session 当成未来 account。

当前 session 的职责是：

- 临时身份；
- reconnect；
- lease；
- nickname/channel occupancy。

未来 Access 层负责：

- 谁能进入；
- actor 是谁；
- role；
- permission。

因此要区分：

```text
Session != Account
readOnly != Role
Origin check != Authentication
Rate limit != Authorization
```

当前：

```yaml
readOnly: true
```

含义是：

> 所有普通参与者都不能写。

未来“管理员能发公告、成员只能读”应由 Authorization 决定：

```text
channel.readOnly
+ actor.role
+ policy
```

而不是改变 `readOnly` 旧语义。

---

# 13. Testing Pyramid

每一层有自己的测试，不用浏览器测试覆盖所有问题。

## Core unit

- command validation；
- session lease；
- channel switching；
- readOnly；
- message/reaction；
- epoch；
- rate limit；
- deterministic timers。

## Contract

- core event → client protocol parser；
- public payload shape；
- Config Schema；
- Protocol compatibility。

## Transport integration

- WebSocket frame；
- Origin；
- heartbeat；
- backpressure；
- sync queue；
- HTTP static boundary；
- graceful shutdown。

## Browser

- 双用户消息；
- reconnect；
- IME；
- mobile drawer；
- reading anchor；
- image viewer；
- readOnly UI。

## Storage（v1.1+）

同一组 Store Contract Test 跑：

```text
MemoryConversationStore
SQLiteConversationStore
```

另外：

- migration fixture；
- crash/reopen；
- idempotency after restart；
- retention；
- backup/restore；
- large history。

## Gateway / Play / Safety（v1.3+）

- preset 自动填充 base URL；
- key 不出现在日志与公开 payload；
- usage 计数与渠道隔离；
- 文本 Policy 拒绝路径；
- 网关故障时聊天仍可用；
- 狼人杀状态机：非法动作拒绝、局内存活、私密 playState 不广播；
- 玩法页不调用网关；玩法 host 不直写 Store。

## Security / fuzz

- malformed frame；
- oversized JSON；
- invalid image；
- YAML edge cases；
- slow client；
- reconnect storm。

---

# 14. Runtime Dependency Policy

Pavilo 的“小”本身是产品价值。

建议：

- runtime dependency 必须解释为什么 Node 标准库不够；
- dev dependency 可以更宽松，但不能泄漏到运行时；
- SDK 型依赖优先放 optional extension；
- 避免为了 20 行代码引入大型通用库；
- 每次新增 runtime dependency 在 PR 中说明：
  - 作用；
  - 包大小；
  - transitive dependencies；
  - 安全/维护状态；
  - 替代方案。

这不是“零依赖宗教”，而是控制默认部署复杂度。

---

# 15. ADR：重要决定不能只留在 Issue/聊天记录里

已有：

```text
docs/adr/
  0001-protocol-v4-only-for-v1.md
  0002-sqlite-pragmatic-hybrid.md
  0003-extension-as-trusted-scripts.md
```

对应版本开工前再写，本次不提前起草正文：

```text
  0004-operator-config-dual-source.md
  0005-in-process-ai-gateway.md
  0006-play-contract.md
```

每份 ADR 只需要：

- Context；
- Decision；
- Alternatives；
- Consequences；
- Status。

尤其以下决策必须 ADR：

- `node:sqlite` vs third-party driver（已有 0002）；
- protocol 支持窗口（已有 0001）；
- SQLite epoch；
- sync vs async Store；
- extension execution model（已有 0003）；
- operator 配置双源（0004）；
- 进程内网关边界（0005）；
- Play 契约（0006）：只收录狼人杀用到的端口，贡献玩法复用同一契约；
- trusted proxy。

---

# 16. 文档单一真源

配置、协议、README 曾经漂过（例如 `readOnly`）。后续以单一真源为准，避免再复制一份会过期的说明。

建议：

- README：用户入口、Quick Start、产品边界；
- `pavilo.example.yaml`：可运行的配置例子；
- `docs/configuration.md`：配置语义唯一详细说明；
- `chat-protocol.md`：线上协议真源；
- `docs/architecture/overview.md`：当前实现；
- `docs/evolution.md`：未来演进原则；
- `docs/play.md`：玩法页与频道绑定的约束（v1.5 前为草案）；
- `ROADMAP.md`：版本计划。

CI 至少验证：

- example YAML 可解析；
- 默认频道 ID 与测试一致；
- protocol constant 与 `/room-info` 一致；
- 文档引用的脚本存在。

不要让 README 复制一整份配置参考。

---

# 17. 架构完成度检查

任何新功能合并前问这些问题：

1. 默认 ephemeral 用户是否被迫承担了额外复杂度？
2. 业务规则是否进入 transport 了？
3. adapter 是否能绕过 core 写状态？
4. 新 IO 是否可在测试中替换？
5. public contract 是否有测试？
6. 重启/失败/超限时语义是否定义？
7. README/配置/协议/代码是否可能再次漂移？
8. 管理页保存配置后，YAML 与 SQLite 的优先级是否写清？
9. 网关或某个 Agent 故障时，普通聊天是否仍可用？
10. 这条抽象是狼人杀现在就要的，还是为尚未存在的玩法提前造的？

如果其中任何一个答案不清楚，功能还没有真正“设计完成”。
