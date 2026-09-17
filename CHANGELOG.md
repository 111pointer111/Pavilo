# Changelog

All notable changes to Pavilo will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- HTTP security headers (X-Frame-Options, Referrer-Policy) for enhanced security
- Malformed input tests for configuration validation
- Security headers tests for HTTP responses

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
