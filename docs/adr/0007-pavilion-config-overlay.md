# ADR-0007: 房间与聊天频道的管理页覆盖层

## Status

已接受（2026-09-20）

## Context

ADR-0004 把启动配置留给 YAML，把模型渠道留给 `/admin` + SQLite。房间标题、默认频道、聊天频道目录仍只能改 YAML 并重启。`docs/admin.md` 要求这类可视化编辑另开 ADR，禁止偷偷热加载 YAML。

部署者需要在值班台改基本语亭设置，同时：

- memory 模式保持 YAML-only，不强迫开 sqlite。
- 没在页面保存过的实例继续 100% 跟配置文件。
- 一旦在页面保存过某段，不能再出现「改了 yaml 却不生效」说不清。
- 不把监听地址、sqlite 路径、operator token 放进页面。

## Decision

房间与聊天频道采用**按段认领的 SQLite 覆盖层**。模型渠道规则不变。

### 谁拥有哪一段

| 段 | 默认真源 | 管理页保存之后 |
| --- | --- | --- |
| `version` / `server.host|port|origins` / `storage` / `operator.token` / `plays` | YAML | 仍是 YAML，页面不能改 |
| 房间：标题、语言、默认频道、暴露 IP/LAN、全站人数上限（`server.maxUsers`） | YAML | `operator_config.section='room'` |
| 聊天频道目录 | YAML `channels` | `operator_config.section='channels'` |
| IP 黑名单 | YAML `moderation.ipDenyList`（可空） | `operator_config.section='moderation'` |
| 模型渠道 | 非法出现在 YAML | `gateway_channels`（ADR-0004 / 0005） |

认领是整段，不是逐字段。保存房间只接管房间；保存聊天频道（含增删）接管整个目录。第一次保存写入当时的有效快照，不是空白覆盖。

不回写 YAML。取消认领的唯一方式是管理页「恢复为配置文件」（删除该段 overlay）。

YAML 在认领之后仍必须能通过严格校验。启动时若文件与 overlay 不一致，打印警告并忽略该段 YAML。

### 表

会话表 `channels`（epoch / seq / 消息）不是目录配置。覆盖层另表：

```sql
CREATE TABLE operator_config (
  section TEXT PRIMARY KEY CHECK (section IN ('room', 'channels', 'moderation')),
  payload TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
```

存在行 = 该段已认领。`payload` 为 JSON。

### 生效

保存后写入 SQLite，并在**当前进程**应用 overlay。这不是热加载 YAML。已打开的聊天页不新增 Protocol v4 事件；刷新或重新进亭后看到新的 `/room-info`。

删除聊天频道只从目录拿掉，不删会话消息。同一 id 再创建会复用 epoch。频道内仍有成员时禁止停用或删除。

### memory 模式

未开 sqlite：行为与今天相同。`/admin` 仍为 404。覆盖层不存在。

## Alternatives

- **保存后仍须重启**：实现更简单，但网关渠道已经立即生效，房间/频道若例外会让值班台像没写上。否决。
- **整份配置一次认领**：改一个标题就冻结全部 YAML 频道，过粗。否决。
- **逐字段 overlay**：默认频道与目录完整性校验会跨源，说不清。否决。
- **热加载 YAML**：改文件是否生效取决于 mtime，和「页面为真源」冲突。否决。

## Consequences

### 好的影响

- 没开管理页的人继续只维护一份 YAML。
- 「谁说了算」可以印在页面徽章、启动横幅和 `config:check` 上。
- 不扩大 Protocol v4。

### 坏的影响 / 权衡

- 认领后改 YAML 同段不生效，但坏 YAML 仍会启动失败。
- 全站人数上限在 YAML 里属于 `server.maxUsers`，在页面上放在房间段。
- 已打开的聊天页目录会过期，直到刷新。

### 未来工作

- 若要已打开标签页同步频道列表，另开协议事件，不在本期塞进 v4。
- 超时、字节限额、Origin、玩法模块启用列表仍留在 YAML。
