# Architecture Decision Records

本目录记录 Pavilo 的重要架构决策。每个 ADR 遵循以下结构：

- **Status**：提议 / 已接受 / 已废弃 / 已替代
- **Context**：为什么需要做这个决策
- **Decision**：我们决定怎么做
- **Alternatives**：考虑过但放弃的方案
- **Consequences**：这个决策的影响

## 原则

ADR 不是"所有技术选择的流水账"，而是**会影响未来 1-3 年架构演进的关键决策**。

以下场景需要 ADR：
- 引入/移除核心依赖
- 定义公开 API 的兼容策略
- 在多个技术方案间做出不可逆的选择
- 明确产品边界（什么不做）

## 决策索引

| ADR | 标题 | 状态 | 日期 |
|-----|------|------|------|
| [0001](0001-protocol-v4-only-for-v1.md) | v1.0 只承诺 Protocol v4 | 已接受 | 2026-09-15 |
| [0002](0002-sqlite-pragmatic-hybrid.md) | SQLite 驱动：node:sqlite 优先的实用主义方案 | 已接受 | 2026-09-15 |
| [0003](0003-extension-as-trusted-scripts.md) | Extension 作为可信脚本，而非沙箱插件系统 | 已接受 | 2026-09-15 |
| [0004](0004-operator-config-dual-source.md) | Operator 配置双源（YAML 启动 + SQLite 管理页） | 已接受 | 2026-09-20 |
| [0005](0005-in-process-ai-gateway.md) | 进程内 AI 网关（preset、用量、非微服务） | 已接受 | 2026-09-20 |
| 0006 | Play 契约（频道绑定、独立玩法页、playAction 信封） | 计划于 v1.5 开工前 | — |

ADR-0003 仍是加载模型：trusted script，不是沙箱。官方维护基础设施（网关、Play 契约）和参考实现（狼人杀）；其他玩法按 0006 的契约贡献，不另开商店。

## 编写指南

### 何时写 ADR

在实现前写，而不是实现后补文档。

**需要：**
```
我们在考虑用 node:sqlite 还是 better-sqlite3
→ 先写 ADR，明确选择依据
→ 实现时按 ADR 执行
```

**不需要：**
```
我们要用 YAML 而不是 JSON 做配置
→ 太常规，不需要 ADR
```

### 模板

```markdown
# ADR-XXXX: 标题

## Status

提议 / 已接受 / 已废弃（被 ADR-YYYY 替代）

## Context

（3-5 段）
- 当前面临什么问题
- 有哪些约束条件
- 产品/技术背景

## Decision

（2-3 段）
- 我们决定做什么
- 具体方案

## Alternatives

（每个方案 1 段）
- 方案 A：为什么不选
- 方案 B：为什么不选

## Consequences

### 好的影响
- ...

### 坏的影响 / 权衡
- ...

### 未来工作
- ...
```

## 废弃 ADR

不删除，而是更新 Status 为"已废弃"，并说明被哪个 ADR 替代。

这样可以追溯历史决策的演变。
