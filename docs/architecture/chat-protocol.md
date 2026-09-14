# 聊天协议基线

> 本文冻结阶段 0 的**当前行为**，作为客户端、服务端拆分时的兼容依据；它不是新协议设计。除非在独立变更中升级版本并补测试，迁移不得改变这里记录的命令、事件、默认值或失败语义。

## 1. 传输与版本

- 浏览器以 WebSocket 连接同源 `/ws`，客户端命令和服务端事件均为 UTF-8 JSON 文本对象。
- 当前服务端协议常量为 **v4**；`GET /room-info` 的 `protocolVersion` 也为 `4`。
- 新连接必须先发送 `join`；在 `timeouts.joinMs` 内未加入会以 WebSocket `1008 / join timeout` 关闭。加入前的其他命令返回 `NOT_JOINED`。
- 客户端声明的版本按数字读取；缺失或不能转成非零数字时按 v1 处理。当前实现没有单独的“版本不支持”错误，因此迁移不得擅自增加严格协商。

### 版本兼容范围

| 客户端版本 | 初始状态 | 消息 ID / ACK | 频道切换 |
|---|---|---|---|
| v1（缺省） | 单个 `state`；历史会从尾部截取到能放进一个 JSON payload | `message` 可省略 `clientMessageId`，服务端生成内部 ID；接受后仍可收到 ACK 和房间回显 | 不支持，`switchChannel` 返回 `UNKNOWN_COMMAND` |
| v2 | `stateStart` → 一个或多个 `history` → `historyEnd` | 要求合法 `clientMessageId`，支持 ACK 和幂等 | 不支持 |
| v3 | 与 v2 相同 | 与 v2 相同 | 支持 `switchChannel` |
| v4（当前浏览器） | 与 v3 相同，`stateStart` 附带所有频道的占用摘要 | 与 v3 相同 | 支持 `switchChannel`；实时接收 `channelOccupancy` |

v2/v3 的 `stateStart.protocolVersion` 是服务端当前版本 `4`；其 `capabilities` 当前为 `ack`、`historyChunks`、`roomEpoch`、`reconnect`、`reactions`、`typingLease`。v4 另外声明 `channelOccupancy`，并在 `stateStart` 附带占用摘要。这只是当前广告值，不应据此推断尚未实现的能力。

v4 的 `channelOccupancy` 事件会向所有已加入的 v4 客户端广播完整摘要；摘要只包含频道 ID 与在线人数，不包含成员身份。

## 2. 加入、身份与恢复

客户端首先发送：

```json
{
  "type": "join",
  "protocolVersion": 4,
  "clientSessionId": "每个页面加载周期的随机 ID",
  "resumeToken": "可选，先前由服务端签发",
  "username": "Alice",
  "avatarSeed": 123,
  "channelId": "general"
}
```

字段契约：

- `username` 去除控制字符、首尾空白并截为 24 个字符；为空返回 `INVALID_NAME`。同一频道内名称按 `toLocaleLowerCase()` 后唯一，活跃 session 和未过期 lease 都参与冲突检查。
- `channelId` 缺失或空字符串时使用默认频道；频道不存在或停用返回 `CHANNEL_UNAVAILABLE`。
- `clientSessionId` 是当前页面加载周期的恢复凭据。当前浏览器每次加载生成一个，短暂断线重连时复用；它不是公开用户 ID。
- `resumeToken` 是服务端返回的随机凭据，当前浏览器连同用户名存于 `sessionStorage`，用于刷新后恢复。若它格式合法，优先于 `clientSessionId`。
- 两种凭据都只接受 `[A-Za-z0-9_-]`、长度 8–96。已知凭据只有在用户名和频道均吻合时才恢复，否则返回 `SESSION_CONFLICT`；恢复会保留公开用户 `id`、`joinedAt` 和原 `avatarSeed`，并接管/关闭该 session 的旧连接。
- **未知或已过期的合法凭据不是错误**：在名称、全局容量和频道容量允许时，它可成为新 session 的 token。客户端不能仅凭 token 字符串判断是否真的恢复了旧身份。
- `avatarSeed` 只影响新 session：有限数值会取绝对整数并归一为无符号 32 位数，缺失时由服务端生成；恢复时沿用原值。
- 服务端在 `stateStart.resumeToken` 返回当前 token（v1 `state` 不返回）。token 不进入 roster、消息或 `/room-info`。

加入成功后，其他成员收到 `presence`：新身份为 `action: "join"`，恢复/接管为 `action: "reconnect"`。发起者从初始状态获得自己的权威身份与 roster。

## 3. Session lease 与人数上限

- 活跃连接在 `sessions` 中；非主动断线后，session 转入默认 **15 秒**的 lease。lease 保留用户身份、名称和频道归属，并继续出现在 roster 中。
- lease 期间不会立即广播离开；持有同一 token 且用户名、频道吻合的客户端可恢复。lease 到期才广播 `presence / leave` 并释放名额。
- `leave` 命令是主动离开：不创建 lease，连接关闭后立即广播离开。服务关闭也不创建 lease。
- 新身份必须同时满足全局 `server.maxUsers` 和目标频道 `channels[].maxUsers`。两个统计都包含活跃 session 与未过期 lease；恢复已有 session 不额外占名额。
- WebSocket 连接上限（默认总计 80、每 IP 12）独立于成员上限；尚未 join 的连接也占连接名额。

## 4. Epoch、序号与历史同步

每个配置频道在 `createChatServer` 时生成独立 `roomEpoch`，并维护独立的历史、`messageSequence` 和字节预算：

- 同一服务实例中切换、断线和无人在线不会改变频道 epoch。
- 新建服务实例（通常是进程重启）会为每个频道生成新 epoch，历史和序号从空、0 开始。
- `/room-info.roomEpoch` 目前只是**默认频道 epoch**的兼容字段；各频道的真实 epoch 以该频道初始状态和事件为准。
- `seq` 在频道内单调增加，但当前实现先分配序号再做部分容量检查，所以被拒绝的消息可能造成空洞；客户端不得要求连续序号，也不得跨频道或跨 epoch 比较。

v2/v3/v4 的同步顺序：

1. `stateStart`：包含 `roomEpoch`、`roomStartedAt`、快照 `latestSeq`、`resumeToken`、`self`、`users`、`channelId`；v4 还包含 `occupancy`，其形状为 `{ "频道 ID": 在线人数 }`，人数包含仍在有效断线租约期内的成员；
2. 一个或多个 `history`：每块包含相同 `roomEpoch` 和一段 `messages`，即使历史为空也会有一个空块；
3. `historyEnd`：包含相同 `roomEpoch` 和快照 `latestSeq`；
4. 快照期间发生的频道广播按到达顺序排在 `historyEnd` 后发送。

同步是一个不可交错的快照边界。同步期间，除 `leave` 外的客户端命令均返回可重试的 `SYNC_IN_PROGRESS`；若命令带 `clientMessageId`，错误会原样携带它。同步队列超出写缓冲或同步超时会关闭连接。当前浏览器在同步时暂存 `presence`、`message`、`reaction`、`typing`、`ack`、`error`，在 `historyEnd` 后处理。

客户端只应用当前 epoch 的 `history`/`historyEnd` 和带 epoch 的消息状态事件；epoch 改变时，旧 pending 消息不得自动重发，因为服务端去重表也属于旧房间生命周期。

## 5. 发送、ACK 与幂等

v2/v3/v4 发送文本或图片：

```json
{
  "type": "message",
  "clientMessageId": "message-client-0001",
  "kind": "text",
  "text": "hello",
  "replyTo": "可选的当前历史消息 ID"
}
```

接受路径：

1. 校验 ID、类型、内容和图片；
2. 以 `频道 ID + session token + clientMessageId` 查重；重复内容直接返回旧 ACK，不消耗消息限流名额；
3. 检查发送频率和容量，写入频道内存历史并按消息数/字节预算 FIFO 淘汰；
4. 只向发送者发送 `ack`；
5. 向频道内所有客户端（含发送者）广播权威 `message` 回显，附同批 `removedIds`。

ACK 形状为：

```json
{
  "type": "ack",
  "clientMessageId": "message-client-0001",
  "messageId": "服务端消息 ID",
  "seq": 1,
  "createdAt": 0
}
```

- 同一去重键、同一内容（类型、正文/图片 data URL、`replyTo` 的指纹相同）重复提交，不创建第二条消息，只重发原 ACK。
- 同一键改用不同内容返回 `MESSAGE_ID_CONFLICT`。
- 去重记录默认保留 10 分钟且最多 512 项；它不是永久存储。频道不同可复用同一 `clientMessageId`。
- ACK 表示服务端已接受，不替代权威房间回显。当前浏览器以 `clientMessageId` 对账 pending；ACK 到达后标为 accepted，收到回显后移除。8 秒未 ACK 标为未确认；同 epoch 重连完成后最多自动补发一次，依靠服务端去重避免重复。
- 带 `clientMessageId` 的消息校验/同步错误会回传该 ID，使客户端能精确标记对应 pending。不要把 error 文本当稳定机器接口，稳定分支依据是 `code`。

常见消息错误包括 `INVALID_MESSAGE_ID`、`INVALID_KIND`、`EMPTY_MESSAGE`、`INVALID_IMAGE`、`MESSAGE_ID_CONFLICT`、`RATE_LIMITED`、`ROOM_BUDGET_EXCEEDED`、`MESSAGE_TOO_LARGE` 和 `SYNC_IN_PROGRESS`。

回复不是指向可变对象：发送时若 `replyTo` 仍在当前频道历史中，服务端复制原消息的 `id`、作者名、类型和文字/“图片”预览；原消息已淘汰或 ID 无效则权威消息中的 `replyTo` 为 `null`。

## 6. 图片契约

客户端只选择 PNG、JPEG、GIF、WebP。服务端只接受严格的 base64 data URL，并同时校验：

- MIME（`image/jpg` 归一为 `image/jpeg`）与文件魔数；
- 解码字节数，默认不超过 **300,000 bytes**；
- 声明宽高均为正且各不超过默认 **1600**；
- 默认像素总数不超过 **4,000,000**；
- 从 PNG/GIF/JPEG/WebP 文件头读出的真实尺寸必须等于声明值；
- 单消息 JSON 上限与频道总字节预算。

浏览器的发送前处理也是既有行为：

- 解码后的原图像素先受 `maxImagePixels` 限制；
- GIF 为保留动画不经过 Canvas，仅检查原字节、尺寸和像素限制；
- 其他图片最长边降到 1600 以内；小且合规的 PNG 保留 PNG，否则编码 JPEG，并在质量 0.82 到 0.5 间尝试压到服务端预算；
- 图片异步处理期间若频道改变或连接失效，不发送处理结果；pending 图片另有页面内 4 MB 总预算。

这些客户端预处理不能替代服务端校验，迁移两端时也不能悄悄改变格式、默认预算或 GIF 动画语义。

## 7. 频道切换

v3 客户端发送 `{ "type": "switchChannel", "channelId": "…" }`。服务端在修改 session 前依次检查目标频道启用、切换限流、目标频道同名冲突和频道容量：

- 任一检查失败，返回 `CHANNEL_UNAVAILABLE`、`RATE_LIMITED`、`NAME_TAKEN` 或 `CHANNEL_FULL`，session、原频道 roster、历史与恢复关系均保持不变。
- 成功后才停止原频道 typing、改变 session 的 `channelId`，向原频道广播 leave，向切换者发送目标频道完整初始同步，再向目标频道其他成员广播 join。
- 切到当前频道不改变归属，只重新发送当前频道完整初始状态。
- 身份 `id`、`joinedAt`、`avatarSeed`、token 保持不变；恢复必须使用切换后的频道。
- 去重键含频道 ID，因此不同频道可安全复用消息 ID。

当前浏览器还会在本地阻止不安全切换：存在草稿、未完成 pending（accepted 除外）或正在处理图片时不发命令；失败时保持原频道 UI。服务端的原子性不能依赖这些 UI 检查。

## 8. 服务端事件及权威性

| 事件 | 语义 | 持久/可恢复性 |
|---|---|---|
| `stateStart` / `history` / `historyEnd`、v1 `state` | 当前频道权威快照 | 可通过重新同步恢复 |
| `message` | 已接受的权威消息及同批淘汰 ID | 消息留在内存历史期间可同步恢复 |
| `reaction` | 服务端按用户集合归并后的权威回应摘要，可能附淘汰 ID | 结果写入消息，留存期间可同步恢复 |
| `prune` | 权威 FIFO 淘汰 ID；当前由 reaction 导致目标消息自身被淘汰时单独发送 | 淘汰结果由下次快照体现 |
| `presence` | 当前频道权威 roster 投影及 join/reconnect/leave 提示 | roster 可重同步；提示不重放，lease 期间断线仍在 roster |
| `channelOccupancy` | v4 所有频道的在线人数摘要（包含有效 lease） | 可通过下一次 `stateStart` 恢复；不包含成员身份 |
| `typing` | 即时展示的租约提示，服务端默认 4 秒自动撤销 | **临时、允许丢失、不进历史**；客户端还以本地到期兜底 |
| `ack` / `error` | 仅发给命令发起者的结果 | 不广播、不进历史；重复消息可在去重窗口内重得 ACK |

WebSocket 本身没有应用层重放保证。`message`、`reaction`、`prune`、roster 是服务端权威事实，但单个实时事件仍可能因断线丢失；客户端通过下一次完整同步收敛，不能把 typing 或 presence 提示伪装成持久历史。

回应仅接受 `👍 ❤️ 😂 🎉 👀 🔥`，命令 `{ type: "reaction", messageId, emoji, active }` 是按用户幂等设/撤；目标已淘汰返回 `MESSAGE_GONE`。typing 命令 `{ type: "typing", active }` 受限流，超限时当前实现静默丢弃。

## 9. 停止、断线与重启

- `stop()` 停止心跳、清空 lease、所有频道历史/字节/序号、sessions 和去重表，再以 `1001 / server stopped` 关闭客户端并停止 HTTP 服务。
- 当前浏览器只把这个**精确 close code/reason** 识别为权威停服：停止自动重连，清空消息、成员、pending、未读和 `sessionStorage` 中恢复/频道信息，返回登录页并显示临时数据已清空。
- 普通网络断线会保留草稿和 pending，标记发送中的项目为未确认，并指数退避（带抖动，最高约 30 秒基数）重连。
- 异常进程退出可能来不及发送停服 reason。客户端会重连；新服务实例的 epoch 不同，旧 pending 被标为“房间已经重启”，不得自动提交。旧 token 在新实例中只是未知 token，不能证明旧身份或恢复旧历史。

## 10. HTTP 公开投影

`/room-info` 只公开：`protocolVersion`、默认频道兼容 `roomEpoch`、`localUrl`、可选 `lanUrls`、`roomTitle`、`defaultChannelId`、频道白名单字段、客户端所需 limits 和 `ephemeral: true`。频道公开字段固定为 `id/name/description/enabled/maxUsers`；limits 固定为 `maxTextLength/maxImageBytes/maxImageDimension/maxImagePixels/maxMessages`。

`publicUser` 固定含 `id/username/avatarSeed/joinedAt`，仅在 `room.exposeMemberIps` 为 true 时含 `ip`。恢复 token、内部名称键、连接和 lease 信息不得公开。
