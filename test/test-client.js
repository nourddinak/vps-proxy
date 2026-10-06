import net from 'node:net';
import tls from 'node:tls';
import { config } from '../src/config.js';

const PROXY_HOST = '127.0.0.1';
const HTTP_PORT = config.httpPort;
const SOCKS5_PORT = config.socks5Port;

const VALID_USER = 'admin';
const VALID_PASS = config.users.get('admin') || 'ProxySecretPass123!';
const INVALID_USER = 'wronguser';
const INVALID_PASS = 'wrongpass';

let totalTests = 0;
let passedTests = 0;

function assert(condition, message) {
  totalTests += 1;
  if (condition) {
    passedTests += 1;
    console.log(`[PASS] ${message}`);
  } else {
    console.error(`[FAIL] ${message}`);
  }
}

// 1. Test HTTP Proxy - Unauthenticated CONNECT
function testHttpUnauthorized() {
  return new Promise((resolve) => {
    const socket = net.connect({ host: PROXY_HOST, port: HTTP_PORT }, () => {
      socket.write('CONNECT api.ipify.org:443 HTTP/1.1\r\nHost: api.ipify.org:443\r\n\r\n');
    });

    let data = '';
    socket.on('data', (chunk) => {
      data += chunk.toString();
    });

    socket.on('close', () => {
      assert(data.includes('407 Proxy Authentication Required'), 'HTTP Proxy: Rejects unauthenticated CONNECT with 407');
      resolve();
    });

    socket.on('error', (err) => {
      assert(false, `HTTP Proxy unauthorized test socket error: ${err.message}`);
      resolve();
    });
  });
}

// 2. Test HTTP Proxy - Authenticated CONNECT Tunnel
function testHttpAuthorized() {
  return new Promise((resolve) => {
    const authHeader = 'Basic ' + Buffer.from(`${VALID_USER}:${VALID_PASS}`).toString('base64');
    const socket = net.connect({ host: PROXY_HOST, port: HTTP_PORT }, () => {
      socket.write(`CONNECT api.ipify.org:443 HTTP/1.1\r\nHost: api.ipify.org:443\r\nProxy-Authorization: ${authHeader}\r\n\r\n`);
    });

    let established = false;
    let dataBuffer = '';

    socket.on('data', (chunk) => {
      dataBuffer += chunk.toString();
      if (!established && dataBuffer.includes('200 Connection Established')) {
        established = true;
        assert(true, 'HTTP Proxy: Accepts valid credentials and establishes 200 tunnel');

        // Upgrade socket to TLS
        const tlsSocket = tls.connect({
          socket,
          servername: 'api.ipify.org',
          rejectUnauthorized: false,
        }, () => {
          tlsSocket.write('GET /?format=json HTTP/1.1\r\nHost: api.ipify.org\r\nConnection: close\r\n\r\n');
        });

        let responseBody = '';
        tlsSocket.on('data', (d) => {
          responseBody += d.toString();
        });

        tlsSocket.on('close', () => {
          assert(responseBody.includes('"ip"'), 'HTTP Proxy: Successfully retrieves data over tunneled HTTPS session');
          resolve();
        });

        tlsSocket.on('error', (err) => {
          assert(false, `TLS over HTTP tunnel error: ${err.message}`);
          resolve();
        });
      }
    });

    socket.on('error', (err) => {
      assert(false, `HTTP Proxy authorized test socket error: ${err.message}`);
      resolve();
    });
  });
}

// 3. Test SOCKS5 - Unauthorized credentials
function testSocks5Unauthorized() {
  return new Promise((resolve) => {
    const socket = net.connect({ host: PROXY_HOST, port: SOCKS5_PORT }, () => {
      // Handshake: VER 0x05, 1 method: 0x02 (User/Pass)
      socket.write(Buffer.from([0x05, 0x01, 0x02]));
    });

    let state = 'HANDSHAKE';
    socket.on('data', (chunk) => {
      if (state === 'HANDSHAKE') {
        if (chunk[0] === 0x05 && chunk[1] === 0x02) {
          state = 'AUTH';
          const uBuf = Buffer.from(INVALID_USER, 'utf8');
          const pBuf = Buffer.from(INVALID_PASS, 'utf8');
          const authPacket = Buffer.concat([
            Buffer.from([0x01, uBuf.length]),
            uBuf,
            Buffer.from([pBuf.length]),
            pBuf,
          ]);
          socket.write(authPacket);
        }
      } else if (state === 'AUTH') {
        // Auth response: chunk[0] = 0x01, chunk[1] = status (0x01 for fail)
        assert(chunk[0] === 0x01 && chunk[1] === 0x01, 'SOCKS5 Proxy: Rejects invalid credentials with status 0x01');
        socket.destroy();
        resolve();
      }
    });

    socket.on('close', () => {
      resolve();
    });

    socket.on('error', (err) => {
      assert(false, `SOCKS5 unauthorized test error: ${err.message}`);
      resolve();
    });
  });
}

// 4. Test SOCKS5 - Authorized connection
function testSocks5Authorized() {
  return new Promise((resolve) => {
    const socket = net.connect({ host: PROXY_HOST, port: SOCKS5_PORT }, () => {
      socket.write(Buffer.from([0x05, 0x01, 0x02]));
    });

    let state = 'HANDSHAKE';
    let dataBuffer = '';

    socket.on('data', (chunk) => {
      if (state === 'HANDSHAKE') {
        if (chunk[0] === 0x05 && chunk[1] === 0x02) {
          state = 'AUTH';
          const uBuf = Buffer.from(VALID_USER, 'utf8');
          const pBuf = Buffer.from(VALID_PASS, 'utf8');
          const authPacket = Buffer.concat([
            Buffer.from([0x01, uBuf.length]),
            uBuf,
            Buffer.from([pBuf.length]),
            pBuf,
          ]);
          socket.write(authPacket);
        }
      } else if (state === 'AUTH') {
        if (chunk[0] === 0x01 && chunk[1] === 0x00) {
          assert(true, 'SOCKS5 Proxy: Accepts valid credentials');
          state = 'CONNECT';

          // Target: api.ipify.org port 80
          const host = 'api.ipify.org';
          const hostBuf = Buffer.from(host, 'utf8');
          const portBuf = Buffer.alloc(2);
          portBuf.writeUInt16BE(80, 0);

          const reqPacket = Buffer.concat([
            Buffer.from([0x05, 0x01, 0x00, 0x03, hostBuf.length]),
            hostBuf,
            portBuf,
          ]);
          socket.write(reqPacket);
        } else {
          assert(false, 'SOCKS5 Proxy: Unexpected auth response');
          socket.destroy();
          resolve();
        }
      } else if (state === 'CONNECT') {
        if (chunk[0] === 0x05 && chunk[1] === 0x00) {
          assert(true, 'SOCKS5 Proxy: CONNECT to target established successfully');
          state = 'TRAFFIC';
          socket.write('GET /?format=json HTTP/1.1\r\nHost: api.ipify.org\r\nConnection: close\r\n\r\n');
        } else {
          assert(false, 'SOCKS5 Proxy: CONNECT failed');
          socket.destroy();
          resolve();
        }
      } else if (state === 'TRAFFIC') {
        dataBuffer += chunk.toString();
      }
    });

    socket.on('close', () => {
      assert(dataBuffer.includes('"ip"'), 'SOCKS5 Proxy: Successfully routed HTTP traffic through tunnel');
      resolve();
    });

    socket.on('error', (err) => {
      assert(false, `SOCKS5 authorized test error: ${err.message}`);
      resolve();
    });
  });
}

async function run() {
  console.log('Running Dual-Protocol Proxy Verification Tests...\n');
  await testHttpUnauthorized();
  await testHttpAuthorized();
  await testSocks5Unauthorized();
  await testSocks5Authorized();

  console.log(`\nTest Summary: ${passedTests}/${totalTests} tests passed.`);
  if (passedTests === totalTests) {
    console.log('All proxy verification checks PASSED successfully.');
    process.exit(0);
  } else {
    console.error('Some proxy verification checks FAILED.');
    process.exit(1);
  }
}

run();
