# Pavilo 分阶段实施计划

> 目标：在不破坏“轻量、临时、自托管、浏览器即用”核心承诺的前提下，先完成项目结构化和基础聊天能力的工程化，再逐步完善部署、发布和可选扩展。狼人杀、Agent 及其他游戏玩法不进入近期实施范围，仅保留清晰的未来扩展边界。
>
> 本计划是实施路线，不代表一次性创建所有目录或一次性完成所有阶段。每个阶段都必须有可验证的完成标准，并在前一阶段稳定后再进入下一阶段。

---

## 1. 总体战略

### 1.1 当前唯一主线

近期只围绕一件事：

> **把 Pavilo 的基础聊天功能变成一个容易理解、容易修改、容易测试、容易部署的稳定内核。**

当前已经具备的能力应视为需要保护的产品契约，而不是重写素材：

- 临时内存聊天；
- 多频道及频道隔离；
- 服务端权威消息；
- ACK 与客户端消息 ID 幂等；
- 历史分块同步；
- 刷新和短暂断线恢复；
- 房间 epoch；
- 断线 session lease；
- 消息、图片、连接和慢连接限制；
- 输入状态、回应、回复和图片查看器；
- YAML 严格校验和配置检查；
- 自托管前端资源。

这些能力的现有行为必须先被测试固定，再进行模块迁移。不得以“结构优化”为理由同时改变协议、配置语义、默认值和 UI 行为。

### 1.2 近期明确不做

以下内容在本计划的基础聊天阶段不实施：

- Agent；
- Claude 或其他模型 Provider；
- 狼人杀及其他游戏；
- SQLite 或其他持久化存储；
- 账号体系；
- 复杂权限系统；
- 多实例和分布式部署；
- 微服务、Redis、Kubernetes；
- 动态插件市场；
- 一次性 React/Vue 全量重写；
- 一次性全量 TypeScript 迁移。

未来扩展只允许建立在稳定的核心命令、事件和能力边界之上，而不是反向侵入聊天内核。

---

## 2. 目标结构

最终建议采用“领域内核、传输层、客户端模块、可选能力”四层结构。它是逐步演进的目标，不要求第一阶段全部落地。

```text
pavilo/
├── src/
│   ├── core/                    # 基础聊天领域，不依赖 HTTP、WebSocket 或 DOM
│   │   ├── room.js              # 频道、房间 epoch、历史、序号、容量
│   │   ├── session.js           # 会话、恢复、租约、昵称、接管
│   │   ├── messages.js          # 消息、回复、回应、幂等、图片元数据
│   │   ├── commands.js          # 命令校验与领域操作
│   │   ├── events.js            # 服务端权威事件形状
│   │   └── index.js             # 内核组合和公开接口
│   ├── transport/
│   │   ├── http.js              # 静态资源、room-info、healthz
│   │   ├── websocket.js         # upgrade、帧、心跳、连接、背压
│   │   └── protocol.js          # 帧解析、协议版本和消息编解码
│   ├── capabilities/
│   │   └── registry.js          # 仅预留，不在近期接入 Agent 或游戏
│   └── adapters/
│       └── memory-store.js      # 当前内存实现；不是数据库抽象平台
├── client/
│   ├── connection.js            # WebSocket、重连、恢复和房间 epoch
│   ├── state.js                 # 状态归约、待确认队列、频道状态
│   ├── messages.js              # 消息模型、列表渲染、阅读位置
│   ├── composer.js              # 输入、IME、图片准备和发送
│   └── overlays.js              # 成员、抽屉、图片查看器和通知
├── index.html                   # 页面骨架和入口
├── chat.css                     # 页面样式
├── server.js                    # 兼容启动入口，最终只负责组合和启动
├── config.js                    # YAML 解析、归一化、校验和加载
└── test/
    ├── unit/                    # 纯领域和客户端协议测试
    ├── integration/             # HTTP/WebSocket 集成测试
    └── browser/                 # 浏览器端到端测试
```

### 2.1 结构边界

#### `src/core`

只处理聊天事实和领域规则：

- 当前有哪些频道；
- 哪些 session 在频道中；
- 谁可以恢复或切换；
- 消息能否提交；
- 消息是否重复；
- 容量是否足够；
- 哪些权威事件已经发生。

核心模块不得：

- 读取 HTTP request；
- 操作 WebSocket socket；
- 读写 DOM；
- 直接访问环境变量；
- 直接调用外部服务。

#### `src/transport`

只负责把外部输入送入内核，把内核事件发送给连接：

- HTTP 路由；
- 静态文件白名单；
- WebSocket upgrade；
- WebSocket 帧解析；
- 心跳和连接关闭；
- 写缓冲和慢连接；
- 协议版本协商。

传输层不得自行修改房间、成员或消息状态。

#### `client`

浏览器端分为连接、状态和视图三类责任：

- 连接模块接收协议消息；
- 状态模块将消息归约为客户端状态；
- 视图模块根据状态渲染 DOM；
- composer 负责用户输入和图片准备；
- overlays 负责独立弹层和焦点管理。

近期不引入前端状态管理框架。先使用明确的状态对象、事件归约函数和订阅机制，等真实复杂度证明需要框架后再评估。

#### `capabilities`

只保留接口方向，不提前开发通用插件系统。未来能力必须通过受限事件订阅和命令提交接口接入，不能直接取得核心内部 Map、socket、恢复令牌或完整未过滤状态。

---

## 3. 阶段总览

| 阶段 | 名称 | 核心目标 | 结果 |
|---|---|---|---|
| 0 | 基线冻结 | 固定现有行为和迁移规则 | 有清晰的不可破坏契约 |
| 1 | 客户端结构化 | 拆出连接、状态、消息和 UI 模块 | 前端不再由 `index.html` 大闭包承载全部业务 |
| 2 | 服务端结构化 | 拆出 core 与 transport | `server.js` 回归为组合入口 |
| 3 | 协议与测试工程化 | 建立协议文档、测试分层和浏览器验证 | 改动可以被自动验证 |
| 4 | 部署产品化 | Docker、CI、文档和版本交付 | 陌生用户可以稳定部署 |
| 5 | 基础聊天稳定版 | 性能、兼容性、安全边界和发布 | 基础聊天达到 v1 候选状态 |
| 6 | 未来扩展准备 | 只定义能力和 Agent 预留接口 | 不实现游戏，只验证核心边界足够清晰 |

阶段 1 和阶段 2 是近期最高优先级，但阶段 0 必须先完成。阶段 3 不能被推迟到结构重构完成之后，因为测试本身就是重构的安全绳。阶段 4 可以与阶段 3 后半段并行，但 Docker 和发布不能早于核心启动行为稳定。

---

# 阶段 0：基线冻结

## 目标

把当前实现从“作者知道怎么用”变成“仓库明确记录了应该怎样工作”。

## 任务

### 0.1 建立行为契约清单

新增或完善协议/行为文档，至少记录：

- join 流程和协议版本；
- `clientSessionId`、resume token、avatar seed 的语义；
- session lease 如何占用名额；
- room epoch 的产生和失效条件；
- 历史同步的开始、分块和结束；
- ACK、`clientMessageId` 和重复消息处理；
- 频道切换失败时必须保留原频道；
- 图片数据限制和客户端预处理；
- typing、reaction、prune 等事件是否权威、是否允许丢失；
- 服务停止后的客户端行为；
- 旧协议版本的兼容范围。

建议文档位置：

```text
docs/architecture/chat-protocol.md
docs/architecture/state-model.md
```

### 0.2 建立迁移规则

每次结构迁移必须满足：

1. 对外命令和事件不变；
2. YAML 路径、优先级和字段含义不变；
3. `npm start` 继续可用；
4. `createChatServer` 继续可导出或通过兼容入口使用；
5. 每次移动一个责任边界，不同时改多个领域行为；
6. 迁移后立即运行对应测试。

### 0.3 清理基线不一致

在进入结构迁移前确认并处理：

- `config.js` 默认频道和 `test/config.test.js` 的预期是否一致；
- `ROADMAP.md` 中前端行数等描述是否准确；
- `vendor/emoji-picker` 的 README、LICENSE 和实际上游许可证是否一致；
- 当前 Node.js 支持版本是否需要从“最低版本”升级为测试矩阵；
- 是否存在不应提交的 `.DS_Store` 等仓库噪声。

## 完成标准

- 有协议和状态契约文档；
- 基线测试在干净工作区可重复运行；
- 所有默认配置和测试预期已经解释清楚；
- 后续贡献者可以据此判断“改动是否破坏行为”。

## 不做

- 不修改协议版本；
- 不更换 WebSocket 库；
- 不改默认配置，只为让测试通过；
- 不在这一阶段拆文件。

---

# 阶段 1：客户端结构化（最高优先级）

## 目标

在不改变视觉和交互行为的前提下，把 `index.html` 中的浏览器业务从单一大闭包拆为可测试模块。

当前前端的关键复杂度不在 HTML 标签，而在连接、恢复、ACK、待确认队列、频道同步、消息重建、图片处理和滚动位置之间的时序关系。因此必须先拆“状态和协议”，再拆“视觉组件”。

## 任务顺序

### 1.1 抽取协议常量和类型约定

先建立客户端内部使用的协议定义：

```text
client/protocol.js
```

包含：

- 协议版本；
- 客户端命令名称；
- 服务端事件名称；
- ACK 和 error 字段；
- epoch、频道 ID 和消息 ID 的基本校验；
- 历史同步事件字段。

如果暂时不迁移 TypeScript，不要用重复的接口文件制造两套事实来源。JavaScript 中先使用常量、断言函数和文档注释。

### 1.2 抽取连接模块

```text
client/connection.js
```

只负责：

- 创建 WebSocket；
- 发送 join；
- 保存并恢复 session 信息；
- 指数退避和重连；
- 处理服务停止与房间 epoch；
- 将原始协议消息转成客户端事件；
- 暴露 `connect`、`send`、`close`、`retry` 等最小接口。

连接模块不能直接调用消息 DOM 函数，也不能直接操作 toast、标题或图片查看器。

### 1.3 抽取客户端状态归约

```text
client/state.js
```

将当前分散在事件处理器中的状态集中管理：

```text
connection
room
self
channel
channels
users
messages
pending
sync
unread
typing
```

建议采用：

```text
state + reduce(state, event) -> nextState
```

不要求一开始使用第三方状态库。关键是让状态变更有明确入口，并能在 Node 测试环境中运行。

归约器必须覆盖：

- stateStart/history/historyEnd；
- presence；
- message；
- reaction；
- prune；
- typing；
- ack；
- error；
- room epoch 改变；
- 重连和恢复；
- 服务停止。

### 1.4 抽取待确认消息管理

```text
client/pending.js
```

集中处理：

- 发送中；
- 已被服务端接收；
- 未确认；
- 失败；
- 重试；
- 同一 `clientMessageId` 对账；
- 当前 epoch 是否仍然允许自动重试；
- 草稿是否仍等于原发送文本。

这部分是基础聊天可靠性的核心，不应继续隐藏在页面事件处理器里。

### 1.5 抽取消息列表和阅读位置

```text
client/messages.js
```

保留当前已验证的阅读位置原则：

- 在 DOM 修改前采样；
- 一个 payload 只进行一次状态变更和一次重建；
- 淘汰和追加合并处理；
- 锚点消息优先，锚点不存在时使用距底部距离；
- 临时关闭 smooth scroll；
- 禁止浏览器原生 `overflow-anchor` 与自定义恢复逻辑叠加。

消息模块只接收状态和渲染上下文，不直接读取 WebSocket。

### 1.6 抽取 composer 和图片处理

```text
client/composer.js
client/images.js
```

分别负责：

- 文本输入；
- IME composition；
- 回复目标；
- typing；
- 图片读取；
- Canvas 降采样；
- GIF 保留；
- 图片尺寸和字节预算；
- 发送前取消。

图片预处理必须先有纯函数测试，再从页面中移动。

### 1.7 抽取 overlays 和通知

```text
client/overlays.js
client/notifications.js
```

包括：

- 成员列表；
- 移动端成员抽屉；
- 图片查看器；
- toast；
- 页面标题未读；
- favicon 徽标；
- 浏览器通知；
- 焦点环绕和恢复。

这些模块只能订阅状态或接受显式数据，不应修改核心消息数组。

### 1.8 保留 HTML 作为页面入口

阶段 1 完成后，`index.html` 只保留：

- 页面结构；
- 资源引用；
- 应用启动入口；
- 必要的静态模板。

可以先使用多个普通 JavaScript 文件通过 `<script>` 引入，不必立即引入 bundler。之后若模块数量和浏览器兼容要求确实需要，再启用原生 ES module 或轻量构建。

## 客户端阶段验收

- 加入、刷新恢复、短暂断线恢复行为不变；
- ACK、失败和重试行为不变；
- 切频道失败保留原频道；
- 同步中发送仍返回可重试错误；
- 收到淘汰和追加事件时阅读位置不漂移；
- IME、移动端抽屉、图片查看器、键盘操作和焦点行为不变；
- 客户端协议层和状态归约可以脱离浏览器运行测试；
- `index.html` 不再包含连接状态机和全部事件分发逻辑。

## 客户端阶段不做

- 不改变 UI 视觉设计；
- 不引入 React；
- 不重写 CSS；
- 不新增 Markdown；
- 不改变消息协议；
- 不引入前端状态管理依赖；
- 不做虚拟列表，除非压力测试证明全量重建已经成为实际瓶颈。

---

# 阶段 2：服务端结构化

## 目标

把 `server.js` 中的领域状态和 WebSocket/HTTP 传输分离，使基础聊天内核可以在不启动网络服务的情况下测试。

## 任务顺序

### 2.1 先抽纯工具和无状态函数

优先抽取低风险函数：

- 消息公开投影；
- 频道公开投影；
- 图片解析和魔数校验；
- 消息指纹；
- 历史分块；
- 容量淘汰；
- 请求限流；
- roster 生成；
- 资源路径安全检查。

每次抽取都保持参数和返回值明确，不把闭包中的所有变量重新包装成一个“万能 context”。

### 2.2 抽取 `room` 和 `session`

建议先建立：

```text
src/core/room.js
src/core/session.js
```

`room.js` 负责：

- 频道配置；
- epoch；
- 消息历史；
- 消息序号；
- room bytes；
- FIFO 淘汰；
- 频道状态快照。

`session.js` 负责：

- 会话 ID；
- 恢复 token；
- 用户名；
- 频道归属；
- active/leased；
- lease 到期；
- 接管旧连接；
- 昵称冲突。

### 2.3 抽取命令处理

```text
src/core/commands.js
```

将 join、switchChannel、message、reaction、typing、leave 的规则拆出来。

命令处理应该返回领域结果，例如：

```text
{
  accepted: true,
  events: [...],
  ack: {...}
}
```

或者：

```text
{
  accepted: false,
  error: {...}
}
```

核心层不要直接向 socket 写数据。广播由 transport 根据领域事件完成。

### 2.4 抽取事件构造

```text
src/core/events.js
```

区分：

- 权威聊天事件；
- 仅用于即时展示的临时事件；
- 仅发给发送者的 ACK/error；
- 仅发给特定频道的事件；
- 未来能力可以订阅的内部事件。

事件应带有明确的频道和 epoch 语义。未来增加游戏时，游戏实例 ID 和状态版本不能借用聊天消息序号。

### 2.5 抽取 HTTP 和 WebSocket transport

```text
src/transport/http.js
src/transport/websocket.js
src/transport/protocol.js
```

HTTP 保留：

- 静态文件白名单；
- realpath 边界检查；
- `/room-info` 公开投影；
- `/healthz`；
- gzip/ETag。

WebSocket 保留：

- upgrade；
- 帧解析；
- masked frame 检查；
- fragment；
- ping/pong；
- 写缓冲；
- 连接和 shutdown。

暂不因为“结构更好”而替换当前自实现协议。是否采用 `ws` 应在独立技术评估中决定：它可以降低传输层维护成本，但不会替代 Pavilo 的 ACK、业务幂等、恢复、房间路由、权限或背压。

### 2.6 让 `server.js` 回归组合入口

最终 `server.js` 只做：

1. 加载配置；
2. 创建 core；
3. 创建 HTTP/WS transport；
4. 注册生命周期；
5. 监听端口；
6. 导出兼容的 `createChatServer`、`listen`、`stop` 和测试状态接口。

## 服务端阶段验收

- core 可以在无网络环境下测试；
- HTTP 测试不需要知道房间内部 Map；
- WebSocket transport 不直接裁决聊天业务；
- 频道切换、恢复、租约和淘汰行为与基线一致；
- `/room-info` 仍只返回白名单字段；
- YAML 文件和源码仍不会被静态服务；
- SIGINT/SIGTERM、心跳和慢连接行为不变；
- `server.js` 不再是所有领域逻辑的唯一承载文件。

---

# 阶段 3：协议和测试工程化

## 目标

让基础聊天的可靠性不依赖人工记忆，而是由分层测试和可重复验证保护。

## 3.1 测试分层

### 单元测试

针对无副作用函数和领域模型：

- 频道容量淘汰；
- 消息序号和 epoch；
- session lease；
- 昵称冲突；
- 幂等去重；
- 图片校验；
- 配置归一化；
- 客户端状态归约；
- pending 消息状态机；
- 图片降采样规则。

### 集成测试

针对 HTTP、WebSocket 和 core 组合：

- join；
- history 分块；
- ACK；
- 重复消息；
- switchChannel；
- Origin；
- heartbeat；
- graceful shutdown；
- 静态白名单；
- gzip 和 ETag；
- 连接与容量限制。

### 浏览器 E2E

使用真实 Chrome/Playwright，至少覆盖：

- 双页面加入；
- 多频道隔离；
- 切换频道；
- 切换失败保留原频道；
- 刷新恢复；
- 短暂断线恢复；
- 房间重启后回到登录；
- 消息 ACK 和失败重试；
- 图片发送；
- 正在查看历史时收到新消息；
- 移动布局和成员抽屉；
- 图片查看器和键盘操作。

### 压力测试

后置加入，避免过早优化：

- 64 名成员；
- 80 个连接；
- 大 roster；
- 300 条历史；
- 图片连续淘汰；
- 慢连接；
- 频道长期活跃；
- 重连风暴；
- 高频 typing/reaction。

## 3.2 测试环境规则

- 默认单元和集成测试不访问外网；
- 浏览器测试使用仓库内资源；
- provider、Agent 和游戏未来都使用 mock；
- 不把本机用户名、IP、端口写进快照；
- 启动临时服务时使用仓库外临时配置；
- 测试结束后按 PID 停止服务，不使用宽泛进程杀死命令。

## 3.3 验收指标

初始指标建议是“无关键行为回归”，而不是盲目追求覆盖率数字：

- 所有现有测试通过；
- 核心协议路径均有至少一个成功和失败用例；
- 浏览器核心链路可重复运行；
- 重要 bug 必须先增加回归测试再修复；
- 慢连接和容量测试不会出现未处理异常；
- CI 失败能定位到具体阶段。

---

# 阶段 4：部署与开源项目化

## 目标

把结构稳定的基础聊天发布成陌生用户可以使用的开源产品。

## 4.1 CI

新增最小 CI 流程，执行：

```bash
npm ci
npm run config:check
npm test
node --check config.js
node --check server.js
```

后续增加：

- Node 22 和当前稳定版本矩阵；
- 浏览器 E2E；
- Docker 构建；
- 镜像启动检查；
- 依赖和许可证检查。

## 4.2 Docker

第一版只提供单容器，不引入数据库、Redis 或代理集群。

要求：

- 使用 `package-lock.json`；
- 运行时不执行 `npm install`；
- 支持 amd64/arm64；
- 非 root 运行；
- 默认不挂载聊天数据卷；
- 配置文件支持只读挂载；
- 正确接收 SIGTERM；
- 镜像版本可追踪；
- 文档说明 LAN 地址不能直接从容器内部推断；
- 提供最小 `compose.yaml`。

Dockerfile 和 Compose 应在基础聊天结构稳定后加入，避免容器包装一个仍在频繁迁移的入口。

## 4.3 文档

建议逐步补齐：

```text
docs/deployment/quick-start.md
docs/deployment/lan.md
docs/deployment/docker.md
docs/deployment/reverse-proxy.md
docs/architecture/overview.md
docs/architecture/chat-protocol.md
docs/architecture/state-model.md
CONTRIBUTING.md
SECURITY.md
CODE_OF_CONDUCT.md
CHANGELOG.md
```

README 保留快速入口，详细内容移到 docs，避免 README 变成所有信息的堆积点。

## 4.4 许可证和发布

- 核对 vendor 资源的真实许可证；
- 生成第三方依赖清单；
- 增加版本发布说明；
- 明确源码运行、Docker 镜像和未来 npm 包不是同一交付渠道；
- 在仓库中说明 `private: true` 的意图，避免贡献者误以为项目不接受开源发布。

## 完成标准

- 新用户能按文档完成裸机启动；
- 新用户能按文档完成 Docker 启动；
- 两个浏览器能完成基础聊天；
- LAN、私有服务器和反向代理边界写清楚；
- CI 能从干净环境运行；
- 有贡献和安全报告入口；
- 默认安装不依赖外部 API 或数据库。

---

# 阶段 5：基础聊天稳定版

## 目标

在引入任何游戏和 Agent 之前，把 Pavilo 基础聊天做成稳定、可解释、可维护的版本。

## 5.1 功能范围确认

可以在此阶段完善基础聊天，但每项功能都必须回答：

- 是否服务于“临时互动空间”；
- 是否增加默认部署成本；
- 是否增加权限或持久化责任；
- 是否需要新的协议版本；
- 是否能被浏览器和集成测试覆盖。

可以考虑的基础体验优化：

- 更清晰的加入和错误提示；
- 移动端体验；
- 无障碍；
- 主题或语言的最小扩展；
- PWA 的有限体验；
- 更清楚的未读和连接状态。

暂不因“完整聊天产品”而引入私聊、搜索、账号和持久化。它们会改变产品责任，应另立阶段。

## 5.2 安全边界

此阶段至少完成：

- 可信 LAN/VPN 的明确声明；
- 不直暴公网的部署提示；
- TLS/WSS 反向代理示例；
- Origin 和代理信任边界文档；
- IP 显示默认行为和关闭方式；
- `/room-info`、`/healthz` 的公开信息说明；
- 上传、消息和连接限制说明；
- 安全报告入口。

## 5.3 稳定版验收

- 协议、配置和存储语义有版本说明；
- 核心聊天路径有自动化测试；
- Docker 和裸机路径都能启动；
- 真实 LAN 验证完成；
- 私有反向代理验证完成；
- 大成员列表、图片、慢连接和重连压力测试完成；
- 无明显跨频道状态泄漏；
- 无重复消息或待确认消息永久卡住；
- 基础聊天关闭所有未来能力时仍能完整运行。

---

# 阶段 6：未来扩展准备（只预留，不实现玩法）

## 目标

在基础聊天稳定后，评估核心接口是否足以承载未来游戏和 Agent，但不提前实现完整平台。

## 6.1 Capability 方向

未来可定义最小能力接口：

```text
registerCapability(manifest)
onEvent(event, publicView)
submitCommand(command)
cancel(runId)
```

能力只能：

- 声明所需事件；
- 读取经过过滤的公开视图；
- 提交经过内核校验的命令；
- 接收明确的取消和生命周期通知。

能力不能直接：

- 修改核心状态；
- 向 socket 写消息；
- 读取其他玩家的秘密数据；
- 访问恢复 token；
- 使用任意 shell 或任意网络。

## 6.2 游戏方向

未来狼人杀应独立为游戏域：

```text
gameId
stateVersion
round
phase
players
privateViews
actions
votes
winner
```

游戏规则由本地权威状态机裁决，聊天只是展示渠道。LLM 未来只能提出对白或行动建议，不能直接决定合法性和胜负。

## 6.3 Agent 方向

未来再建立 provider-neutral adapter：

```text
runAgent({
  runId,
  playerId,
  visibleContext,
  tools,
  outputSchema,
  timeout,
  abortSignal
}) -> {
  text,
  proposedActions,
  toolCalls,
  usage,
  finishReason,
  providerRequestId
}
```

第一版 Agent 扩展必须满足：

- 没有 provider 配置时不初始化、不读 Key、不联网；
- 默认安装不包含 provider SDK；
- mock provider 可以完成所有测试；
- 流式预览和正式消息分离；
- 每个 run 有 ID、序号、取消和幂等；
- 所有游戏行动仍由本地状态机裁决；
- token、延迟、错误和预算可观测；
- 默认不记录秘密角色和完整 prompt。

只有当核心聊天、事件模型和能力接口经过一个真实但很小的扩展验证后，才决定是否引入更复杂的插件生命周期、独立进程或 Agent 调度器。

---

## 4. 每阶段的提交和分支策略

推荐每个阶段拆成可以单独审查的提交：

```text
chore(baseline): document chat protocol invariants
refactor(client): extract connection state machine
refactor(client): extract pending message lifecycle
refactor(client): extract message rendering
refactor(server): extract room domain
refactor(server): extract websocket transport
refactor(test): add browser contract coverage
chore(ci): add clean install and test matrix
build(docker): add minimal self-hosted image
 docs(project): add deployment and contribution guides
```

每个重构提交应满足：

- 不混入新功能；
- 不混入格式化全文件；
- 不改变无关命名；
- 包含对应测试；
- 说明保留了哪些行为契约；
- 可以单独回滚。

---

## 5. 优先级排序

### 现在立即做

1. 阶段 0：冻结协议和状态契约；
2. 确认默认频道、测试预期和许可证说明；
3. 抽取客户端连接和状态归约；
4. 抽取 pending 消息生命周期；
5. 为刷新、断线、ACK、切频道和阅读位置补浏览器验证；
6. 抽取服务端纯领域模块；
7. 建立 CI。

### 随后做

8. 拆 HTTP/WebSocket transport；
9. 完善协议和架构文档；
10. Docker 单容器和 Compose；
11. LAN、反向代理和私有云文档；
12. 负载和慢连接测试；
13. 发布、贡献、安全和变更日志体系。

### 基础聊天稳定后再评估

14. SQLite opt-in；
15. 访问口令和邀请；
16. 管理员/只读频道；
17. Webhook 和机器人；
18. Capability registry；
19. Mock Agent；
20. 狼人杀最小纵切片；
21. Claude 和其他 Provider adapter。

---

## 6. 最终完成定义

基础聊天阶段只有同时满足以下条件，才算完成：

### 用户层

- 不需要数据库、账号或 Agent Key 就能启动；
- 裸机和 Docker 路径都清晰；
- LAN 用户能打开浏览器加入；
- 刷新和短暂断线不会无故丢失身份；
- 消息发送状态明确，失败可重试；
- 多频道不会互相泄漏；
- 移动端和键盘操作可用。

### 工程层

- 核心领域不依赖传输层；
- 客户端连接和状态不依赖 DOM；
- `server.js` 和 `index.html` 不再承载全部业务；
- 协议、配置和状态语义有文档；
- 单元、集成和浏览器测试分层；
- 关键 bug 有回归测试；
- CI 可从干净环境验证。

### 产品层

- 默认安装不外呼；
- 默认不要求数据库；
- 临时数据边界清楚；
- 公网限制写清楚；
- Docker 镜像可追踪；
- 有 CONTRIBUTING、SECURITY 和 CHANGELOG；
- 新贡献者能独立完成一次小型修改。

满足这些条件后，Pavilo 才适合把 Agent 和游戏作为扩充内容引入。届时 Agent 是建立在稳定聊天内核之上的可选参与者，而不是用来弥补基础产品工程不足的核心依赖。
