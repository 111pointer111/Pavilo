# ADR-0003: Extension 作为可信脚本，而非沙箱插件系统

## Status

已接受（2026-09-15）

## Context

v1.3 将引入 Extension Foundation，允许用户扩展 Pavilo 的能力。典型需求包括：

1. **Policy / Moderation**：阻止包含敏感词的消息、限制上传、审核加入请求
2. **Webhook**：将消息同步到外部系统（Discord、Slack、日志服务）
3. **Bot / Agent**：响应 @mention，调用 LLM 生成回复

### 设计空间

Extension 系统的复杂度范围极大：

| 复杂度 | 示例 | 工程量 |
|--------|------|--------|
| **简单：可信脚本** | Express middleware | 1-2 周 |
| **中等：插件 + 权限** | VS Code Extension | 2-3 个月 |
| **重型：沙箱 + 市场** | Chrome Extension Store | 1 年+ |

**核心问题：v1.3 应该做到什么程度？**

如果做成"沙箱 + 市场"，Pavilo 会从"极简聊天工具"变成"聊天平台框架"，这与产品定位冲突。

### 目标用户分析

**谁会用 Pavilo？**

根据产品定位（"一条命令，给身边的人一间聊天室"），典型用户是：
- 技术团队的自托管实例
- 有编程能力的个人/小团队
- 愿意看文档、改配置文件的人

**他们不是：**
- 非技术的"终端用户"
- 需要 UI 点击安装插件的人
- 期望"一键部署 + 插件市场"的用户

如果用户连 YAML 配置都不愿意碰，他们应该用 Slack/Discord，而不是自托管 Pavilo。

### 参考案例

#### Vite Plugin：成功的"可信脚本"模式

```js
// vite.config.js
import somePlugin from 'vite-plugin-something';

export default {
  plugins: [
    somePlugin({ option: 'value' })
  ]
};
```

- 插件是 Node.js 模块，与主进程同权限
- 没有沙箱，没有权限系统
- 文档明确："插件可以执行任意代码，只使用可信插件"
- 生态繁荣，npm 上有数千个插件

#### WordPress Plugin：过度复杂的例子

- 沙箱、权限、审核流程
- 插件市场、付费插件、安全扫描
- 维护成本巨大，仍然频繁出现安全漏洞

## Decision

**v1.3 的 Extension 是可信脚本（trusted scripts），而非沙箱插件系统。**

用户编写 JavaScript 文件，通过配置路径加载，与 Pavilo 主进程同权限运行。

### 架构设计

#### 两类扩展点

**1. Policy Hooks（同步，Pre-commit）**

在命令提交前拦截，返回 allow/deny。

```js
// extensions/my-policy.js
module.exports = {
  async canSendMessage({ user, channel, message, core }) {
    // 阻止包含 "spam" 的消息
    if (message.text?.toLowerCase().includes('spam')) {
      return { allowed: false, code: 'BLOCKED_WORD', message: 'Message contains blocked word' };
    }
    
    // 限制非管理员发送图片
    if (message.kind === 'image' && !core.isAdmin(user.id)) {
      return { allowed: false, code: 'PERMISSION_DENIED', message: 'Only admins can send images' };
    }
    
    return { allowed: true };
  },

  async canJoinChannel({ user, channel, core }) {
    // 邀请制：只允许白名单用户加入 'private' 频道
    if (channel.id === 'private' && !isInWhitelist(user.username)) {
      return { allowed: false, code: 'INVITE_ONLY', message: 'This channel is invite-only' };
    }
    return { allowed: true };
  },

  async canUploadImage({ user, channel, image, core }) {
    // 自定义图片审核逻辑
    return { allowed: true };
  }
};
```

**2. Domain Events（异步，Post-commit）**

消息已提交后触发，失败不影响聊天。

```js
// extensions/my-webhook.js
module.exports = {
  async onMessageCreated({ message, channel, api }) {
    // 同步到 Discord
    await fetch('https://discord.com/api/webhooks/...', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: `[${channel.name}] ${message.author.username}: ${message.text}`
      })
    });
  },

  async onUserJoined({ user, channel, api }) {
    console.log(`${user.username} joined ${channel.name}`);
  },

  async onUserLeft({ user, channel, api }) {
    // 发送离线通知
  }
};
```

#### 配置方式

```yaml
version: 2

extensions:
  # Policy Hooks（同步拦截）
  policy: ./extensions/moderation.js
  
  # Event Handlers（异步监听）
  events:
    - ./extensions/discord-webhook.js
    - ./extensions/analytics.js
    - ./extensions/chatgpt-bot.js
```

#### Bot / Agent 实现

Bot 本质上是"监听 Domain Event + 调用 Command API"：

```js
// extensions/chatgpt-bot.js
const OpenAI = require('openai');
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

module.exports = {
  async onMessageCreated({ message, channel, api }) {
    // 只响应 @bot 开头的消息
    if (!message.text?.startsWith('@bot ')) return;

    const prompt = message.text.replace('@bot ', '');
    
    try {
      const response = await client.chat.completions.create({
        model: 'gpt-4',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 500
      });

      // 通过 Command API 发送回复
      await api.sendMessage({
        channelId: channel.id,
        text: response.choices[0].message.content,
        replyTo: message.id
      });
    } catch (error) {
      console.error('[bot] OpenAI error:', error);
      await api.sendMessage({
        channelId: channel.id,
        text: '抱歉，我遇到了一个错误。',
        replyTo: message.id
      });
    }
  }
};
```

#### Extension API

扩展接收的 `api` 对象提供对 core 的受限访问：

```js
class ExtensionAPI {
  // 发送消息（通过正常的 Command 路径，受 Policy 检查）
  async sendMessage({ channelId, text, replyTo }) { ... }
  
  // 查询频道信息
  getChannel(channelId) { ... }
  
  // 查询在线成员
  getOnlineUsers(channelId) { ... }
  
  // 不允许：
  // - 直接操作 SQLite
  // - 绕过 Policy 直接写消息
  // - 访问其他扩展的内部状态
}
```

### 安全模型

**明确声明：Extensions 是 Trusted Code**

文档中明确说明：
> **⚠️ Security Notice**
> 
> Pavilo extensions run in the same Node.js process as the main server, with full system access. They can:
> - Read/write files
> - Make network requests
> - Execute shell commands
> - Access environment variables
> 
> **Only load extensions you trust.** Do not copy-paste random scripts from the internet.
> 
> This is by design — Pavilo is a self-hosted tool for technical users, not a SaaS platform with untrusted user uploads.

类比：
- Vite/Rollup plugins：同权限，文档明确说明风险
- Express middleware：同权限，从 npm 安装前需要审查
- VS Code extensions：沙箱，但也因此限制能力

Pavilo 选择前者：信任用户的判断，而不是试图沙箱化。

### 生态策略

**不做插件市场，做示例 + 文档**

```
docs/extensions/
  README.md          # 如何编写扩展
  api-reference.md   # Extension API 文档
  examples/
    word-filter.js       # 敏感词过滤
    discord-webhook.js   # Discord 同步
    slack-webhook.js     # Slack 同步
    openai-bot.js        # OpenAI 聊天机器人
    claude-bot.js        # Anthropic Claude 机器人
    rate-limiter.js      # 自定义限流策略
    audit-log.js         # 审计日志
```

用户：
1. 复制 `examples/openai-bot.js` 到自己的 `extensions/` 目录
2. 修改 API key、提示词等配置
3. 在 `pavilo.yaml` 中引用
4. 重启服务

如果社区想分享扩展：
- 通过 GitHub Gist / 仓库分享
- 在 Pavilo Discussions 中讨论
- 官方 repo 可以收录优秀示例到 `docs/extensions/community/`

**不需要：**
- npm package 发布机制
- 插件版本兼容矩阵
- 插件审核流程
- 插件市场 UI

## Alternatives

### 方案 A：沙箱 + 权限系统（类似 VS Code）

```yaml
extensions:
  - name: chatgpt-bot
    version: 1.2.0
    permissions:
      - messages.read
      - messages.write
      - network.outbound
```

**技术方案：**
- 使用 `vm2` 或 `isolated-vm` 沙箱化
- 定义权限模型，扩展需要声明所需权限
- 运行时检查每个 API 调用

**为什么不选：**

1. **工程量巨大**
   - 沙箱本身就是一个大工程（几个月）
   - 权限系统需要设计、实现、测试（几周）
   - 沙箱逃逸风险仍然存在

2. **限制能力**
   - Bot 可能需要调用外部 API（OpenAI、数据库、文件系统）
   - 沙箱会限制这些能力，需要为每个场景设计"安全代理"

3. **与产品定位冲突**
   - Pavilo 是给技术用户的自托管工具
   - 如果用户不信任自己加载的代码，不应该加载它

4. **参考案例的教训**
   - Figma plugins：沙箱 + 权限，工程量巨大
   - WordPress：沙箱不完善，仍然频繁出现安全漏洞
   - Vite：可信脚本，生态繁荣，很少出现安全问题

### 方案 B：WebAssembly 插件

```yaml
extensions:
  - wasm: ./extensions/bot.wasm
```

**为什么不选：**
- **几乎没有优势**。Bot 需要调用外部 API（HTTP、LLM），WASM 仍然需要 host 提供能力
- **开发者体验差**。编写 WASM 插件比 JavaScript 复杂 10 倍
- **生态小**。99% 的 Pavilo 用户会选择 JavaScript

### 方案 C：External Process（独立进程）

```yaml
extensions:
  - type: http
    url: http://localhost:9000/webhook
  - type: grpc
    addr: localhost:9001
```

**为什么不选：**
- **部署复杂度 10 倍**。用户需要管理多个进程、端口、健康检查
- **性能开销**。每个事件都要跨进程通信
- **调试困难**。扩展崩溃时，Pavilo 主进程无法感知

这个方案适合"企业级微服务架构"，不适合"10 人小团队的自托管聊天室"。

## Consequences

### 好的影响

1. **实现简单，v1.3 可以在 2-3 周内完成核心功能**
   ```js
   // src/extensions/loader.js（<200 行）
   function loadExtensions(config) {
     const policy = config.extensions.policy ? require(config.extensions.policy) : null;
     const eventHandlers = config.extensions.events?.map(path => require(path)) || [];
     return { policy, eventHandlers };
   }
   ```

2. **开发者体验极佳**
   - 用熟悉的 JavaScript 编写
   - 用熟悉的 npm 包（OpenAI SDK、Discord.js 等）
   - 用熟悉的调试工具（console.log、Node debugger）

3. **生态自然生长**
   - 用户在 GitHub 分享 Gist："这是我写的 Slack 集成"
   - 其他人复制、修改、改进
   - 不需要官方维护"插件市场"

4. **符合产品定位**
   - Pavilo 是技术用户的工具，不是"傻瓜式聊天平台"
   - 愿意自己写扩展的用户，本来就具备安全意识

5. **未来可扩展**
   - 如果未来真的需要沙箱（例如 v2.0 支持"多租户 SaaS 模式"），可以引入
   - 但在 v1.x 的自托管场景，可信脚本已经足够

### 坏的影响 / 权衡

1. **安全风险：恶意扩展可以做任何事**
   - **缓解措施**：
     - 文档明确警告
     - 不提供"一键安装"UI
     - 推荐用户审查代码后再加载
   - **产品判断**：这与"自托管 + 技术用户"的定位一致

2. **扩展崩溃会导致主进程崩溃**
   - **缓解措施**：
     - 用 `try-catch` 包裹扩展调用
     - Policy hook 失败可以配置 fail-open/fail-closed
     - Event handler 失败只打印错误，不影响聊天
   - **未来优化**：v1.4 可以引入"扩展健康检查"，自动禁用频繁崩溃的扩展

3. **没有版本管理，升级 Pavilo 可能破坏扩展**
   - **缓解措施**：
     - Extension API 遵循 SemVer
     - Breaking changes 只在 major 版本（v2.0）
     - 文档维护 "Extension API Changelog"
   - **产品判断**：技术用户可以处理这种复杂度

4. **不适合"SaaS 多租户"场景**
   - **产品判断**：Pavilo v1.x 明确不支持多租户（见 ROADMAP）
   - 如果未来需要（v2.0+），可以引入沙箱作为独立模式

### 未来工作

1. **v1.3 核心实现**
   - `src/extensions/loader.js`：加载用户脚本
   - `src/extensions/policy.js`：Policy Hook 调用点
   - `src/extensions/events.js`：Domain Event 发射
   - `src/extensions/api.js`：Extension API（sendMessage 等）
   - 错误处理、超时、日志

2. **文档**
   - `docs/extensions/README.md`：概览 + 安全警告
   - `docs/extensions/api-reference.md`：API 文档
   - `docs/extensions/examples/`：5-7 个可运行示例

3. **v1.4 可选增强**
   - 扩展健康检查（连续失败 N 次自动禁用）
   - 扩展性能监控（Policy hook 平均耗时）
   - 热重载（修改扩展文件后自动重载，无需重启）

## 相关决策

- **与 ADR-0002 的关系**：Extension 不能直接操作 SQLite，必须通过 Command API
- **与 ROADMAP 的关系**：符合"Core Before Platform"原则（原则 4）
- **与 v1.4 Agent 的关系**：Agent 只是特殊的 Event Handler，不需要独立架构
