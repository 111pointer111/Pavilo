# Pavilo 架构演进与版本策略

本文描述 Pavilo 从当前 Ephemeral Core 演进到可选持久化、Agent 与安全扩展时的目标架构。

它不是对未来实现的强行抽象。任何新增边界都应遵循一个原则：

> **先有真实需求，再引入抽象；但在真实需求到来之前，不要让现有代码形成无法拆开的耦合。**

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
- 不因为未来“可能分布式”现在就加入消息队列、Redis 或 async everywhere。

---

# 2. 目标架构

中期目标：

```text
                         ┌────────────────────┐
                         │   Browser Client   │
                         └─────────┬──────────┘
                                   │
                         HTTP / WebSocket
                                   │
                         ┌─────────▼──────────┐
                         │ Transport Adapters │
                         │ http / websocket   │
                         └─────────┬──────────┘
                                   │ command
                                   ▼
                    ┌────────────────────────────┐
                    │ Application / Chat Core    │
                    │ validation · command rules │
                    │ sessions · policy · effect │
                    └───────┬───────────┬────────┘
                            │           │
              conversation  │           │ domain event
                            │           │
                  ┌─────────▼───┐   ┌──▼─────────────┐
                  │ Store Port  │   │ Event / Hooks  │
                  └──────┬──────┘   └──┬─────────────┘
                         │             │
             ┌───────────┴───────┐     ├─ Webhook
             │                   │     ├─ Bot
     ┌───────▼────────┐  ┌──────▼────┐├─ Agent
     │ Memory Adapter │  │ SQLite    │└─ Moderation
     │ default        │  │ Adapter   │
     └────────────────┘  └───────────┘
```

长期如果出现管理 API、CLI、Agent 等新的命令来源，它们应进入同一 Application/Core 命令路径，而不是各自直接修改状态。

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
core -> OpenAI SDK
core -> webhook URL
SQLite adapter -> browser payload routing
Agent -> raw database
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

v1.1 建议只保存：

- channel durable cursor；
- epoch；
- latest seq；
- message；
- reply relation；
- reactions；
- idempotency record；
- retention metadata；
- DB schema migration。

以后 Access/Moderation 成熟后才考虑：

- account/identity；
- invite；
- ban；
- audit。

不要为了“既然有数据库”把所有 Map 机械搬进表。

---

# 5. ConversationStore：SQLite 的正确边界

当前 `room.js` 同时承担频道 epoch、历史、seq、字节预算与 FIFO；这是 memory-only 阶段的合理实现。

引入 SQLite 时，不建议设计“一张表一个 Repository”的通用 CRUD 层，而应抽出面向聊天领域的高层 Store Port。

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

不把它当作最终 SQL DDL；真正实现前通过 ADR 固化。

建议：

- foreign keys 开启；
- WAL 是否默认开启通过 benchmark/ADR 决定；
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

原因：

- driver 是可扩展枚举；
- 不把“开数据库”写成产品代际；
- 将来真有其他 driver 时结构不需要推倒；
- memory 是显式一等实现。

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

当前浏览器使用 Protocol v4，服务端还保留 Alpha 阶段旧版本兼容。

在 v1.0 前必须决定：

1. WebSocket protocol 是否正式作为第三方 Public API；
2. 如果是，支持窗口多长；
3. 如果不是，至少保证“服务器与同版本自带浏览器”稳定，并给热升级时旧标签页一个清晰策略。

建议：

- Alpha 阶段的 v1/v2 不要仅因为“已经写了”就永久冻结；
- v0.9 前清理不再值得维护的历史分支；
- v1.0 后对文档明确承诺的协议做兼容；
- 第三方 Bot/Agent 不应依赖伪装成浏览器 WebSocket 客户端；v1.3 后给它们统一 Command/Extension API。

---

# 10. Extension 架构

Agent、Webhook、Moderation 有两个完全不同的方向，不能用一个万能 Hook 混在一起。

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

# 11. Agent 与统一网关

Agent 应被视为“特殊 actor + 外部能力 adapter”，而不是数据库触发器。

推荐路径：

```text
message.created
      ↓
Agent extension
      ↓
Model Gateway
      ↓
Agent result
      ↓
Command API
      ↓
Core validation
      ↓
ConversationStore
      ↓
broadcast
```

这样 Agent 输出仍然遵守：

- 频道权限；
- 文本长度；
- rate policy；
- message schema；
- persistence；
- audit。

### Gateway 边界

`src/core` 不 import 任何 LLM SDK。

可选扩展层处理：

- OpenAI-compatible；
- 未来其他 provider；
- API key；
- timeout；
- retry；
- streaming；
- usage。

即使 Agent 全部故障：

```text
normal Pavilo chat = unaffected
```

这是架构验收条件。

---

# 12. Access / Authorization / Moderation

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

建议从 v0.2 开始建立：

```text
docs/adr/
  0001-protocol-support-policy.md
  0002-sqlite-driver-choice.md
  0003-persistence-epoch-semantics.md
  0004-extension-hooks.md
```

每份 ADR 只需要：

- Context；
- Decision；
- Alternatives；
- Consequences；
- Status。

尤其以下决策必须 ADR：

- `node:sqlite` vs third-party driver；
- protocol v1-v4 的支持窗口；
- SQLite epoch；
- sync vs async Store；
- extension execution model；
- trusted proxy。

---

# 16. 文档单一真源

当前已经出现 `readOnly` 的代码/README/example 漂移，后续要减少重复描述。

建议：

- README：用户入口、Quick Start、产品边界；
- `pavilo.example.yaml`：可运行的配置例子；
- `docs/configuration.md`（未来新增）：配置语义唯一详细说明；
- `chat-protocol.md`：线上协议真源；
- `overview.md`：当前实现；
- `evolution.md`：未来演进原则；
- `ROADMAP.md`：版本计划。

CI 至少验证：

- example YAML 可解析；
- 默认频道 ID 与测试一致；
- protocol constant 与 `/room-info` 一致；
- 文档引用的脚本存在。

不要让 README 复制一整份配置参考。

---

# 17. 架构完成度检查

任何新功能合并前问 7 个问题：

1. 默认 ephemeral 用户是否被迫承担了额外复杂度？
2. 业务规则是否进入 transport 了？
3. adapter 是否能绕过 core 写状态？
4. 新 IO 是否可在测试中替换？
5. public contract 是否有测试？
6. 重启/失败/超限时语义是否定义？
7. README/配置/协议/代码是否可能再次漂移？

如果其中任何一个答案不清楚，功能还没有真正“设计完成”。
