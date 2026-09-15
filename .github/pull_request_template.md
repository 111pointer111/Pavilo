name: Pull Request
about: 为 Pavilo 贡献代码
title: ''
labels: ''
assignees: ''

---

## 变更类型

请勾选适用的选项：

- [ ] 🐛 Bug 修复
- [ ] ✨ 新功能
- [ ] 📝 文档更新
- [ ] ♻️ 代码重构
- [ ] ⚡️ 性能优化
- [ ] ✅ 测试相关
- [ ] 🔨 构建/工具链

## 变更说明

**解决了什么问题？**
<!-- 简要描述这个 PR 做了什么 -->

**相关 Issue**
<!-- 如果有相关 Issue，请引用，例如：Closes #123 -->

## 测试

**如何测试？**
<!-- 描述你如何验证这个变更 -->
- [ ] 运行了 `npm test`，所有测试通过
- [ ] 运行了 `npm run config:check`
- [ ] 手动测试了以下场景：
  - ...

## 代码审查清单

请确认以下问题（来自 [CONTRIBUTING.md](CONTRIBUTING.md)）：

- [ ] 默认 ephemeral 用户没有被迫承担额外复杂度
- [ ] 业务规则没有进入 transport 层
- [ ] 新 IO 可以在测试中替换（注入）
- [ ] Public contract 有测试覆盖
- [ ] 错误处理和边界情况已考虑
- [ ] 文档已同步更新（如果需要）

## Breaking Changes

- [ ] 这个 PR 包含不兼容变更

**如果包含 Breaking Changes，请说明：**
<!-- 
- 什么变更不兼容？
- 用户需要如何迁移？
- 是否需要在提交信息中标记 BREAKING CHANGE？
-->

## 文档更新

如果你的 PR 涉及以下变更，请确认已同步更新：

- [ ] 新配置字段 → `pavilo.example.yaml` + README
- [ ] Protocol 变更 → `docs/architecture/chat-protocol.md`
- [ ] 架构变更 → `docs/architecture/` 或新增 ADR

## 截图（如果涉及 UI）

<!-- 如果修改了前端，请提供截图或录屏 -->

## 其他信息

<!-- 任何其他相关信息 -->
