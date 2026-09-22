# AI 网关与管理页

> 状态：进程内网关和管理后台已随 v1.3.0 发布。Agent 宿主可以调用网关。视觉内容审核仍为规划，排在提交前文本规则之后，不在 v1.5。见 [路线图](../ROADMAP.md)。

它是 **语亭管理后台里的一个模块**，不是另一套登录。后台壳子见 [admin.md](admin.md)。聊天核心不依赖网关。

**模型渠道和 API key 只在「AI 网关」模块配置**，不写进 YAML，也不是聊天频道（`general` / `project`）。YAML 只负责怎么启动。

## 打开

```bash
cp pavilo.sqlite.example.yaml pavilo.yaml
mkdir -p data
TOKEN=$(openssl rand -hex 32)
# 写入 operator.token，或：
export PAVILO_OPERATOR_TOKEN="$TOKEN"
npm run config:check
npm start
```

浏览器打开 `http://localhost:4173/admin`，登录后进语亭总览；模型渠道在 `#/gateway/channels`。

`/admin` 只在 **sqlite 且 token 至少 16 字符** 时存在；否则与其它未知路径一样是 404。sqlite 但没填 token 时聊天仍可用，启动日志会提示：

```
SQLite 已启用，但未配置 operator.token，无法打开 /admin，也无法配置模型渠道。
生成口令：openssl rand -hex 32
```

memory 模式没有管理页，也没有网关渠道。

## 渠道存在哪里

全部在 SQLite 的 `gateway_channels` / `gateway_usage`。管理页保存后以数据库为准。YAML 里出现 `gateway:` 会被严格 schema 拒绝。

- 官方 preset：`deepseek`（自动 `https://api.deepseek.com/v1`，默认 `deepseek-chat`）。
- 自定义：`preset: openai-compatible`，填 `baseUrl` 与 `model`。
- 最多 8 条。这是模型供应商渠道，不是聊天频道。

## 密钥

- Operator token 推荐 `openssl rand -hex 32`。写在 YAML 或 `PAVILO_OPERATOR_TOKEN`。
- 管理页写入的 API key 是 AES-256-GCM 密文，由当前 token 经 HKDF 派生。只拷走 `.db` 读不出明文。
- **更换 operator.token 后必须在值班台重新填写渠道 key。**
- GET `/admin/api/channels` 只回 `keyPresent` 与末四位 hint。空字符串保存 = 保持原值。
- `/room-info`、`/healthz`、公开协议不含密钥。

## 给后续版本的调用口

```js
const result = await gateway.complete({
  channelId,      // 省略则使用第一条已启用渠道
  messages,
  model,
  maxTokens
});
```

`src/core` 不 import 网关；主分支的管理页探测和 Play/Agent runtime 已调用该接口。当前没有通用聊天 Bot 插件入口。未来可选视觉审核复用同一网关，不要求普通聊天依赖 AI。

网关 hang 或失败时，join / message / ACK 不受影响。

管理页 HTTP 见 [http-api.md](api/http-api.md)。Session 在进程内存，重启需重新登录。
