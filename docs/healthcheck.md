# 健康检查契约

Pavilo 提供标准的健康检查端点 `/healthz`，用于监控服务状态。

## 端点

```
GET /healthz
```

## 响应格式

### 成功响应

**状态码**: `200 OK`

**Content-Type**: `application/json`

**响应体**:
```json
{
  "ok": true,
  "users": 3,
  "messages": 42,
  "roomBytes": 8192,
  "clients": 3,
  "ephemeral": true
}
```

### 字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `ok` | boolean | 当前实现恒为 `true`（见下方"失败响应"） |
| `users` | number | 当前在线用户数 |
| `messages` | number | 当前保存的消息总数（所有频道） |
| `roomBytes` | number | 当前消息占用的字节数 |
| `clients` | number | 当前 WebSocket 连接数 |
| `ephemeral` | boolean | `true` 表示 memory（重启即空）；`false` 表示 sqlite 留存 |

### 失败响应

当前实现**没有返回非 200 的分支**：只要进程还能处理 HTTP 请求，`/healthz` 就返回 `200 OK` 且 `ok` 为 `true`。

因此"服务不健康"只能表现为：

- 连接被拒绝（进程已退出或未监听）；
- 请求超时（进程卡死）；
- 非预期的响应体。

调用方应把"连不上/超时"当作失败，而不是等待某个非 200 状态码。

## 使用场景

### 1. Docker 健康检查

```dockerfile
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:4173/healthz', (r) => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"
```

### 2. Kubernetes Liveness Probe

```yaml
livenessProbe:
  httpGet:
    path: /healthz
    port: 4173
  initialDelaySeconds: 5
  periodSeconds: 30
  timeoutSeconds: 3
  failureThreshold: 3
```

### 3. 监控脚本

```bash
#!/bin/bash
# healthcheck.sh

ENDPOINT="http://localhost:4173/healthz"

response=$(curl -s -o /dev/null -w "%{http_code}" "$ENDPOINT")

if [ "$response" -eq 200 ]; then
  echo "✓ Pavilo is healthy"
  exit 0
else
  echo "✗ Pavilo is unhealthy (HTTP $response)"
  exit 1
fi
```

### 4. 负载均衡器健康检查

**Nginx**:
```nginx
upstream pavilo {
    server localhost:4173 max_fails=3 fail_timeout=30s;
    
    # 健康检查（需要 nginx_upstream_check_module）
    check interval=30000 rise=2 fall=3 timeout=3000 type=http;
    check_http_send "GET /healthz HTTP/1.0\r\n\r\n";
    check_http_expect_alive http_2xx;
}
```

**Caddy**:
```caddyfile
chat.example.com {
    reverse_proxy localhost:4173 {
        health_uri /healthz
        health_interval 30s
        health_timeout 3s
    }
}
```

### 5. 监控告警

结合监控工具（如 Prometheus + Blackbox Exporter）：

```yaml
# prometheus.yml
scrape_configs:
  - job_name: 'pavilo'
    metrics_path: /probe
    params:
      module: [http_2xx]
    static_configs:
      - targets:
        - http://localhost:4173/healthz
    relabel_configs:
      - source_labels: [__address__]
        target_label: __param_target
      - source_labels: [__param_target]
        target_label: instance
      - target_label: __address__
        replacement: blackbox-exporter:9115
```

## 契约保证

### v0.x 系列

- ✅ 端点路径固定为 `/healthz`
- ✅ 成功时返回 `200 OK`
- ✅ 响应体为 JSON 格式
- ✅ 始终包含 `ok`, `users`, `messages`, `roomBytes`, `clients`, `ephemeral` 字段
- ✅ `ephemeral` 随存储驱动：`memory` 为 `true`，`sqlite` 为 `false`
- ✅ 无需认证或特殊头

### v1.0+ 规划

未来版本可能增加字段：
- `storage`: 存储模式（`memory` 或 `sqlite`）
- `dbSize`: 数据库文件大小（仅 SQLite 模式）
- `uptime`: 服务运行时间（秒）

**向后兼容**: 现有字段不会被移除或改变含义。

## 最佳实践

### 1. 合理的检查间隔

- **Docker**: 30 秒
- **Kubernetes**: 30 秒
- **负载均衡器**: 10-30 秒
- **监控告警**: 60 秒

### 2. 超时设置

- 推荐超时: **3 秒**
- `/healthz` 是轻量级端点，通常在 < 10ms 内响应

### 3. 失败阈值

- **Docker**: 3 次连续失败后标记不健康
- **Kubernetes**: 3 次连续失败后重启 Pod
- **负载均衡器**: 3 次连续失败后移出池

### 4. 启动延迟

- **start_period / initialDelaySeconds**: 5 秒
- Pavilo 启动很快（< 1 秒），但留出缓冲时间

### 5. 不要过度依赖

健康检查返回 `200` 并不代表：
- WebSocket 连接一定正常（需要单独测试）
- 网络到客户端的路径畅通
- 反向代理配置正确

## 示例脚本

### Shell 脚本

```bash
#!/bin/bash
# check_pavilo.sh - 检查 Pavilo 健康状态并输出详情

ENDPOINT="${PAVILO_URL:-http://localhost:4173}/healthz"

response=$(curl -s -w "\n%{http_code}" "$ENDPOINT")
body=$(echo "$response" | head -n -1)
status=$(echo "$response" | tail -n 1)

if [ "$status" -eq 200 ]; then
  echo "✓ Pavilo is healthy"
  echo "$body" | jq '.'
  exit 0
else
  echo "✗ Pavilo is unhealthy (HTTP $status)"
  echo "$body"
  exit 1
fi
```

### Python 脚本

```python
#!/usr/bin/env python3
# check_pavilo.py

import sys
import requests

ENDPOINT = "http://localhost:4173/healthz"

try:
    response = requests.get(ENDPOINT, timeout=3)
    
    if response.status_code == 200:
        data = response.json()
        print(f"✓ Pavilo is healthy")
        print(f"  Users: {data['users']}")
        print(f"  Messages: {data['messages']}")
        print(f"  Clients: {data['clients']}")
        print(f"  Memory: {data['roomBytes']} bytes")
        sys.exit(0)
    else:
        print(f"✗ Pavilo is unhealthy (HTTP {response.status_code})")
        sys.exit(1)
        
except requests.RequestException as e:
    print(f"✗ Cannot reach Pavilo: {e}")
    sys.exit(1)
```

### Node.js 脚本

```javascript
#!/usr/bin/env node
// check_pavilo.js

const http = require('http');

const ENDPOINT = process.env.PAVILO_URL || 'http://localhost:4173/healthz';

http.get(ENDPOINT, (res) => {
  let data = '';
  
  res.on('data', (chunk) => data += chunk);
  
  res.on('end', () => {
    if (res.statusCode === 200) {
      const health = JSON.parse(data);
      console.log('✓ Pavilo is healthy');
      console.log(`  Users: ${health.users}`);
      console.log(`  Messages: ${health.messages}`);
      console.log(`  Clients: ${health.clients}`);
      process.exit(0);
    } else {
      console.log(`✗ Pavilo is unhealthy (HTTP ${res.statusCode})`);
      process.exit(1);
    }
  });
}).on('error', (e) => {
  console.error(`✗ Cannot reach Pavilo: ${e.message}`);
  process.exit(1);
});
```

## 与其他端点的区别

| 端点 | 用途 | 认证 | 响应 |
|------|------|------|------|
| `/healthz` | 健康检查 | 无需 | JSON, 200 |
| `/room-info` | 房间元数据 | 无需 | JSON, 房间信息 |
| `/` | 聊天界面 | 无需 | HTML |
| `/chat.css` | 样式表 | 无需 | CSS |

**注意**: `/healthz` 是最轻量的端点，专为自动化监控设计。

## 故障排查

### 健康检查总是失败

1. **检查端口**: 确认 Pavilo 监听在正确端口
   ```bash
   netstat -tuln | grep 4173
   ```

2. **检查防火墙**: 确保端口可访问
   ```bash
   curl http://localhost:4173/healthz
   ```

3. **检查容器内网络**: 如果在 Docker 中
   ```bash
   docker exec pavilo curl http://localhost:4173/healthz
   ```

### 响应慢

- `/healthz` 应在 < 10ms 内响应
- 如果慢，可能是服务器资源不足或负载过高
- 检查 CPU/内存使用情况

### 返回 503

- Pavilo 目前不会返回 503
- 如果看到 503，可能是反向代理或负载均衡器的响应
- 检查上游服务是否真的在运行

## 参考

- [HTTP 健康检查最佳实践](https://tools.ietf.org/id/draft-inadarei-api-health-check-06.html)
- [Docker HEALTHCHECK 文档](https://docs.docker.com/engine/reference/builder/#healthcheck)
- [Kubernetes Probes 文档](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/)
