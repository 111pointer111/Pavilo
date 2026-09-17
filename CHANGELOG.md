# Changelog

All notable changes to Pavilo will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.8.0] - 2026-09-17

### Added
- **轻量 i18n**：无构建步骤的纯 JS 字典 + `{var}` 插值（`client/i18n.js`）
- 简体中文与英语界面，顶栏语言切换；选择写入 `localStorage`（`pavilo.language`）
- 配置项 `room.defaultLanguage`（仅 `zh-CN` / `en`），`/room-info` 公开 `defaultLanguage` 与 `supportedLanguages`
- `PROTOCOL_NOT_SUPPORTED` 升级提示文案（中英），为 v0.9 协议清理做准备

### Improved
- 静态文案通过 `data-i18n` / `data-i18n-html` 更新；动态文案统一走 `t()`
- 日期、时长、`html lang` 随当前语言切换

### Technical
- 客户端白名单 13 → 14 个文件（`i18n.js` 排在 `app.js` 之前）
- 总测试数：267 个（266 通过，1 跳过）

## [0.7.0] - 2024-12-19

### Added
- **用户文档**
  - 配置指南（docs/configuration.md）- 所有配置项详细说明
  - 故障排查指南（docs/troubleshooting.md）- 常见问题和解决方案
- **API 文档**
  - HTTP API 文档（docs/api/http-api.md）
  - WebSocket 协议文档（docs/api/websocket-protocol.md）
- **多语言**
  - 英文版 README（README.en.md）- 完整核心信息英文入口
  - 中英文 README 互相跳转

### Improved
- 文档体系完善
- 用户和开发者文档齐全
- 故障排查流程清晰
- README 版本号漂移修正（v0.1 Alpha → v0.7.0）

### Fixed
- **v0.5.0 遗留问题：`error-states.js` 与 `performance.js` 是死代码**（此前既未进静态白名单、也未被任何代码引用）
  - 两个模块加入 `src/transport/http.js` 的 `CLIENT_FILES` 白名单（11 → 13 个文件）
  - `index.html` 引入两个脚本，`performance.js` 排在 `overlays.js` 之前
  - 错误反馈统一接入 `app.js`：连接状态指示器由 `errorController` 单一维护，
    离线 / 重连彻底失败 / 恢复分别走 `handleError` / `showErrorOverlay` / `clearError`
  - 新增阻塞性错误覆盖层（`#errorOverlay`）：重连彻底失败时用整屏提示 + "刷新页面"按钮，
    取代原先一闪而过的 toast
  - `overlays.js` 的成员列表用 `shouldRebuildList` 跳过无变化的整表重建
  - `app.js` 的频道占用更新用 `smartUpdate`，人数未变时不重写 `innerHTML`
  - 裁剪 `performance.js`：移除 6 个没有任何调用点的 helper，只保留真正被使用的两个
  - 新增 `test/client-assets-wiring.test.js`：强制白名单与 `index.html` 保持一致
- 文档全部按代码核实，消除"文档漂移"：
  - 配置字段名与 `pavilo.example.yaml` / 配置加载器严格对齐（此前部分示例使用了 schema 之外的字段名，照抄会导致启动失败）
  - 默认端口统一为 `4173`（此前部分示例误用 `3000`）
  - 启动日志示例改为 `server.js` 的真实输出格式
  - `/healthz` 响应体改为真实的 `{ ok, users, messages, roomBytes, clients, ephemeral }`；
    并说明实现中**没有返回非 200 的分支**
  - 错误信息改为配置加载器的真实文案（如 `room.defaultChannel: 默认频道不能是只读频道`）
  - 文档中的完整配置示例已通过 `npm run config:check` 实测
- 既有文档的同类漂移：
  - `docs/architecture/chat-protocol.md`：频道公开字段补上遗漏的 `readOnly` 与 `welcome`，
    并补上 `deprecatedProtocols`
  - `docs/healthcheck.md`：删除不存在的 "503 Service Unavailable" 分支描述

### Technical
- 总测试数：260 个（259 通过，1 跳过）
- 新增 6 个文档文件、1 个接线回归测试
- 现有架构文档已完善（docs/architecture/）

## [0.6.0] - 2024-12-19

### Added
- Issue 模板系统
  - Bug 报告模板（.github/ISSUE_TEMPLATE/bug_report.md）
  - 功能请求模板（.github/ISSUE_TEMPLATE/feature_request.md）
  - 安全问题报告模板（.github/ISSUE_TEMPLATE/security_report.md）
  - Issue 模板配置文件（.github/ISSUE_TEMPLATE/config.yml）
- Bug 管理文档
  - Bug 分类和优先级标准（docs/bug-classification.md）
  - Bug 修复 Checklist（docs/bug-fix-checklist.md）
- 版本号管理流程文档（docs/version-management.md）
  - 语义化版本规则
  - 发布流程完整指南
  - Git 提交规范
  - 版本废弃策略
  - 热修复流程

### Improved
- 质量保证流程标准化
- Issue 管理更规范
- 版本发布流程更清晰

### Technical
- 测试保持稳定：254 个（253 通过，1 跳过）
- 新增 4 个 GitHub 模板文件
- 新增 3 个流程文档

## [0.5.0] - 2024-12-19

### Added
- 错误状态统一管理模块（client/error-states.js）
- 性能优化工具模块（client/performance.js）
- 浏览器兼容性验收清单（docs/v0.5.0-browser-compatibility.md）
- 错误状态测试套件（7 个测试）
- 性能工具测试套件（13 个测试）

### Improved
- 统一错误状态反馈系统（网络离线、连接失败、服务停止、频道不可用）
- 只读频道 UI 已完善（🔒 图标、禁用输入、明确提示）
- 图片懒加载已在 v0.3.0 实现（使用 loading="lazy" 属性）
- DOM 批量更新工具，减少大量数据下的性能开销
- 节流和防抖工具，优化频繁更新的性能

### Changed
- 错误提示文案更清晰、更易理解
- 连接状态指示器支持更多状态变体（离线、连接中、警告）

### Technical
- 新增 20 个测试用例
- 总测试数：254 个（253 通过，1 跳过）
- 测试覆盖率保持稳定

## [0.4.0] - 2024-12-19

### Added
- HTTP security headers for enhanced protection
  - X-Frame-Options: DENY (prevents clickjacking)
  - Referrer-Policy: strict-origin-when-cross-origin (controls referrer leakage)
  - Applied uniformly to all HTTP responses (HTML/CSS/JS/JSON/vendor files)
- Security headers test suite (test/security-headers.test.js)
- Malformed input test suite (test/malformed-input.test.js)
  - Malformed YAML configuration parsing tests
  - Invalid configuration value validation tests
  - Deeply nested channel configuration tests
  - Special character handling tests
- CHANGELOG.md following Keep a Changelog format
  - Retroactively documented v0.1.0, v0.2.0, v0.3.0

### Changed
- Updated package.json version from 0.1.0 to 0.4.0
- Simplified ROADMAP.md (removed performance testing to maintain focus)

### Security
- Enhanced HTTP security posture with additional response headers

### Tests
- Total tests: 234 (233 passing)
- New tests: 9 (3 security headers + 4 malformed input + 2 config validation)

## [0.3.0] - 2024-01-XX

### Added
- **Docker support** with multi-stage builds and security hardening
  - Dockerfile with Node 22 Alpine base image
  - Non-root user (pavilo:pavilo, uid/gid 1001)
  - Read-only filesystem support
  - Built-in health check (/healthz endpoint)
  - Security options (no-new-privileges, cap_drop: ALL)
- **docker-compose.yml** with production-ready configuration
- **.dockerignore** for optimized build context
- **Enhanced startup logs** with clear, structured information
  - Application version (v0.1.0)
  - Protocol version (v4)
  - Storage mode (ephemeral)
  - Config source (file path or built-in defaults)
  - Network addresses (local + LAN)
  - Security boundaries (Origin check, IP visibility, capacity limits)
- **Deployment documentation**
  - Docker deployment guide (docs/deployment/docker.md)
  - Reverse proxy configuration guide for Nginx and Caddy (docs/deployment/reverse-proxy.md)
  - Health check contract documentation (docs/healthcheck.md)
- **Offline startup verification** - confirmed no external network dependencies

### Changed
- Startup logs now display comprehensive system information
- README updated with Docker quick start section

### Fixed
- Configuration file loading now shows clear source information

## [0.2.0] - 2024-01-XX

### Added
- **Protocol v4** - stable WebSocket protocol
  - Message ACK with client-side ack tracking
  - Idempotency support with deduplication
  - Connection resilience (auto-reconnect, history catch-up)
  - Sequence-based ordering guarantees
- **Emoji reactions** - 6 quick reactions (👍 ❤️ 😂 🎉 👀 🔥)
- **Image upload and inline display**
  - Drag-and-drop support
  - Paste from clipboard
  - 300KB size limit per image
  - JPEG, PNG, WebP support
- **Message replies** - thread-like conversations
- **Enhanced UI**
  - Deep dark mode with system theme detection
  - Glassmorphism design (frosted glass effects)
  - Smooth micro-interactions and animations
  - Responsive mobile layout
  - Keyboard navigation support
- **Read-only channels** - announcement and rules channels
- **Member list** with online status
- **Typing indicators**
- **Browser notifications** (opt-in, with permission request)
- **Unread indicators** (page title badge, dynamic favicon)
- **Design language documentation** (docs/design-language.md)
- **Test strategy documentation** (TEST_STRATEGY.md)
- **Comprehensive test suite** (200+ tests)
  - Unit tests for core logic
  - Integration tests for WebSocket protocol
  - Browser automation tests with Playwright

### Changed
- Upgraded to Protocol v4 (v1/v2/v3 still supported for compatibility)
- Improved connection stability and error handling
- Enhanced security with Origin validation
- Static resources (Lucide icons, emoji picker) now self-hosted

### Security
- Origin header validation for WebSocket connections
- Rate limiting for messages and reactions
- Input sanitization and validation
- Resource limits (max users, connections, messages, bytes)

## [0.1.0] - 2024-01-XX

### Added
- **Initial release** - ephemeral chat system
- **Multi-channel support** with configurable channels
- **WebSocket-based real-time communication**
- **Markdown support** in messages
- **YAML configuration** (pavilo.yaml)
- **Graceful shutdown** (SIGINT/SIGTERM handling)
- **Static file serving** with gzip compression
- **ETag caching** for static resources
- **Built-in defaults** - works without configuration file
- **Security boundaries**
  - Max users and connections limits
  - Message size limits
  - Channel capacity limits
  - Backpressure handling
- **Documentation**
  - README with quick start guide
  - Configuration examples
  - Contributing guidelines (CONTRIBUTING.md)
  - Security policy (SECURITY.md)
  - Code of conduct (CODE_OF_CONDUCT.md)
  - Roadmap (ROADMAP.md)

### Architecture
- Pure in-memory storage (ephemeral mode only)
- Node.js 22+ required
- Minimal dependencies (only `yaml` for config parsing)
- Clean separation: core logic + transport layer
- Protocol versioning support

---

## Version History Summary

- **v0.3.0** - Docker support and deployment readiness
- **v0.2.0** - Protocol v4, reactions, images, enhanced UI
- **v0.1.0** - Initial ephemeral chat system

## Links

- [GitHub Repository](https://github.com/caigg188/Pavilo)
- [Issue Tracker](https://github.com/caigg188/Pavilo/issues)
- [Roadmap](ROADMAP.md)

---

**Note**: Dates are placeholders (2024-01-XX) and will be updated with actual release dates.
