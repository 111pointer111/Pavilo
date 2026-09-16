# Pavilo 测试策略

## 概述

本文档定义 Pavilo 的测试组织、范围和维护策略，确保测试套件保持高质量、可维护且不产生遗留问题。

## 现状分析

### 测试统计（截至 2026-09-15）

- **测试文件数**: 21 个
- **测试用例数**: ~217 个（不含浏览器测试的子断言）
- **本地通过率**: 228/229 (99.6%)
- **跳过测试**: 1 个（channels.test.js 同步时序问题）
- **问题文件**: 1 个空文件（client-server-contract.test.js）

### 测试分层

```
┌─────────────────────────────────────┐
│  E2E (Browser)                      │  1 文件，15 子场景
│  - 完整用户流程验证                  │  慢，真实环境
└─────────────────────────────────────┘
┌─────────────────────────────────────┐
│  Integration (Server)               │  2 文件，29 用例
│  - 完整服务器栈                      │  中速，契约验证
│  - HTTP + WebSocket + Core          │
└─────────────────────────────────────┘
┌─────────────────────────────────────┐
│  Component (Channels, Config)       │  4 文件，40 用例
│  - 功能模块端到端                    │  中速，功能保障
└─────────────────────────────────────┘
┌─────────────────────────────────────┐
│  Unit (Client, Core, Transport)     │  14 文件，148 用例
│  - 独立模块逻辑                      │  快，边界情况
│  - 无外部依赖                        │
└─────────────────────────────────────┘
```

## 问题识别

### 🔴 立即处理

1. **client-server-contract.test.js 是空文件**
   - 已有 4 个客户端协议版本兼容性测试分布在各处
   - **决策**: 删除此空文件，契约测试已在 server.test.js 和 client-protocol.test.js 充分覆盖

2. **channels.test.js 有 1 个跳过的测试**
   ```javascript
   test.skip('a client is told to wait', async (t) => {
     // TODO: 同步状态时序问题，Core 与 Transport 层状态不一致
   ```
   - **决策**: 作为技术债务跟踪，在 v0.3.0 修复同步状态管理后取消跳过

### 🟡 结构优化

3. **client-state.test.js (31) 和 client-state-regressions.test.js (7) 分离**
   - regressions 文件是为了隔离特定 bug 的回归测试
   - **决策**: 保留分离，regressions 文件仅添加真正的线上 bug 回归用例

4. **协议兼容性测试分散**
   - client-server-contract.test.js: 4 个版本兼容测试（protocol v1-4）
   - server.test.js: 包含协议测试
   - client-protocol.test.js: 包含解析测试
   - **决策**: 保持现状，这些是不同层面的测试（wire format vs behavior vs parsing）

## 测试分类与职责

### 1. 单元测试（Unit Tests）

**目标**: 验证单个模块的逻辑正确性，快速反馈

#### 客户端单元测试（`test/client-*.test.js`）
- ✅ `client-state.test.js` - 状态机核心逻辑
- ✅ `client-state-regressions.test.js` - 生产 bug 回归保护
- ✅ `client-connection.test.js` - WebSocket 连接管理
- ✅ `client-messages.test.js` - 消息列表渲染逻辑
- ✅ `client-composer.test.js` - 编辑器状态与草稿
- ✅ `client-mentions.test.js` - @提及解析与匹配
- ✅ `client-images.test.js` - 图片尺寸计算
- ✅ `client-pending.test.js` - 待发送队列
- ✅ `client-protocol.test.js` - 协议解析器

**特点**:
- 不启动服务器
- 不依赖 DOM（UMD 加载测试确保 Node/Browser 兼容）
- 每个模块 < 1 秒执行完成

#### 核心单元测试（`test/core*.test.js`）
- ✅ `core.test.js` - Core 状态机与广播逻辑
- ✅ `core-images.test.js` - 图片头部解析与预算验证

#### 传输单元测试（`test/transport-*.test.js`）
- ✅ `transport-protocol.test.js` - WebSocket 帧解析器
- ✅ `websocket-transport.test.js` - 传输层队列与预算

### 2. 组件测试（Component Tests）

**目标**: 验证功能模块的完整行为

- ✅ `channels.test.js` - 频道隔离、切换、恢复（11 用例，1 跳过）
- ✅ `readonly-channels.test.js` - 只读频道权限验证（5 用例）
- ✅ `config.test.js` - 配置解析、合并、验证（21 用例）
- ✅ `config-example.test.js` - 示例配置有效性（3 用例）

**特点**:
- 可能启动轻量 Core 实例
- 测试功能边界和配置契约
- 每个测试 < 100ms

### 3. 集成测试（Integration Tests）

**目标**: 验证完整服务器栈的端到端行为

- ✅ `server.test.js` - 完整协议握手、消息流、断线恢复（26 用例）
- ✅ `http.test.js` - HTTP 端点、静态资源、安全检查（3 用例）

**特点**:
- 启动完整服务器（HTTP + WebSocket + Core）
- 使用真实网络连接（localhost）
- 每个测试 10-100ms

### 4. E2E 测试（End-to-End Tests）

**目标**: 验证真实用户场景和浏览器集成

- ✅ `browser/chat.test.cjs` - 双标签页完整聊天流程（15 子场景）
  - 登录、发消息、表情、图片、切换频道、断线恢复、优雅停机

**特点**:
- 使用 Playwright 驱动真实 Chrome
- 启动生产模式服务器
- 超时 180 秒
- 仅在 CI 的 browser-test job 执行

## CI 策略

### GitHub Actions 工作流

#### 主测试流水线（`.github/workflows/ci.yml`）

```yaml
jobs:
  test:
    strategy:
      matrix:
        node-version: [22, 24, 26]
    steps:
      - npm test  # 单元 + 组件 + 集成测试（228 用例）
  
  browser-test:
    needs: test  # 只在核心测试通过后执行
    steps:
      - npm install --no-save playwright
      - npm run test:browser  # E2E 测试（15 子场景）
```

**运行条件**:
- 每次 push 到 main
- 每次 pull request
- 矩阵测试 Node 22/24/26

#### 发布流水线（`.github/workflows/release.yml`）

```yaml
on:
  push:
    tags:
      - 'v*'
steps:
  - npm test  # 确保版本可发布
  - 创建 GitHub Release
```

**特点**:
- 测试失败不阻塞发布（`continue-on-error: true`）
- 自动标记 v0.x 为 pre-release

### 本地开发流程

```bash
# 日常开发 - 快速反馈
npm test                    # 228 用例，~0.5 秒

# 提交前检查 - 完整验证
npm run test:browser        # + 浏览器测试，~30 秒

# 调试单个文件
node --test test/channels.test.js
```

## 维护准则

### ✅ 何时添加测试

1. **新功能**: 必须有对应单元测试和组件测试
2. **Bug 修复**: 
   - 如果是客户端 bug → `client-state-regressions.test.js`
   - 如果是服务器 bug → 在相关 test 文件添加回归用例
3. **协议变更**: 更新 `client-protocol.test.js` 和 `server.test.js`
4. **配置字段**: 更新 `config.test.js` 和 `config-example.test.js`

### ❌ 避免测试膨胀

1. **不要重复测试**: 
   - 单元测试已覆盖的逻辑，集成测试不再详细测试
   - 客户端和服务器测试各自负责自己的边界

2. **不要过度 mock**:
   - 优先使用真实依赖（如 Core）
   - 只 mock 外部系统（时间、网络、文件）

3. **不要测试实现细节**:
   - 测试公开 API 和契约，不测试私有函数
   - 重构时测试应该无需修改

### 🔄 何时删除/合并测试

1. **功能废弃**: 同步删除相关测试
2. **协议版本**: Protocol v1-v3 将在 v0.9.0 移除，届时删除兼容性测试
3. **重复覆盖**: 如果两个测试验证相同边界，保留更清晰的那个

### 🚨 跳过测试的规则

**原则**: 跳过测试（`test.skip`）是技术债务，必须有明确的修复计划

**当前跳过的测试**:
```javascript
// test/channels.test.js:233
test.skip('a client is told to wait', async (t) => {
  // 问题: Core 和 Transport 层的同步状态不一致
  // 修复计划: v0.3.0 重构同步状态管理
  // 跟踪: ROADMAP.md "Technical Debt"
});
```

**流程**:
1. 添加 `test.skip` 时必须注释说明：
   - 问题原因
   - 修复计划
   - 跟踪位置
2. 每个 minor 版本发布前 review 所有跳过测试
3. 超过 2 个版本的跳过测试要么修复要么删除

## 测试质量指标

### 目标

- **通过率**: ≥ 99% （跳过测试不计入分母）
- **执行速度**: 
  - 单元测试 < 500ms 总计
  - 集成测试 < 5s 总计
  - E2E 测试 < 60s
- **覆盖率**: 不强制要求数字，但关键路径必须覆盖
- **CI 稳定性**: 主分支 CI 通过率 ≥ 95%

### 当前状态

- ✅ 通过率: 99.6% (228/229)
- ✅ 执行速度: 单元+集成 ~0.5s
- ✅ CI 稳定性: 最近 5 次 CI 全部成功

## 重构计划

### 立即执行（v0.2.1）

1. **删除空文件**
   ```bash
   rm test/client-server-contract.test.js
   ```
   理由: 契约测试已在其他文件充分覆盖

2. **更新 package.json 测试脚本**
   ```json
   {
     "scripts": {
       "test": "node --test test/*.test.js",
       "test:browser": "node --test test/browser/*.test.cjs"
     }
   }
   ```

### 中期（v0.3.0）

3. **修复跳过的同步测试**
   - 重构 Core 和 WebSocket Transport 的同步状态传递
   - 确保 SYNC_IN_PROGRESS 错误能正确发送
   - 取消 `test.skip`

4. **添加性能基准测试**
   - 消息吞吐量
   - 并发连接数
   - 内存占用

### 长期（v1.0）

5. **移除 Protocol v1-v3 兼容性测试**
   - 在 v0.9.0 删除废弃协议后，清理相关测试

6. **考虑快照测试**
   - 对于复杂的客户端状态转换，使用快照减少断言代码

## 参考资料

- [CONTRIBUTING.md](../CONTRIBUTING.md) - 贡献者测试要求
- [ROADMAP.md](../ROADMAP.md) - 功能路线图
- [docs/architecture/](./architecture/) - 架构决策记录
