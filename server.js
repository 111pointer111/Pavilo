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
  const pkg = require('./package.json');
  app.listen().then((address) => {
    const port = typeof address === 'object' && address ? address.port : DEFAULTS.port;
    const config = app.config;

    // Banner with version
    process.stdout.write(`\n╭─────────────────────────────────────╮\n`);
    process.stdout.write(`│  Pavilo / 语亭                      │\n`);
    process.stdout.write(`│  v${pkg.version.padEnd(30)} │\n`);
    process.stdout.write(`╰─────────────────────────────────────╯\n\n`);

    // Core info
    process.stdout.write(`✓ Protocol version: ${PROTOCOL_VERSION}\n`);
    process.stdout.write(`✓ Storage mode: ephemeral (in-memory only)\n`);
    process.stdout.write(`✓ Config source: ${loaded.configPath || 'built-in defaults'}\n`);
    process.stdout.write(`  → Restart required to apply config changes\n\n`);

    // Network addresses
    process.stdout.write(`🌐 Listening on:\n`);
    process.stdout.write(`  → Local:  http://localhost:${port}\n`);
    const addresses = app.localAddresses();
    if (addresses.length && config.exposeLanUrls) {
      for (const ip of addresses) {
        process.stdout.write(`  → LAN:    http://${ip}:${port}\n`);
      }
    } else if (!config.exposeLanUrls) {
      process.stdout.write(`  → LAN addresses hidden (exposeLanUrls: false)\n`);
    }

    // Security boundaries
    process.stdout.write(`\n🔒 Security boundaries:\n`);
    process.stdout.write(`  → Origin check: ${config.allowNoOrigin ? 'disabled (allowNoOrigin: true)' : 'enabled'}\n`);
    if (config.allowNoOrigin) {
      process.stdout.write(`    ⚠️  Warning: Non-browser clients allowed. Use allowNoOrigin: false for stricter security.\n`);
    }
    if (config.allowedOrigins.length > 0) {
      process.stdout.write(`  → Allowed origins: ${config.allowedOrigins.join(', ')}\n`);
    }
    process.stdout.write(`  → Member IPs: ${config.exposeMemberIps ? 'visible to all users' : 'hidden'}\n`);
    process.stdout.write(`  → Max users: ${config.maxUsers}\n`);
    process.stdout.write(`  → Max connections: ${config.maxClients}\n\n`);

    process.stdout.write(`Ready to accept connections.\n\n`);
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
