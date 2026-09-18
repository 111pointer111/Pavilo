# 版本号管理流程

本文档定义 Pavilo 的版本号管理规范和发布流程。

## 版本号规则

Pavilo 从 v1.0.0 开始遵循 [语义化版本 2.0.0](https://semver.org/lang/zh-CN/)。

### 版本号格式

```
v{MAJOR}.{MINOR}.{PATCH}[-{PRERELEASE}]
```

### 版本号含义

- **MAJOR（主版本号）**：不兼容的 API 变更
- **MINOR（次版本号）**：向后兼容的新功能
- **PATCH（修订号）**：向后兼容的问题修复

### v1.0 之前的版本（Alpha/Beta）

- `v0.x.y`：开发阶段，API 可能不稳定
- `v1.0.0`：第一个稳定版本

## 何时升级版本号

### 升级 PATCH（修订号）

**触发条件**：
- Bug 修复
- 安全漏洞修复
- 性能优化（不改变 API）
- 文档更新（不涉及功能变更）

**示例**：
- `v1.2.3` → `v1.2.4`：修复消息发送失败问题
- `v1.2.4` → `v1.2.5`：修复安全漏洞 CVE-2024-XXXX

**注意事项**：
- 不应包含新功能
- 不应改变现有行为（除非是修复 Bug）
- 不应更改 API

### 升级 MINOR（次版本号）

**触发条件**：
- 添加新功能（向后兼容）
- 标记已有功能为 deprecated（但不移除）
- 内部实现大幅改进
- 添加新的配置选项（有默认值）

**示例**：
- `v1.2.5` → `v1.3.0`：添加 SQLite 持久化支持
- `v1.3.0` → `v1.4.0`：添加用户认证功能

**注意事项**：
- PATCH 重置为 0
- 旧功能必须继续工作
- 新功能可选，不影响现有用户

### 升级 MAJOR（主版本号）

**触发条件**：
- 移除已 deprecated 的功能
- 更改现有 API 行为
- 配置文件格式不兼容
- 需要用户手动迁移

**示例**：
- `v1.9.0` → `v2.0.0`：移除 Protocol v1/v2/v3 支持
- `v2.5.0` → `v3.0.0`：配置文件格式改为 TOML

**注意事项**：
- MINOR 和 PATCH 重置为 0
- 必须提供迁移指南
- 充分的废弃期（至少 1-2 个 MINOR 版本）

## Pavilo 的四类版本

Pavilo 同时维护四类版本号，各自独立演进：

| 版本类型 | 示例 | 位置 | 说明 |
|---------|------|------|------|
| App Version | `1.2.3` | `package.json` | 发布版本 |
| Config Schema | `1` / `2` | YAML `version:` | 配置文件格式 |
| WebSocket Protocol | `4` / `5` | 握手时协商 | 客户端-服务端协议 |
| Database Schema | `1` / `2` | 迁移脚本 | SQLite 内部版本 |

### 版本关系示例

```
App v1.5.0
├─ Config Schema v1 (兼容)
├─ WebSocket Protocol v4 (支持 v3 向后兼容)
└─ Database Schema v2 (从 v1 自动迁移)

App v2.0.0
├─ Config Schema v2 (不兼容，需迁移)
├─ WebSocket Protocol v5 (移除 v3 支持)
└─ Database Schema v3 (从 v1/v2 自动迁移)
```

### 重要原则

- **SQLite 本身不等于 v2.0**
  - 如果默认行为仍为 memory mode
  - 如果旧配置继续可运行
  - 那么加入 SQLite 适合作为 `v1.1.0`

- **Protocol 升级不强制 MAJOR**
  - 如果向后兼容（支持旧协议）
  - 那么 Protocol v5 可以在 `v1.x.0` 中引入

## 发布流程

### 1. 准备发布

#### 1.1 确认版本号

根据变更内容确定版本号：

```bash
# 查看自上次发布以来的变更
git log v0.5.0..HEAD --oneline

# 确定版本号类型
# - 只有 fix/docs/test？→ PATCH
# - 有 feat？→ MINOR
# - 有 breaking change？→ MAJOR
```

#### 1.2 更新 CHANGELOG

在 `CHANGELOG.md` 中：

```markdown
## [Unreleased]

## [0.6.0] - 2024-12-19

### Added
- 功能 A
- 功能 B

### Changed
- 变更 A

### Fixed
- 修复 A (#123)
- 修复 B (#456)

### Security
- 安全修复 A

### Deprecated
- 废弃 API A（将在 v0.8.0 移除）
```

**分类说明**：
- `Added` - 新功能
- `Changed` - 功能变更
- `Deprecated` - 即将废弃
- `Removed` - 已移除功能
- `Fixed` - Bug 修复
- `Security` - 安全修复

#### 1.3 更新 package.json

```bash
# 手动编辑 package.json
vim package.json

# 或使用 npm version（自动创建 commit 和 tag）
npm version minor -m "chore: release v%s"
```

#### 1.4 更新 ROADMAP.md

标记当前版本为已完成：

```markdown
## v0.6.0 — Quality Assurance（已完成）

### 发布门槛（✅ 全部满足）

- ✅ Issue 模板完善
- ✅ Bug 修复流程文档化
- ✅ 版本号管理流程明确
```

### 2. 提交和打标签

#### 2.1 提交版本变更

```bash
# 添加所有版本相关文件
git add CHANGELOG.md package.json ROADMAP.md

# 提交（使用规范格式）
git commit -m "chore(release): v0.6.0

- 新增 Issue 模板
- 新增 Bug 分类和修复流程文档
- 新增版本号管理流程文档

详见 CHANGELOG.md"
```

#### 2.2 创建 Git 标签

```bash
# 创建带注释的标签
git tag -a v0.6.0 -m "Release v0.6.0: Quality Assurance

主要更新：
- Issue 模板（Bug 报告、功能请求、安全问题）
- Bug 分类和优先级标准
- Bug 修复 Checklist
- 版本号管理流程

详见 CHANGELOG.md"

# 查看标签
git tag -n9 v0.6.0
```

#### 2.3 推送到远程

```bash
# 推送代码
git push origin main

# 推送标签
git push origin v0.6.0
```

### 3. 自动发布

推送标签后，GitHub Actions 会自动：

1. 触发 `.github/workflows/release.yml`
2. 运行测试
3. 创建 GitHub Release
4. 附加 CHANGELOG 内容

### 4. 验证发布

```bash
# 检查 GitHub Release
gh release list

# 查看最新 Release
gh release view v0.6.0

# 或访问
# https://github.com/{user}/{repo}/releases/tag/v0.6.0
```

### 5. 宣布发布

- [ ] 更新 README（如果有重要变更）
- [ ] 在 Discussions 发布公告
- [ ] 更新官方文档
- [ ] 通知重要用户（如果是重大版本）

## Release Checklist

打标签前：

- [ ] `package.json` 版本号与 CHANGELOG 标题一致
- [ ] ROADMAP 对应版本已标记完成
- [ ] `npm ci && npm test && npm run config:check` 通过
- [ ] `npm audit --audit-level=high` 无高危
- [ ] README / README.en.md 版本号与协议说明已更新
- [ ] 协议、`/room-info`、`/healthz` 文档与实现一致
- [ ] SECURITY.md 联系方式不是占位符
- [ ] breaking change 写在 CHANGELOG 的 Removed/Changed，并有迁移说明

打标签后：

- [ ] GitHub Release 已创建（v0.x 为 pre-release）
- [ ] GHCR 镜像标签符合策略：SemVer 发布带 `{{version}}`、`{{major}}.{{minor}}` 和 `latest`；`{{major}}`（如 `1`）从 v1.0 起打
- [ ] 手工更新 GitHub Description / Topics（不进代码仓库）

v1.0 额外：

- [ ] v0.9 RC 在目标环境观察至少 7 天无阻塞问题

## Git 提交规范

### Commit Message 格式

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Type 类型

- `feat` - 新功能
- `fix` - Bug 修复
- `docs` - 文档变更
- `style` - 代码格式（不影响功能）
- `refactor` - 重构（不是 fix 也不是 feat）
- `perf` - 性能优化
- `test` - 测试相关
- `chore` - 构建过程或辅助工具变动
- `revert` - 回退之前的 commit

### Scope 范围

- `core` - 核心业务逻辑
- `transport` - HTTP/WebSocket 传输层
- `client` - 客户端代码
- `config` - 配置相关
- `docker` - Docker 相关
- `deps` - 依赖更新
- `release` - 发布相关

### Subject 规范

- 使用中文或英文（保持一致）
- 使用祈使句，现在时
- 首字母小写
- 结尾不加句号
- 不超过 50 字符

### Body 规范

- 详细说明变更的动机
- 对比变更前后的行为
- 每行不超过 72 字符

### Footer 规范

- 关联 Issue：`Closes #123` 或 `Fixes #456`
- 不兼容变更：`BREAKING CHANGE: 说明`
- 多个 Issue：`Closes #123, #456, #789`

### 示例

```
feat(client): 添加离线消息缓存功能

当网络离线时，将未发送的消息缓存到 localStorage，
在网络恢复后自动重新发送。

- 添加 OfflineQueue 模块
- 在 connection 模块中集成
- 添加相关测试

Closes #234
```

```
fix(transport): 修复 WebSocket 连接泄露问题

在频繁重连的场景下，旧连接没有正确关闭，
导致连接数累积最终耗尽资源。

修复方案：
- 在创建新连接前关闭旧连接
- 添加连接清理逻辑
- 增强连接状态追踪

Closes #567
```

```
chore(release): v0.6.0

- 新增 Issue 模板
- 新增 Bug 分类和修复流程文档
- 新增版本号管理流程文档

详见 CHANGELOG.md
```

## 版本分支策略

### 主分支（Main Branch）

- `main` - 稳定分支，每次 commit 都应该可发布
- 所有功能和修复最终合并到 `main`
- 发布时从 `main` 打标签

### 功能分支（Feature Branches）

```
feature/issue-123-user-authentication
feature/sqlite-integration
```

### 修复分支（Fix Branches）

```
fix/issue-456-message-send-failure
fix/security-xss-vulnerability
```

### 发布分支（Release Branches）

通常不需要，但如果需要维护旧版本：

```
release/v1.x
release/v2.x
```

## 热修复流程

针对生产环境的紧急 Bug：

### 1. 创建热修复分支

```bash
# 从最新发布标签创建分支
git checkout -b hotfix/v1.2.4 v1.2.3
```

### 2. 修复问题

```bash
# 修复代码
# 添加测试
# 更新 CHANGELOG
```

### 3. 发布热修复版本

```bash
# 提交修复
git commit -m "fix: 修复关键问题"

# 更新版本号
npm version patch -m "chore: release v1.2.4"

# 合并回 main
git checkout main
git merge --no-ff hotfix/v1.2.4

# 推送
git push origin main
git push origin v1.2.4

# 删除分支
git branch -d hotfix/v1.2.4
```

## 版本废弃策略

### 废弃流程

1. **标记废弃**（在 MINOR 版本中）
   ```javascript
   // DEPRECATED: 此 API 将在 v2.0.0 中移除，请使用 newApi 代替
   function oldApi() { ... }
   ```

2. **文档说明**（更新 CHANGELOG）
   ```markdown
   ### Deprecated
   - `oldApi()` 已废弃，将在 v2.0.0 中移除。请使用 `newApi()` 代替。
   ```

3. **保持至少 1-2 个 MINOR 版本**
   - v1.5.0: 标记废弃
   - v1.6.0: 继续保留
   - v1.7.0: 继续保留（可选）
   - v2.0.0: 移除

4. **移除**（在 MAJOR 版本中）
   ```markdown
   ### Removed
   - `oldApi()` 已移除。请使用 `newApi()` 代替。
   ```

### 迁移指南

每次 MAJOR 版本发布时，提供迁移指南：

```markdown
# 从 v1.x 迁移到 v2.0

## Breaking Changes

### API 变更

**oldApi() 已移除**

旧代码：
\`\`\`javascript
oldApi(param);
\`\`\`

新代码：
\`\`\`javascript
newApi({ param });
\`\`\`

### 配置变更

**配置格式改为 version: 2**

旧配置：
\`\`\`yaml
version: 1
setting: value
\`\`\`

新配置：
\`\`\`yaml
version: 2
settings:
  key: value
\`\`\`

## 自动迁移工具

提供迁移脚本：
\`\`\`bash
npx pavilo-migrate v1-to-v2 config.yaml
\`\`\`
```

## 常见问题

### Q: 忘记更新 CHANGELOG 怎么办？

A: 在下一个 PATCH 版本中补充，并在 commit message 中说明。

### Q: 打错标签怎么办？

A: 删除本地和远程标签，重新打标签：

```bash
# 删除本地标签
git tag -d v0.6.0

# 删除远程标签
git push origin :refs/tags/v0.6.0

# 重新打标签
git tag -a v0.6.0 -m "..."
git push origin v0.6.0
```

### Q: 需要修改已发布版本的 CHANGELOG 怎么办？

A: 不要修改已发布版本的内容。在下一个版本的 CHANGELOG 中添加说明。

### Q: 何时使用预发布版本（prerelease）？

A: Pavilo 目前不使用预发布版本。v1.0 之前的 v0.x.y 版本本身就是 alpha/beta 阶段。

## 参考资源

- [语义化版本 2.0.0](https://semver.org/lang/zh-CN/)
- [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)
- [Conventional Commits](https://www.conventionalcommits.org/zh-hans/)
- [Bug 修复 Checklist](bug-fix-checklist.md)
- [CONTRIBUTING.md](../CONTRIBUTING.md)
