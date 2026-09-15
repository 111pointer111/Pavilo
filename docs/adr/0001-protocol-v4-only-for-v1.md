# ADR-0001: v1.0 只承诺 Protocol v4

## Status

已接受（2026-09-15）

## Context

Pavilo 的 WebSocket 协议经历了四个 Alpha 版本的快速迭代：

- **v1**：单块 `state` 事件，ACK 可选，无频道切换
- **v2**：分块历史（`stateStart` → `history` → `historyEnd`），强制 `clientMessageId`
- **v3**：增加频道切换支持
- **v4**：增加 `channelOccupancy` 实时广播

当前服务端实现同时支持这四个版本，代码中有大量 `if (clientVersion < 2)` 的分支逻辑。

### 核心问题

**v1.0 是否应该长期承诺支持 v1-v4 的所有版本？**

这个决策会影响：
1. **测试复杂度**：每个新功能都要在四个协议版本上验证
2. **未来扩展**：v1.1 SQLite、v1.3 Extension 的协议变更需要同时维护四个分支
3. **安全审计**：攻击面是单协议的 4 倍
4. **第三方客户端**：如果承诺长期支持，就形成了公开 API 契约

### 产品约束

Pavilo 的核心定位是：
- **Ephemeral First**：默认无持久化，停服即清空
- **极简部署**：一条命令启动，不是企业级 24/7 服务
- **Alpha 阶段**：v0.x 的协议本质上是实验性的，不应该背负"永久向后兼容"的负担

与 Slack、Discord 等需要向 10 年前客户端负责的产品不同，Pavilo 的典型场景是：
- 小团队自托管
- 停服/升级时所有人刷新浏览器即可
- 没有"必须支持 2020 年的旧 Android 客户端"的需求

## Decision

**v1.0 正式只承诺 Protocol v4，删除 v1/v2/v3 的实现代码。**

### 实施路径

#### v0.2-v0.8（清理期）
- 在 `/room-info` 响应中增加 `deprecatedProtocols: [1, 2, 3]` 字段
- 在协议文档中明确标记 v1/v2/v3 为 deprecated
- 当 v1/v2/v3 客户端连接时，在 `stateStart` 中增加警告字段：
  ```json
  {
    "type": "stateStart",
    "protocolVersion": 4,
    "deprecationWarning": "Protocol v1-v3 will be removed in v1.0. Please upgrade to v4.",
    ...
  }
  ```

#### v0.9.0（冻结前清理）
- 删除 `src/core/` 和 `src/transport/` 中所有 v1/v2/v3 兼容代码
- 客户端尝试使用 `protocolVersion < 4` 时，直接返回错误并关闭连接：
  ```json
  {
    "type": "error",
    "code": "PROTOCOL_NOT_SUPPORTED",
    "message": "Server requires protocol version 4 or higher"
  }
  ```
- 更新所有测试，只覆盖 v4

#### v1.0.0（稳定承诺）
- 文档明确承诺："Protocol v4 is stable throughout the v1.x series"
- 第三方客户端可以安全地依赖 v4
- 未来协议变更（如果需要）将通过以下方式处理：
  - v1.x 内的兼容性扩展（增加可选字段）不改变版本号
  - 不兼容变更（删除字段、改变语义）需要进入 v2.0

## Alternatives

### 方案 A：长期支持 v1-v4

**理由：**
- 对第三方客户端更友好
- 热升级时旧浏览器标签页能继续工作

**为什么不选：**
- **维护成本过高**。每个新功能都要测试 4 个版本，未来 5 年你会后悔这个决定
- **限制未来扩展**。v1 的单块历史架构与 v1.1 SQLite 的分块加载冲突
- **不符合产品定位**。Pavilo 是 ephemeral-first 的轻量工具，不是需要向 10 年前客户端负责的企业产品
- **Alpha 阶段的快速迭代产物不应成为长期契约**

### 方案 B：每个 minor 版本可以破坏协议

**理由：**
- 最大灵活性，随时可以改协议

**为什么不选：**
- **第三方客户端无法信任 Pavilo**。如果 v1.2 可能破坏 v1.1 的协议，没人敢基于它开发
- **违反 SemVer 原则**。minor 版本应该向后兼容

### 方案 C：支持"最近 N 个版本"的滚动窗口

**理由：**
- 平衡灵活性和稳定性

**为什么不选：**
- **复杂度仍然高**。无论是 N=2 还是 N=3，你仍然要维护多个版本
- **给第三方开发者的承诺不清晰**。"我们支持最近 3 个版本"是不稳定的契约

## Consequences

### 好的影响

1. **代码库大幅简化**
   - 删除 `src/core/index.js` 中的版本分支逻辑
   - 删除 `src/transport/websocket.js` 中的协议降级处理
   - 测试只需覆盖一个协议版本

2. **未来扩展空间更大**
   - v1.1 SQLite 可以在协议中增加"历史游标"字段，不用考虑 v1 的单块兼容
   - v1.3 Extension 可以在消息中增加 "Bot 身份标记"，不用担心 v2 客户端解析失败

3. **安全审计成本降低**
   - 只需审计一个协议解析路径
   - 畸形输入的攻击面减少 75%

4. **文档更清晰**
   - 第三方开发者只需阅读 v4 的协议文档
   - "v1.0 支持哪些协议版本？" → "v4"

### 坏的影响 / 权衡

1. **热升级时旧标签页会断开**
   - 用户从 v0.9 升级到 v1.0 时，未刷新的浏览器标签页会收到 `PROTOCOL_NOT_SUPPORTED` 错误
   - **缓解措施**：客户端检测到此错误时，显示友好提示："服务器已升级，请刷新页面"
   - **产品判断**：对于 ephemeral-first 的 Pavilo，这是可接受的

2. **如果有人基于 v3 写了 Bot，会破坏它**
   - **缓解措施**：
     - v0.2-v0.8 给足够的警告期（预计 6-12 个月）
     - v1.0 之前 Pavilo 本身就是 Alpha，第三方不应该假设 API 稳定
     - v1.0 文档明确："第三方客户端应基于 v4 开发"

3. **无法支持"非常旧的第三方客户端"**
   - **产品判断**：如果某个客户端在 v1.0 后仍然坚持用 v3，它应该 fork Pavilo v0.9 的代码

### 未来工作

1. **v0.2 立即行动**
   - 在 `chat-protocol.md` 中标记 v1/v2/v3 为 deprecated
   - PR 描述中说明：这不会立即删除代码，只是明确未来方向

2. **v0.9 删除代码**
   - 提交信息格式：`BREAKING(protocol): remove v1/v2/v3 support, v4 only`
   - 更新所有测试

3. **v1.0 文档承诺**
   - 在 README 中增加 "Protocol Stability" 章节
   - 明确："Protocol v4 is stable in v1.x. Breaking changes require v2.0."

## 相关决策

- **如果未来需要 v5**（例如 v1.5 增加"私聊"功能，需要重新设计房间模型）：
  - v1.4 作为最后一个 v4-only 版本
  - v1.5 同时支持 v4 和 v5，给迁移期
  - v2.0 只支持 v5

- **第三方客户端的推荐做法**：
  - 在握手时检查 `stateStart.protocolVersion`
  - 如果服务端返回 `protocolVersion: 5`，而客户端只支持 v4，显示"需要升级"提示
