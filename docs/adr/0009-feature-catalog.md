# ADR-0009: 功能目录与有效能力

## Status

已接受（2026-09-21）；已随 v1.4.0 发布。产品阶段见 [路线图](../../ROADMAP.md)，工作清单见 [v1.4 设计](../v1.4-design.md)。

## Context

v1.3 频道功能全部常开，`readOnly` 是唯一服务端功能限制。`stateStart.capabilities` 只协商协议（ack、historyPage、play），不能表示「这个频道关了图片」。嵌入和宿主接入需要按频道关掉图片、历史等能力，且绕过 UI 仍被拒绝。

约束：

- 默认 memory 部署必须与 v1.3 行为一致。
- 未知 YAML 键拒绝；不为此开 Config Schema v3。
- Protocol v4 不升号；旧客户端忽略未知字段。
- 审核、嵌入 SDK、四类产品预设不在 v1.4。

## Decision

### 频道声明功能，服务端计算有效能力

省略的功能键视为 `true`。允许的键只有：`images`、`replies`、`reactions`、`mentions`、`typing`、`history`。另加 `access: open | authenticated`（省略 = `open`）。

`readOnly` 与 features 独立：只读仍禁止发言；只读频道可以再关回应或历史。

实例层不另写功能总开关。存储、网关、玩法仍用现有启用方式。

### 依赖在启动或值班台保存时失败

- `channels[].play` 仍要求 `plays` + sqlite（已有）。
- `access: authenticated` 要求已配置可用的 `identity.issuers`（ADR-0010），否则启动失败。
- `identity.guests: false` 必须配置可用的 `identity.issuers`。此时默认频道可以是 `authenticated`；不要求再留一个 `open` 频道。
- 关 `images` 不要求关掉其它模块。

值班台一旦认领聊天频道目录，`features` / `access` 随该段 overlay 走，不另开真源。来不及做页面编辑时，YAML 仍是合法来源，overlay JSON 必须能保存这些字段。

### 协议：`features` 对象 + 收敛后的 `capabilities` 数组

`stateStart` 增加 `features` 对象（上列六键的有效布尔值）。旧客户端忽略。

现有 `capabilities` 字符串数组仍表示协议是否提供该命令。频道关掉对应功能时，从数组去掉该项（例如无 `history` 则无 `historyPage`；无 `reactions` 则无 `reactions`）。不要把功能开关混进该数组当新约定。

`/room-info` 对未认证请求只列出 `access: open` 的频道（含 `enabled: false`，供界面显示停用项）。`authenticated` 频道对未认证请求不可见。全部为 `open` 时与 v1.3 一致。不返回密钥。

### 绕过 UI 的拒绝

| 关闭 | 行为 |
| --- | --- |
| `images` | `kind: image` → `FEATURE_DISABLED` |
| `replies` | 带 `replyTo` → `FEATURE_DISABLED` |
| `reactions` | `reaction` → `FEATURE_DISABLED` |
| `mentions` | 权威 `mentions` 字段 → `FEATURE_DISABLED`；正文随意写 `@` 不拦 |
| `typing` | 静默丢弃（与只读频道一致） |
| `history` | `historyPage` → `FEATURE_DISABLED`；join 快照历史为空块 |

人和 Agent 的公开消息走同一套检查。

## Alternatives

- **只藏 UI**：客户端可直接发图。否决。
- **新协议号 / Schema v3**：v1.x 兼容成本过高。否决。
- **实例级再写一份总开关**：与「不配网关即无关网关」重复。否决。
- **把开关塞进 `capabilities` 数组**：与协议协商混名。否决。

## Consequences

### 好的影响

- 旧配置零改动即全功能。
- 为以后的嵌入提供服务端能力面，不必再改命令形状。嵌入排在 v1.6，不在治理闭环里。

### 坏的影响 / 权衡

- 客户端必须同时看 `capabilities` 与 `features`。
- 出现 `authenticated` 频道后，`/room-info` 不再列出全部频道。

### 未来工作

- 审核开关等有实现再加字段。
- 四类预设是配置模板，不是第三套真源。
