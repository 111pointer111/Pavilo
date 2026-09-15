# Pavilo 架构原则

本文记录 Pavilo 在设计和实现时必须遵守的核心原则。这些原则源自产品定位，并通过具体 ADR 落地。

---

## 产品定位

> **一条命令，给身边的人一间聊天室。**

Pavilo 不是：
- ❌ 企业级 24/7 聊天平台
- ❌ Slack/Discord 的开源替代品
- ❌ 需要"傻瓜式一键安装"的 SaaS 产品

Pavilo 是：
- ✅ 技术团队的自托管工具
- ✅ 默认极简、按需生长的临时聊天核心
- ✅ 可以在树莓派、NAS、旧笔记本上一条命令启动

---

## 七大不变量（来自 ROADMAP）

### 1. Ephemeral First

默认安装和启动不需要数据库、账号系统或第三方云服务。停止服务后聊天记录回到空白是第一等产品模式，而不是"阉割版"。

**意味着：**
- SQLite 是可选的，memory mode 永远是默认
- 文档和示例优先展示 memory mode
- 持久化不应显著增加启动复杂度

### 2. One Mainline

Pavilo 永远只有一套主代码和一条版本主线。`memory`、`sqlite` 等是运行模式，不是两套产品。

**意味着：**
- 不做 Community Edition / Enterprise Edition
- 不做 Pavilo Lite / Pavilo Pro
- 所有功能通过配置启用/禁用

### 3. Optional Means Optional

持久化、Agent、网关、认证、风控等能力默认关闭；未启用时不应显著增加启动成本、运行依赖和认知负担。

**意味着：**
- `better-sqlite3` 是 `optionalDependencies`，不安装不影响启动
- Agent SDK（OpenAI、Anthropic）不出现在 `dependencies`
- 默认配置文件不包含"注释掉的高级功能"

### 4. Core Before Platform

聊天领域内核保持小、确定、可测试。Transport、Storage、Agent、Webhook、Moderation 等通过边界与内核交互，不把厂商 SDK、SQL、HTTP request/socket 塞回 `src/core`。

**意味着：**
- `src/core` 不 import `ws`、`node:sqlite`、`openai`
- core 的测试不需要启动真实 WebSocket 服务器
- 引入新 IO 依赖前，先问"能否通过注入隔离？"

### 5. Compatibility Is a Feature

应用版本、配置 Schema、WebSocket 协议和数据库 Schema 分别演进，不能用同一个"版本号"表达所有兼容性。

**意味着：**
- App v1.2 可以读取 Config Schema v1 和 v2
- Protocol v4 稳定后，新功能通过可选字段扩展
- 数据库 migration 独立于 App 版本号

### 6. Safe by Construction

在认证、TLS、可信代理和滥用防护未形成完整基线前，不宣称可以把裸端口直接暴露到公网。

**意味着：**
- README 默认场景是"局域网 / Tailscale / 反向代理后"
- 公网暴露需要显式警告
- v1.5 Access & Moderation 完成前，不营销"公网可用"

### 7. No Premature Generalization

不为了"未来可能支持 PostgreSQL / 分布式 / 插件市场"提前复杂化当前架构。真实需求出现后再扩展边界。

**意味着：**
- 不做"通用 ORM"
- 不做"抽象消息队列"
- 不做"插件沙箱运行时"
- 先用最简单的方案，等真实瓶颈出现再优化

---

## 依赖方向规则

### 允许的依赖方向

```
server.js (composition root)
    ↓
src/transport (HTTP / WebSocket 生命周期)
    ↓
src/core (命令 / 状态 / 事件)
    ↓
domain contracts (纯数据结构)

src/storage (SQLite / Memory)
    ↑ 依赖
src/core (通过 Store 接口)
```

### 禁止的依赖

❌ `src/core` → `ws`（WebSocket 库）  
❌ `src/core` → `node:sqlite`  
❌ `src/core` → `openai`  
❌ `src/core` → `express`  
❌ `src/storage` → `src/transport`  
❌ Extension → SQLite 直接操作

**检查方式：**
```bash
# src/core 不应该 import 网络库或数据库
grep -r "require('ws')" src/core && echo "VIOLATION"
grep -r "require('node:sqlite')" src/core && echo "VIOLATION"
```

---

## 测试金字塔

Pavilo 的测试应该遵循以下层次：

### 1. Core Unit Tests（最多）

- 纯函数、命令处理、状态变更
- 注入时钟、ID 生成器、定时器
- 不启动网络服务
- 快速（<1s）

**示例：**
- 消息校验逻辑
- session lease 计时
- 频道切换规则
- rate limiting

### 2. Contract Tests（中等）

- core event → client protocol parser
- Config Schema 解析
- Protocol 兼容性
- Store 接口（Memory + SQLite 跑同一组测试）

### 3. Transport Integration Tests（较少）

- WebSocket 握手
- Origin 检查
- 心跳超时
- backpressure
- 真实网络

### 4. Browser Acceptance Tests（最少）

- 双用户消息流
- reconnect
- IME 输入
- 移动端布局
- 真实浏览器（Playwright）

**原则：**
- 不用浏览器测试覆盖"敏感词过滤"（应该在 Core Unit 测）
- 不在 Unit Tests 里启动真实服务器
- 失败时，先看是哪一层的问题

---

## 性能原则

### 不是性能目标

- ❌ "支持 10k 并发用户"
- ❌ "每秒处理 100k 消息"
- ❌ "亚毫秒级延迟"

Pavilo 不是高并发聊天系统。

### 实际性能目标

- ✅ 10-50 人同时在线，流畅无卡顿
- ✅ 历史 10k 条消息，加载 < 1 秒
- ✅ 300 KB 图片，发送 < 2 秒
- ✅ 慢客户端不拖垮其他客户端
- ✅ 进程重启 < 3 秒

### 优化顺序

1. **先保证正确性**：没有数据丢失、不一致、竞态条件
2. **再优化资源边界**：内存上限、连接数、消息数
3. **最后才优化速度**：如果 benchmark 显示瓶颈才优化

**反例：**
```js
// 不要为了"看起来快"提前引入复杂优化
const cache = new LRU({ max: 10000 }); // 我们真的需要 LRU 吗？
```

**正例：**
```js
// 先用最简单的实现，测试证明瓶颈后再优化
const messages = []; // Array 在 1k 以内完全够用
```

---

## 安全原则

### 默认安全假设

Pavilo v1.x 默认场景是：

> 局域网内、技术用户、互相信任的小团队

**不是：**
- 公网暴露的开放聊天室
- 陌生人可以随意加入
- 需要防御 DDoS / 刷单 / 爬虫

### v1.0 安全边界

- ✅ Origin 检查（阻止 CSRF）
- ✅ 连接数限制（防止资源耗尽）
- ✅ 消息大小限制
- ✅ 图片解码校验
- ✅ rate limiting（防止单用户刷屏）

- ❌ 没有用户认证（任何人可以用任何用户名加入）
- ❌ 没有权限系统
- ❌ 没有 IP 封禁
- ❌ 没有内容审核

### Extension 安全模型（ADR-0003）

**明确声明：Extensions are Trusted Code**

- 扩展与主进程同权限运行
- 没有沙箱，没有权限检查
- 文档明确警告："Only load extensions you trust"

这不是偷懒，而是产品定位决定的：
- Pavilo 用户是技术人员，有能力审查代码
- 沙箱会限制扩展能力（无法调用外部 API）
- 参考 Vite、Rollup、Express 的插件模式

---

## 文档原则

### 文档单一真源

- **README**：用户入口、Quick Start、产品边界
- **`pavilo.example.yaml`**：可运行的配置示例
- **`docs/configuration.md`**（未来）：配置语义唯一详细说明
- **`docs/architecture/chat-protocol.md`**：协议真源
- **`docs/architecture/overview.md`**：当前实现
- **`docs/architecture/evolution.md`**：未来演进原则
- **`docs/adr/`**：重大决策记录
- **ROADMAP.md**：版本计划

### 避免文档漂移

- CI 验证 `pavilo.example.yaml` 可解析
- 默认频道 ID 与测试一致
- Protocol version 与代码常量一致
- 文档引用的脚本存在

### 何时写 ADR

在实现前写，而不是实现后补文档。

**需要 ADR：**
- 引入/移除核心依赖（SQLite driver）
- 定义公开 API 兼容策略（Protocol v4 only）
- 在多个技术方案间做不可逆选择（Extension 沙箱 vs 可信脚本）
- 明确产品边界（什么不做）

**不需要 ADR：**
- 常规技术选择（YAML vs JSON）
- 库的小版本升级
- Bug 修复

---

## 版本策略

### SemVer 规则（v1.0+）

- **PATCH**（v1.0.1）：兼容性修复，不改变行为
- **MINOR**（v1.1.0）：向后兼容的新能力
- **MAJOR**（v2.0.0）：需要用户迁移的不兼容变更

### 四类版本号

| 版本 | 示例 | 作用 | 变更时机 |
|------|------|------|----------|
| App Version | `1.2.0` | Pavilo 发布版本 | 每次发布 |
| Config Schema | `version: 1 / 2` | 配置文件结构 | 配置不兼容时 |
| WebSocket Protocol | `4 / 5 ...` | 浏览器/客户端与服务端协议 | 协议不兼容时 |
| Database Schema | `1 / 2 ...` | SQLite 内部迁移版本 | 表结构变化时 |

**例子：**
- App v1.2.0 可以读取 Config Schema v1 和 v2
- Protocol v4 在整个 v1.x 系列保持稳定（ADR-0001）
- 数据库从 Schema v3 升级到 v4 不需要升级 Pavilo App

### Breaking Change 门槛

只有以下情况才进入 v2.0：

- 必须删除/重定义 v1 公共配置字段
- 必须不兼容地重做 WebSocket 协议
- 必须改变已稳定的 Extension API
- 身份模型发生无法兼容的重构

**不是 Breaking Change：**
- SQLite 持久化（可选功能）→ v1.1
- Extension 系统（可选功能）→ v1.3
- Agent 支持（基于 Extension）→ v1.4

---

## 代码审查检查清单

每个 PR 合并前问 7 个问题：

1. **默认 ephemeral 用户是否被迫承担了额外复杂度？**
   - 新功能是否默认关闭？
   - 未启用时是否零开销？

2. **业务规则是否进入 transport 了？**
   - WebSocket handler 是否只做协议解析？
   - 命令校验是否在 core？

3. **adapter 是否能绕过 core 写状态？**
   - SQLite adapter 是否直接广播消息？
   - Extension 是否直接操作数据库？

4. **新 IO 是否可在测试中替换？**
   - 时钟、ID 生成器、HTTP 请求是否可注入？

5. **public contract 是否有测试？**
   - Protocol 变更是否有兼容性测试？
   - Config Schema 是否有解析测试？

6. **重启/失败/超限时语义是否定义？**
   - Policy hook 超时怎么办？
   - SQLite 写入失败是否有回滚？

7. **README/配置/协议/代码是否可能再次漂移？**
   - 新配置字段是否同步到 example？
   - 协议文档是否更新？

---

## 产品边界：明确不做的事

以下不是"永远不做"，但不应抢占当前主线（至少到 v1.x）：

### 暂缓功能池

- 私聊（v1.x 只做频道）
- 群组/工作区多租户
- 文件管理（只有图片）
- 语音/视频通话
- 端到端加密
- 联邦协议
- 原生 iOS / Android
- 多实例共享 session（Redis / PostgreSQL）
- Kubernetes operator
- 主题/插件市场

### 判断标准

新功能进入主线前必须先回答：

1. **它是否强化 Pavilo 的核心定位？**
   - "一条命令启动的临时聊天室"
   
2. **是否可以保持默认部署极简？**
   - 不需要 Redis / PostgreSQL / Kafka
   
3. **是否真的有用户需求？**
   - 不是"其他聊天软件有，所以我们也要有"

---

## 总结：设计决策的优先级

当面临多个技术方案时，按以下优先级选择：

1. **产品定位** > 技术先进性
   - "零编译依赖" > "最快的性能"
   
2. **可维护性** > 功能丰富度
   - "只支持 Protocol v4" > "向后兼容所有版本"
   
3. **实际需求** > 假想需求
   - "同步 SQLite" > "为分布式预留异步接口"
   
4. **用户信任** > 防御性编程
   - "Extension 是可信脚本" > "沙箱插件系统"

**记住：Pavilo 是给懂一点代码的人用的自托管工具，不是给"终端用户"用的 SaaS 平台。**
