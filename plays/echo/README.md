# Echo 夹具

这不是产品玩法。它用来冻结 Play 契约：独立页面、`playAction` / `playState`、Agent 基座。

默认配置不要启用。开发或测试时：

```yaml
version: 2
storage:
  driver: sqlite
  sqlite:
    path: ./data/pavilo.db
plays:
  - echo
channels:
  - id: general
    name: 闲聊
  - id: echo
    name: 回声桌
    play: echo
```

对照完整示例见 `pavilo.sqlite.example.yaml` 里标注「可选：玩法」的注释块。
