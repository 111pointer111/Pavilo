# HTTP API 文档

Pavilo 提供以下 HTTP 端点。默认 memory 模式下数据只在进程内存中（`ephemeral: true`）；sqlite 模式下 `ephemeral` 为 `false`。

## 端点列表

| 端点 | 方法 | 说明 |
|------|------|------|
| `/`、`/index.html`、`/chat` | GET, HEAD | 返回主页面（HTML） |
| `/room-info` | GET, HEAD | 返回房间和频道信息（JSON） |
| `/healthz` | GET, HEAD | 健康检查端点（JSON） |
| `/client/{file}` | GET, HEAD | 客户端 JavaScript 文件（按白名单精确匹配；`play.js` 供玩法页，不进聊天页） |
| `/plays/{id}/`、`/plays/{id}/{file}` | GET, HEAD | 已启用玩法的 `page/`；`/plays/{id}/assets/` 映射 `assets/`。未启用或 `host.js` 为 404 |
| `/vendor/{path}` | GET, HEAD | 第三方依赖文件（目录挂载） |
| `/chat.css` | GET, HEAD | 样式表 |
| `/favicon.ico` | GET, HEAD | 返回 `204 No Content`，无响应体 |
| `/ws` | WebSocket | WebSocket 连接升级 |
| `/admin`、`/admin/`、`/admin/index.html` | GET, HEAD | 管理页。仅 sqlite + `operator.token`；否则 404 |
| `/admin/admin.css`、`/admin/app.js`、`/admin/i18n.js`、`/admin/list.js`、`/admin/chart.js` | GET, HEAD | 管理页静态资源（精确白名单） |
| `/admin/api/*` | 见下 | 管理页 JSON API；未启用时同样 404 |

公开聊天路由在 `src/transport/http.js`。`/admin` 在 `src/operator/http.js`，由 `server.js` 按路径分流。未匹配的路径返回 404；服务端**没有实现 405**，因此对 `/room-info` 之类的端点使用 POST 等不支持的方法时同样返回 404，也不会带 `Allow` 响应头。

---

## 1. GET `/`

返回主应用页面 `index.html`。

### 请求

```http
GET / HTTP/1.1
Host: localhost:4173
```

`/index.html` 与 `/chat` 返回同一文件。

### 响应

```http
HTTP/1.1 200 OK
Content-Type: text/html; charset=utf-8
Content-Length: 12345
Cache-Control: no-cache
ETag: "app-3c2e-1f0a9b8c7d6e5f40"
Vary: Accept-Encoding
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: strict-origin-when-cross-origin
Content-Security-Policy: default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss:;
Content-Encoding: gzip

<!doctype html>
<html lang="zh-CN">
...
</html>
```

### 响应头

（上面的 `Content-Length` 与 `ETag` 数值是示例，实际值由文件内容决定。）

- `Content-Type`: `text/html; charset=utf-8`
- `Cache-Control`: `no-cache`（每次加载都会向服务端校验）
- `ETag`: `"app-<body 字节数的十六进制>-<body sha1 的前 16 位十六进制>"`
- `Vary`: `Accept-Encoding`
- `X-Content-Type-Options`: `nosniff`
- `X-Frame-Options`: `DENY`
- `Referrer-Policy`: `strict-origin-when-cross-origin`
- `Content-Security-Policy`: `default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss:;`
- `Content-Encoding`: `gzip`（仅在客户端声明支持且 body ≥ 1024 字节时出现）

`/chat.css` 与 `/client/*.js` 走同一条 `serveAppFile` 路径，响应头与上表一致，只是 `Content-Type` 分别为 `text/css; charset=utf-8` 和 `text/javascript; charset=utf-8`。

---

## 2. GET `/room-info`

返回房间配置的公开投影。字段由 `src/core/events.js` 的 `publicChannel` / `publicLimits` 决定，`localUrl` 与 `lanUrls` 由 `src/transport/http.js` 追加。

### 请求

```http
GET /room-info HTTP/1.1
Host: localhost:4173
```

### 响应

使用内置默认配置时：

```http
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8
Content-Length: 673
Cache-Control: no-store
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: strict-origin-when-cross-origin

{
  "protocolVersion": 4,
  "deprecatedProtocols": [],
  "roomEpoch": "room-general_4efe0d43ef23052f",
  "roomTitle": "语亭 · 临时频道",
  "defaultChannelId": "general",
  "defaultLanguage": "zh-CN",
  "supportedLanguages": ["zh-CN", "en"],
  "channels": [
    {
      "id": "general",
      "name": "闲聊",
      "description": "轻松聊聊，只留当下。",
      "enabled": true,
      "readOnly": false,
      "maxUsers": 64,
      "welcome": ""
    },
    {
      "id": "project",
      "name": "项目讨论",
      "description": "聚焦项目，高效协作。",
      "enabled": true,
      "readOnly": false,
      "maxUsers": 32,
      "welcome": ""
    }
  ],
  "limits": {
    "maxTextLength": 2000,
    "maxImageBytes": 300000,
    "maxImageDimension": 1600,
    "maxImagePixels": 4000000,
    "maxMessages": 300
  },
  "ephemeral": true,
  "localUrl": "http://localhost:4173",
  "lanUrls": ["http://192.168.1.100:4173"]
}
```

### 响应字段

#### 根对象

| 字段 | 类型 | 说明 |
|------|------|------|
| `protocolVersion` | number | 当前协议版本，固定为 `4` |
| `deprecatedProtocols` | array | 仍可连接但已废弃的协议版本；v0.9 起为空数组 `[]` |
| `roomEpoch` | string | **默认频道**的 epoch（兼容字段，形如 `room-general_<16 位十六进制>`） |
| `roomTitle` | string | 房间标题（`room.title`） |
| `defaultChannelId` | string | 默认频道 ID（`room.defaultChannel`） |
| `defaultLanguage` | string | 首次访问的默认界面语言（`room.defaultLanguage`），`zh-CN` 或 `en` |
| `supportedLanguages` | array | 客户端支持的语言，固定为 `["zh-CN", "en"]` |
| `channels` | array | 频道列表，见下表 |
| `limits` | object | 客户端所需的尺寸限制，见下表 |
| `ephemeral` | boolean | `true` 为 memory（重启即空）；`false` 为 sqlite 留存 |
| `retentionDays` | number \| null | 仅 sqlite：留存天数；`null` 表示永久。memory 模式不出现此字段 |
| `localUrl` | string | `http://localhost:<实际监听端口>`，始终存在 |
| `lanUrls` | array | 局域网地址列表；`room.exposeLanUrls` 为 `false` 时为空数组 |

`Content-Length` 始终是实际 JSON body 的字节长度，会随配置变化；上面示例为默认配置加单个局域网地址时的 673 字节。

`roomEpoch` 只是默认频道的 epoch；各频道的真实 epoch 以各自的初始状态 `stateStart.roomEpoch` 和事件为准。`lanUrls` 只包含非内部 IPv4 地址。

#### `channels[]` 对象

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 频道唯一标识（小写字母、数字、下划线、连字符） |
| `name` | string | 频道名称 |
| `description` | string | 频道描述，未配置时为 `""` |
| `enabled` | boolean | 是否启用 |
| `readOnly` | boolean | 是否只读（只读频道可进入、可回应，不能发消息） |
| `maxUsers` | number | 该频道人数上限（含断线租约期内的成员） |
| `welcome` | string | 频道欢迎文本，未配置时为 `""` |

#### `limits` 对象

| 字段 | 类型 | 说明 |
|------|------|------|
| `maxTextLength` | number | 文本消息最大字符数 |
| `maxImageBytes` | number | 图片最大解码字节数 |
| `maxImageDimension` | number | 图片单边最大像素 |
| `maxImagePixels` | number | 图片总像素上限 |
| `maxMessages` | number | 每频道保留的最大消息条数（对应配置项 `limits.maxMessagesPerChannel`） |

### 使用场景

- 客户端启动时获取频道列表与限制
- 移动设备获取局域网地址
- 检查服务配置

---

## 3. GET `/healthz`

健康检查端点，用于监控和负载均衡器。

### 请求

```http
GET /healthz HTTP/1.1
Host: localhost:4173
```

也支持 `HEAD`（响应头相同，无响应体）。

### 响应

```http
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8
Content-Length: 77
Cache-Control: no-store
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: strict-origin-when-cross-origin

{"ok":true,"users":0,"messages":0,"roomBytes":0,"clients":0,"ephemeral":true}
```

### 响应字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `ok` | boolean | 固定为 `true` |
| `users` | number | 当前活跃 session 数（含未过期的断线租约） |
| `messages` | number | 所有频道当前保留的消息总条数 |
| `roomBytes` | number | 所有频道消息占用的总字节数 |
| `clients` | number | 当前 WebSocket 连接数（未 join 的连接也计入） |
| `ephemeral` | boolean | 与 `/room-info` 相同：memory 为 `true`，sqlite 为 `false` |
| `storage` | object | 仅 sqlite：`driver`、`path`、`bytes`（库文件大小）、`messages`（全库消息数）。此时顶层 `messages` 也是全库条数，`roomBytes` 仍为工作集 |

服务端只要还能处理 HTTP 请求就返回 200；当前实现没有返回非 200 的分支，健康检查失败只能体现为连接失败或超时。

### 使用场景

- Docker 健康检查
- Kubernetes liveness/readiness probe
- 负载均衡器健康检查
- 监控系统心跳

### 示例

```bash
# 简单检查
curl http://localhost:4173/healthz

# 用于脚本
if curl -f -s http://localhost:4173/healthz > /dev/null; then
    echo "Service is healthy"
else
    echo "Service is down"
    exit 1
fi
```

---

## 4. WebSocket `/ws`

WebSocket 连接端点。

### 连接

```javascript
const ws = new WebSocket('ws://localhost:4173/ws');
```

或（HTTPS）

```javascript
const ws = new WebSocket('wss://example.com/ws');
```

### 升级请求要求

升级请求必须同时满足：

- 路径为 `/ws`；
- `Sec-WebSocket-Key` 是合法的 22 字符 base64 值；
- `Sec-WebSocket-Version: 13`；
- `Upgrade: websocket`，且 `Connection` 中包含 `upgrade`；
- Origin 校验通过（见下）。

```http
GET /ws HTTP/1.1
Host: localhost:4173
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Version: 13
Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==
Origin: http://localhost:4173
```

### Origin 检查

Origin 按以下顺序判定：

1. `Origin` 缺失时，取决于 `server.allowNoOrigin`（默认 `true`，即允许非浏览器客户端）；
2. `Origin` 命中 `server.allowedOrigins` 列表则放行；
3. 否则要求 `Origin` 的 host 与请求的 `Host` 完全一致，且协议为 `http:` 或 `https:`。

不通过时以 HTTP `403 Forbidden` 拒绝升级。服务正在停止或连接数超限时以 `503 Service Unavailable` 拒绝：

- `server.maxConnections`（默认 80）：WebSocket 连接总数上限，未 join 的连接也计入；
- `server.maxConnectionsPerIp`（默认 12）：单 IP 连接上限。

### 协议

连接建立后，使用 [WebSocket 协议](websocket-protocol.md) 通信。

---

## 5. 静态资源

### GET `/client/{file}`

客户端 JavaScript 文件。只提供**白名单中精确列出的 13 个文件**，其余路径（包括真实存在于 `client/` 目录但未列入白名单的文件）返回 404。

**可用文件**（`CLIENT_FILES`）：

- `/client/protocol.js`
- `/client/state.js`
- `/client/performance.js`
- `/client/connection.js`
- `/client/pending.js`
- `/client/messages.js`
- `/client/composer.js`
- `/client/mentions.js`
- `/client/images.js`
- `/client/overlays.js`
- `/client/notifications.js`
- `/client/error-states.js`
- `/client/app.js`

> 白名单之外的任何新文件在被加入 `CLIENT_FILES` **并且**被 `index.html` 引用之前都无法通过 HTTP 访问，也不会成为运行时的一部分。`test/client-assets-wiring.test.js` 会强制两者保持一致，避免出现"模块已存在但从未被加载"的死代码。

### 响应特性

- **Gzip 压缩**：当客户端声明 `Accept-Encoding: gzip`、文件类型可压缩（`text/*`、`application/json`、`application/javascript`）且 body ≥ 1024 字节时启用
- **ETag**：`"app-<长度十六进制>-<sha1 前 16 位>"`
- **Vary**: `Accept-Encoding`
- **Cache-Control**: `no-cache`（浏览器每次加载都会回来校验；服务端本身不处理 `If-None-Match`，不会返回 304）
- **安全头**：`X-Content-Type-Options: nosniff`、`X-Frame-Options: DENY`、`Referrer-Policy: strict-origin-when-cross-origin`、CSP（与 HTML 相同）

### GET `/vendor/{library}/{file}`

第三方依赖的目录挂载点，不是白名单：只要解析后仍位于 `vendor/` 目录内、且扩展名属于 `.html/.css/.js/.mjs/.json/.svg/.ico`（或文件名为 `LICENSE`），就会被提供。

**当前仓库中可访问的文件**：

- `/vendor/lucide/index.js` - Lucide 图标库（由 `index.html` 引入）
- `/vendor/lucide/icon-nodes.json`
- `/vendor/lucide/package.json`
- `/vendor/lucide/LICENSE`
- `/vendor/emoji-picker/index.js` - Emoji 选择器入口
- `/vendor/emoji-picker/picker.js`
- `/vendor/emoji-picker/database.js`
- `/vendor/emoji-picker/data.json` - Emoji 数据
- `/vendor/emoji-picker/i18n/zh_CN.js` - 简体中文语言包
- `/vendor/emoji-picker/LICENSE`

`README.md` 等 `.md` 文件不在 MIME 白名单内，返回 404。路径中包含 `..` 或空字节时返回 `403 Forbidden`。

Vendor 文件的响应头与 `/client/*` 相同的部分是 `ETag`、`Vary`、nosniff、DENY、Referrer-Policy，区别是：

- **Cache-Control**: `public, max-age=300`（5 分钟）
- **不包含 CSP**（CSP 只在 `serveAppFile` 路径上设置）

### GET `/chat.css`

主样式表，与 `/client/*.js` 走同一条应用文件路径（`Cache-Control: no-cache`、带 CSP、可 gzip）。

```http
GET /chat.css HTTP/1.1
Host: localhost:4173
```

---

## 安全响应头

安全头**不是所有响应都有**，按响应类型区分：

| 响应头 | 值 | 适用范围 |
|--------|-----|----------|
| `X-Content-Type-Options` | `nosniff` | 应用文件（HTML/CSS/JS）、vendor 文件、JSON（`/room-info`、`/healthz`） |
| `X-Frame-Options` | `DENY` | 同上 |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | 同上 |
| `Content-Security-Policy` | `default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss:;` | 仅应用文件（`/`、`/index.html`、`/chat`、`/chat.css`、`/client/*.js`） |
| `Cache-Control` | `no-store` | JSON 端点与错误响应 |
| `Cache-Control` | `no-cache` | 应用文件 |
| `Cache-Control` | `public, max-age=300` | vendor 文件 |

`404`、`403`、`500` 等错误响应只有 `Content-Type` 和 `Cache-Control: no-store`，不带上述安全头；`400 Bad Request` 只有 `Content-Type`。

---

## 错误响应

### 404 Not Found

路径未匹配，或请求了不存在的静态文件。响应体为 `Not found`（注意大小写）。

```http
HTTP/1.1 404 Not Found
Content-Type: text/plain; charset=utf-8
Cache-Control: no-store

Not found
```

对已有端点使用不支持的方法（例如 `POST /room-info`）同样返回 404，而不是 405。

### 403 Forbidden

`/vendor/` 路径包含 `..` 或空字节时：

```http
HTTP/1.1 403 Forbidden
Content-Type: text/plain; charset=utf-8
Cache-Control: no-store

Forbidden
```

### 400 Bad Request

请求 URL 无法解析时：

```http
HTTP/1.1 400 Bad Request
Content-Type: text/plain; charset=utf-8

Bad request
```

### 500 Internal Server Error

只在文件已通过路径校验、但读取失败时出现（响应体为 `<文件名> is missing`）：

```http
HTTP/1.1 500 Internal Server Error
Content-Type: text/plain; charset=utf-8
Cache-Control: no-store

index.html is missing
```

### HEAD 请求

`HEAD` 与 `GET` 的路由和响应头完全一致，只是不发送响应体（`Content-Length` 仍为完整 body 的长度）。

---

## 性能优化

### 压缩

只有文件响应会被压缩（`/`、`/index.html`、`/chat`、`/chat.css`、`/client/*.js`、`/vendor/*`）。`/room-info` 与 `/healthz` 的 JSON 响应**不压缩**。

```http
GET /client/app.js HTTP/1.1
Accept-Encoding: gzip, deflate
```

响应：

```http
HTTP/1.1 200 OK
Content-Type: text/javascript; charset=utf-8
Content-Encoding: gzip
Vary: Accept-Encoding
```

启用条件是三者同时满足：请求头 `Accept-Encoding` 中含 `gzip`、MIME 属于 `text/*` 或 `application/json` 或 `application/javascript`、body 不少于 1024 字节。

### 缓存

应用文件与 vendor 文件都会返回 `ETag`（`Vary: Accept-Encoding`）。服务端只负责生成 ETag，**不处理 `If-None-Match`，不会返回 304**；`Cache-Control: no-cache` 与 `public, max-age=300` 的含义分别是"每次校验"和"可缓存 5 分钟"。

---

## 反向代理配置

### Nginx

```nginx
server {
    listen 80;
    server_name chat.example.com;

    location / {
        proxy_pass http://localhost:4173;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /ws {
        proxy_pass http://localhost:4173;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

反向代理后，浏览器带来的 `Origin` 是外部域名，与传给 Pavilo 的 `Host` 一致时会被第 3 条规则放行；若代理改写了 `Host`，则需要显式配置允许的 Origin：

```yaml
server:
  allowedOrigins:
    - 'https://chat.example.com'
```

Pavilo 没有 `trustProxy` 之类的配置项：用户 IP 始终取自 socket 的对端地址（`X-Forwarded-For` / `X-Real-IP` 会被忽略），因此按 IP 的连接上限、成员列表里显示的 IP 反映的都是直连代理的地址。

### Caddy

```caddyfile
chat.example.com {
    reverse_proxy localhost:4173
}
```

Caddy 自动处理 WebSocket 升级和 HTTPS。

---

## 监控和运维

### 健康检查脚本

```bash
#!/bin/bash
# health-check.sh

HEALTH_URL="http://localhost:4173/healthz"

if curl -f -s -o /dev/null "$HEALTH_URL"; then
    exit 0  # 健康
else
    exit 1  # 异常
fi
```

### Docker Compose 健康检查

```yaml
services:
  pavilo:
    image: pavilo
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:4173/healthz"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 10s
```

---

## 8. `/admin`（仅 sqlite 且已配置 `operator.token`）

未启用时全部返回 404，与未知路径相同。启用后：

- 登录页可匿名 GET。
- JSON API 除 `POST /admin/api/login` 外需要 cookie `pavilo_operator`（`HttpOnly`、`SameSite=Strict`、`Path=/admin`）。
- 登录与其它状态改变请求必须带本 origin（或 `allowedOrigins`）的 `Origin` 头。
- 进程重启后 session 失效。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/admin/api/login` | `{ token }`；成功 Set-Cookie |
| POST | `/admin/api/logout` | 清 cookie |
| GET | `/admin/api/session` | 可写性、存储驱动、网关开关 |
| GET | `/admin/api/dashboard` | 房间 health 投影 + pavilion 真源摘要 + 网关摘要，无密钥 |
| GET | `/admin/api/pavilion` | 有效房间/聊天频道、每段 `source`（`yaml` \| `operator`） |
| PUT | `/admin/api/pavilion/room` | 保存并认领房间段，立即生效 |
| DELETE | `/admin/api/pavilion/room` | 取消认领，套回 YAML 房间设置 |
| PUT | `/admin/api/pavilion/channels` | 保存并认领整个聊天频道目录，立即生效 |
| DELETE | `/admin/api/pavilion/channels` | 取消认领，套回 YAML 频道列表 |
| GET | `/admin/api/channels` | 模型渠道列表；只含 `keyPresent` / `keyHint` |
| PUT | `/admin/api/channels/:id` | 创建或更新。空 `apiKey` 保持原值；`null` 清除 |
| DELETE | `/admin/api/channels/:id` | 删除该模型渠道（管理页是唯一来源，不会回到 YAML） |
| POST | `/admin/api/channels/:id/probe` | 极短 `complete()` |
| GET | `/admin/api/usage?days=7` | sqlite 用量；memory 为 `{ tracking: false, rows: [] }` |
| GET | `/admin/api/people` | 当前席位账本、IP 黑名单、真源、最近操作 |
| GET | `/admin/api/people/:id` | 这一席 + 同上列表 |
| GET | `/admin/api/people/:id/messages` | 该席发言摘要；查询 `beforeCreatedAt` / `beforeChannelId` / `beforeId` / `limit` |
| POST | `/admin/api/people/:id/mute` | `{ active }`；省略 `active` 视为禁言。玩法席 409 `AGENT_SEAT` |
| POST | `/admin/api/people/:id/kick` | `{ denyIp }`；`denyIp: true` 请离并写入 IP 黑名单（认领 `moderation` 段） |
| PUT | `/admin/api/moderation` | `{ ipDenyList }`；保存并认领 `moderation` 段 |
| DELETE | `/admin/api/moderation` | 取消认领，套回 YAML 黑名单 |

人员页管**当前进程里的临时席位**，不是会员名录。昵称离开后再进是新的一席。值班台始终能看到 IP，不受 `exposeMemberIps` 限制。玩法 Agent 席不能禁言或请离。

前端路由（hash）把语亭后台与 AI 网关分开，见 [admin.md](../admin.md)。`GET/PUT /admin/api/channels` 管的是**模型渠道**，不是聊天频道。聊天频道走 `/admin/api/pavilion/channels`。人员与 IP 黑名单走 `/admin/api/people*` 与 `/admin/api/moderation`。

`PUT /admin/api/pavilion/channels` 的 body 为 `{ channels: [...] }`，字段与 YAML `channels[]` 相同。频道内仍有成员时停用或删除返回 409 `CHANNEL_BUSY`；有进行中的玩法时改绑定返回 409 `PLAY_BOUND`。非法目录（没有可发言频道、默认频道只读等）返回 400。

错误码：`OPERATOR_UNAUTHORIZED`（401）、`OPERATOR_FORBIDDEN`（403）、`OPERATOR_RATE_LIMITED`（429）、`OPERATOR_READONLY`（409）、`CHANNEL_BUSY` / `PLAY_BOUND` / `AGENT_SEAT`（409）、`NOT_FOUND`（404）、`OPERATOR_BAD_REQUEST` / `BAD_JSON`（400）。网关部署见 [gateway.md](../gateway.md)。覆盖层见 [ADR-0007](../adr/0007-pavilion-config-overlay.md)。人员页见 [admin.md](../admin.md)。

---

## 参考资源

- [WebSocket 协议](websocket-protocol.md)
- [配置指南](../configuration.md)
- [语亭管理后台](../admin.md)
- [AI 网关与管理页](../gateway.md)
- [部署文档](../deployment/)
- [故障排查](../troubleshooting.md)