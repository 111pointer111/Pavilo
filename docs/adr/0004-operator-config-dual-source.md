# ADR-0004: Operator 配置双源（YAML 启动 + SQLite 管理页）

## Status

已接受（2026-09-20）

## Context

v1.3 要让部署者能配置模型渠道并查看用量。启动方式必须保持 Pavilo 一贯的 YAML，密钥又经常需要在页面里改，不能每次改 key 都重启、也不能让「改了 yaml 却不生效」说不清。

约束：

- 默认 ephemeral：没开 sqlite、没开网关时，启动成本与 v1.2 相同。
- 严格 schema：未知根键必须拒绝，所以新能力要有明确的 Config Schema 版本。
- 管理页不是账号系统，只有一个 operator token。
- 渠道 API key 比聊天记录更敏感。SQLite 文件可能被单独拷走；**库内不能存明文 key**。

## Amendment（2026-09-20）

渠道与 API key **不再**出现在 YAML / 环境变量里，只在 `/admin` 写入 SQLite。YAML 只保留 `operator.token`。sqlite 缺 token 时进程仍启动，但打印提示，且 `/admin` 为 404。

## Amendment（2026-09-20，schema 按部署家族）

Config Schema **不再为每个可选模块 bump 版本**。对外只保留：

| Schema | 部署 | 允许的根键 |
| --- | --- | --- |
| v1 | 内存 | 聊天核心。禁止 `storage` / `operator` / `plays` / `gateway` |
| v2 | SQLite 家族 | v1 + `storage` + `operator` + `plays`。`gateway:` 仍非法 |

`version: 3` 仅作 v2 的读入别名（未发版示例曾用过），文档不再教人写 3。`operator` 与 `plays` 出现在 memory 配置里会拒绝。旧的「只有 storage」的 v2 文件继续合法。

## Decision

### Config Schema

`operator` 写在 `version: 2`。`gateway:` 不是合法 YAML。v1 继续合法。不强迫只聊天的用户改 YAML。

### 谁拥有哪一类字段

YAML（及 `PAVILO_OPERATOR_TOKEN`）负责**怎么启动**：监听、聊天频道、是否 sqlite、管理页口令。

管理页负责**全部网关渠道**（preset、baseUrl、model、API key）。sqlite 是渠道真源。YAML 出现 `gateway:` 为配置错误。

`/admin` 在 sqlite 且 token ≥ 16 字符时打开。sqlite 缺 token 不阻止启动，只提示。

### 环境变量只覆盖口令

| 变量 | 作用 |
| --- | --- |
| `PAVILO_OPERATOR_TOKEN` | 覆盖 `operator.token` |

### Operator token

- 写在 YAML 或 `PAVILO_OPERATOR_TOKEN`。推荐 `openssl rand -hex 32`（64 个十六进制字符）。
- 这不是账号系统；进程内 session 用它校验登录。重启后管理页登录失效。

### SQLite 中的渠道密钥：AES-256-GCM，不是明文

管理页写入的 API key 存入 `gateway_channels.api_key` 时必须是密文：

- 算法：AES-256-GCM
- 密钥：HKDF-SHA256，IKM = 当前 `operator.token`，salt = `pavilo-gateway-v1`，info = `api-key`，输出 32 字节
- IV 12 字节随机；AAD = 渠道 `id`
- 库内格式：`v1.<iv>.<tag>.<ciphertext>`（base64url）

不把登录 token 直接当 AES key，也不另做 KMS。威胁模型：

- 拿到 YAML（或 env）的人本来就能调模型，解密能力与「读得到 token」同级。
- **只拿到 `.db` 文件的人读不出渠道 key。** 这是相对明文存储多出来的那一层。

更换 `operator.token` 后旧密文无法解开。启动或管理页读取失败时返回稳定错误码（如 `GATEWAY_KEY_UNWRAP_FAILED`），不写密文、不写明文；管理员必须在页面里重新填写 key。不在本期做 token 轮换自动重加密。

YAML / env 里的 key 仍以明文存在配置源（与今天把秘密放进 yaml 的模型相同），只有**写入 SQLite 的那份**加密。未开 sqlite 时不落库、不记用量，管理页只读。

### memory 模式

未开 sqlite：YAML/env 仍可调用模型；用量不记；管理页不可保存渠道。

## Alternatives

- **把 `gateway` 塞进 Schema v2**：sqlite 用户少一次改 version，但 v2 的语义会变成「storage 或网关」，严格校验也无法区分误粘贴。
- **用 operator.token 直接当 AES key**：token 一换，格式与派生参数都绑死，以后无法加 version。HKDF 成本可忽略。
- **独立 `operator.dataSecret`**：轮换登录 token 不会锁死 key，但部署者要管两份秘密。v1.3 只有一个 operator，先不增加。
- **密钥只掩码、库内明文**：拷走 db 等于拷走全部供应商 key。否决。

## Consequences

### 好的影响

- 旧配置继续能跑。
- 「谁说了算」可以写进文档和启动 warning。
- db 文件泄漏不会直接露出渠道 key。

### 坏的影响 / 权衡

- sqlite 用户要开网关需把 `version` 改为 3。
- 更换 operator token 需要重填渠道 key。
- YAML 里的引导 key 仍是明文；想避免这一点就只用 env + 管理页。

### 未来工作

- 若要轮换 token 而不重填 key，再引入独立 dataSecret，另开 ADR。
- 用量表与渠道表的具体 DDL 见实现与 ADR-0005。
