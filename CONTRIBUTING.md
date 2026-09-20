# 贡献指南

感谢你对 Pavilo 的关注！本文档将帮助你了解如何为项目做出贡献。

## 目录

- [行为准则](#行为准则)
- [开始之前](#开始之前)
- [开发环境](#开发环境)
- [提交规范](#提交规范)
- [Pull Request 流程](#pull-request-流程)
- [代码审查清单](#代码审查清单)
- [测试要求](#测试要求)
- [贡献玩法](#贡献玩法)
- [架构原则](#架构原则)

---

## 行为准则

Pavilo 致力于为所有贡献者提供友好、尊重的环境。请遵循基本的开源社区礼仪：

- 尊重不同观点和经验
- 优雅地接受建设性批评
- 关注对社区最有利的事情
- 对他人表示同理心

## 开始之前

### 适合新手的任务

查找标记为 `good first issue` 的 Issue，这些是相对独立、明确的小任务。

### 重大变更

如果你计划实现重大功能或架构变更，**请先开 Issue 讨论**：
- 描述问题和你的解决方案
- 等待维护者反馈
- 确认方向后再投入大量时间编码

这样可以避免你的 PR 因为与产品方向不符而被拒绝。

## 开发环境

### 要求

- **Node.js**: 22+
- **操作系统**: macOS / Linux / Windows (WSL2)
- **浏览器**: Chrome / Edge（用于浏览器测试）

### 安装

```bash
git clone https://github.com/caigg188/Pavilo.git
cd Pavilo
npm install
```

### 运行

```bash
# 启动服务（默认 http://localhost:4173）
npm start

# 运行单元测试和集成测试
npm test

# 运行浏览器验收测试
npm run test:browser

# 校验配置示例
npm run config:check
```

### 目录结构

```
.
├── config.js            # 配置加载与校验
├── server.js            # 服务入口（composition root）
├── src/
│   ├── core/           # 核心逻辑（不依赖网络）
│   ├── storage/        # ConversationStore（默认 memory）
│   └── transport/      # HTTP / WebSocket 适配器
├── client/             # 前端模块
├── test/               # Node.js 测试
└── docs/               # 架构文档与 ADR
```

### 架构文档

在修改代码前，请先阅读：
- [架构原则](docs/architecture/principles.md) — 核心不变量与设计哲学
- [架构决策记录](docs/adr/) — 重大技术决策的背景
- [产品路线图](ROADMAP.md) — 版本规划与非目标

## 提交规范

Pavilo 使用约定式提交（Conventional Commits）格式：

```
<type>(<scope>): <中文说明>

[可选的详细描述]
```

### Type（类型，英文）

- `feat`: 新功能
- `fix`: Bug 修复
- `docs`: 文档变更
- `style`: 代码格式（不影响功能）
- `refactor`: 重构（不改变外部行为）
- `perf`: 性能优化
- `test`: 测试相关
- `chore`: 构建/工具链变更

### Scope（模块，英文）

- `core`: src/core/
- `storage`: src/storage/
- `transport`: src/transport/
- `client`: client/
- `config`: 配置相关
- `room`: 房间逻辑
- `session`: 会话管理
- `protocol`: 协议变更
- `play`: 玩法契约或官方/社区玩法
- `gateway`: AI 网关
- `adr`: ADR 文档

### 示例

```bash
git commit -m "feat(room): 支持只读频道"
git commit -m "fix(client): 修复断线重连后消息重复"
git commit -m "docs(adr): 新增 SQLite driver 选型决策"
git commit -m "refactor(core): 提取 ConversationStore 接口"
```

### BREAKING CHANGE

如果提交包含不兼容变更，在提交信息中说明：

```
feat(protocol): 删除 Protocol v1/v2/v3 支持

BREAKING CHANGE: 服务端只接受 Protocol v4 客户端。
旧客户端连接时返回 PROTOCOL_NOT_SUPPORTED 并以 1002 关闭。
```

## Pull Request 流程

### 1. Fork 并创建分支

```bash
git checkout -b feat/your-feature-name
```

分支命名：
- `feat/feature-name` — 新功能
- `fix/bug-description` — Bug 修复
- `docs/what-changed` — 文档更新

### 2. 开发与测试

- 编写代码
- 添加测试（如果是新功能或 Bug 修复）
- 确保 `npm test` 通过
- 确保 `npm run config:check` 通过
- 如果修改了前端，手动验证浏览器行为

### 3. 提交变更

```bash
git add -A
git commit -m "feat(scope): 中文说明"
```

### 4. 推送并创建 PR

```bash
git push origin feat/your-feature-name
```

在 GitHub 上创建 Pull Request，填写：
- **标题**：与提交信息一致
- **描述**：
  - 解决了什么问题？
  - 如何测试？
  - 是否有 Breaking Change？
  - 相关 Issue 编号（如 `Closes #123`）

### 5. 代码审查

维护者会审查你的代码。可能的结果：
- ✅ 批准并合并
- 💬 请求修改（回复评论后重新提交）
- ❌ 拒绝（说明原因）

## 代码审查清单

每个 PR 合并前必须回答这 7 个问题（来自 [架构原则](docs/architecture/principles.md)）：

1. **默认 ephemeral 用户是否被迫承担了额外复杂度？**
   - 新功能是否默认关闭？未启用时是否零开销？

2. **业务规则是否进入 transport 了？**
   - WebSocket handler 是否只做协议解析？

3. **adapter 是否能绕过 core 写状态？**
   - 是否通过 Command API 进入 core？

4. **新 IO 是否可在测试中替换？**
   - 时钟、ID 生成器、HTTP 请求是否可注入？

5. **public contract 是否有测试？**
   - Protocol 变更是否有兼容性测试？

6. **重启/失败/超限时语义是否定义？**
   - 错误处理是否明确？

7. **README/配置/协议/代码是否可能再次漂移？**
   - 新配置字段是否同步到 example？

玩法相关 PR 额外对照 [docs/play.md](docs/play.md)：页面是否独立、是否走 `playAction`、浏览器是否调用了网关。

## 测试要求

### 测试金字塔

Pavilo 的测试遵循以下层次（从多到少）：

1. **Core Unit Tests**（最多）
   - 纯函数、命令处理、状态变更
   - 注入时钟、ID 生成器
   - 不启动网络服务
   - 快速（<1s）

2. **Contract Tests**（中等）
   - Protocol 解析器
   - Config Schema
   - Store 接口

3. **Transport Integration Tests**（较少）
   - WebSocket 握手
   - 真实网络

4. **Browser Acceptance Tests**（最少）
   - 双用户消息流
   - 真实浏览器

### 新功能的测试要求

- **新命令/状态变更** → Core Unit Test（必须）
- **新配置字段** → Config 解析测试（必须）
- **Protocol 变更** → Contract Test（必须）
- **UI 变更** → 手动验证（必须）+ Browser Test（可选）

### 运行测试

```bash
# 运行所有 Node.js 测试
npm test

# 运行特定测试文件
node --test test/room.test.js

# 运行浏览器测试（需要 Playwright）
npm run test:browser
```

## 贡献玩法

Pavilo 主线负责 **AI 网关**、**Play 宿主** 和一层薄契约。官方样例是文字狼人杀（状态机 + **自己的页面**）。启用一套玩法模块，再把频道的 `play` 指过去；进入该频道即加载玩法页，不要改聊天气泡流。

请先读 [docs/play.md](docs/play.md)、[ROADMAP v1.5](ROADMAP.md)、[evolution.md §11](docs/evolution.md)。v1.5 之前还没有运行时，不要提交「通用游戏平台」或往 `chat.css` 里塞玩法按钮。

在此之前用 Issue 对齐：规则、页面交互、人数、Agent 怎么参与。必须能回答：主持人是否为状态机？浏览器是否不调网关？失败时普通聊天是否仍可用？页面是否独立于聊天页？

v1.5 之后：按 `plays/<id>/host.js` + `page/` 提交；想进主仓库就提 PR，也可以只在自己的实例加载。

## 架构原则

在开发前，请务必阅读并遵守：

### 依赖方向规则

**允许：**
```
server.js (composition root)
    ↓
src/transport
    ↓
src/core
```

**禁止：**
- ❌ `src/core` → `ws`（WebSocket 库）
- ❌ `src/core` → `node:sqlite`
- ❌ `src/core` → `openai`
- ❌ `src/transport` → `src/storage`

### 七大不变量

1. **Ephemeral First** — 默认无数据库
2. **One Mainline** — 只有一条版本主线
3. **Optional Means Optional** — 可选功能默认关闭
4. **Core Before Platform** — 核心保持小而确定
5. **Compatibility Is a Feature** — 多类版本号独立演进
6. **Safe by Construction** — 安全默认值
7. **No Premature Generalization** — 真实需求出现后再抽象；玩法契约只收录狼人杀用到的端口

详见 [架构原则](docs/architecture/principles.md)。

### 明确不做的事

以下功能暂不考虑（至少到 v1.x）：
- 私聊
- 多租户
- 文件管理（只有图片）
- 语音/视频
- 原生 App
- 玩法商店 / 通用游戏引擎
- 插件市场

如果你的 PR 涉及这些，很可能被拒绝。

## 何时写 ADR

如果你的 PR 涉及以下情况，**必须先写 ADR**（Architecture Decision Record）：

- 引入/移除核心依赖
- 定义公开 API 兼容策略
- 在多个技术方案间做不可逆选择
- 明确产品边界（什么不做）

ADR 模板和示例见 [docs/adr/README.md](docs/adr/README.md)。

## 文档更新

如果你的 PR 涉及以下变更，**必须同步更新文档**：

- 新配置字段 → `pavilo.example.yaml` + README
- Protocol 变更 → `docs/architecture/chat-protocol.md`
- 新命令/事件 → Protocol 文档
- 架构变更 → `docs/architecture/overview.md` 或新增 ADR

## 问题与讨论

- **Bug 报告** → 开 Issue，包含复现步骤
- **功能建议** → 开 Issue，说明使用场景
- **问题咨询** → GitHub Discussions
- **架构讨论** → GitHub Discussions（Architecture 分类）

## 许可证

贡献到 Pavilo 的代码将遵循 [MIT License](LICENSE)。

---

感谢你的贡献！🎉
