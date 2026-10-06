import { config } from './config.js';
import { logger } from './logger.js';
import { createHttpProxyServer } from './httpProxy.js';
import { createSocks5ProxyServer } from './socks5Proxy.js';

const httpServer = createHttpProxyServer();
const socks5Server = createSocks5ProxyServer();

function startServers() {
  httpServer.listen(config.httpPort, config.bindHost, () => {
    logger.info(`HTTP/HTTPS Forward Proxy listening on ${config.bindHost}:${config.httpPort}`, 'HTTP');
  });

  socks5Server.listen(config.socks5Port, config.bindHost, () => {
    logger.info(`SOCKS5 Proxy listening on ${config.bindHost}:${config.socks5Port}`, 'SOCKS5');
  });

  const authStatus = config.authRequired
    ? `Enabled (${config.users.size} user${config.users.size === 1 ? '' : 's'})`
    : 'Disabled (Open proxy / No credentials required)';

  const ipWhitelistStatus = config.allowedIps.size > 0
    ? `Restricted to [${Array.from(config.allowedIps).join(', ')}]`
    : (config.authRequired ? 'Open to all IPs (Credentials required)' : 'Open to all IPs (WARNING: Unrestricted)');

  logger.info(`Proxy service started [PID ${process.pid}]`, 'SYSTEM');
  logger.info(`Authentication: ${authStatus}`, 'SYSTEM');
  logger.info(`Access control: ${ipWhitelistStatus}`, 'SYSTEM');
}

function handleShutdown(signal) {
  logger.info(`Received ${signal}. Gracefully shutting down...`, 'SYSTEM');

  let closedCount = 0;
  const onClosed = () => {
    closedCount += 1;
    if (closedCount === 2) {
      logger.info('All proxy listeners closed. Exiting process.', 'SYSTEM');
      process.exit(0);
    }
  };

  httpServer.close(onClosed);
  socks5Server.close(onClosed);

  // Force shutdown if connections do not close in 5 seconds
  setTimeout(() => {
    logger.warn('Forcing shutdown after 5s timeout.', 'SYSTEM');
    process.exit(1);
  }, 5000).unref();
}

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));

process.on('uncaughtException', (err) => {
  logger.error(`Uncaught exception: ${err.stack || err.message}`, 'SYSTEM');
});

process.on('unhandledRejection', (reason) => {
  logger.error(`Unhandled rejection: ${reason}`, 'SYSTEM');
});

startServers();
