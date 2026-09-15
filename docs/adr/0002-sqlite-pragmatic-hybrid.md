# ADR-0002: SQLite 驱动的实用主义混合方案

## Status

已接受（2026-09-15）

## Context

v1.1 将引入可选的 SQLite 持久化模式。需要选择底层 SQLite 驱动。

### 候选方案

#### Option A: Node 内置 `node:sqlite`
- **引入时间**：Node 22.5.0（2024-07-17）
- **状态**：Experimental（截至 2026-09-15）
- **API**：`DatabaseSync` 提供同步接口
- **依赖**：零，Node 内置
- **部署**：零编译，`npm install && node server.js` 即可

#### Option B: `better-sqlite3`
- **成熟度**：生产验证多年，GitHub 6k+ stars
- **性能**：高度优化，benchmark 通常优于其他方案
- **依赖**：原生模块，需要编译
- **部署**：
  - Docker 需要 `build-essential`（增加镜像大小 100+ MB）
  - ARM 设备（树莓派）可能编译失败
  - Windows 需要 `windows-build-tools`

### 产品约束

Pavilo 的核心原则：
1. **Ephemeral First**：SQLite 是可选的，memory mode 永远是一等公民
2. **极简部署**：理想情况下，用户克隆仓库后 `npm install && node server.js` 就能跑起来
3. **Optional Means Optional**：持久化是"按需生长"的能力，不应显著增加默认部署复杂度

### 技术约束

1. **同步 vs 异步**
   - 当前 Pavilo 的 core 是同步的（命令 → 状态变更 → 事件发射）
   - SQLite 同步接口与现有架构完美契合，无需重写成 async pipeline
   - 未来如果真的需要远程数据库（PostgreSQL），那是 v2.0 的 breaking change

2. **Node 版本支持**
   - v1.1 预计 2027 年发布（因为 v1.0 本身要走完 v0.2-v0.9）
   - 到那时 Node 22 已经是 LTS，Node 18 接近 EOL

3. **性能需求**
   - Pavilo 的典型场景是 10-50 人的小团队
   - 不是"每秒 10k 消息"的高并发聊天系统
   - 如果 `node:sqlite` 性能够用，零依赖的价值 > 最后 10% 性能优化

## Decision

**v1.1 默认使用 `node:sqlite`，但允许用户显式启用 `better-sqlite3` 作为性能后备方案。**

### 配置设计

```yaml
version: 2

storage:
  driver: sqlite
  sqlite:
    path: ./data/pavilo.db
    engine: auto  # 可选：auto | node | better-sqlite3
    retentionDays: 30
```

**`engine` 字段语义：**

- **`auto`（默认）**：
  - Node 22.5+ → 使用 `node:sqlite`
  - Node < 22.5 → 尝试 `require('better-sqlite3')`，如果未安装则报错并提示升级 Node

- **`node`**：
  - 强制使用 `node:sqlite`
  - Node < 22.5 时启动失败，提示升级 Node 或改用 `better-sqlite3`

- **`better-sqlite3`**：
  - 强制使用 `better-sqlite3`
  - 未安装时启动失败，提示 `npm install better-sqlite3`

### 实现策略

```js
// src/storage/sqlite-adapter.js
function createSQLiteAdapter(config) {
  const engine = config.sqlite.engine || 'auto';
  let db;

  if (engine === 'node' || (engine === 'auto' && isNodeSQLiteAvailable())) {
    const { DatabaseSync } = require('node:sqlite');
    db = new DatabaseSync(config.sqlite.path);
    console.log(`[storage] Using node:sqlite (Node ${process.version})`);
  } else if (engine === 'better-sqlite3' || engine === 'auto') {
    try {
      const Database = require('better-sqlite3');
      db = new Database(config.sqlite.path);
      console.log('[storage] Using better-sqlite3');
    } catch (err) {
      if (engine === 'auto') {
        throw new Error('SQLite requires Node 22.5+ or better-sqlite3. Run: npm install better-sqlite3');
      }
      throw err;
    }
  }

  // 统一的 Adapter 接口，隐藏底层差异
  return new SQLiteConversationStore(db);
}

function isNodeSQLiteAvailable() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  return major > 22 || (major === 22 && minor >= 5);
}
```

### package.json 依赖

```json
{
  "dependencies": {
    "yaml": "^2.3.0"
  },
  "optionalDependencies": {
    "better-sqlite3": "^11.0.0"
  },
  "engines": {
    "node": ">=18.0.0"
  }
}
```

**说明：**
- `better-sqlite3` 作为 `optionalDependencies`，npm install 失败不会导致安装失败
- 引擎要求保持 `>=18`，但 SQLite 功能在 `<22.5` 时需要 `better-sqlite3`

### 文档策略

#### README 中的快速开始

```markdown
## 持久化模式（可选）

默认情况下，Pavilo 在内存中运行，停服后历史清空。如果需要持久化：

**Node 22.5+（推荐）**
```yaml
# pavilo.yaml
storage:
  driver: sqlite
  sqlite:
    path: ./data/pavilo.db
```

**Node 18-22.4（需要额外依赖）**
```bash
npm install better-sqlite3
# 配置同上
```

性能优化：如果遇到大量消息时延迟，可以显式使用 `better-sqlite3`：
```yaml
storage:
  sqlite:
    engine: better-sqlite3
```
```

#### Dockerfile 策略

```dockerfile
# 默认镜像：零编译，适合大多数用户
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .
CMD ["node", "server.js"]
```

```dockerfile
# performance.Dockerfile：针对高负载场景
FROM node:22-alpine
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package*.json ./
RUN npm ci --production --include=optional
COPY . .
CMD ["node", "server.js"]
```

文档中说明：
> 默认 Dockerfile 不编译 `better-sqlite3`，适合大多数场景。如果你的实例有 100+ 人或需要最佳性能，使用 `docker build -f performance.Dockerfile`。

## Alternatives

### 方案 A：只用 `node:sqlite`

**理由：**
- 最简单
- 零依赖

**为什么不选：**
- **过早承诺**。如果 `node:sqlite` 性能不够，或 API 在 Experimental 阶段变化，我们会被锁死
- **逼迫所有人升级 Node**。某些生产环境可能在 2027 年仍然运行 Node 20

### 方案 B：只用 `better-sqlite3`

**理由：**
- 生产验证，性能最优
- API 稳定

**为什么不选：**
- **违背"极简部署"原则**。用户在树莓派、NAS 上跑 Pavilo，可能因为编译失败而放弃
- **Docker 镜像膨胀**。默认镜像从 100 MB 变成 250+ MB
- **失去 Node 生态的长期红利**。`node:sqlite` 最终会稳定，到时候我们仍然背负编译依赖

### 方案 C：抽象层 + 运行时插件

```yaml
storage:
  adapter: @pavilo/sqlite-better
```

**理由：**
- 最大灵活性，未来可以支持 PostgreSQL、MySQL

**为什么不选：**
- **过度设计**。Pavilo 明确不支持远程数据库（见 ROADMAP）
- **增加复杂度**。插件系统本身就是一个大工程

## Consequences

### 好的影响

1. **保持零编译依赖的默认体验**
   - 用户在 Node 22+ 环境下，`npm install && node server.js` 仍然可以直接启动
   - 符合 Pavilo "一条命令启动"的产品承诺

2. **给高性能用户留后路**
   - 如果 `node:sqlite` 性能不够，可以无痛切换到 `better-sqlite3`
   - 通过 `ConversationStore` 接口隔离，切换对上层透明

3. **延迟最终决策**
   - v1.1 不需要现在就确定"永远用 X"
   - v1.2 可以根据真实反馈调整默认策略

4. **适应 Node 生态演进**
   - 如果 `node:sqlite` 在 2027 年毕业为稳定 API，我们不需要改代码
   - 如果它仍然 experimental，我们可以在 v1.2 切换默认为 `better-sqlite3`

### 坏的影响 / 权衡

1. **两套代码路径**
   - 需要测试两种驱动的行为差异
   - **缓解措施**：通过 `ConversationStore` 契约测试保证一致性

2. **文档复杂度增加**
   - 用户需要理解"什么时候需要 better-sqlite3"
   - **缓解措施**：默认 `engine: auto` 自动选择，99% 用户不需要关心

3. **`node:sqlite` 的 Experimental 风险**
   - 如果 API 在 v1.1 发布后发生变化，需要跟进
   - **缓解措施**：
     - v1.1 发布前验证 Node 22 LTS 的 API 稳定性
     - 如果风险太大，v1.2 可以切换默认为 `better-sqlite3`

### 未来工作

1. **v1.1 实施**
   - 实现 `createSQLiteAdapter` 的双引擎切换逻辑
   - 编写 SQLite 契约测试，分别跑两种驱动
   - 文档说明两种场景的使用方式

2. **v1.2 评估**
   - 收集社区反馈：`node:sqlite` 是否稳定？性能是否够用？
   - 如果 `node:sqlite` 仍然 experimental 或性能不佳，考虑切换默认为 `better-sqlite3`
   - 如果 `node:sqlite` 表现良好，可以在文档中淡化 `better-sqlite3` 的存在感

3. **性能基准**
   - 建立 benchmark：1000 条消息插入、历史分页查询、并发写入
   - 对比 `node:sqlite` 和 `better-sqlite3` 的实际差异
   - 根据数据决定是否需要调整推荐

## 相关决策

- **与 ADR-0001 的关系**：同步接口与 Protocol v4 的命令模型完美契合，不需要异步改造
- **与 ROADMAP 的关系**：不为"未来可能支持 PostgreSQL"提前复杂化（ROADMAP 原则 7）
- **与 Extension 的关系**（ADR-0003）：Extension 不应直接操作 SQLite，必须通过 Command API
