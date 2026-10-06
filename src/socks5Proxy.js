import net from 'node:net';
import { config } from './config.js';
import { logger } from './logger.js';
import { isIpAllowed, normalizeIp, validateCredentials } from './auth.js';

const SOCKS_VERSION = 0x05;
const AUTH_NO_AUTH = 0x00;
const AUTH_USER_PASS = 0x02;
const NO_ACCEPTABLE_METHODS = 0xff;

const CMD_CONNECT = 0x01;
const ATYP_IPV4 = 0x01;
const ATYP_DOMAIN = 0x03;
const ATYP_IPV6 = 0x04;

const REP_SUCCESS = 0x00;
const REP_FAIL = 0x01;
const REP_CMD_NOT_SUPPORTED = 0x07;
const REP_ADDR_NOT_SUPPORTED = 0x08;

export function createSocks5ProxyServer() {
  const server = net.createServer((clientSocket) => {
    const clientIp = normalizeIp(clientSocket.remoteAddress);

    // 1. Check IP whitelist
    if (!isIpAllowed(clientIp)) {
      logger.warn(`Forbidden client IP for SOCKS5: ${clientIp}`, 'SOCKS5');
      return clientSocket.destroy();
    }

    let state = 'HANDSHAKE'; // HANDSHAKE -> AUTH -> REQUEST -> PIPED
    let buffer = Buffer.alloc(0);
    let authenticatedUser = null;

    clientSocket.setTimeout(120000);
    clientSocket.on('timeout', () => {
      clientSocket.destroy();
    });

    const onData = (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);

      try {
        if (state === 'HANDSHAKE') {
          // Handshake requires at least 2 bytes (VER, NMETHODS)
          if (buffer.length < 2) return;
          const version = buffer[0];
          const nMethods = buffer[1];

          if (version !== SOCKS_VERSION) {
            logger.warn(`Unsupported SOCKS version: 0x${version.toString(16)} from ${clientIp}`, 'SOCKS5');
            clientSocket.destroy();
            return;
          }

          if (buffer.length < 2 + nMethods) return; // Wait for all methods

          const methods = buffer.subarray(2, 2 + nMethods);
          buffer = buffer.subarray(2 + nMethods);

          if (!config.authRequired) {
            let hasNoAuth = false;
            for (let i = 0; i < methods.length; i++) {
              if (methods[i] === AUTH_NO_AUTH) {
                hasNoAuth = true;
                break;
              }
            }

            if (hasNoAuth) {
              clientSocket.write(Buffer.from([SOCKS_VERSION, AUTH_NO_AUTH]));
              authenticatedUser = 'anonymous';
              state = 'REQUEST';
            } else {
              logger.warn(`Client did not offer no-auth method from ${clientIp}`, 'SOCKS5');
              clientSocket.write(Buffer.from([SOCKS_VERSION, NO_ACCEPTABLE_METHODS]));
              clientSocket.destroy();
              return;
            }
          } else {
            let hasUserPass = false;
            for (let i = 0; i < methods.length; i++) {
              if (methods[i] === AUTH_USER_PASS) {
                hasUserPass = true;
                break;
              }
            }

            if (hasUserPass) {
              // Tell client we require Username/Password (RFC 1929)
              clientSocket.write(Buffer.from([SOCKS_VERSION, AUTH_USER_PASS]));
              state = 'AUTH';
            } else {
              logger.warn(`Client did not offer username/password auth from ${clientIp}`, 'SOCKS5');
              clientSocket.write(Buffer.from([SOCKS_VERSION, NO_ACCEPTABLE_METHODS]));
              clientSocket.destroy();
              return;
            }
          }
        }

        if (state === 'AUTH') {
          // RFC 1929 auth: VER (1), ULEN (1), UNAME (ULEN), PLEN (1), PASSWD (PLEN)
          if (buffer.length < 2) return;
          const authVersion = buffer[0];
          const uLen = buffer[1];

          if (buffer.length < 2 + uLen + 1) return;
          const pLen = buffer[2 + uLen];

          if (buffer.length < 2 + uLen + 1 + pLen) return;

          const username = buffer.subarray(2, 2 + uLen).toString('utf8');
          const password = buffer.subarray(3 + uLen, 3 + uLen + pLen).toString('utf8');
          buffer = buffer.subarray(3 + uLen + pLen);

          if (validateCredentials(username, password)) {
            authenticatedUser = username;
            // Success response: 0x01 (version), 0x00 (success)
            clientSocket.write(Buffer.from([0x01, 0x00]));
            state = 'REQUEST';
          } else {
            logger.warn(`Unauthorized SOCKS5 credentials for user "${username}" from ${clientIp}`, 'SOCKS5');
            // Fail response: 0x01 (version), 0x01 (failure)
            clientSocket.write(Buffer.from([0x01, 0x01]));
            clientSocket.destroy();
            return;
          }
        }

        if (state === 'REQUEST') {
          // Request: VER (1), CMD (1), RSV (1), ATYP (1), DST.ADDR (...), DST.PORT (2)
          if (buffer.length < 4) return;
          const version = buffer[0];
          const cmd = buffer[1];
          const atyp = buffer[3];

          if (version !== SOCKS_VERSION) {
            clientSocket.destroy();
            return;
          }

          if (cmd !== CMD_CONNECT) {
            logger.warn(`Unsupported command 0x${cmd.toString(16)} from ${clientIp}`, 'SOCKS5');
            sendReply(clientSocket, REP_CMD_NOT_SUPPORTED);
            clientSocket.destroy();
            return;
          }

          let targetHost = '';
          let portOffset = 4;

          if (atyp === ATYP_IPV4) {
            if (buffer.length < 4 + 4 + 2) return;
            targetHost = `${buffer[4]}.${buffer[5]}.${buffer[6]}.${buffer[7]}`;
            portOffset = 8;
          } else if (atyp === ATYP_DOMAIN) {
            if (buffer.length < 5) return;
            const domainLen = buffer[4];
            if (buffer.length < 5 + domainLen + 2) return;
            targetHost = buffer.subarray(5, 5 + domainLen).toString('utf8');
            portOffset = 5 + domainLen;
          } else if (atyp === ATYP_IPV6) {
            if (buffer.length < 4 + 16 + 2) return;
            const ipv6Parts = [];
            for (let i = 0; i < 16; i += 2) {
              ipv6Parts.push(buffer.readUInt16BE(4 + i).toString(16));
            }
            targetHost = ipv6Parts.join(':');
            portOffset = 20;
          } else {
            sendReply(clientSocket, REP_ADDR_NOT_SUPPORTED);
            clientSocket.destroy();
            return;
          }

          const targetPort = buffer.readUInt16BE(portOffset);
          const remainingData = buffer.subarray(portOffset + 2);

          state = 'PIPED';
          clientSocket.removeListener('data', onData);

          logger.info(`CONNECT ${targetHost}:${targetPort} (User: ${authenticatedUser}, IP: ${clientIp})`, 'SOCKS5');

          const targetSocket = net.connect({ host: targetHost, port: targetPort }, () => {
            sendReply(clientSocket, REP_SUCCESS);

            if (remainingData.length > 0) {
              targetSocket.write(remainingData);
            }

            targetSocket.pipe(clientSocket);
            clientSocket.pipe(targetSocket);
          });

          targetSocket.setTimeout(120000);
          targetSocket.on('timeout', () => {
            targetSocket.destroy();
            clientSocket.destroy();
          });

          targetSocket.on('error', (err) => {
            logger.error(`Target socket error (${targetHost}:${targetPort}): ${err.message}`, 'SOCKS5');
            sendReply(clientSocket, REP_FAIL);
            clientSocket.destroy();
          });

          clientSocket.on('error', (err) => {
            logger.debug(`Client socket error: ${err.message}`, 'SOCKS5');
            targetSocket.destroy();
          });

          targetSocket.on('close', () => {
            clientSocket.destroy();
          });

          clientSocket.on('close', () => {
            targetSocket.destroy();
          });
        }
      } catch (err) {
        logger.error(`Error processing SOCKS5 packet: ${err.message}`, 'SOCKS5');
        clientSocket.destroy();
      }
    };

    clientSocket.on('data', onData);

    clientSocket.on('error', (err) => {
      logger.debug(`Client connection error: ${err.message}`, 'SOCKS5');
    });
  });

  return server;
}

function sendReply(socket, repCode) {
  if (!socket.writable) return;
  // SOCKS5 reply format: VER, REP, RSV, ATYP (IPv4), BND.ADDR (4 bytes 0), BND.PORT (2 bytes 0)
  const reply = Buffer.from([0x05, repCode, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
  try {
    socket.write(reply);
  } catch {
    // Ignore socket write errors on closing sockets
  }
}
