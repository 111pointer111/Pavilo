# WebSocket 协议文档

Pavilo 使用 WebSocket 进行实时通信。当前协议版本：**v4**（`PROTOCOL_VERSION = 4`）。

> **完整协议规范**：详见 [chat-protocol.md](../architecture/chat-protocol.md)

## 连接流程

```
1. 客户端发起 WebSocket 连接
   ↓
2. 服务器验证 Origin 与升级请求头
   ↓
3. 握手成功，连接建立
   ↓
4. 客户端发送 join 命令（timeouts.joinMs 内，默认 12000 毫秒）
   ↓
5. 服务器验证用户名、频道与凭据
   ↓
6. 服务器发送初始状态（stateStart → history → historyEnd）
   ↓
7. 客户端和服务器开始双向通信
   ↓
8. 心跳维持（默认每 30 秒一个 Ping 帧）
   ↓
9. 连接关闭
```

超时未发送 `join` 会收到 `1008 / join timeout`；加入前发送其他命令返回 `NOT_JOINED`。

---

## 客户端命令

客户端向服务器发送的 JSON 命令。命令名以 `client/protocol.js` 的 `COMMANDS` 为准：

```javascript
COMMANDS = { JOIN: 'join', MESSAGE: 'message', REACTION: 'reaction',
  TYPING: 'typing', SWITCH_CHANNEL: 'switchChannel', HISTORY_PAGE: 'historyPage',
  PLAY_ACTION: 'playAction', LEAVE: 'leave' }
```

`playAction` 仅在当前频道绑定玩法时有意义，否则 `PLAY_NOT_BOUND`。信封见 [play.md](../play.md)。

无法识别或格式非法的命令返回 `BAD_REQUEST`（JSON 解析失败返回 `BAD_JSON`），已加入后发送未知 `type` 返回 `UNKNOWN_COMMAND`。

### 1. `join` - 加入房间

**必须在连接后 `timeouts.joinMs`（默认 12000 毫秒）内发送**，否则连接会以 `1008 / join timeout` 关闭。

```json
{
  "type": "join",
  "protocolVersion": 4,
  "clientSessionId": "3f2a9c1b-8d4e-4a71-9f60-2c5b7e0d1a33",
  "username": "北岸的猫",
  "channelId": "general",
  "resumeToken": "可选，先前由服务端签发",
  "avatarSeed": 42
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `type` | string | ✅ | 固定为 `"join"` |
| `protocolVersion` | number | ✅ | 必须为整数 `4`；缺失、非整数或其他版本返回 `PROTOCOL_NOT_SUPPORTED` 并以 `1002 / protocol not supported` 关闭 |
| `clientSessionId` | string | ⬜ | 本页面加载周期的恢复凭据，`[A-Za-z0-9_-]{8,96}` |
| `username` | string | ✅ | 用户名：去除控制字符、首尾空白后截为 24 个字符；为空返回 `INVALID_NAME` |
| `channelId` | string | ⬜ | 目标频道；缺失或空字符串时使用默认频道 |
| `resumeToken` | string | ⬜ | 恢复令牌，`[A-Za-z0-9_-]{8,96}`；格式合法时优先于 `clientSessionId` |
| `avatarSeed` | number | ⬜ | 头像种子；只影响新 session，有限数值会归一为无符号 32 位整数 |

补充约定：

- `resumeToken` / `clientSessionId` 若命中已知凭据但用户名或频道不匹配，返回 `SESSION_CONFLICT`；未知或已过期的合法凭据不报错，会直接成为新 session 的 token。
- 首次 join 成功时其他成员收到 `action: "join"` 的 `presence`，恢复旧身份时是 `action: "reconnect"`。
- 已加入的连接重复发送 `join` 会被忽略。

### 2. `switchChannel` - 切换频道

所有已加入的 v4 连接都支持频道切换。

```json
{
  "type": "switchChannel",
  "channelId": "project"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `type` | string | ✅ | 固定为 `"switchChannel"` |
| `channelId` | string | ✅ | 目标频道 ID |

依次检查目标频道启用、切换限流、目标频道同名冲突和频道容量，失败分别返回 `CHANNEL_UNAVAILABLE`、`RATE_LIMITED`、`NAME_TAKEN`、`CHANNEL_FULL`，且不改变当前状态。成功后服务端会重新发送目标频道的完整初始状态（`stateStart → history → historyEnd`）。切到当前频道只重发初始状态。

### 3. `message` - 发送消息

#### 文本消息

```json
{
  "type": "message",
  "kind": "text",
  "clientMessageId": "message-client-0001",
  "text": "你好！",
  "replyTo": "m3_7c1d9a4b2e5f8031",
  "mentions": ["u_1a2b3c4d5e6f7081"]
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `type` | string | ✅ | 固定为 `"message"` |
| `kind` | string | ✅ | `"text"` 或 `"image"`，其他值返回 `INVALID_KIND` |
| `clientMessageId` | string | ✅ | 客户端消息 ID，`[A-Za-z0-9_-]{8,96}`（v1 连接可省略） |
| `text` | string | ✅ | 消息文本，服务端按 `maxTextLength` 截断；清洗后为空返回 `EMPTY_MESSAGE` |
| `replyTo` | string | ⬜ | 要回复的历史消息 ID（注意字段名不是 `replyToId`） |
| `mentions` | array | ⬜ | 提及的**用户 ID 字符串数组**（不是对象数组） |

`mentions` 只是候选人选：服务端会再次校验被提及者确实在当前频道 roster 中、且正文里出现了对应的 `@用户名`，否则该提及被丢弃。图片消息只有在带配文时才允许 `mentions`。

#### 图片消息

```json
{
  "type": "message",
  "kind": "image",
  "clientMessageId": "message-client-0002",
  "image": {
    "src": "data:image/png;base64,iVBORw0KGgo...",
    "width": 800,
    "height": 600
  },
  "text": "看这个",
  "mentions": ["u_1a2b3c4d5e6f7081"]
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `image.src` | string | ✅ | 严格的 base64 data URL，仅接受 `image/png`、`image/jpeg`、`image/gif`、`image/webp` |
| `image.width` | number | ✅ | 声明宽度，必须与文件头中的真实尺寸一致 |
| `image.height` | number | ✅ | 声明高度，必须与文件头中的真实尺寸一致 |
| `text` | string | ⬜ | 可选配文，清洗规则与文字消息相同；空字符串视为无配文，权威回显不带 `text` |
| `mentions` | array | ⬜ | 仅在配文非空时生效，校验规则与文字消息相同 |

服务端会重新计算字节数，因此 `image.bytes` 属于可选/被忽略字段；校验失败返回 `INVALID_IMAGE`。权威回显中的 `image` 形如 `{ src, mime, width, height, bytes }`。带配文时权威消息同时包含 `text` 与可选 `mentions`。

消息相关错误码：`CHANNEL_READ_ONLY`、`INVALID_MESSAGE_ID`、`INVALID_KIND`、`EMPTY_MESSAGE`、`INVALID_IMAGE`、`MESSAGE_ID_CONFLICT`、`RATE_LIMITED`、`ROOM_BUDGET_EXCEEDED`、`MESSAGE_TOO_LARGE`、`SYNC_IN_PROGRESS`。

### 4. `reaction` - 表情回应

```json
{
  "type": "reaction",
  "messageId": "m3_7c1d9a4b2e5f8031",
  "emoji": "👍",
  "active": true
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `type` | string | ✅ | 固定为 `"reaction"` |
| `messageId` | string | ✅ | 消息 ID |
| `emoji` | string | ✅ | 表情，只接受白名单中的 6 个 |
| `active` | boolean | ✅ | `true` 添加，`false` 撤销（按用户幂等） |

**支持的表情**（`REACTION_EMOJIS`，共 6 个）：👍 ❤️ 😂 🎉 👀 🔥

任一项不合法返回 `INVALID_REACTION`；目标消息已被淘汰返回 `MESSAGE_GONE`；超过`rateLimits.reactions`（默认 20 次 / 5 秒）返回 `REACTION_RATE_LIMITED`。

### 5. `typing` - 输入状态

```json
{
  "type": "typing",
  "active": true
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `type` | string | ✅ | 固定为 `"typing"` |
| `active` | boolean | ✅ | 真值调用激活、假值取消 |

服务端把状态广播给同频道其他成员，并在 `timeouts.typingTtlMs`（默认 4000 毫秒）后自动撤销。只读频道中该命令被直接忽略；超过 `rateLimits.typing`（默认 12 次 / 5 秒）时**静默丢弃**，不返回错误。

### 6. `leave` - 离开房间

```json
{
  "type": "leave"
}
```

主动离开不创建断线租约，立即广播 `presence / leave`，随后连接以 `1000 / left` 关闭。`leave` 是同步阶段唯一允许执行的命令。

---

## 服务端事件

服务端事件分为两组（`client/protocol.js`）：

- **同步阶段事件** `SYNC_EVENTS`：`stateStart`、`history`、`historyEnd`；
- **实时事件** `DEFERRED_EVENTS`：`presence`、`message`、`reaction`、`typing`、`channelOccupancy`、`playState`、`ack`、`error`、`moderation`。同步进行中到达的这些事件会被当前客户端暂存，收到 `historyEnd` 后再按序处理。`playState` 仅在当前频道绑定玩法时出现，信封见 [play.md](../play.md)。`moderation` 只发给当事席。

同步期间，除 `leave` 外的客户端命令一律返回 `SYNC_IN_PROGRESS`。

### 同步阶段事件

#### 1. `stateStart` - 开始同步

进入房间或切换频道时发送，标志同步开始。

```json
{
  "type": "stateStart",
  "protocolVersion": 4,
  "capabilities": ["ack", "historyChunks", "roomEpoch", "reconnect", "reactions", "typingLease", "mentions", "channelOccupancy", "historyPage"],
  "roomEpoch": "room-general_4efe0d43ef23052f",
  "roomStartedAt": 1700000000000,
  "latestSeq": 42,
  "resumeToken": "3f2a9c1b8d4e",
  "self": {
    "id": "u_1a2b3c4d5e6f7081",
    "username": "北岸的猫",
    "avatarSeed": 42,
    "joinedAt": 1700000000000,
    "ip": "192.168.1.100"
  },
  "users": [
    {
      "id": "u_9f8e7d6c5b4a3021",
      "username": "Alice",
      "avatarSeed": 10,
      "joinedAt": 1699999000000,
      "ip": "192.168.1.101"
    }
  ],
  "channelId": "general",
  "occupancy": { "general": 2, "project": 0 }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `protocolVersion` | number | 服务端协议版本，v4 |
| `capabilities` | array | 服务端能力列表，含 `channelOccupancy`、`historyPage`；当前频道绑了玩法时另有 `play` |
| `roomEpoch` | string | 当前频道的 epoch |
| `roomStartedAt` | number | 频道创建时间戳 |
| `latestSeq` | number | 快照时刻的频道序号 |
| `resumeToken` | string \| null | 当前 session 的恢复令牌 |
| `self` | object | 自己的公开用户对象 |
| `users` | array | 当前频道 roster |
| `channelId` | string | 当前频道 ID |
| `occupancy` | object | `{ "频道 ID": 在线人数 }` |

公开用户对象固定含 `id/username/avatarSeed/joinedAt`，只有 `room.exposeMemberIps` 为 `true`（默认）时才含 `ip`。

#### 2. `history` - 历史消息

历史消息分块发送；即使历史为空也会有一个空块。

```json
{
  "type": "history",
  "roomEpoch": "room-general_4efe0d43ef23052f",
  "messages": [
    {
      "id": "m1_9f2c7a1b4d5e6083",
      "seq": 1,
      "clientMessageId": "message-client-0001",
      "kind": "text",
      "author": {
        "id": "u_9f8e7d6c5b4a3021",
        "username": "Alice",
        "avatarSeed": 10,
        "joinedAt": 1699999000000,
        "ip": "192.168.1.101"
      },
      "createdAt": 1700000000000,
      "replyTo": null,
      "reactions": {},
      "text": "Hello!"
    }
  ]
}
```

权威消息对象（`history`、实时 `message`、回显共用）：

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 服务端消息 ID |
| `seq` | number | 频道内单调递增序号（可能有空洞，不可跨频道/跨 epoch 比较） |
| `clientMessageId` | string | 发送方的客户端消息 ID（v1 由服务端生成） |
| `kind` | string | `"text"` 或 `"image"` |
| `author` | object | 公开用户对象 |
| `createdAt` | number | 服务端接受时间戳 |
| `replyTo` | object \| null | `{ id, username, kind, text }`；原消息不存在或已淘汰时为 `null` |
| `reactions` | object | `{ "<emoji>": { count, userIds } }` |
| `text` | string | 文本消息必有；图片消息仅在带配文时存在 |
| `image` | object | 仅图片消息：`{ src, mime, width, height, bytes }` |
| `mentions` | array | 仅当有有效提及时存在：`[{ id, username }]` |

#### 3. `historyEnd` - 历史同步完成

```json
{
  "type": "historyEnd",
  "roomEpoch": "room-general_4efe0d43ef23052f",
  "latestSeq": 42
}
```

收到此事件后，客户端可以开始发送命令。

### 实时事件

#### 4. `message` - 新消息

权威消息回显，向频道内所有客户端（含发送者）广播。

```json
{
  "type": "message",
  "roomEpoch": "room-general_4efe0d43ef23052f",
  "message": {
    "id": "m100_4b8a1c2d3e5f6079",
    "seq": 100,
    "clientMessageId": "message-client-0003",
    "kind": "text",
    "author": {
      "id": "u_1a2b3c4d5e6f7081",
      "username": "Bob",
      "avatarSeed": 20,
      "joinedAt": 1700000100000,
      "ip": "192.168.1.102"
    },
    "createdAt": 1700001000000,
    "replyTo": null,
    "reactions": {},
    "text": "新消息"
  },
  "removedIds": []
}
```

`removedIds` 是本次写入触发的 FIFO 淘汰 ID 列表。

#### 5. `ack` - 消息确认

只发给命令发起者，不广播、不进历史。

```json
{
  "type": "ack",
  "clientMessageId": "message-client-0001",
  "messageId": "m100_4b8a1c2d3e5f6079",
  "seq": 100,
  "createdAt": 1700001000000
}
```

字段固定为 `ACK_FIELDS`：`clientMessageId`、`messageId`、`seq`、`createdAt`。同一去重键、同样内容的重复提交会重发原 ACK。

#### 6. `presence` - 成员变化

`join` / `reconnect` 携带完整用户对象，`leave` 携带 `userId` 与 `username`：

```json
{
  "type": "presence",
  "action": "join",
  "user": {
    "id": "u_5c6d7e8f9a0b1c2d",
    "username": "Charlie",
    "avatarSeed": 30,
    "joinedAt": 1700002000000,
    "ip": "192.168.1.103"
  },
  "users": [
    {
      "id": "u_5c6d7e8f9a0b1c2d",
      "username": "Charlie",
      "avatarSeed": 30,
      "joinedAt": 1700002000000,
      "ip": "192.168.1.103"
    }
  ]
}
```

```json
{
  "type": "presence",
  "action": "leave",
  "userId": "u_5c6d7e8f9a0b1c2d",
  "username": "Charlie",
  "users": []
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `action` | string | `"join"`、`"reconnect"`、`"leave"` |
| `user` | object | 完整用户对象，仅 `join` / `reconnect` |
| `userId` | string | 仅 `leave` |
| `username` | string | 仅 `leave` |
| `users` | array | 变化后的频道 roster |

#### 7. `reaction` - 表情回应更新

```json
{
  "type": "reaction",
  "roomEpoch": "room-general_4efe0d43ef23052f",
  "messageId": "m100_4b8a1c2d3e5f6079",
  "reactions": {
    "👍": { "count": 3, "userIds": ["u_1a2b3c4d5e6f7081", "u_9f8e7d6c5b4a3021", "u_5c6d7e8f9a0b1c2d"] }
  },
  "removedIds": []
}
```

#### 8. `channelOccupancy` - 频道在线人数

v4 专有，向所有已加入的 v4 客户端广播完整摘要；只含频道 ID 与人数（含有效断线租约），不含成员身份。

```json
{
  "type": "channelOccupancy",
  "occupancy": { "general": 2, "project": 1 }
}
```

#### 9. `typing` - 输入状态更新

```json
{
  "type": "typing",
  "userId": "u_9f8e7d6c5b4a3021",
  "username": "Alice",
  "active": true
}
```

临时提示、允许丢失、不进历史；服务端在 `typingTtlMs` 后自动补发 `active: false`。

#### 10. `prune` - 消息被淘汰

频道超出消息条数或字节预算时按 FIFO 淘汰；当回应导致目标消息自身被淘汰时单独发送。

```json
{
  "type": "prune",
  "roomEpoch": "room-general_4efe0d43ef23052f",
  "removedIds": ["m1_9f2c7a1b4d5e6083", "m2_1a0b2c3d4e5f6078"]
}
```

#### 11. `error` - 错误

只发给命令发起者，字段固定为 `ERROR_FIELDS`：`code`、`message`、可选 `clientMessageId`。

```json
{
  "type": "error",
  "code": "CHANNEL_FULL",
  "message": "这个频道已达到管理员设置的人数上限。"
}
```

带 `clientMessageId` 的命令（目前是 `message`）失败且该字段为字符串时，错误会原样回带该 ID，方便客户端定位 pending。错误文本不保证稳定，请根据 `code` 分支。

**真实错误码**（来自 `src/core/commands.js`、`src/transport/websocket.js`）：

| 代码 | 触发条件 |
|------|----------|
| `BAD_JSON` | 文本帧不是合法 JSON |
| `BAD_REQUEST` | 命令不是对象或缺少字符串 `type` |
| `NOT_JOINED` | 加入前发送了 `join` 以外的命令 |
| `SYNC_IN_PROGRESS` | 同步阶段发送了 `leave` 以外的命令 |
| `UNKNOWN_COMMAND` | 已加入但 `type` 未知，或 v2 及以下使用 `switchChannel` |
| `INVALID_NAME` | 用户名为空 |
| `NAME_TAKEN` | 同频道已有同名成员 |
| `SESSION_CONFLICT` | 恢复凭据与用户名或频道不匹配 |
| `CHANNEL_UNAVAILABLE` | 频道不存在、已停用，或默认频道不可用 |
| `CHANNEL_FULL` | 频道人数已达 `maxUsers` |
| `SERVER_FULL` | 全局人数已达 `server.maxUsers` |
| `CHANNEL_READ_ONLY` | 只读频道不能发消息 |
| `MUTED` | 这一席被值班台禁言，不能发消息 |
| `KICKED` | 这一席被请离（随后连接以 `4008 / kicked` 关闭） |
| `IP_DENIED` | 连接 IP 在黑名单中（随后以 `4009 / ip_denied` 关闭） |
| `INVALID_MESSAGE_ID` | `clientMessageId` 不是 `[A-Za-z0-9_-]{8,96}` |
| `INVALID_KIND` | `kind` 不是 `text` 或 `image` |
| `EMPTY_MESSAGE` | 文本清洗后为空 |
| `INVALID_IMAGE` | 图片格式、尺寸或大小不符合要求 |
| `MESSAGE_ID_CONFLICT` | 同一 `clientMessageId` 被用于不同内容 |
| `RATE_LIMITED` | 触发 `rateLimits.messages` 或切换频道的限流 |
| `ROOM_BUDGET_EXCEEDED` | 单条消息超出频道剩余字节预算 |
| `MESSAGE_TOO_LARGE` | 单条消息的 JSON 超过 `maxJsonBytes` |
| `REACTION_RATE_LIMITED` | 触发 `rateLimits.reactions` 限流 |
| `INVALID_REACTION` | `messageId`、`emoji` 或 `active` 不合法 |
| `MESSAGE_GONE` | 回应目标消息已被淘汰 |
| `PAYLOAD_TOO_LARGE` | 服务端要发送的负载超过 `maxJsonBytes`，回退为错误帧 |
| `PLAY_NOT_BOUND` | 当前频道没有绑定玩法时发送了 `playAction` |
| `PLAY_ACTION_REJECTED` | 玩法拒绝该动作（非法、非当前回合等） |

---

## 心跳机制

服务端每 `timeouts.heartbeatIntervalMs`（默认 30000 毫秒）发送一次 Ping 帧（opcode `0x9`），客户端自动回复 Pong。

如果 Pong 未在 `timeouts.heartbeatTimeoutMs`（默认 75000 毫秒）内到达，服务端以 **`1001 / heartbeat timeout`** 关闭连接。该超时在每个心跳周期检查一次，因此实际关闭时间可能比 75 秒晚一个周期。

浏览器会自动处理 Ping/Pong，开发者无需手动实现。

---

## 连接关闭

服务端发起的关闭都会带 code 与 reason：

| Close Code | Reason | 触发条件 |
|------------|--------|----------|
| `1000` | `left` | 收到 `leave` 命令 |
| `1000` | `reconnected` | 同一 session 被新的 join 接管 |
| `1000` | `bye` | 收到客户端的 Close 帧 |
| `1001` | `server stopped` | 服务正常停止 |
| `1001` | `heartbeat timeout` | 心跳超时 |
| `1002` | `protocol error` / `control frame too large` / `unexpected continuation` / `unsupported opcode` | 帧格式违规 |
| `1003` | `text only` | 收到二进制帧（协议只接受文本帧） |
| `1007` | `invalid utf-8` | 文本帧不是合法 UTF-8 |
| `1008` | `join timeout` | 未在 `joinMs` 内 join |
| `1008` | `sync timeout` / `sync overflow` | 初始同步超时或积压超过写缓冲 |
| `1008` | `too many frames` | 单次数据块内解析出超过 128 帧 |
| `1009` | `payload too large` | 超过 `maxJsonBytes` 或 `maxWsFrameBytes` |
| `4008` | `kicked` | 值班台结束了这一席 |
| `4009` | `ip_denied` | 连接 IP 在黑名单中 |

客户端应把下列关闭当作**不要自动重连**的终态，并清空恢复信息：

- **`1001` + reason `server stopped`**：权威停服
- **`4008` + reason `kicked`**：被请离，回到进亭页
- **`4009` + reason `ip_denied`**：这个网络不能进亭

其余断线按普通重连处理。请离前服务端会先发 `{ "type": "moderation", "action": "kicked" }`；禁言是 `{ "type": "moderation", "action": "muted" | "unmuted" }`，不关连接。其他人只看到普通 `presence / leave`，没有公开的踢人广播。

---

## 使用示例

### JavaScript 客户端

```javascript
const ws = new WebSocket('ws://localhost:4173/ws');

ws.onopen = () => {
  // 发送 join 命令
  ws.send(JSON.stringify({
    type: 'join',
    protocolVersion: 4,
    clientSessionId: makeClientSessionId(),
    username: '我的名字',
    channelId: 'general'
  }));
};

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);

  switch (data.type) {
    case 'stateStart':
      console.log('开始同步', data.channelId, data.latestSeq);
      break;

    case 'history':
      console.log('历史分块', data.messages.length);
      break;

    case 'historyEnd':
      console.log('同步完成', data.latestSeq);
      break;

    case 'message':
      console.log('新消息', data.message);
      break;

    case 'channelOccupancy':
      console.log('各频道人数', data.occupancy);
      break;

    case 'error':
      console.error('错误', data.code, data.message);
      break;
  }
};

ws.onerror = (error) => {
  console.error('WebSocket 错误', error);
};

ws.onclose = (event) => {
  console.log('连接关闭', event.code, event.reason);
};

// 发送文本消息：clientMessageId 只用 [A-Za-z0-9_-]
function sendMessage(text) {
  ws.send(JSON.stringify({
    type: 'message',
    kind: 'text',
    clientMessageId: `msg-${Date.now().toString(36)}-a1b2c3d4`,
    text: text
  }));
}

// 发送输入状态
function sendTyping(active) {
  ws.send(JSON.stringify({
    type: 'typing',
    active: active
  }));
}

// 复用 client/connection.js 的实现：clean 后截断为 96 字符
function makeClientSessionId() {
  const value = crypto.randomUUID?.() || `cs_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
  return value.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 96);
}
```

---

## 最佳实践

### 1. 幂等性

`clientMessageId` 必须匹配 `[A-Za-z0-9_-]{8,96}`。注意 `Math.random()` 产生的小数点不是合法字符：

```javascript
// ❌ 含小数点，服务端返回 INVALID_MESSAGE_ID
// const id = `msg_${Date.now()}_${Math.random()}`;

// ✅ 只使用字母、数字、下划线和连字符
const id = `msg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
```

同一去重键、同一内容重复提交只会返回原 ACK，不会产生第二条消息；内容不同则返回 `MESSAGE_ID_CONFLICT`。

### 2. 重连

`client/connection.js` 已实现带抖动的指数退避：

- 基数 `RECONNECT_BASE = 700` 毫秒，每次乘 2，上限 `RECONNECT_CAP = 30000` 毫秒；
- 实际延迟在基数的 ±25% 间随机；
- 连续 `MAX_RECONNECT_ATTEMPTS = 3` 次失败后停止并发出 `maxRetriesReached`，此时需要用户手动重试（`retry()`）；
- 重连成功后重发 `join`，`clientSessionId` 在同一页面加载周期内保持不变。

### 3. Resume Token

服务端在 `stateStart.resumeToken` 返回当前 token，客户端应保存它并在重连的 `join` 中带回来。Pavilo 自带客户端把它和用户名一起存在 `sessionStorage` 的 `pavilo.resume` 键下（当前频道存在 `pavilo.channel`）：

```javascript
ws.onmessage = (event) => {
  const data = JSON.parse(event.data);

  if (data.type === 'stateStart' && typeof data.resumeToken === 'string') {
    sessionStorage.setItem('pavilo.resume', JSON.stringify({
      token: data.resumeToken,
      username: data.self.username
    }));
  }
};

// 下次连接时使用
const saved = JSON.parse(sessionStorage.getItem('pavilo.resume') || 'null');
if (saved) {
  ws.send(JSON.stringify({
    type: 'join',
    protocolVersion: 4,
    clientSessionId: makeClientSessionId(),
    username: saved.username,
    channelId: sessionStorage.getItem('pavilo.channel') || 'general',
    resumeToken: saved.token
  }));
}
```

### 4. 错误处理

处理所有错误事件，并按 `code` 而不是文案分支：

```javascript
ws.onmessage = (event) => {
  const data = JSON.parse(event.data);

  if (data.type === 'error') {
    switch (data.code) {
      case 'CHANNEL_FULL':
        alert('频道已满');
        break;
      case 'RATE_LIMITED':
      case 'REACTION_RATE_LIMITED':
        alert('发送过快，请稍后再试');
        break;
      case 'SYNC_IN_PROGRESS':
        // 可重试：同步完成后重发
        break;
      default:
        alert(data.message);
    }
  }
};
```

---

## 协议版本

| 版本 | 状态 | 说明 |
|------|------|------|
| v4 | ✅ 唯一支持 | 增量同步、Room Epoch、频道占用摘要 |
| v1–v3 | 已移除 | v0.9.0 起不再接受；见下方迁移说明 |

`/room-info.deprecatedProtocols` 为 `[]`（字段保留，便于客户端探测）。

### 从旧协议迁移

v0.9.0 起 `join` 必须带 `protocolVersion: 4`。服务端对其他值的处理：

```json
{ "type": "error", "code": "PROTOCOL_NOT_SUPPORTED", "message": "Server requires protocol version 4" }
```

随后以 WebSocket `1002 / protocol not supported` 关闭。内置网页客户端会提示刷新。第三方客户端应：

1. 握手时发送 `protocolVersion: 4`
2. 读取 `/room-info.protocolVersion`（当前为 `4`）
3. 收到 `PROTOCOL_NOT_SUPPORTED` 时提示用户刷新或升级客户端，不要静默重连旧协议

**建议**：所有新客户端只实现 v4。

---

## 安全注意事项

1. **验证 Origin**：服务端会检查 WebSocket Origin（`server.allowNoOrigin` 默认 `true`，即允许不带 Origin 的非浏览器客户端；公网部署建议设为 `false` 并配置 `server.allowedOrigins`）
2. **HTTPS/WSS**：生产环境必须使用加密连接
3. **速率限制**：按 `rateLimits.windowMs`（默认 5000 毫秒）窗口计，消息 8 次、回应 20 次、输入状态 12 次（分别对应 `rateLimits.messages` / `reactions` / `typing`）；频道切换固定为 8 次 / 5000 毫秒
4. **输入验证**：服务端校验每条命令的字段与类型；客户端侧所有入站事件都要通过 `client/protocol.js` 的 `parseServerEvent` 结构校验，非法帧被丢弃

---

## 参考资源

- [完整协议规范](../architecture/chat-protocol.md)
- [HTTP API 文档](http-api.md)
- [配置指南](../configuration.md)
- [客户端实现](../../client/)