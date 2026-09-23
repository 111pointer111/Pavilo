# ADR-0010: 宿主身份与频道授权

## Status

已接受（2026-09-21）；已随 v1.4.0 发布。与 [ADR-0009](0009-feature-catalog.md) 一起构成 v1.4。产品阶段见 [路线图](../../ROADMAP.md)。凭证字段以本文为准；[集成设计](../integration.md) 里的嵌入 SDK 仍不是可调用教程。

## Context

当前只有临时 session：`resumeToken` 恢复连接，公开 `id` 与昵称。这够局域网聊天，不能把宿主账号的「是谁」和「能进哪些预建频道」交给 Pavilo。v1.5 嵌入需要同一套身份，但 v1.4 先立端口，不做 iframe / SDK。

约束：

- 不自建注册、密码、找回。
- 身份验证不强制 SQLite；Play 仍要 sqlite。
- operator token 不参与用户接入。
- 身份不放进 URL、不进 `/room-info`。
- Protocol v4 不升号；旧客户端不发凭证即访客。
- 不信任 JWT 头里的 `alg`（[RFC 8725](https://www.rfc-editor.org/rfc/rfc8725.html)）。

## Decision

### 四层身份

| 层 | 职责 |
| --- | --- |
| 稳定用户 `userKey` | 宿主 `sub`。服务端与值班台可见，不进公开 roster / 消息 |
| 会话 | 现有 resume token；恢复连接 |
| 连接 | WebSocket peer |
| Agent 席 | `kind: agent`；不验用户 JWT，不能用 JWT 冒充 |

昵称是显示名。访客没有 `userKey`。历史不按同昵称绑定到后来的宿主用户。幂等键仍是 `channelId + session.token + clientMessageId`。

### 配置：v1 与 v2 都允许 `identity`

未写 `identity` = 纯访客，与 v1.3 相同。不新增 Schema 版本。

```yaml
identity:
  guests: true
  audience: pavilo
  clockSkewSec: 60
  issuers:
    - id: app
      alg: HS256
      secret: ""
```

`PAVILO_IDENTITY_SECRET` 覆盖 issuer secret（单个 issuer 时）。禁止与 `operator.token` / `PAVILO_OPERATOR_TOKEN` 共用。密钥不进页面、日志、`/room-info`、healthz。

v1.4 只实现 **一个 issuer、配置钉死 `HS256`**。验签用配置里的 alg，忽略 token 头。`exp` 必填；TTL 建议不超过 15 分钟。拒绝 `alg: none`、未知 iss/aud、缺 sub。

Pavilo 持有 HMAC 密钥因而也能签发；浏览器不得持有。生产若不愿共享签发权，后续在同一 `issuers[]` 加 Ed25519 公钥，不改 join 形状。

值班台 v1.4 不做身份密钥 UI。YAML / env 为真源。人员页可只读显示席位是否有 `userKey`；禁言/请离仍针对这一席。稳定用户拒绝不在本 ADR，见 [ADR-0011](0011-governance-loop.md)。

### 凭证 claims

| 声明 | 规则 |
| --- | --- |
| `iss` | 等于配置的 issuer `id` |
| `aud` | 等于 `identity.audience` |
| `exp` / `iat` | `exp` 必填 |
| `sub` | 稳定用户主键，`[A-Za-z0-9._:-]{1,128}` |
| `name` | 可选；经现有 `cleanUsername`；缺省则截断 `sub` |
| `channels` | 预建频道 id 数组；空 = 无授权 |

### 进入：`join.identityToken`

Protocol v4 可选字段。独立 `/` 登录页保持用户名进亭；`guests: false` 时提示需要宿主应用，不在独立页做账号表单。

| 情况 | 结果 |
| --- | --- |
| 无 token，`guests: true`，频道 `access: open` | 访客（现有行为） |
| 无 token，`guests: false` | `IDENTITY_REQUIRED` |
| 坏 token / 过期 / 错 iss/aud | `IDENTITY_INVALID` 或 `IDENTITY_EXPIRED`，不回落访客 |
| 合法 token 但频道未授权 | `CHANNEL_FORBIDDEN` |
| operator token 当 JWT | `IDENTITY_INVALID` |
| resume 命中的 session 有 `userKey`，新 token `sub` 不同 | `SESSION_CONFLICT` |

每次需授权的命令都检查当前身份与频道授权，不只在 join。凭证过期后拒绝命令并以明确 close reason 断开，不降级成有权限访客。v1.4 续期 = 宿主再签 + 再 join，不加 `refreshIdentity` 命令。

切频道检查目标频道授权与 features。`/room-info` 过滤规则见 ADR-0009。

### Play

公开动作走同一套授权与 features。私密视图仍只给授权演员。有 `userKey` 时演员键用 `userKey`，否则 `session.id`。换 `sub` 不得沿用旧私密快照。身份开启后新开的对局才保证按用户恢复。

## Alternatives

- **独立页做宿主登录表单**：变成自建账号。否决。
- **JWT 放 URL / `/room-info`**：泄漏与缓存。否决。
- **v1.4 就做 iframe postMessage**：缺少能力目录也会漏权限。放到 v1.5，沿用本 ADR 的 JWT。
- **一开始就上 Ed25519 / JWKS**：示例与运维更重。否决为 v1.4 必做；结构预留 `issuers[]`。
- **幂等键改成 userKey**：把连接可靠性与账号绑死，多标签冲突。否决。
- **SQLite 用户表**：v1.4 无持久封禁需求；身份不强制 sqlite。否决。

## Consequences

### 好的影响

- 访客与宿主模式同一内核。
- 以后的嵌入只换传递通道，不换 claims。嵌入排在 v1.6。
- memory 也可启用身份。

### 坏的影响 / 权衡

- HMAC 使 Pavilo 能签发用户凭证，必须靠部署纪律隔离。
- 独立聊天页没有宿主登录 UX。
- 过期靠再 join，体验不如静默刷新。

### 未来工作

- Ed25519 issuer。
- 嵌入页用 postMessage 送同一 JWT（v1.6）。
- 稳定用户拒绝与治理记录已随 v1.5.0 发布，见 [ADR-0011](0011-governance-loop.md)。
- 可选 `refreshIdentity` 命令，若再 join 不够用再加。
