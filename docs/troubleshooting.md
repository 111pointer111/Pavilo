# 故障排查指南

本文档帮助你诊断和解决 Pavilo 的常见问题。

## 快速诊断

### 1. 检查服务状态

```bash
# 检查服务是否运行
curl http://localhost:4173/healthz

# 预期响应（示例）
{"ok":true,"users":1,"messages":12,"roomBytes":2048,"clients":2,"ephemeral":true}
```

服务正常时 `/healthz` 返回 HTTP 200；服务未运行时请求会直接失败（连接被拒绝）。

### 2. 检查配置

```bash
# 验证配置文件
npm run config:check

# 查看启动日志中的配置来源
npm start | grep "Config"
```

### 3. 检查网络

```bash
# 检查端口是否监听
lsof -i :4173
# 或
netstat -an | grep 4173

# 检查防火墙
sudo ufw status  # Ubuntu/Debian
sudo firewall-cmd --list-all  # CentOS/RHEL
```

---

## 常见问题

### 服务启动问题

#### ❌ 端口已被占用

**错误信息**：
```
Error: listen EADDRINUSE: address already in use :::4173
```

**原因**：端口 4173 已被其他程序占用

**解决方案**：

1. **查找占用进程**：
   ```bash
   # macOS/Linux
   lsof -i :4173
   
   # 或使用 netstat
   netstat -tulpn | grep 4173
   ```

2. **停止占用进程**：
   ```bash
   # 找到 PID 后
   kill <PID>
   
   # 或强制停止
   kill -9 <PID>
   ```

3. **使用其他端口**：
   ```bash
   PORT=8080 npm start
   ```

---

#### ❌ 配置文件格式错误

**错误信息**：
```
/path/to/pavilo.yaml: YAML 解析失败：<解析器给出的具体原因>
```

**原因**：YAML 格式错误（通常是缩进问题，或使用了重复键、锚点/别名等被拒绝的语法）

**解决方案**：

1. **检查缩进**（必须使用空格，不能用 Tab）：
   ```yaml
   # ❌ 错误
   channels:
   	- id: general  # 使用了 Tab
   
   # ✅ 正确
   channels:
     - id: general  # 使用 2 个空格
   ```

2. **使用在线验证器**：
   - https://www.yamllint.com/
   - 粘贴配置内容检查语法

3. **查看详细错误**：
   ```bash
   npm run config:check
   ```

---

#### ❌ 配置验证失败

**错误信息**：
```
room.defaultChannel: 找不到频道 “lobby”
```

**原因**：配置项不符合规则

**常见配置错误**：

1. **默认频道不存在**：
   ```yaml
   # ❌ 错误：找不到频道 “lobby”
   room:
     defaultChannel: lobby
   channels:
     - id: general
       name: 闲聊
   
   # ✅ 正确
   room:
     defaultChannel: general
   ```

2. **默认频道未启用**（`room.defaultChannel: 默认频道必须启用`）：
   ```yaml
   # ❌ 错误
   channels:
     - id: general
       name: 闲聊
       enabled: false
   room:
     defaultChannel: general
   
   # ✅ 正确
   channels:
     - id: general
       name: 闲聊
       enabled: true
   room:
     defaultChannel: general
   ```

3. **默认频道是只读的**（`room.defaultChannel: 默认频道不能是只读频道`）：
   ```yaml
   # ❌ 错误
   channels:
     - id: announcements
       name: 公告
       readOnly: true
   room:
     defaultChannel: announcements
   
   # ✅ 正确：默认频道不能是只读
   room:
     defaultChannel: general
   ```

---

#### ❌ 权限错误

**错误信息**：
```
Error: EACCES: permission denied, bind
```

**原因**：
- 尝试使用特权端口（1-1024）但没有权限
- 或文件系统权限不足

**解决方案**：

1. **使用非特权端口**（推荐）：
   ```bash
   PORT=8080 npm start
   ```

2. **使用 sudo**（不推荐）：
   ```bash
   sudo PORT=80 npm start
   ```

3. **使用反向代理**（推荐用于生产）：
   - Pavilo 运行在高端口（如 4173）
   - Nginx/Caddy 监听 80/443 并转发

---

### 连接问题

#### ❌ 无法从局域网访问

**症状**：
- 本地 `localhost:4173` 可以访问
- 局域网其他设备无法访问

**原因**：
- 服务器只监听 `127.0.0.1`
- 防火墙阻止
- 路由器隔离

**解决方案**：

1. **检查监听地址**：
   ```yaml
   # 确保配置为
   server:
     host: 0.0.0.0
   ```

2. **检查防火墙**：
   ```bash
   # Ubuntu/Debian
   sudo ufw allow 4173
   
   # CentOS/RHEL
   sudo firewall-cmd --add-port=4173/tcp --permanent
   sudo firewall-cmd --reload
   
   # macOS
   # 系统偏好设置 → 安全性与隐私 → 防火墙
   ```

3. **获取局域网 IP**：
   ```bash
   # macOS/Linux
   ifconfig | grep "inet "
   # 或
   ip addr show
   
   # Windows
   ipconfig
   ```

4. **测试连接**：
   ```bash
   # 从另一台设备
   curl http://192.168.1.100:4173/healthz
   ```

---

#### ❌ WebSocket 连接失败

**症状**：
- 页面加载但无法连接
- 控制台显示 `WebSocket connection failed`

**原因**：
- Origin 检查失败
- 反向代理配置错误
- 网络问题

**解决方案**：

1. **检查浏览器控制台**：
   ```
   F12 → Console → 查看错误信息
   ```

2. **检查 Origin**：
   ```yaml
   # 如果设置了 allowedOrigins
   server:
     allowedOrigins:
       - 'http://localhost:4173'
       - 'http://192.168.1.100:4173'
   ```

3. **检查反向代理**（如使用）：
   ```nginx
   # Nginx 需要正确的 WebSocket 配置
   location /ws {
       proxy_pass http://localhost:4173;
       proxy_http_version 1.1;
       proxy_set_header Upgrade $http_upgrade;
       proxy_set_header Connection "upgrade";
   }
   ```

4. **查看服务器日志**：
   ```bash
   npm start
   # 查看是否有连接错误或 Origin 拒绝
   ```

---

#### ❌ 频繁断线重连

**症状**：
- 连接状态频繁在"已连接"和"重连中"之间切换
- 消息发送失败

**原因**：
- 网络不稳定
- 心跳超时设置过短
- 服务器资源不足

**解决方案**：

1. **调整心跳超时**（默认 `heartbeatIntervalMs: 30000`、`heartbeatTimeoutMs: 75000`）：
   ```yaml
   timeouts:
     heartbeatIntervalMs: 30000
     heartbeatTimeoutMs: 90000  # 建议为 interval 的 2-3 倍
   ```

2. **检查网络质量**：
   ```bash
   # 测试延迟
   ping 192.168.1.100
   
   # 测试丢包率
   ping -c 100 192.168.1.100
   ```

3. **检查服务器资源**：
   ```bash
   # CPU 和内存使用
   top
   # 或
   htop
   
   # 查看进程状态
   ps aux | grep node
   ```

---

### 功能问题

#### ❌ 无法发送消息

**症状**：
- 输入框有内容但发送按钮禁用
- 或点击发送无响应

**原因**：
- 只读频道
- 连接未就绪
- 速率限制
- 输入框内容为空

**解决方案**：

1. **检查频道是否只读**：
   - 查看是否显示 🔒 图标
   - 查看是否有"只读频道"提示

2. **检查连接状态**：
   - 左上角状态指示器应显示"已连接"（绿点）
   - 如果是"连接中"或"已断开"，等待重连

3. **检查输入内容**：
   - 确保输入框不为空
   - 确保不超过字符限制（默认 2000 字符）

4. **检查是否被限流**：
   ```yaml
   # 检查配置：默认每 5 秒窗口内最多 8 条消息
   rateLimits:
     windowMs: 5000
     messages: 8
   ```
   - 如果发送过快会被临时限制

---

#### ❌ 图片无法上传

**症状**：
- 选择、粘贴或拖入图片后无响应
- 输入框内没有出现缩略图
- 或提示"图片太大"等错误

**原因**：
- 图片超过大小/尺寸限制
- 格式不支持
- 浏览器不支持
- 当前在登录页、只读频道，或图片查看器仍开着（粘贴会被忽略）

**解决方案**：

1. **检查图片格式**：
   - 支持：PNG、JPEG、GIF、WebP
   - 不支持：BMP、TIFF 等

2. **检查图片大小**：
   ```yaml
   # 查看配置限制
   limits:
     maxImageBytes: 300000      # 压缩后约 300KB
     maxImagePixels: 4000000    # 约 2000x2000
     maxImageDimension: 1600    # GIF 单边最大 1600px
   ```

3. **先看输入框内的缩略图**：
   - 压缩中缩略图会变暗
   - 失败时旁边会出现错误说明和“重试”
   - 点缩略图可在发出前预览；点发送后才会进入消息列表

4. **尝试压缩图片**：
   - 使用在线工具：https://tinypng.com/
   - 或裁剪图片尺寸

5. **查看浏览器控制台错误**：
   ```
   F12 → Console → 查看具体错误信息
   ```

---

#### ❌ 频道切换失败

**症状**：
- 点击频道无响应
- 或提示"频道不可用"

**原因**：
- 频道已停用
- 频道已满
- 频道切换中
- 网络断开

**解决方案**：

1. **检查频道状态**：
   ```yaml
   # 确保频道已启用
   channels:
     - id: general
       enabled: true  # 必须为 true
   ```

2. **检查频道人数**：
   - 频道列表显示"已满"
   - 等待其他用户离开或增加 `maxUsers`

3. **检查是否有未发送的消息**：
   - 输入框有草稿
   - 输入框里还有未发送的图片
   - 或有消息等待确认
   - 先发送、删除图片或清空后再切换

4. **等待当前操作完成**：
   - 如果正在上传图片，等待完成
   - 如果正在切换频道，等待完成

---

### 性能问题

#### ❌ 页面卡顿

**症状**：
- 滚动消息列表卡顿
- 输入延迟
- 动画不流畅

**原因**：
- 消息过多
- 浏览器性能不足
- 内存不足

**解决方案**：

1. **限制消息数量**：
   ```yaml
   limits:
     maxMessagesPerChannel: 200  # 减少保留消息数
   ```

2. **刷新页面**：
   - 清空当前状态
   - 重新加载最新消息

3. **关闭其他标签页**：
   - 释放浏览器资源
   - 特别是其他 Pavilo 标签页

4. **升级浏览器**：
   - 使用最新版 Chrome/Firefox/Safari
   - 检查浏览器版本

---

#### ❌ 服务器内存占用过高

**症状**：
- `top` 显示 Node.js 进程内存持续增长
- 服务器响应变慢

**原因**：
- 消息历史过多
- 在线用户过多
- 内存泄漏（罕见）

**解决方案**：

1. **调整消息限制**：
   ```yaml
   limits:
     maxMessagesPerChannel: 200  # 减少
   ```

2. **调整频道容量与断线租约**：
   ```yaml
   server:
     maxUsers: 30          # 全局成员上限（含断线租约）
     maxConnections: 40    # 连接总数上限
   channels:
     - id: general
       name: 闲聊
       enabled: true
       maxUsers: 20        # 单频道上限，不得超过 server.maxUsers
   timeouts:
     sessionLeaseMs: 5000  # 缩短断线后身份保留时间
   ```

3. **定期重启服务**（临时方案）：
   ```bash
   # 使用进程管理器
   pm2 restart pavilo
   ```

4. **监控内存**：
   ```bash
   # 查看内存使用
   ps aux | grep node
   
   # 或使用 htop
   htop
   ```

---

### Docker 问题

#### ❌ 容器无法启动

**错误信息**：
```
Error: Cannot find module '/app/server.js'
```

**原因**：构建或挂载问题

**解决方案**：

1. **重新构建镜像**：
   ```bash
   docker build -t pavilo .
   ```

2. **检查挂载路径**（仓库中 `docker-compose.yml` 的挂载目标是 `/config/pavilo.yaml`，需同时设置 `PAVILO_CONFIG`）：
   ```yaml
   # docker-compose.yml
   volumes:
     - ./pavilo.yaml:/config/pavilo.yaml:ro
   environment:
     - PAVILO_CONFIG=/config/pavilo.yaml
   ```

3. **检查权限**：
   ```bash
   # 确保配置文件可读
   chmod 644 pavilo.yaml
   ```

---

#### ❌ 容器内无法访问

**症状**：
- 容器运行正常
- 但无法从宿主机访问

**原因**：端口映射问题

**解决方案**：

1. **检查端口映射**：
   ```yaml
   # docker-compose.yml
   ports:
     - "4173:4173"  # 宿主机:容器
   ```

2. **检查容器内监听地址**：
   ```yaml
   # pavilo.yaml
   server:
     host: 0.0.0.0  # 不要用 127.0.0.1
   ```

3. **检查容器网络**：
   ```bash
   docker ps
   docker inspect <container-id>
   ```

---

## 日志分析

### 查看日志

```bash
# 直接运行
npm start

# Docker
docker logs pavilo

# Docker Compose
docker-compose logs -f pavilo

# PM2
pm2 logs pavilo
```

### 常见日志消息

#### ✅ 正常启动

```
──────────────────────────────────────╮
│  Pavilo / 语亭                       │
│  v0.7.0                              │
╰──────────────────────────────────────╯

✓ Protocol version: 4
✓ Storage mode: memory
✓ Config source: /path/to/pavilo.yaml
  → Restart required to apply config changes

 Listening on:
  → Local:  http://localhost:4173
  → LAN:    http://192.168.1.100:4173

🔒 Security boundaries:
  → Origin check: ...
```

#### ⚠️ 配置警告

```
✓ Config source: built-in defaults
```

**原因**：没有找到 `./pavilo.yaml`，也没有设置 `PAVILO_CONFIG`，因此回退到内置默认配置（`general` + `project` 两个频道）。

**解决**：如需自定义，执行 `cp pavilo.example.yaml pavilo.yaml`（内存）或 `cp pavilo.sqlite.example.yaml pavilo.yaml`（留存）后修改并重启。

#### ❌ 连接拒绝

```
WebSocket rejected: Origin 'http://evil.com' not allowed
```

**原因**：Origin 不在白名单中

**解决**：
```yaml
server:
  allowedOrigins:
    - 'http://evil.com'  # 如果这是合法来源
```

#### ❌ 频道已满

```
Channel 'general' full: 50/50 users
```

**解决**：
```yaml
channels:
  - id: general
    maxUsers: 100  # 增加容量
```

---

## 调试技巧

### 1. 启用详细日志

设置环境变量：
```bash
DEBUG=pavilo:* npm start
```

### 2. 使用浏览器开发工具

- **Network 标签**：查看 WebSocket 帧
- **Console 标签**：查看客户端错误
- **Application 标签**：查看 sessionStorage

### 3. 网络抓包

```bash
# 使用 tcpdump
sudo tcpdump -i any -n port 4173

# 使用 Wireshark（图形界面）
```

### 4. 健康检查脚本

```bash
#!/bin/bash
# health-check.sh

HEALTH_URL="http://localhost:4173/healthz"

if curl -f -s -o /dev/null "$HEALTH_URL"; then
    echo "✅ Service is healthy"
    exit 0
else
    echo "❌ Service is down"
    exit 1
fi
```

---

## 获取帮助

如果以上方法都无法解决问题：

1. **搜索现有 Issues**：
   https://github.com/caigg188/Pavilo/issues

2. **创建新 Issue**：
   - 使用 Bug 报告模板
   - 提供完整的环境信息
   - 包含错误日志和复现步骤

3. **查看文档**：
   - [配置指南](configuration.md)
   - [部署文档](deployment/)
   - [架构文档](architecture/)

4. **讨论区**：
   https://github.com/caigg188/Pavilo/discussions

---

## 预防性维护

### 定期检查

- [ ] 检查磁盘空间（日志文件）
- [ ] 检查内存使用
- [ ] 检查连接数
- [ ] 更新 Node.js 和依赖

### 监控建议

1. **健康检查**：
   ```bash
   */5 * * * * /path/to/health-check.sh
   ```

2. **资源监控**：
   - CPU、内存、网络
   - 使用 Prometheus + Grafana

3. **日志轮转**：
   ```bash
   # 使用 logrotate
   /var/log/pavilo/*.log {
       daily
       rotate 7
       compress
       missingok
   }
   ```

---

## 常见误解

### ❌ 误解：刷新会丢失所有消息

**实际**：
- 会话恢复机制会保留身份和频道
- 最近的消息历史会重新加载
- 但未发送的草稿会丢失

### ❌ 误解：Pavilo 需要数据库

**实际**：
- 默认使用内存存储（ephemeral mode）
- 服务停止后数据清空是设计特性
- 未来版本可选 SQLite 持久化

### ❌ 误解：只能在局域网使用

**实际**：
- 可以通过反向代理暴露到公网
- 但需要配置安全措施（Origin、HTTPS、认证等）
- 参考[部署文档](deployment/)

---

## 参考资源

- [配置指南](configuration.md)
- [Bug 分类标准](bug-classification.md)
- [版本管理流程](version-management.md)
- [部署文档](deployment/)
- [架构文档](architecture/)
