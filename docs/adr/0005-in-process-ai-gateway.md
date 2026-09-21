# ADR-0005: 进程内 AI 网关（preset、用量、非微服务）

## Status

已接受（2026-09-20）；网关在主分支已实现，尚未发布。

2026-09-21 补充：下文 v1.4/v1.5 是原阶段背景，现行顺序见 [ADR-0008](0008-embeddable-composable-chat.md) 与路线图。管理页探测和 Play/Agent runtime 已是调用方；“唯一产品调用方”的描述仅记录网关最初落地时的范围。进程内网关、服务端密钥和 core 不依赖厂商的决策继续有效。

## Context

v1.4 内容审核（视觉）和 v1.5 Play/Agent 都需要调模型。如果每个调用方自己握一把供应商 SDK 和 key，core 会被厂商 API 污染，故障域也会和聊天缠在一起。

产品约束：

- 不做独立网关微服务、不做负载均衡、不做模型市场。
- `src/core` 不 import fetch / 厂商 SDK。
- 默认关闭；未启用时不得发起上游 HTTP。
- 网关故障时普通聊天必须不受影响。
- 第一阶段官方渠道是 DeepSeek；其它 OpenAI 兼容端点用同一套调用层。

## Decision

### 进程内模块，不是聊天的一部分

```text
Play / Safety / 管理页 probe / 未来脚本
        ↓
src/gateway  (preset · timeout · retry · usage · 密钥解包)
        ↓
OpenAI-compatible HTTP
```

`server.js` 创建网关并注入到 operator HTTP。core 不知道网关存在。Protocol v4 不增加能力位。v1.3 **没有**聊天侧 Bot / `@mention` 自动回复；唯一产品调用方是管理页的连通性探测。`complete()` 作为给 v1.4/v1.5 的端口先冻结。

### 调用口

```js
const result = await gateway.complete({
  channelId,   // 省略则 YAML defaultChannel
  messages,    // OpenAI chat messages；content 可为 string（视觉以后再加 array）
  model,
  temperature,
  maxTokens,
  timeoutMs
});
// { ok: true, model, text, usage, latencyMs }
// { ok: false, code, message }
```

`complete()` 在边界返回结果对象，不把异常抛进聊天路径。可注入 `fetch` / `now` / store，便于测试。

### Preset，而不是新调用层

- **`deepseek`**：自动填充 `https://api.deepseek.com/v1`，默认模型 `deepseek-chat`。管理员只填 key。
- **`openai-compatible`**：自定义渠道，必须填 `baseUrl` 与 `model`（SiliconFlow、本地 vLLM、OpenAI 等都走这里）。

请求永远是：

```
POST {baseUrl}/chat/completions
Authorization: Bearer {apiKey}
{ model, messages, stream: false, ... }
```

不引入 OpenAI SDK。用 Node 22 的 `fetch`。v1.3 不做 stream。

### 超时、重试、并发

- 默认超时 30s；只对 429/502/503 最多重试 2 次。
- 进程内 in-flight 上限默认 4，超出排队，排到超时则 `GATEWAY_BUSY`。
- 连续失败只在 status / 管理页标 `degraded`，不自动禁用渠道。

### 用量

仅 sqlite：按 `(channel_id, UTC day)` 聚合 requests / tokens / errors。不受消息 `retentionDays` 删除。memory 模式用量为空操作。

### 故障隔离

网关未启用、未配置、超时、上游 4xx/5xx 都不得调用 `core.dispatch`，不得阻塞 WebSocket 心跳。这是发布门槛，用「fetch hang 时 message 仍 ACK」的集成测试钉死。

`/healthz` 在网关启用时可附加 `{ enabled, channels, degraded }`，**不含** key 与 baseUrl；网关故障不把 `/healthz` 改成非 200。

## Alternatives

- **独立微服务**：多一个进程、一份协议、一份部署文档，与「一条命令一间聊天室」冲突。
- **每个扩展自己 fetch**：key 与超时无法统一，审核和玩法会把厂商错误直接带进聊天。
- **v1.3 就做聊天 Bot**：会提前拖进身份、mention、限流和审核，打乱「先网关后审核后玩法」。
- **只支持 DeepSeek**：官方渠道仍是 DeepSeek；拒绝自定义渠道会把所有兼容端点推到下一个 minor，而调用层本就兼容。

## Consequences

### 好的影响

- core 保持无网络对象。
- 后续审核 / 玩法只依赖一个 `complete()`。
- 自定义渠道几乎零成本。

### 坏的影响 / 权衡

- 没有故障转移；一个渠道挂了就是挂了。
- 非 OpenAI 兼容的厂商要自己做代理，或以后加 preset。
- v1.3 对终端用户「看不见 AI」，部署者只在 `/admin` 看见。

### 未来工作

- v1.4 视觉：messages content 改为 OpenAI 的 array 形状，不改网关边界。
- v1.5 Play host 只通过网关调模型，不直连供应商。
