# 阶段一、二：模块边界

本次只结构化基础聊天，不引入构建工具、前端框架、数据库、新 WebSocket 库或新协议。配置默认值、v1/v2/v3 兼容、CSS 和页面 DOM 保持既有契约。详见 [聊天协议](chat-protocol.md)、[状态模型](state-model.md)。

## 客户端

`index.html` 保留页面结构、首屏恢复标记、资源引用与启动入口。`client/` 使用普通脚本；协议/连接/状态/pending/图片规则同时支持 CommonJS 导出，可直接由 Node 测试加载，不依赖 DOM。

| 模块 | 责任 |
|---|---|
| `protocol.js` | 命令/事件名称、字段约定和解析校验；不引入新的线上协议 |
| `connection.js` | WebSocket、join、恢复存储、退避重连、停服；通过订阅发出生命周期和 payload，不触碰 DOM |
| `state.js` | `createInitialState` / `reduce` / `createStore`；快照、频道、消息、typing、未读、pending 投影与连接状态 |
| `pending.js` | ACK 超时、accepted、失败、同 ID 对账、同 epoch 重试及草稿匹配；定时器可注入 |
| `images.js` | 可纯测的尺寸/质量/字节预算规则，以及可注入浏览器 API 的读取和 Canvas 处理 |
| `messages.js` | 权威与待确认消息显示、一次 payload 一次重建、DOM 修改前采样及阅读锚点恢复 |
| `composer.js` | 输入、IME、回复、typing、图片发送意图 |
| `overlays.js` | 成员资料、抽屉、popover、图片查看器和焦点管理 |
| `notifications.js` | toast、标题、favicon、系统通知；不修改权威消息数组 |
| `app.js` | 创建模块、绑定 DOM/用户意图与协议事件；跨模块副作用的组合点 |

`reduce(state, event)` 不做 IO。连接、时钟、当前阅读/聚焦条件作为明确输入；视图根据状态渲染。待确认项中的发送定时器属于 pending 管理器，不属于纯 reducer。

阅读位置不是 CSS 自动行为：修改 DOM 前采样，淘汰与追加合并处理，优先恢复消息锚点，锚点消失后按距底部距离回退。恢复期间临时禁用 smooth scroll，并保留 `overflow-anchor: none`。

## 服务端

`server.js` 加载配置、创建 core 和 transport，保留命令行启动与信号处理。导入模块不会监听端口或注册进程信号。

```js
const { createChatServer } = require('./server');
const app = createChatServer(options);
const address = await app.listen(0, '127.0.0.1');
app.state();
await app.stop();
```

兼容导出仍为 `createChatServer`、`DEFAULTS`、`PROTOCOL_VERSION`、`REACTION_EMOJIS`。工厂返回 `server/listen/stop/roomEpoch/localAddresses/config/state`，不要求现有调用者迁移。

### 领域内核 `src/core`

- `room.js`：每频道 epoch/开始时间、历史、序号、字节数、FIFO 淘汰、历史分块和统计。
- `session.js`：用户名规范化、恢复凭据、频道与全局容量、active/leased、昵称冲突、租约到期。
- `messages.js`：图片魔数/尺寸校验、消息公开字节、回复快照、指纹和去重窗口。
- `commands.js`：join/switchChannel/message/reaction/typing/leave 规则和限流。
- `events.js`：公开投影与私有路由 envelope。typing 标记为 transient；ACK/error 只发给对应连接。
- `index.js`：组合内核、逻辑 peer、命令 dispatch、同步完成、断线和关闭。时钟、ID 及定时调度可注入。

内核没有 HTTP request 或 socket。peer 是内核内部的逻辑身份；其 `session.client` 只是逻辑 peer 引用，不是网络连接。内部 Map 不向传输层暴露。

```js
const core = createChatCore(config, runtime);
core.connect('peer-1', '127.0.0.1');
const result = core.dispatch('peer-1', command);
// { accepted, effects, error? }
```

`effects` 保持发生顺序：

- `send`：指定 peer 的 payload；
- `broadcast`：频道事件及事件发生时的接收 peer ID 列表；
- `initial`：指定 peer 的完整初始同步序列；
- `close`：指定 peer 的关闭 code/reason。

路由 envelope 仅在进程内部使用，不能原样发到浏览器。ACK 必须先于 message；接管产生的 typing 等事件必须按**发生时**的接收者路由，不能在状态改变后重新枚举。

`core.completeSync(peerId)` 由传输层在初始快照和同期直播队列都完成后调用。在此之前，内核继续拒绝普通命令并保留 `clientMessageId`。租约/typing 到期产生的 effects 通过注入的 `onEffects` 送到传输层；测试可注入虚拟时钟而完全不启动网络。

### 传输层 `src/transport`

- `http.js`：静态资源、`/room-info`、`/healthz`、MIME、gzip/ETag 和路径边界。只读取 core 的公开元数据/统计，不了解内部 Map。
- `websocket.js`：upgrade、Origin、连接/每 IP 限制、写缓冲、初始同步队列、drain、心跳和生命周期。
- `protocol.js`：masked frame 校验、fragment、控制帧和 JSON 解码。只将命令交给 core，不裁决聊天业务。

`socket.write(false)` 表示已排队但背压，不能当发送失败重发。初始同步按 drain 推进；慢连接仍受原有字节和超时上限约束。

### 静态资源与配置隐私

`/client/` 不是目录挂载：只服务 `http.js` 显式列出的文件，GET/HEAD 共享 gzip、ETag 和 realpath 边界检查。未列出的客户端文件、`src/`、测试、配置与其余仓库源码仍为 404。

配置加载器保守保留整个 `client/` 和 `vendor/` 目录，拒绝其中配置文件及指向这些目录的符号链接，避免以后增加前端资源时暴露真实配置。YAML 版本、字段、默认值、加载优先级保持不变。

## 验证与后续范围

- `npm test`：现有配置/网络集成测试，加客户端纯模块、真实 core 输出到客户端解析器的契约测试、无网络领域测试。
- `npm run test:browser`：独立 Google Chrome/Playwright 双页面验收；Playwright 由仓库外安装提供，见 README。
- `npm run config:check` 与 `node --check`：配置和源码语法检查。

本次未把旧测试强制搬到新目录，避免改变默认发现规则。`test/browser/` 独立执行，不让默认 Node 测试隐式依赖浏览器。CI、Node 版本矩阵、Docker、真实移动输入法/局域网/代理和压力测试仍属于后续阶段；不以本次模块化声称它们已经完成。
