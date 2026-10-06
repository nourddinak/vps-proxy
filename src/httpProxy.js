import http from 'node:http';
import net from 'node:net';
import url from 'node:url';
import { config } from './config.js';
import { logger } from './logger.js';
import { isIpAllowed, normalizeIp, parseBasicAuthHeader, validateCredentials } from './auth.js';

export function createHttpProxyServer() {
  const server = http.createServer((req, res) => {
    const clientIp = normalizeIp(req.socket.remoteAddress);

    // 1. Check IP whitelist
    if (!isIpAllowed(clientIp)) {
      logger.warn(`Forbidden client IP: ${clientIp}`, 'HTTP');
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      return res.end('403 Forbidden: IP address not allowed\n');
    }

    // 2. Check Proxy Authentication if enabled
    let username = 'anonymous';
    if (config.authRequired) {
      const authHeader = req.headers['proxy-authorization'];
      const creds = parseBasicAuthHeader(authHeader);
      if (!creds || !validateCredentials(creds.username, creds.password)) {
        logger.warn(`Unauthorized HTTP request from ${clientIp} for ${req.url}`, 'HTTP');
        res.writeHead(407, {
          'Proxy-Authenticate': 'Basic realm="VPS Proxy"',
          'Content-Type': 'text/plain',
          Connection: 'close',
        });
        return res.end('407 Proxy Authentication Required\n');
      }
      username = creds.username;
    }

    // 3. Forward regular HTTP request
    try {
      const parsedUrl = new url.URL(req.url.startsWith('http') ? req.url : `http://${req.headers.host}${req.url}`);
      logger.info(`${req.method} ${parsedUrl.hostname}${parsedUrl.pathname} (User: ${username}, IP: ${clientIp})`, 'HTTP');

      const forwardHeaders = { ...req.headers };
      delete forwardHeaders['proxy-authorization'];
      delete forwardHeaders['proxy-connection'];

      const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || 80,
        path: parsedUrl.pathname + parsedUrl.search,
        method: req.method,
        headers: forwardHeaders,
      };

      const proxyReq = http.request(options, (proxyRes) => {
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res, { end: true });
      });

      proxyReq.on('error', (err) => {
        logger.error(`Forward error for ${parsedUrl.hostname}: ${err.message}`, 'HTTP');
        if (!res.headersSent) {
          res.writeHead(502, { 'Content-Type': 'text/plain' });
          res.end('502 Bad Gateway\n');
        }
      });

      req.pipe(proxyReq, { end: true });
    } catch (err) {
      logger.error(`Malformed request URL ${req.url}: ${err.message}`, 'HTTP');
      if (!res.headersSent) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('400 Bad Request\n');
      }
    }
  });

  // Handle HTTPS CONNECT tunneling
  server.on('connect', (req, clientSocket, head) => {
    const clientIp = normalizeIp(clientSocket.remoteAddress);

    // 1. Check IP whitelist
    if (!isIpAllowed(clientIp)) {
      logger.warn(`Forbidden client IP for CONNECT: ${clientIp}`, 'HTTP');
      clientSocket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return clientSocket.destroy();
    }

    // 2. Check Proxy Authentication if enabled
    let username = 'anonymous';
    if (config.authRequired) {
      const authHeader = req.headers['proxy-authorization'];
      const creds = parseBasicAuthHeader(authHeader);
      if (!creds || !validateCredentials(creds.username, creds.password)) {
        logger.warn(`Unauthorized CONNECT request from ${clientIp} for ${req.url}`, 'HTTP');
        clientSocket.write(
          'HTTP/1.1 407 Proxy Authentication Required\r\n' +
          'Proxy-Authenticate: Basic realm="VPS Proxy"\r\n' +
          'Connection: close\r\n\r\n'
        );
        return clientSocket.destroy();
      }
      username = creds.username;
    }

    // 3. Connect to target endpoint
    const [targetHost, targetPortStr] = req.url.split(':');
    const targetPort = parseInt(targetPortStr, 10) || 443;

    logger.info(`CONNECT ${targetHost}:${targetPort} (User: ${username}, IP: ${clientIp})`, 'HTTP');

    const targetSocket = net.connect(targetPort, targetHost, () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head && head.length > 0) {
        targetSocket.write(head);
      }
      targetSocket.pipe(clientSocket);
      clientSocket.pipe(targetSocket);
    });

    targetSocket.setTimeout(120000);
    clientSocket.setTimeout(120000);

    targetSocket.on('timeout', () => {
      targetSocket.destroy();
      clientSocket.destroy();
    });

    clientSocket.on('timeout', () => {
      clientSocket.destroy();
      targetSocket.destroy();
    });

    targetSocket.on('error', (err) => {
      logger.error(`Target socket error (${targetHost}:${targetPort}): ${err.message}`, 'HTTP');
      if (clientSocket.writable) {
        clientSocket.write('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n');
      }
      clientSocket.destroy();
    });

    clientSocket.on('error', (err) => {
      logger.debug(`Client socket error: ${err.message}`, 'HTTP');
      targetSocket.destroy();
    });

    targetSocket.on('close', () => {
      clientSocket.destroy();
    });

    clientSocket.on('close', () => {
      targetSocket.destroy();
    });
  });

  return server;
}
