#!/usr/bin/env node
/**
 * rdp-install.js — install a temporary add-on into a *running* Firefox that was
 * started with `-start-debugger-server <port>`.
 *
 * This is the only way to (re)install an unsigned extension into release
 * Firefox without a manual click in about:debugging: speak the Remote
 * Debugging Protocol and call addons.installTemporaryAddon.
 *
 * usage: node rdp-install.js <port> <abs path to .xpi | extension dir> [timeoutMs]
 */
const net = require('net');

function packet(obj) {
  const json = Buffer.from(JSON.stringify(obj), 'utf8');
  return Buffer.concat([Buffer.from(`${json.length}:`, 'utf8'), json]);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Firefox opens the debugger port late in startup (10-30s on a cold profile),
// so keep trying until the deadline.
async function connect(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastErr = null;
  while (Date.now() < deadline) {
    try {
      return await new Promise((resolve, reject) => {
        const sock = net.connect({ host: '127.0.0.1', port }, () => resolve(sock));
        sock.setTimeout(5000);
        sock.once('timeout', () => { sock.destroy(); reject(new Error('rdp connect timeout')); });
        sock.once('error', reject);
      });
    } catch (e) {
      lastErr = e;
      await sleep(400);
    }
  }
  throw lastErr || new Error('rdp unreachable');
}

function reader(sock) {
  let buf = Buffer.alloc(0);
  const queue = [];
  const waiters = [];
  sock.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      const sep = buf.indexOf(':');
      if (sep < 0) break;
      const len = Number(buf.slice(0, sep).toString('utf8'));
      if (!Number.isFinite(len) || len <= 0) { buf = Buffer.alloc(0); break; }
      if (buf.length < sep + 1 + len) break;
      const json = buf.slice(sep + 1, sep + 1 + len).toString('utf8');
      buf = buf.slice(sep + 1 + len);
      let msg;
      try { msg = JSON.parse(json); } catch { continue; }
      const w = waiters.shift();
      if (w) w(msg); else queue.push(msg);
    }
  });
  return () => new Promise((res) => {
    if (queue.length) return res(queue.shift());
    waiters.push(res);
  });
}

async function main() {
  const port = Number(process.argv[2]);
  const target = process.argv[3];
  const timeoutMs = Number(process.argv[4] || 25000);
  if (!port || !target) {
    console.error('usage: rdp-install.js <port> <xpi|dir> [timeoutMs]');
    process.exit(2);
  }
  const sock = await connect(port, timeoutMs);
  const next = reader(sock);
  const send = async (obj) => {
    sock.write(packet(obj));
    return next();
  };

  const hello = await next();                       // root greeting
  const root = await send({ to: 'root', type: 'getRoot' });
  const addonsActor = root.addonsActor || (hello.addonsActor);
  if (!addonsActor) throw new Error('no addonsActor in RDP root');

  const reply = await send({ to: addonsActor, type: 'installTemporaryAddon', addonPath: target });
  if (reply.error) throw new Error(`${reply.error}: ${reply.message || ''}`);
  const addon = reply.addon || {};
  process.stdout.write(JSON.stringify({
    ok: true, id: addon.id, name: addon.name, version: addon.version, path: target,
  }) + '\n');
  sock.end();
}

main().catch((e) => {
  process.stderr.write(`rdp-install: ${e.message}\n`);
  process.exit(1);
});
