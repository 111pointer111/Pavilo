# Pavilo / 语亭

<p align="center">
  <img src="docs/logo/pavilo-lockup.svg" width="520" alt="Pavilo / 语亭">
</p>

> 一条命令，给身边的人一间聊天室。

**简体中文** · [English](README.en.md)

Pavilo（**Pavilion + Local**）是一个浏览器即用、默认临时、可以自行托管的极简群聊。像一座随处可搭的小亭：启动 Node.js 进程，同一局域网里的人打开网页就能交谈，服务停止后一切回到空白。

当前版本 **v0.7.0**：支持配置多个临时频道，仅内存存储，适合可信局域网、私有网络或 VPN 环境。

## 设计原则

- **开箱即用**：安装依赖后一条命令启动，参与者只需要浏览器。
- **保持轻量**：服务端主要使用 Node.js 内置模块，仅用 `yaml` 加载配置；前端资源全部自托管。
- **临时优先**：不使用数据库、不写入聊天记录，停止服务即清空会话。
- **部署者可控**：运行在自己的电脑或服务器上，不依赖外部账号和云服务。
- **按需扩展**：持久化、权限与风控作为未来可选能力加入，不让默认部署变重。

## 功能

**聊天体验**

- 输入用户名即可进入默认频道；配置多个频道后可在界面中切换，频道列表显示各频道实时在线人数
- 频道之间隔离消息、在线成员、输入状态和回应；每个频道有独立临时历史及人数上限
- 只读频道（`readOnly: true`）：可进入、浏览历史、使用表情回应，但所有人都不能发消息；适合公告、规则等由部署者维护的内容
- 频道欢迎语（`welcome`）：频道顶部显示的导言卡，介绍频道用途、规则或玩法
- 刷新页面仍在聊天页：会话身份只存在当前标签页的 `sessionStorage` 中，刷新自动恢复；只有点击”离开”（需二次确认）才会回到登录页
- 文字、表情、图片（PNG / JPEG / GIF / WebP，默认单张上限 300 KB）；表情选择器支持搜索、肤色和中文关键词
- 回复消息，每条消息显示精确到秒的发送时间
- @ 提及频道成员，被提及时高亮显示，点击可查看成员资料
- 随机生成头像，点击头像查看用户名、IP（默认显示，可配置关闭）和在线时长
- 在线成员列表、加入/离开提示、输入状态提示
- 图片在页内查看器里打开：缩放、旋转、还原、下载，多图可用方向键翻页，桌面端可拖动平移、滚轮缩放
- 消息回应固定为 6 个表情（👍 ❤️ 😂 🎉 👀 🔥）
- 响应式移动端布局、键盘操作与减少动态效果支持

**界面与资源**

- 完整的**深色模式**支持，自动适配系统主题偏好
- 现代**玻璃态（Glassmorphism）**设计，半透明背景与模糊效果
- 流畅的**微交互动画**：按钮弹性反馈、表情弹跳、脉冲动画等
- 精心设计的**色彩系统**和间距规范，详见 [设计语言文档](docs/design-language.md)
- 图标来自自托管的 [Lucide](https://lucide.dev)（`vendor/lucide`，ISC 许可）
- 表情选择器来自自托管的 `vendor/emoji-picker`（Apache-2.0 许可）
- 服务端静态白名单只提供聊天页、样式、明确列出的 `client/` 模块及所需的 `vendor/` 资源，不提供任意仓库文件
- 静态文本资源按 `Accept-Encoding` 协商 gzip，压缩结果按 ETag 缓存，响应带 `Vary: Accept-Encoding`；不支持 gzip 的客户端仍收到原始字节

**可靠性**

- 消息由服务端确认接收（ACK），未确认或失败的内容可在当前页面重试
- 相同消息 ID 幂等去重，短暂断线或刷新可恢复临时身份
- 图片发送前在浏览器内降采样到长边 1600 px 并按大小在质量 0.5–0.82 之间收敛；GIF 保留动画、不降采样，仍受同一条上限约束
- 正常停服会让页面回到登录状态；意外断线继续重连。新进程产生新的频道纪元，旧的未确认内容不会自动发入新房间
- YAML 配置使用版本、严格类型、未知键、重复键、别名和交叉容量校验

**当前只读边界**

- 消息发出后不可编辑或删除，只能通过表情回应参与
- 无历史持久化、私聊、搜索、账号或角色权限
- `enabled: false` 的频道完全不可加入；`readOnly: true` 的频道可以加入、浏览历史、使用表情回应，但所有人都不能发消息（没有例外，也没有管理员豁免）
- 只读频道适合公告、规则等由部署者在配置中维护的内容；改完需要重启服务

**提醒（渐进式）**

- 页内未读计数与“回到底部”按钮、标题未读角标、动态图标徽标
- “开启提醒”只会在用户点击后请求浏览器通知权限，绝不自动弹窗
- 普通局域网 HTTP 地址即使无法使用系统通知，页内提醒也始终可用

## 快速开始

### 本地运行

需要 Node.js 22+。克隆仓库后按锁文件安装依赖：

```bash
npm ci
npm start
```

默认监听 `0.0.0.0:4173`，启动后终端会打印本机与局域网访问地址：

- 本机访问：`http://localhost:4173`
- 局域网访问：`http://<主机局域网 IP>:4173`

把局域网地址发给连接同一 Wi-Fi 或私有网络的用户即可。临时更换端口：

```bash
PORT=8080 npm start
```

### Docker 部署

使用 Docker Compose（推荐）：

```bash
git clone https://github.com/caigg188/Pavilo.git
cd Pavilo
docker compose up -d
```

或者手动构建和运行：

```bash
docker build -t pavilo .
docker run -d -p 4173:4173 --name pavilo pavilo
```

详见 [Docker 部署文档](docs/deployment/docker.md)。

### 生产部署

- **反向代理**：参考 [Nginx/Caddy 配置指南](docs/deployment/reverse-proxy.md)
- **健康检查**：参考 [健康检查契约文档](docs/healthcheck.md)

停止服务请按 `Ctrl-C`。

## 配置

Pavilo 按以下优先级加载配置（越靠后优先级越高）：

1. 内置默认值；
2. 默认路径 `./pavilo.yaml`，文件不存在时安静回退到内置默认值；
3. `PAVILO_CONFIG` 指向的 YAML 文件；
4. `PORT` 环境变量，只覆盖最终端口。

`PAVILO_CONFIG` 一旦显式设置，目标缺失、不可读、过大、不是普通文件或校验失败都会使启动失败，不会回退。`PORT` 只接受 `1` 至 `65535` 的严格十进制字符串，例如 `4173`；`4173.0`、`0x105d`、空格和正负号均无效。

创建配置：

```bash
cp pavilo.example.yaml pavilo.yaml
npm run config:check
npm start
```

也可使用仓库外路径：

```bash
PAVILO_CONFIG=/etc/pavilo/config.yaml npm run config:check
PAVILO_CONFIG=/etc/pavilo/config.yaml npm start
```

修改配置后必须**重启进程**，运行中的服务不会热加载。`npm run config:check` 只校验并显示实际配置来源，不启动服务。

配置必须声明 `version: 1`。YAML 使用严格类型：布尔值写作 `true` / `false`，数字写作整数；未知配置项、重复键、未知 tag、锚点/别名和非对象根节点都会被拒绝。完整字段及推荐值见 [`pavilo.example.yaml`](./pavilo.example.yaml)。

### 频道和人数语义

- 不提供 `channels` 时，会保留内置 `general` 和 `project`，各频道 `maxUsers` 自动收紧到 `server.maxUsers`，因此可以只调低全局人数。
- 一旦提供 `channels`，列表就是完整替换而非与 `general` 合并；**非 `general` 默认频道**需同时出现在列表中、启用，并由 `room.defaultChannel` 指定。
- `server.maxUsers` 是全局成员上限；`channels[].maxUsers` 是单频道上限，且不得超过全局上限。
- 全局和频道人数都包含 `timeouts.sessionLeaseMs` 内暂时断线、仍可恢复身份的成员。连接总数由 `server.maxConnections` 单独限制。
- 至少要启用一个可发言的频道（`enabled: true` 且 `readOnly` 不为 `true`）；只读频道可以浏览，但不计入”可发言”的最低要求。

示例：自定义频道并设为默认频道：

```yaml
version: 1
room:
  defaultChannel: projects
channels:
  - id: projects
    name: 项目讨论
    enabled: true
    maxUsers: 24
```

_注：内置默认频道为 `general` 和 `project`（单数）。_

### 配置文件安全

Pavilo 的 HTTP 服务采用静态白名单，`pavilo.yaml` 和 `pavilo.example.yaml` 不会被应用直接提供；配置加载器也拒绝把 `index.html`、`chat.css` 或 `vendor/`、`client/` 内文件（包括通过符号链接指向它们的文件）用作配置。但这不是认证机制：聊天页面、房间元数据和前端资源对任何能访问监听端口的人开放。

- 不要把真实配置放入 `vendor/`、`client/`、其他 Web 根目录、对象存储公开目录或反向代理的静态目录。
- 反向代理只能转发 Pavilo 的应用端口，不得额外把整个仓库目录作为静态站点；否则代理可能绕过应用白名单，泄漏原始 YAML、源码或其他文件。
- 原始 YAML **不得提供下载**。如配置包含内部域名或网络策略，更应放在仓库外并设置操作系统文件权限。
- `allowedOrigins` 只校验 WebSocket 浏览器 Origin，**不是用户认证或访问控制**；`allowNoOrigin: true` 还允许没有 Origin 的客户端。
- 直接连接时服务看到真实 IP；反向代理下当前版本不信任 `X-Forwarded-For`，成员看到的可能是代理 IP，同 IP 连接限制也会按代理 IP 聚合。不要为“修复”显示而让代理公开仓库，也不要把未受保护的端口直接暴露公网。

## 容量与临时数据边界

**消息 ACK** 表示“本次服务进程已接受”，不表示所有成员已送达或已读。默认容量包括：每频道最多 300 条历史、约 32 MB 消息预算、单图 300 KB、全局 64 名成员、80 个连接、同一 IP 12 个连接，以及慢连接写缓冲上限；超限时优先淘汰最旧消息。

图片上限直接决定一个频道能留住多少张图：单图 300 KB 时约 79 张，旧默认值 1.5 MB 时只有 16 张——一张原图就能吃掉频道约 5% 的容量，所以调高 `limits.maxImageBytes` 要连同 `limits.maxChannelBytes` 一起考虑。客户端会在上传前把长边降到 1600 px，所以手机原图通常远小于这个上限；但 GIF 不做降采样，可能因此被拒绝。

配置校验要求最大图片的 base64/最长文字消息、全局最大人数对应的成员列表 JSON、WebSocket 帧及写缓冲可以相互容纳。这些是防止配置自相矛盾的保守下限，不是内存使用承诺；提高人数、图片、历史或缓冲上限会显著增加内存需求。

**临时数据**：会话、在线状态、消息和回应只存在于服务端进程或当前浏览器页面内存中；浏览器不使用 `localStorage`、Cache Storage 或 IndexedDB 保存聊天内容。唯一例外是表情选择器在 IndexedDB 中缓存的表情数据与个人常用表情计数，不涉及聊天内容。

为了让刷新仍停留在聊天页，当前标签页会在 `sessionStorage` 中保存房间签发的随机恢复令牌与用户名，不含消息。它随标签页关闭而消失，点击“离开”会立即清除；服务重启后自动失效。

**提醒边界**：系统通知需要浏览器权限与安全上下文，`http://<局域网 IP>` 通常不可用，此时自动降级为页内提醒。浏览器权限本身由浏览器管理，服务停止后仍可能存在。

## 在服务器上运行

Pavilo 可以运行在能执行 Node.js 的服务器上，但 **v0.1 只面向可信网络**（内网、VPN 或其他有访问控制的私有网络）。当前没有账号认证、TLS、端到端加密或完整公网风控，请勿把端口直接暴露到公网。

成员资料默认向频道内参与者显示完整连接 IP，这是当前产品行为；可设置 `room.exposeMemberIps: false` 关闭显示。无论是否显示，服务仍需使用连接 IP 执行单 IP 连接限制。请只在可信环境中使用。

`/room-info` 默认会列出主机的所有局域网地址，方便把入口发给同网段的人；不需要时可设置 `room.exposeLanUrls: false`，接口改返回空数组。另外，`/healthz` 会报告当前人数、连接数与内存中的消息字节数，用于存活检查和观测。这些端点都不需要认证，和聊天页一样对任何能访问监听端口的人开放。

## 开发与测试

```bash
npm ci                  # 严格按 package-lock.json 安装依赖
npm run config:check    # 校验实际将加载的配置
npm test                # 运行 test/*.test.js
node --check config.js
node --check server.js
```

测试覆盖配置、客户端协议/状态/pending/图片规则、无网络聊天内核，以及 HTTP / WebSocket 的历史分块、ACK、幂等去重、恢复身份、Origin、心跳、回应、静态资源和生命周期；频道测试覆盖隔离、原子切换、人数租约与容量淘汰。

浏览器验收使用已安装的 Google Chrome，Playwright 单独安装到仓库外，不进入运行时依赖：

```bash
npm install --prefix /tmp/pavilo-browser-verify --no-package-lock playwright
PAVILO_PLAYWRIGHT_PATH=/tmp/pavilo-browser-verify/node_modules/playwright npm run test:browser
```

脚本自动创建仓库外临时 YAML、分配回环端口、驱动双页面，并只关闭自己启动的进程。覆盖频道隔离/切换失败、刷新/断线恢复、IME、图片查看器、阅读位置、移动端抽屉和正常停服；移动键盘使用缩小视口模拟，不能代替真机输入法验收。

模块边界和维护约定见 [架构概览](docs/architecture/overview.md)、[协议契约](docs/architecture/chat-protocol.md)、[状态契约](docs/architecture/state-model.md) 和 [设计语言](docs/design-language.md)。

架构决策与演进策略见：
- [架构原则](docs/architecture/principles.md) — 核心设计哲学与不变量
- [架构演进](docs/evolution.md) — 未来扩展边界
- [架构决策记录](docs/adr/) — 重大技术决策的背景与权衡
- [产品路线图](ROADMAP.md) — 版本规划与发布门槛

## 项目结构

```text
.
├── config.js           # YAML / 环境变量配置加载与校验
├── pavilo.example.yaml # 完整配置示例
├── index.html          # 页面骨架、资源引用与启动入口
├── chat.css            # 页面样式（深色模式、玻璃态、微交互）
├── client/             # 协议、连接、状态、pending 与独立视图模块
├── server.js           # 配置、core/transport 组合与兼容启动入口
├── src/core/           # 不依赖网络的房间、会话、命令与领域事件
├── src/transport/      # HTTP 静态白名单、WebSocket 连接与帧协议
├── vendor/             # 自托管的第三方前端资源
├── scripts/            # Lucide 资源构建脚本
├── test/               # Node 单元/集成测试及独立浏览器验收
├── docs/
│   ├── architecture/   # 架构、协议与状态契约
│   └── design-language.md  # 设计语言、色彩系统与组件规范
├── package.json        # 元数据、依赖与命令
├── ROADMAP.md          # 已实现状态与后续计划
└── LICENSE             # MIT 许可证
```

## 许可证

Pavilo 使用 [MIT License](./LICENSE) 开源。
