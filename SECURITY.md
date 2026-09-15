# 安全政策

## 支持的版本

Pavilo 当前处于 Alpha 阶段（v0.x），安全更新仅针对最新版本。

| 版本 | 支持状态 |
| --- | --- |
| main (最新提交) | ✅ 支持 |
| v0.x (最新发布) | ✅ 支持 |
| < v0.x | ❌ 不支持 |

**重要**：v1.0 发布前，不保证向后兼容。请及时更新到最新版本。

## 安全假设与边界

Pavilo v0.x 设计用于**可信网络环境**（内网、VPN、反向代理后）。

### 当前安全边界

✅ **已实现的保护：**
- Origin 检查（防止 CSRF）
- 连接数限制（防止资源耗尽）
- 消息大小限制
- 图片解码校验
- Rate limiting（防止刷屏）
- WebSocket 协议校验

❌ **尚未实现（v0.x）：**
- 用户认证（任何人可以用任何用户名加入）
- 权限系统
- IP 封禁
- 内容审核
- TLS/加密传输（需反向代理提供）
- 可信代理头（`X-Forwarded-For` 等）

### 适用场景

✅ **安全的使用场景：**
- 公司内网（有防火墙）
- Tailscale / WireGuard / Zerotier 等 VPN
- Nginx / Caddy 反向代理 + 基础认证
- 家庭局域网（信任所有设备）

❌ **不安全的使用场景：**
- 直接暴露到公网（无任何防护）
- 开放注册的公开聊天室
- 需要防御 DDoS / 刷单 / 爬虫

### 默认配置的安全考量

- `server.allowNoOrigin: false` — 默认拒绝非浏览器客户端
- `room.exposeMemberIps: true` — 默认显示 IP（适合可信环境）
- `room.exposeLanUrls: true` — 默认暴露局域网地址（方便分享）

在公网环境下，建议设置：
```yaml
server:
  allowNoOrigin: false
room:
  exposeMemberIps: false
  exposeLanUrls: false
```

## 报告安全漏洞

### 如何报告

**请勿公开披露安全漏洞**。请通过以下方式私密报告：

1. **GitHub Security Advisory**（推荐）
   - 访问 https://github.com/你的用户名/Pavilo/security/advisories
   - 点击 "New draft security advisory"

2. **邮件报告**
   - 发送邮件到：[你的安全联系邮箱]
   - 主题：`[Security] Pavilo vulnerability report`

### 报告应包含

- 漏洞描述（CVSS 评级，如果可能）
- 复现步骤（越详细越好）
- 影响范围（哪些版本受影响）
- 是否有公开的 PoC 或讨论
- 你的联系方式

### 响应时间

我们会在收到报告后尽快响应：
- **24 小时内**：确认收到报告
- **7 天内**：评估严重性并给出初步反馈
- **30 天内**：发布修复（根据严重程度加急）

### 披露政策

- 修复发布后，我们会公开致谢报告者（除非你要求匿名）
- 披露时间表由严重性决定：
  - **Critical / High**：立即私密修复，发布后公开
  - **Medium / Low**：在下一个版本中修复

## 已知限制与不承诺修复的问题

以下是产品设计导致的已知限制，**不视为安全漏洞**：

### 1. 无用户认证

任何能访问监听端口的人都可以加入聊天室。

**缓解措施：**
- 使用反向代理 + 基础认证
- 使用 VPN 限制访问
- 等待 v1.5 的访问控制功能

### 2. 用户名可伪造

用户可以使用任何用户名（除非该名称已被占用）。

**缓解措施：**
- 在可信环境使用（团队内网）
- 通过 IP 识别用户（如果启用 `exposeMemberIps`）

### 3. 无速率限制（部分）

当前只有消息发送、typing、频道切换有速率限制，其他操作（如连接）只有全局上限。

**缓解措施：**
- 使用反向代理的速率限制
- 等待 v0.4 的完整压力测试

### 4. 内存中的临时数据

消息只存在进程内存中，服务重启后清空。

**这不是 Bug，而是产品设计（Ephemeral First）。**

### 5. IP 地址暴露

默认配置下，频道内成员可以看到彼此的 IP。

**缓解措施：**
- 设置 `room.exposeMemberIps: false`
- 使用反向代理（所有人显示为代理 IP）

## 依赖项安全

Pavilo 只有一个 runtime 依赖：`yaml`

我们会：
- 定期检查依赖项的安全公告
- 在发现漏洞后尽快更新
- 在 CHANGELOG 中注明安全相关的依赖更新

运行 `npm audit` 检查已知漏洞。

## 安全最佳实践

### 部署建议

1. **使用反向代理**
   ```nginx
   # Nginx 示例
   location / {
       proxy_pass http://localhost:4173;
       proxy_http_version 1.1;
       proxy_set_header Upgrade $http_upgrade;
       proxy_set_header Connection "upgrade";
       proxy_set_header Host $host;
       
       # 基础认证
       auth_basic "Restricted Access";
       auth_basic_user_file /etc/nginx/.htpasswd;
   }
   ```

2. **启用 HTTPS**
   - 使用 Let's Encrypt 免费证书
   - Pavilo 本身不处理 TLS，由反向代理提供

3. **限制访问源**
   ```nginx
   # 只允许特定 IP 段
   allow 192.168.1.0/24;
   deny all;
   ```

4. **定期更新**
   ```bash
   git pull origin main
   npm install
   npm test
   # 重启服务
   ```

### 配置建议

```yaml
# 生产环境最小暴露配置
version: 1

server:
  host: 127.0.0.1  # 只监听本地，通过反向代理暴露
  allowNoOrigin: false
  maxUsers: 32
  maxConnections: 40

room:
  exposeMemberIps: false
  exposeLanUrls: false
```

### 监控建议

- 监控 `/healthz` 端点（连接数、消息数）
- 设置告警：连接数接近上限
- 定期查看日志：异常重连、错误率

## 路线图

未来版本的安全增强计划：

- **v0.4**：完整压力测试、畸形输入测试、Threat Model 文档
- **v1.5**：访问控制、邀请制、角色权限
- **v2.0+**：端到端加密（如果社区有需求）

## 联系方式

- **安全问题**：[安全邮箱]
- **一般问题**：GitHub Issues
- **架构讨论**：GitHub Discussions

---

感谢你帮助 Pavilo 保持安全！🔒
