# README 与示例配置同步修改建议

这份文件记录本轮应立即同步到现有文档的最小修改。它不是新的长期文档，应用后可以删除。

## 1. README：修正 `readOnly` 语义

现有“当前只读边界”段落中，删除：

> `enabled: false` 的频道完全不可加入；Pavilo 没有只读频道权限。若需要公告频道，只能先停用，不能将其当作“只有管理员能发言”

改为：

> `enabled: false` 的频道完全不可加入；`readOnly: true` 的频道可以进入和阅读，但当前所有普通参与者都不能发送消息。Pavilo 暂无角色权限，因此还不支持“管理员可发、普通成员只读”的公告权限模型。

建议把小标题从“当前只读边界”改为“当前能力边界”。

---

## 2. README：修正默认频道

现有：

> 不提供 `channels` 时，会保留内置 `general` 和 `awesome-ai`

改为：

> 不提供 `channels` 时，会保留内置 `general` 和 `project`

---

## 3. README：修正频道校验描述

现有：

> 至少要启用一个频道；停用频道无法加入，也不存在绕过此限制的“只读”角色。

改为：

> 至少要启用一个可发言频道；`enabled: false` 的频道无法加入；`readOnly: true` 的频道可以加入但不能发送。当前没有角色系统，因此没有管理员绕过 `readOnly` 的例外。

---

## 4. README：开发文档链接

在：

> 模块边界和维护约定见架构概览、协议契约、状态契约和设计语言。

增加：

- `docs/architecture/evolution.md`：架构演进与版本策略；
- `ROADMAP.md`：具体版本规划。

---

## 5. pavilo.example.yaml：把 `readOnly` 写进示例

建议把 channels 示例调整为：

```yaml
channels:
  # 通用闲聊频道
  - id: general
    name: 闲聊
    description: 轻松聊聊，只留当下。
    enabled: true
    readOnly: false
    maxUsers: 64

  # 项目讨论频道
  - id: project
    name: 项目讨论
    description: 聚焦项目，高效协作。
    enabled: true
    readOnly: false
    maxUsers: 32

  # 静态只读频道
  # readOnly: true 表示参与者可以进入和阅读，但不能发送消息。
  # 当前没有角色权限，因此不存在“管理员可写”的例外。
  - id: announcements
    name: 公告
    description: 只读公告频道示例。
    enabled: true
    readOnly: true
    maxUsers: 64
```

同时将 `room.defaultChannel` 注释补充为：

> 默认频道必须 `enabled: true` 且不能是 `readOnly: true`。

---

## 6. ROADMAP

用本目录提供的新 `ROADMAP.md` 整体替换当前 ROADMAP。

关键变化：

- v1.0 不再等待 SQLite / 权限 / Agent；
- v1.0 明确定义为 Ephemeral Stable；
- SQLite 进入 v1.1；
- Persistence Hardening 进入 v1.2；
- Extension Foundation 进入 v1.3；
- Agent / Gateway、Access / Moderation 分别后移；
- v2 只作为 breaking-change 门槛，不绑定某个功能。

---

## 7. 推荐的后续文档任务（v0.2）

新建：

```text
CONTRIBUTING.md
SECURITY.md
docs/adr/
```

暂时不要为了“文档齐全”一次性创建大量空文档。等 CI、协议策略、SQLite 选型分别做出真实决定时再写 ADR。
