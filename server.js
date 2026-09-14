'use strict';

const http = require('node:http');
const { DEFAULTS, loadConfig } = require('./config');
const { createChatCore } = require('./src/core');
const { PROTOCOL_VERSION, REACTION_EMOJIS } = require('./src/core/events');
const { createHttpHandler } = require('./src/transport/http');
const { createWebSocketTransport } = require('./src/transport/websocket');

function createChatServer(options = {}) {
  const config = { ...DEFAULTS, ...options };
  config.channels = (options.channels || DEFAULTS.channels).map((channel) => ({ ...channel }));
  let transport;
  const core = createChatCore(config, { onEffects: (effects) => transport.deliver(effects) });
  const server = http.createServer(createHttpHandler(config, core, () => server.address(), __dirname));
  transport = createWebSocketTransport(server, config, core);
  const { listen, stop, roomEpoch, localAddresses, state } = transport;
  return { server, listen, stop, roomEpoch, localAddresses, config, state };
}

module.exports = { createChatServer, DEFAULTS, PROTOCOL_VERSION, REACTION_EMOJIS: [...REACTION_EMOJIS] };

if (require.main === module) {
  let loaded;
  try {
    loaded = loadConfig();
  } catch (error) {
    process.stderr.write(`无法加载语亭配置：${error.message}\n`);
    process.exitCode = 1;
    return;
  }
  const app = createChatServer(loaded.config);
  app.listen().then((address) => {
    const port = typeof address === 'object' && address ? address.port : DEFAULTS.port;
    process.stdout.write(`Pavilo / 语亭 listening on http://localhost:${port}\n`);
    const addresses = app.localAddresses();
    if (addresses.length) {
      for (const ip of addresses) process.stdout.write(`LAN access: http://${ip}:${port}\n`);
    } else {
      process.stdout.write('LAN access: use the host machine\'s local IP address.\n');
    }
    process.stdout.write(`Config: ${loaded.configPath || 'built-in defaults'} (restart to apply changes)\n`);
    process.stdout.write('Ephemeral mode: messages and presence live in memory only.\n');
  }).catch((error) => {
    if (error.code === 'EADDRINUSE') {
      process.stderr.write(`无法启动：端口 ${loaded.config.port} 已被占用。可使用 PORT=4187 npm start 更换端口。\n`);
    } else {
      process.stderr.write(`无法启动语亭聊天室：${error.message}\n`);
    }
    process.exitCode = 1;
  });
  const shutdown = (signal) => app.stop(signal).finally(() => process.exit(0));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}
