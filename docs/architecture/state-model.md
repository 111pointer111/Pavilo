# 聊天状态模型基线

> 本文冻结阶段 0、结构迁移前 `server.js` 与 `index.html` 已实现的状态及不变量，供阶段 1/2 移动责任边界时核对。后续文件位置可改变，行为契约不能随之改变；目标结构是否完成以实际代码与验收为准。

## 1. 生命周期与状态所有权

Pavilo 的聊天数据全部在单个服务进程内存中：

- **服务实例**拥有频道 Map、活跃 sessions、断线 leases、消息幂等表、连接集合和 shutdown 状态；
- **频道**拥有自己的 epoch、启动时间、消息历史、消息序号与字节用量；
- **session**拥有公开身份、恢复 token、当前频道和至多一个当前连接；
- **连接**拥有 join/sync/closing 状态、帧缓冲、写入/同步队列、心跳、typing 和限流桶；
- **浏览器页面**拥有连接状态、当前频道快照、pending、草稿、typing 展示、未读和 UI 临时状态。

没有数据库或跨进程恢复。服务实例结束时，历史、身份、lease、回应和去重记录都结束。

## 2. 服务端模型

### 2.1 服务实例

```text
lifecycle: created → starting → listening → stopping → stopped
shuttingDown: boolean
clients: Set<Connection>
sessions: Map<token, Session>
leasedSessions: Map<token, Lease>
dedupe: Map<channelId + token + clientMessageId, DedupeEntry>
channelStates: Map<channelId, ChannelState>
```

不变量：

1. `listen()` 只可从 `created` 调用；当前实例 stop 后不可再次 listen。
2. shutdown 后拒绝新的 WebSocket upgrade，并最终销毁现有连接。
3. 活跃 session 与 lease 合起来才是“占用成员名额”的集合；同一 token 计算一次。
4. `dedupe` 是有 TTL/容量限制的可靠性缓存，不是消息存储。

### 2.2 频道

```text
ChannelState {
  config: { id, name, description, enabled, maxUsers }
  epoch
  startedAt
  messages[]
  messageSequence
  roomBytes
}
```

不变量：

1. 每个频道状态完全隔离：roster、历史、seq、epoch、typing 广播、回应、回复查找、容量淘汰和去重命名空间均不跨频道。
2. `roomBytes` 等于当前历史公开消息 JSON 尺寸之和；回应变化会重新计量。
3. 历史同时受 `maxMessages` 与 `maxRoomBytes` 约束，超限时从最旧消息开始 FIFO 淘汰。
4. 每个新服务实例生成新 epoch，`messageSequence` 从 0 开始；消息 seq 单调但允许空洞。
5. 消息 ID 只应与频道 epoch 一起解释；客户端不能单靠 ID 跨重启去重。

### 2.3 Session 与 lease

```text
Session {
  id, username, nameKey, channelId, ip,
  avatarSeed, joinedAt, token,
  client: Connection | null
}

Lease { session, expiresAt, timer }
```

session 状态转换：

```text
新 join ───────────────→ active
active ──意外断线──────→ leased ──同 token 恢复──→ active
  │                         └─到期───────────────→ removed
  ├─主动 leave──────────────────────────────────→ removed
  ├─同 token 接管旧连接────────────────────────→ active（换连接）
  └─成功切频道──────────────────────────────────→ active（换 channelId）
```

不变量：

1. token 是恢复能力凭据，不是公开 ID；公开 `id` 在成功恢复、接管和切频道时保持稳定。
2. 已知 token 的用户名或频道不吻合必须 `SESSION_CONFLICT`，不能静默复用或改写该身份。
3. 未知/过期 token 可创建新 session，因此“token 格式合法”和“恢复成功”不是同一事实。
4. 同一频道的活跃 session 与未过期 lease 均保留名称；不同频道可以有同名用户。
5. 只有意外断线产生 lease。主动离开、停服不产生 lease。
6. session 任一时刻至多指向一个当前连接；恢复活跃 session 时先关闭旧连接。

### 2.4 连接

```text
Connection {
  joined, session, closing, intentionalLeave,
  protocolVersion,
  syncing, syncQueue, syncQueueBytes,
  joinTimer, syncTimer,
  typingActive, typingTimer,
  rates,
  lastPong, pingSentAt, awaitingPong,
  frame/fragment buffers
}
```

连接主状态：

```text
connected-unjoined → syncing → joined-ready → closing → removed
                         ↑          │
                         └─重发状态─┘（切到同频道或成功切频道）
```

- `joined` 表示已有 session；`syncing` 表示初始快照尚未完整写出。二者可同时为 true。
- syncing 时，频道广播进入该连接的同步队列；`historyEnd` 写完后再 flush，保证快照与实时事件不交错。
- syncing 时只允许 `leave`；其他命令返回 `SYNC_IN_PROGRESS`。
- typing 属于连接而非 session 的持久属性：连接断开、切频道或 TTL 到期都会撤销。
- 连接限流桶不随 session 恢复，新的 WebSocket 连接重新开始；消息幂等则按 session token 跨短暂重连保留。

## 3. 消息与回应模型

### 3.1 权威消息

```text
Message {
  id, seq, clientMessageId,
  kind: text | image,
  author: PublicUser,
  createdAt,
  replyTo: ReplySnapshot | null,
  reactions: { emoji: { count, userIds[] } },
  text | image,
  // internal: reactionUsers, byteSize
}
```

不变量：

1. 客户端提交不是消息事实；只有服务端接受并生成的消息才进入历史。
2. 服务端广播的 `author`、时间、ID、seq、回复快照、回应和图片元数据均为权威值。
3. `clientMessageId` 用于提交对账；服务端消息 `id` 用于历史、回复和回应。
4. 回复保存发送时的摘要。原消息后续回应变化或淘汰不会重写回复摘要。
5. `reactionUsers` 和 `byteSize` 永不进入公开投影。
6. 回应是每个用户对每个固定 emoji 的布尔集合操作；重复 active=true/false 不重复计数。

### 3.2 提交状态与去重

服务端提交状态：

```text
收到命令
  ├─校验/限流/预算失败 → error（不写历史、不写 dedupe）
  ├─已有相同 key + 相同指纹 → 重发原 ack
  ├─已有相同 key + 不同指纹 → MESSAGE_ID_CONFLICT
  └─接受 → 写历史 → 淘汰 → 记录 dedupe → ack + message 广播
```

`messageSequence` 当前在部分最终容量检查之前增加。因此失败通常不产生消息，但可能消耗 seq；任何重构若想消除空洞，属于行为改变，不能混入纯迁移。

浏览器 pending 状态：

```text
sending ──ACK──────→ accepted ──权威回显/超时清理──→ removed
   │                     │
   ├─8 秒无 ACK────────→ unconfirmed
   ├─相关 error────────→ error
   └─断线──────────────→ unconfirmed

unconfirmed/error ──用户重试──────────────→ sending
unconfirmed ──同 epoch 重连、首次自动补发──→ sending
任意未完成 ──epoch 改变──────────────────→ error（不自动重发）
```

补充约束：

- pending 仅在页面内存中，不写 `sessionStorage`；刷新不会恢复它。
- ACK 后清空文字草稿的前提是输入框当前值仍等于发送文本，避免覆盖用户新编辑。
- 权威回显可先于/后于 ACK；任一顺序都按 `clientMessageId` 对账，不得生成两条 UI 消息。
- 手动跨 epoch 重试会生成新的 `clientMessageId`；旧房间的 ID 不能直接带入新 epoch。
- 当前页面最多 32 个 pending，且同一时刻只允许一条 sending 文本；accepted 不阻止切频道。

## 4. 快照同步与实时收敛

服务端开始同步时固定：

```text
snapshotMessages = 当前 messages 的浅拷贝
snapshotSeq = 当前 messageSequence
```

之后按 `stateStart / history* / historyEnd` 发送；同步期间发生的广播排队到终止符之后。客户端以 `pendingStateEpoch` 接收历史块，在 `historyEnd` 时一次性建立：

- `self`
- 当前频道 `users`
- 去重排序后的 `messages`
- `roomEpoch`
- `latestSeq`
- `knownMessageKeys`

完整快照是权威替换，不是增量合并。切频道成功时，客户端只有在收到目标频道 `stateStart` 后才清空原频道视图；切换错误不应清空原状态。

实时事件规则：

- 带 epoch 的 `message/reaction/prune` 若与当前 epoch 不同则忽略；
- `message` 将 `removedIds` 与追加消息合并为一次状态变化和一次列表重建；
- `reaction` 先应用同批淘汰，再以服务端摘要替换目标回应；
- `prune` 删除指定消息；
- `presence.users` 替换 roster，而非在客户端猜测全量成员；
- `typing` 只更新临时 Map，并在客户端约 4.5 秒到期兜底。

注意：当前 `typing` 和 `presence` payload 不带 epoch，只依靠服务端按频道路由以及切换时清空临时状态。结构迁移必须保留这一基线；若未来补 epoch，应作为协议变更单独完成。

## 5. 频道切换事务

服务端切换边界：

```text
validate(target enabled, rate, name, capacity)
  ├─失败 → error；不修改任何频道归属
  └─成功 → stop typing
          → session.channelId = target
          → source presence/leave
          → target full state sync to caller
          → target presence/join to others
```

关键不变量：

1. **所有会失败的领域检查必须在修改 `session.channelId` 前完成。**
2. 失败后连接仍可立刻在原频道发消息，且消息使用原频道 epoch。
3. 成功切换保留 session 身份和 token；全局成员数不变。
4. 目标初始状态到达前，浏览器保持原频道视图；收到匹配 `requestedChannelId` 的 `stateStart` 才 reset。
5. 浏览器在草稿、未完成 pending 或图片处理中拒绝发起切换，是 UX 防护而非服务端原子性的前提。

## 6. 权威状态与临时状态

### 服务端权威、可由快照修复

- 频道配置公开投影；
- 当前 roster（包括有效 lease）；
- session 的身份与频道归属；
- 消息历史、seq、reply snapshot、reaction summary；
- FIFO 淘汰结果；
- 每频道 epoch。

### 服务端裁决但不持久重放

- ACK/error 命令结果；
- join/reconnect/leave 提示；
- typing active/inactive；
- WebSocket close reason。

### 仅浏览器页面状态

- `connectionState`、重连次数/定时器；
- 草稿、replyTarget、pending 展示状态；
- 当前阅读位置、未读计数、通知；
- 选中成员、弹层、图片查看器；
- typing 展示到期时间；
- 正在处理的图片。

服务端权威不等于每个事件可靠送达。断线后以完整快照收敛；typing、提示和 ACK/error 不应被伪造成历史事件。

## 7. 浏览器连接状态

当前页面可概括为：

```text
idle → connecting → joining → joined
          ↑             │        │
          └──── reconnecting ← disconnected

joined ──用户 leave────────────→ idle/login（清身份）
joined ──1001 server stopped───→ stopped/login（清全部临时状态，不重连）
joined ──异常重启──────────────→ reconnect → 新 epoch snapshot
```

不变量：

- 重连前保留草稿和 pending；发送中的 pending 变为 unconfirmed。
- 同 epoch 同 session 恢复后，快照先对账已存在消息，再至多自动重发一次未确认项。
- epoch 改变后不自动重发旧 pending。
- 主动离开清除恢复 token、保存频道、身份、历史、pending 与 UI 状态。
- 收到精确 `1001 / server stopped` 也清空上述状态并禁止自动重连。
- 只发生网络断线时不冒充权威停服；继续退避重连。

## 8. 容量、限流与淘汰

需要保持彼此独立的四类限制：

1. **连接容量**：总 WebSocket 与每 IP 上限，在 upgrade 时检查；
2. **成员容量**：全局 `maxUsers` 与每频道 `maxUsers`，包含有效 lease；
3. **消息容量**：每频道消息数和 JSON 字节预算，FIFO 淘汰；
4. **命令速率**：每连接的 message/reaction/typing，以及固定的 switch 限流。

重要行为：

- 新消息若自身超过频道总预算，拒绝而不是清空频道来容纳它；
- 每个接受的 message 广播都携带 `removedIds`（可为空），使客户端把淘汰和追加作为一个变更；
- reaction 增大消息尺寸也可能触发淘汰；若目标自身被淘汰，发送 `prune` 而不是 reaction；
- typing 超限静默丢弃，其他限流返回对应 error；
- 慢连接超过写缓冲会被销毁或因同步 overflow/timeout 关闭，不能拖住全局状态推进。

## 9. 消息列表与阅读位置

消息列表的状态变更和 DOM 重建必须保留以下已验证原则：

- 改 DOM 前采样近底部状态与阅读锚点，不能在淘汰后的布局上再次采样；
- 一个 message payload 的淘汰和追加合并处理，最多一次列表重建；
- 用户正在翻历史时，优先恢复锚点消息的位置；锚点已淘汰则退回距底部距离；
- 本人新消息或原本近底部时允许贴底，其他人的新消息不能把正在阅读历史的人弹走；
- 程序化恢复位置时临时关闭 smooth scroll，并避免浏览器原生 `overflow-anchor` 与自定义恢复叠加；
- 完整频道快照重建后，按当前 epoch 重建已知消息集合，不继续保留上一个频道/快照的陈旧集合。

这些是 UI 行为契约，而不是要求沿用某个 DOM 函数名。

## 10. 配置基线

配置文件版本与聊天协议版本是两套独立编号：当前 YAML `version` 仅支持 **1**，当前聊天协议为 **3**。

加载优先级与替换语义：

1. 显式 `loadConfig({ configPath })`；
2. `PAVILO_CONFIG`；
3. 仓库根 `pavilo.yaml`；
4. 文件不存在且未显式指定时使用内置默认值；
5. `PORT` 最后覆盖配置端口，且必须是严格十进制 1–65535。

YAML 严格拒绝未知字段、错误类型、重复键、别名和不支持的 version。显式 `channels` **整体替换**默认频道数组；未写 `channels` 时保留内置频道，并把其 `maxUsers` 收紧到全局 `server.maxUsers`。默认频道必须存在且启用。

当前内置默认频道恰为两个：

| ID | 名称 | 描述 | enabled | maxUsers |
|---|---|---|---:|---:|
| `general` | 闲聊 | 轻松聊聊，只留当下。 | true | 64 |
| `awesome-ai` | 智能硬件项目聚集地 | 我们是最棒的👍 | true | 64 |

默认 `room.defaultChannel` 为 `general`，默认全局成员数 64。配置测试明确断言缺省/部分配置保留以上两个频道；迁移不得把旧的单频道预期重新引入，也不得只为测试方便改默认值。

其他与状态直接相关的当前默认值包括：每频道 300 条消息、每频道 32 MiB、图片 300,000 bytes / 1600 边长 / 4,000,000 像素、session lease 15 秒、dedupe 10 分钟 / 512 项、总连接 80、每 IP 12。

## 11. 结构迁移守则

阶段 1/2 的每个迁移提交必须满足：

1. 对外命令、事件名称、字段、顺序与错误 code 不变；
2. v1/v2/v3 兼容范围不变，不顺手严格化版本协商；
3. session/lease、每频道 epoch、幂等 key、同步队列和切换原子性不变；
4. YAML 路径、优先级、字段含义、严格校验和默认值不变；
5. `npm start` 继续以 `server.js` 启动；`createChatServer`、`listen`、`stop` 和测试状态入口保持兼容；
6. 一次只移动一个责任边界，不同时更改协议、配置、默认值或 UI；
7. 移动后立即运行对应单元/集成测试；涉及刷新、重连、切频道、图片或阅读位置时补真实浏览器验证；
8. 不把目标架构写成已完成事实。本文取样自迁移前的 `server.js` 和 `index.html`；后续拆出的 core、transport、client 模块只有在代码落地且验证通过后才算完成。

任何有意改变以上行为的工作都应独立提出：明确新契约、版本/兼容策略、失败行为与回归测试，不能隐藏在“重构”中。
