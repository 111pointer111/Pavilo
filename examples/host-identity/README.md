# 宿主身份示例

最小「已有登录的产品」：这个小服务签发 HS256 JWT，页面用 WebSocket `join.identityToken` 进入 Pavilo。不改 Pavilo 源码，也不是嵌入 SDK。

配置只维护两份示例。宿主身份是 SQLite 家族上的可选块，写在 [`pavilo.sqlite.example.yaml`](../../pavilo.sqlite.example.yaml) 的注释里。

## 准备

1. 复制 sqlite 示例并准备数据目录：

```bash
cp pavilo.sqlite.example.yaml pavilo.yaml
mkdir -p data
```

2. 在 `pavilo.yaml` 里按注释打开宿主身份：
   - 取消 `identity:` 段注释
   - 取消 `staff` 频道注释
   - 把 `http://127.0.0.1:4174` 和 `http://localhost:4174` 写入 `server.allowedOrigins`
3. 写入 `identity.issuers[0].secret`，或：

```bash
export PAVILO_IDENTITY_SECRET=$(openssl rand -hex 32)
```

4. `npm run config:check` 后 `npm start`
5. 在本目录用**同一**密钥启动示例：

```bash
PAVILO_IDENTITY_SECRET=... PAVILO_URL=http://127.0.0.1:4173 node server.js
```

6. 打开 http://127.0.0.1:4174 ，用 `ada` / `ada` 登录，应能进入 `staff`。

若改了示例端口，YAML 的 `allowedOrigins` 一起改。不要把 JWT 放进 Pavilo 的 URL。独立聊天页 `/` 不会代填 `identityToken`。
