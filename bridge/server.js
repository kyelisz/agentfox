#!/usr/bin/env node
/**
 * firefox-bridge server
 *
 *  - CLI side : POST /api  (token in x-bx-token)  -> runs a command in Firefox
 *  - Browser  : GET /poll  (long-poll) + POST /reply   <-- extension dials in
 *  - Bonus    : WS  upgrade  (same protocol, for the test harness / other clients)
 *
 * Everything binds to 127.0.0.1. The browser side must present an
 * `Origin: moz-extension://…` header, which a web page can never forge, so a
 * random site cannot drive your browser even though it can reach this port.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { WebSocketServer } = require('ws');

const ROOT = path.resolve(__dirname, '..');
const RUN = path.join(ROOT, 'run');
const PORT = Number(process.env.BX_PORT || 8788);
const HOST = '127.0.0.1';
const TOKEN_FILE = path.join(RUN, 'token');
const LOG_FILE = path.join(RUN, 'server.log');
const POLL_HOLD_MS = 25000;

fs.mkdirSync(RUN, { recursive: true });
if (!fs.existsSync(TOKEN_FILE)) {
  fs.writeFileSync(TOKEN_FILE, crypto.randomBytes(24).toString('hex'), { mode: 0o600 });
}
const TOKEN = fs.readFileSync(TOKEN_FILE, 'utf8').trim();

function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.join(' ')}`;
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch {}
}

/* ------------------------------------------------------------------ state */

let ws = null;                 // optional websocket client
const waiters = [];            // held /poll requests: {res, timer, cid}
const cidLast = new Map();     // cid -> last poll ts, newest wins
const pending = new Map();     // id -> {resolve, reject, timer}
let lastPoll = 0;
let seq = 0;

const extAttached = () => !!((ws && ws.readyState === 1) || waiters.length > 0);

function isExtensionOrigin(req) {
  return String(req.headers.origin || '').startsWith('moz-extension://');
}

const queue = [];          // commands waiting for a poller to show up

/* ---- settings: two switches the user owns, shared with the agent ------- */
const SETTINGS_FILE = path.join(RUN, 'settings.json');
const DEFAULTS = { askLocalhost: true, alwaysOn: false };
let settings = { ...DEFAULTS };
try { settings = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) }; } catch {}

function saveSettings() {
  try { fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2)); } catch (e) { log('settings save failed', String(e.message || e)); }
}

// "always on" means: the bridge and the chat-answering session come up with the
// desktop, so Firefox is attached without anyone typing anything.
const AUTOSTART_DIR = path.join(os.homedir(), '.config', 'autostart');
function autostartFile(name, execLine) {
  const body = ['[Desktop Entry]', 'Type=Application', 'Name=' + name, 'Exec=' + execLine,
    'X-GNOME-Autostart-enabled=true', 'Terminal=false', 'NoDisplay=true', ''].join('\n');
  return { path: path.join(AUTOSTART_DIR, name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.desktop'), body };
}

function applyAlwaysOn() {
  try { fs.mkdirSync(AUTOSTART_DIR, { recursive: true }); } catch {}
  const bx = path.join(ROOT, 'bin', 'bx');
  const entries = [
    autostartFile('free-pi bridge', `bash -lc "${bx} up"`),
    autostartFile('free-pi chat agent', `bash -lc "${bx} chatagent on"`),
    autostartFile('free-pi firefox watcher', `bash -lc "${bx} up; bx-watch-firefox --daemon"`),
  ];
  for (const e of entries) {
    try {
      if (settings.alwaysOn) fs.writeFileSync(e.path, e.body);
      else fs.rmSync(e.path, { force: true });
    } catch (err) { log('autostart write failed', e.path, String(err.message || err)); }
  }
  return entries.map((e) => e.path);
}

/* ---- chat: the little textbox widget in a tab <-> the agent ------------ */
const CHAT_LOG = path.join(RUN, 'chat.jsonl');
const chat = { seq: 0, users: [], agents: [], waiters: [], thread: 'main' };

// replay the transcript so a fresh tab (or a restarted bridge) still shows it
try {
  const lines = fs.readFileSync(CHAT_LOG, 'utf8').trim().split('\n').filter(Boolean).slice(-500);
  for (const line of lines) {
    let m;
    try { m = JSON.parse(line); } catch { continue; }
    if (!m || !m.text) continue;
    const thread = m.thread || 'main';
    if (m.from === 'user') {
      chat.users.push({ id: m.id, ts: m.ts, tab: m.tab, url: m.url, title: m.title, text: m.text, thread, read: true });
      chat.seq = Math.max(chat.seq, m.id || 0);
    } else if (m.from === 'agent') {
      chat.agents.push({ id: m.id, ts: m.ts, tab: m.tab, text: m.text, thread });
      chat.seq = Math.max(chat.seq, m.id || 0);
    }
  }
} catch {}

function chatLog(rec) {
  try { fs.appendFileSync(CHAT_LOG, JSON.stringify(rec) + '\n'); } catch {}
}

function pushUserMessage(tab, url, title, text, thread) {
  const rec = { id: ++chat.seq, ts: Date.now(), tab: Number(tab) || 0, url: String(url || ''), title: String(title || ''), text: String(text || '').slice(0, 4000), thread: thread || chat.thread || 'main', read: false };
  chat.users.push(rec);
  if (chat.users.length > 500) chat.users.shift();
  chatLog({ ...rec, from: 'user' });
  log('user message', 'tab=' + rec.tab, JSON.stringify(rec.text.slice(0, 120)));
  // delivered right here, so it must not come back from the unread filter
  rec.read = true;
  while (chat.waiters.length) {
    const w = chat.waiters.shift();
    clearTimeout(w.timer);
    if (!w.res.writableEnded) json(w.res, 200, { messages: [rec], waiting: chat.waiters.length });
  }
  return rec;
}

function pushAgentMessage(tab, text, thread) {
  // no thread given: answer in the thread of the most recent user message, so a
  // reply never lands in a different conversation than the question
  const latest = chat.users.slice(-1)[0];
  const t = thread || (latest && latest.thread) || 'main';
  const rec = { id: ++chat.seq, ts: Date.now(), tab: tab === 'all' ? 'all' : (Number(tab) || 0), text: String(text || '').slice(0, 4000), thread: t };
  chat.agents.push(rec);
  if (chat.agents.length > 500) chat.agents.shift();
  chatLog({ ...rec, from: 'agent' });
  log('agent message', 'tab=' + rec.tab, JSON.stringify(rec.text.slice(0, 120)));
  return rec;
}

function sendCommand(action, params, timeoutMs, cid) {
  return new Promise((resolve, reject) => {
    const id = String(++seq);
    armTimer(id, resolve, reject, timeoutMs, action);
    queue.push({ id, action, params, cid: cid || null });
    flushQueue();
    // the extension re-polls within a few ms of finishing a command; give it a
    // moment instead of failing on a transient gap
    setTimeout(() => {
      const i = queue.findIndex((c) => c.id === id);
      if (i >= 0 && pending.has(id)) {
        queue.splice(i, 1);
        failNow(id, new Error('NO_EXTENSION: the Firefox bridge extension is not connected. Open Firefox and load it, then run `bx status`.'));
      }
    }, 8000);
  });
}

function newestCid() {
  let best = null;
  let ts = -1;
  for (const [cid, t] of cidLast) if (t > ts) { ts = t; best = cid; }
  return ts > Date.now() - 60000 ? best : null;
}

function flushQueue() {
  while (queue.length) {
    if (ws && ws.readyState === 1) {
      const cmd = queue.shift();
      try { ws.send(JSON.stringify({ id: cmd.id, type: 'cmd', action: cmd.action, params: cmd.params })); }
      catch (e) { failNow(cmd.id, e); }
      continue;
    }
    const wanted = queue[0] && queue[0].cid;
    let idx = wanted ? waiters.findIndex((w) => w.cid === wanted) : -1;
    if (idx < 0) {
      const preferred = newestCid();
      idx = preferred ? waiters.findIndex((w) => w.cid === preferred) : -1;
    }
    if (idx < 0) idx = 0;
    const waiter = waiters.length ? waiters.splice(idx, 1)[0] : null;
    if (!waiter) return;
    const cmd = queue.shift();
    clearTimeout(waiter.timer);
    waiter.res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    waiter.res.end(JSON.stringify({ cmd: { id: cmd.id, type: 'cmd', action: cmd.action, params: cmd.params } }));
  }
}

function armTimer(id, resolve, reject, timeoutMs, action) {
  const timer = setTimeout(() => {
    pending.delete(id);
    reject(new Error(`TIMEOUT: Firefox did not answer "${action}" within ${timeoutMs}ms`));
  }, Math.max(1000, timeoutMs));
  pending.set(id, { resolve, reject, timer });
}

function failNow(id, err) {
  const entry = pending.get(id);
  if (!entry) return;
  pending.delete(id);
  clearTimeout(entry.timer);
  entry.reject(err instanceof Error ? err : new Error(String(err)));
}

function settle(msg) {
  const entry = pending.get(String(msg.id));
  if (!entry) return false;
  pending.delete(String(msg.id));
  clearTimeout(entry.timer);
  if (msg.ok) entry.resolve(msg.result);
  else entry.reject(new Error(msg.error || 'EXTENSION_ERROR'));
  return true;
}

/* -------------------------------------------------------------------- http */

function json(res, code, body) {
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(JSON.stringify(body));
}

function readBody(req, limit = 32 * 1024 * 1024) {
  return new Promise((resolve) => {
    let raw = '';
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { req.destroy(); resolve(''); return; }
      raw += c;
    });
    req.on('end', () => resolve(raw));
    req.on('error', () => resolve(''));
  });
}

function applyCors(req, res) {
  const origin = String(req.headers.origin || '');
  if (origin.startsWith('moz-extension://')) {
    res.setHeader('access-control-allow-origin', origin);
    res.setHeader('access-control-allow-headers', 'content-type, x-bx-token');
    res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
    res.setHeader('vary', 'origin');
    return true;
  }
  return false;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  const tokenOK = (req.headers['x-bx-token'] || url.searchParams.get('token') || '') === TOKEN;

  // Pairing: hands the loopback token to the extension only. Extension requests
  // bypass CORS in Firefox, while a web page cannot read this body because no
  // Access-Control-Allow-Origin header is ever sent for /pair.
  if (url.pathname === '/pair') {
    log('pair request', 'origin=' + JSON.stringify(req.headers.origin || null));
    return json(res, 200, { token: TOKEN, port: PORT, protocol: 1 });
  }

  applyCors(req, res);
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  if (url.pathname === '/settings' && tokenOK) {
    if (req.method === 'GET') return json(res, 200, { ok: true, settings });
    if (req.method === 'POST') {
      let body;
      try { body = JSON.parse(await readBody(req)); } catch { return json(res, 400, { error: 'BAD_JSON' }); }
      if (typeof body.askLocalhost === 'boolean') settings.askLocalhost = body.askLocalhost;
      if (typeof body.alwaysOn === 'boolean') settings.alwaysOn = body.alwaysOn;
      saveSettings();
      const files = applyAlwaysOn();
      log('settings', JSON.stringify(settings));
      return json(res, 200, { ok: true, settings, autostart: files });
    }
    return json(res, 405, { error: 'METHOD' });
  }

  if (url.pathname === '/health') {
    return json(res, 200, {
      ok: true, extension: extAttached(), waiting: waiters.length, queued: queue.length, settings,
      clients: [...cidLast.entries()].map(([cid, t]) => ({ cid, ago: Date.now() - t })),
      active: newestCid(), lastPoll,
      pid: process.pid, port: PORT, transport: ws ? 'ws' : (waiters.length ? 'poll' : 'none'),
    });
  }

  // Diagnostics sink — unauthenticated on purpose so a broken socket can be
  // debugged from the terminal (`bx logs`). It only writes to the local log.
  if (url.pathname === '/__diag') {
    log('diag', url.searchParams.get('event') || '?', (url.searchParams.get('msg') || '').slice(0, 400));
    return json(res, 204, {});
  }

  // ---- browser side -------------------------------------------------------
  if (url.pathname === '/poll') {
    if (!tokenOK) return json(res, 401, { error: 'BAD_TOKEN' });
    lastPoll = Date.now();
    const hold = Math.min(Number(url.searchParams.get('wait') || POLL_HOLD_MS), POLL_HOLD_MS);
    const timer = setTimeout(() => {
      const i = waiters.findIndex((w) => w.res === res);
      if (i >= 0) waiters.splice(i, 1);
      if (!res.writableEnded) json(res, 200, { idle: true });
    }, hold);
    const cid = url.searchParams.get('cid') || 'anon';
    cidLast.set(cid, Date.now());
    waiters.push({ res, timer, cid });
    flushQueue();
    res.on('close', () => {
      clearTimeout(timer);
      const i = waiters.findIndex((w) => w.res === res);
      if (i >= 0) waiters.splice(i, 1);
    });
    return;
  }

  if (url.pathname === '/reply') {
    if (!tokenOK) return json(res, 401, { error: 'BAD_TOKEN' });
    lastPoll = Date.now();
    cidLast.set(url.searchParams.get('cid') || 'anon', Date.now());
    let msg;
    try { msg = JSON.parse(await readBody(req)); } catch { return json(res, 400, { error: 'BAD_JSON' }); }
    settle(msg);
    return json(res, 200, { ok: true });
  }

  // ---- chat, browser side -------------------------------------------------
  if (url.pathname === '/chat/user' && req.method === 'POST') {
    if (!tokenOK) return json(res, 401, { error: 'BAD_TOKEN' });
    let body;
    try { body = JSON.parse(await readBody(req) || '{}'); } catch { return json(res, 400, { error: 'BAD_JSON' }); }
    if (!String(body.text || '').trim()) return json(res, 400, { error: 'EMPTY' });
    const rec = pushUserMessage(body.tab, body.url, body.title, body.text, body.thread);
    return json(res, 200, { ok: true, id: rec.id, ts: rec.ts });
  }

  if (url.pathname === '/chat/threads') {
    if (!tokenOK) return json(res, 401, { error: 'BAD_TOKEN' });
    const map = new Map();
    const touch = (m) => {
      const t = m.thread || 'main';
      const cur = map.get(t) || { id: t, count: 0, lastTs: 0, lastText: '', firstText: '' };
      cur.count++;
      if (!cur.firstText && m.from === 'user') cur.firstText = m.text;
      if (m.ts >= cur.lastTs) { cur.lastTs = m.ts; cur.lastText = m.text; }
      map.set(t, cur);
    };
    chat.users.forEach((m) => touch({ ...m, from: 'user' }));
    chat.agents.forEach((m) => touch({ ...m, from: 'agent' }));
    const threads = [...map.values()].sort((a, b) => b.lastTs - a.lastTs).slice(0, 40)
      .map((t) => ({ id: t.id, title: (t.firstText || t.lastText || 'chat').slice(0, 70), count: t.count, lastTs: t.lastTs, lastText: t.lastText.slice(0, 90) }));
    return json(res, 200, { threads, current: chat.thread || 'main' });
  }

  if (url.pathname === '/chat/new' && req.method === 'POST') {
    if (!tokenOK) return json(res, 401, { error: 'BAD_TOKEN' });
    const id = 't' + Date.now().toString(36);
    chat.thread = id;
    log('new chat thread', id);
    return json(res, 200, { ok: true, thread: id });
  }

  if (url.pathname === '/chat/select' && req.method === 'POST') {
    if (!tokenOK) return json(res, 401, { error: 'BAD_TOKEN' });
    let body;
    try { body = JSON.parse(await readBody(req) || '{}'); } catch { return json(res, 400, { error: 'BAD_JSON' }); }
    const t = String(body.thread || '').trim() || 'main';
    chat.thread = t;
    log('selected chat thread', t);
    return json(res, 200, { ok: true, thread: t });
  }

  if (url.pathname === '/chat/history') {
    if (!tokenOK) return json(res, 401, { error: 'BAD_TOKEN' });
    const limit = Math.min(Number(url.searchParams.get('limit') || 120), 500);
    const wantThread = url.searchParams.get('thread') || '';
    const all = [
      ...chat.users.map((m) => ({ id: m.id, ts: m.ts, from: 'user', tab: m.tab, text: m.text, thread: m.thread || 'main' })),
      ...chat.agents.map((m) => ({ id: m.id, ts: m.ts, from: 'agent', tab: m.tab, text: m.text, thread: m.thread || 'main' })),
    ]
      .filter((m) => !wantThread || m.thread === wantThread)
      .filter((m) => !/^I hit an error answering/.test(m.text))   // old failure placeholders
      .sort((a, b) => a.id - b.id);
    return json(res, 200, { messages: all.slice(-limit), seq: chat.seq });
  }

  if (url.pathname === '/chat/replies') {
    if (!tokenOK) return json(res, 401, { error: 'BAD_TOKEN' });
    const tab = Number(url.searchParams.get('tab') || 0);
    const since = Number(url.searchParams.get('since') || 0);
    cidLast.set(url.searchParams.get('cid') || 'anon', Date.now());
    const thread = url.searchParams.get('thread') || '';
    const replies = chat.agents.filter((m) => m.ts > since && (m.tab === 'all' || m.tab === tab) && (!thread || (m.thread || 'main') === thread));
    return json(res, 200, { replies, now: Date.now(), agentOnline: waiters.length > 0 || !!(ws && ws.readyState === 1) });
  }

  // ---- chat, agent side ---------------------------------------------------
  if (!tokenOK) return json(res, 401, { ok: false, error: 'BAD_TOKEN' });

  if (url.pathname === '/chat/inbox') {
    const peek = url.searchParams.get('peek') === '1';
    const limit = Math.min(Number(url.searchParams.get('limit') || 50), 200);
    const msgs = chat.users.filter((m) => !m.read).slice(-limit);
    if (!peek) for (const m of chat.users) m.read = true;
    return json(res, 200, { messages: msgs, pending: chat.users.filter((m) => !m.read).length });
  }

  if (url.pathname === '/chat/watch') {
    const timeout = Math.min(Number(url.searchParams.get('timeout') || 60000), 300000);
    const unread = chat.users.filter((m) => !m.read);
    if (unread.length) {
      for (const m of chat.users) m.read = true;
      return json(res, 200, { messages: unread.slice(-50) });
    }
    const timer = setTimeout(() => {
      const i = chat.waiters.findIndex((w) => w.res === res);
      if (i >= 0) chat.waiters.splice(i, 1);
      if (!res.writableEnded) json(res, 200, { idle: true });
    }, timeout);
    chat.waiters.push({ res, timer });
    res.on('close', () => {
      clearTimeout(timer);
      const i = chat.waiters.findIndex((w) => w.res === res);
      if (i >= 0) chat.waiters.splice(i, 1);
    });
    return;
  }

  if (url.pathname === '/chat/say' && req.method === 'POST') {
    let body;
    try { body = JSON.parse(await readBody(req) || '{}'); } catch { return json(res, 400, { error: 'BAD_JSON' }); }
    if (!String(body.text || '').trim()) return json(res, 400, { error: 'EMPTY' });
    const rec = pushAgentMessage(body.tab === 'all' ? 'all' : (body.tab || chat.users.slice(-1)[0] && chat.users.slice(-1)[0].tab || 0), body.text, body.thread);
    return json(res, 200, { ok: true, id: rec.id, tab: rec.tab, thread: rec.thread, deliveredTo: chat.agents.length });
  }

  if (url.pathname === '/api' && req.method === 'POST') {
    let body;
    try { body = JSON.parse(await readBody(req) || '{}'); } catch { return json(res, 400, { ok: false, error: 'BAD_JSON' }); }
    if (!body.action) return json(res, 400, { ok: false, error: 'NO_ACTION' });
    const timeoutMs = Number((body.params && body.params.timeoutMs) || body.timeoutMs || 30000);
    try {
      const result = await sendCommand(body.action, body.params || {}, timeoutMs, body.cid || (body.params && body.params.cid));
      return json(res, 200, { ok: true, result });
    } catch (err) {
      return json(res, 200, { ok: false, error: String((err && err.message) || err) });
    }
  }

  return json(res, 404, { ok: false, error: 'NOT_FOUND' });
});

/* --------------------------------------------------------------------- ws */

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  const ok = (url.searchParams.get('token') || '') === TOKEN;
  if (!ok) {
    log('reject upgrade from origin', req.headers.origin || '(none)');
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (sock) => wss.emit('connection', sock, req));
});

wss.on('connection', (sock) => {
  log('websocket attached');
  ws = sock;
  sock.on('message', (data) => {
    lastPoll = Date.now();
    let msg;
    try { msg = JSON.parse(String(data)); } catch { return; }
    if (msg.type === 'hello') { log('hello from', msg.version || '?'); return; }
    settle(msg);
  });
  sock.on('close', () => {
    log('websocket closed');
    if (ws === sock) ws = null;
    for (const id of [...pending.keys()]) failNow(id, new Error('EXTENSION_DISCONNECTED'));
  });
  sock.on('error', (e) => log('ws error', e.message));
  try { sock.send(JSON.stringify({ id: '0', type: 'welcome', port: PORT, pid: process.pid })); } catch {}
  flushQueue();
});

/* ------------------------------------------------------------------- boot */

server.listen(PORT, HOST, () => {
  fs.writeFileSync(path.join(RUN, 'server.pid'), String(process.pid));
  log(`listening on ${HOST}:${PORT} pid ${process.pid}`);
  process.stdout.write(`bx bridge listening on http://${HOST}:${PORT}\n`);
});

server.on('error', (err) => {
  log('server error', err.message);
  if (err.code === 'EADDRINUSE') {
    process.stderr.write(`port ${PORT} already in use (bridge already running?) —  \`bx down\` first\n`);
    process.exit(42);
  }
  process.exit(1);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    log('shutting down', sig);
    try { fs.unlinkSync(path.join(RUN, 'server.pid')); } catch {}
    process.exit(0);
  });
}
