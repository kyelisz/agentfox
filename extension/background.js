/* background.js — bridge client over HTTP long-poll to 127.0.0.1:<port>. */
/* global pageExec */

const DEFAULT_PORT = 8788;
const VERSION = '1.0.0';
const HOLD_MS = 20000;
// random per background-page load: lets the bridge tell two browsers apart and
// talk to the most recently active one (e.g. yours, not a test instance)
const CID = Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);

let connected = false;
let lastError = '';
let port = DEFAULT_PORT;
let token = '';
let cfg = { readonly: false, highlight: true };
let useMainWorld = true;
let looping = false;

function log(...a) { try { console.log('[bridge]', ...a); } catch (e) {} }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
const base = () => `http://127.0.0.1:${port}`;

/* Lifecycle breadcrumbs land in run/server.log so a dead link can still be
   diagnosed from the terminal with `bx logs`. */
function diag(event, msg) {
  try {
    fetch(`${base()}/__diag?event=${encodeURIComponent(event)}&msg=${encodeURIComponent(String(msg || '').slice(0, 400))}`)
      .catch(() => {});
  } catch (e) {}
}

function setError(e) {
  lastError = String((e && e.message) || e || '');
  log('error:', lastError);
  diag('error', lastError);
}

async function loadConfig() {
  const s = await browser.storage.local.get({ port: DEFAULT_PORT, readonly: false, highlight: true, token: '' });
  port = Number(s.port) || DEFAULT_PORT;
  cfg = { readonly: !!s.readonly, highlight: !!s.highlight };
  token = s.token || '';
}

/* The bridge hands out its loopback token on /pair. Extension requests bypass
   CORS in Firefox, so a web page cannot read that response. */
async function pair() {
  const r = await fetch(`${base()}/pair`, { cache: 'no-store' });
  if (!r.ok) throw new Error('pair http ' + r.status);
  const txt = await r.text();
  let body = {};
  try { body = JSON.parse(txt); } catch (e) { throw new Error('pair body not json: ' + txt.slice(0, 120)); }
  if (!body || !body.token) throw new Error('pair gave no token: ' + txt.slice(0, 120));
  token = body.token;
  await browser.storage.local.set({ token });
  diag('paired', typeof token + ' len ' + String(token).length + ' body ' + txt.slice(0, 20));
  return token;
}

/* ------------------------------------------------------ long-poll transport */

async function reply(body) {
  const ac = new AbortController();
  const t = setTimeout(() => { try { ac.abort(); } catch (e) {} }, 8000);
  try {
    if (!token) await pair();
    const r = await fetch(`${base()}/reply?cid=${CID}&token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    if (!r.ok) throw new Error('reply http ' + r.status);
  } catch (e) { setError(e); }
  clearTimeout(t);
}

/* Nothing may hold a poll loop forever. */
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`${label} timed out after ${ms}ms`)), ms)),
  ]);
}

async function runCommand(cmd) {
  let payload;
  try {
    payload = { id: cmd.id, ok: true, result: await withTimeout(handle(cmd), 70000, String(cmd.action)) };
  } catch (e) {
    payload = { id: cmd.id, ok: false, error: String((e && e.message) || e) };
  }
  await reply(payload);
}

// Two concurrent long-polls: while one is executing a command the other stays
// held, so the terminal's next request never sees a "no poller" gap.
const POLLERS = 2;
let pollerCount = 0;
const aborters = new Set();

async function pollLoop() {
  pollerCount++;
  while (true) {
    try {
      if (!token) await pair();
      const abortCtl = new AbortController();
      aborters.add(abortCtl);
      const t = setTimeout(() => { try { abortCtl.abort(); } catch (e) {} }, HOLD_MS + 15000);
      const r = await fetch(`${base()}/poll?wait=${HOLD_MS}&cid=${CID}&token=${encodeURIComponent(token)}`, {
        cache: 'no-store', signal: abortCtl.signal,
      });
      aborters.delete(abortCtl);
      clearTimeout(t);
      if (r.status === 401) {
        token = '';
        await browser.storage.local.set({ token: '' });
        throw new Error('token rejected, re-pairing');
      }
      if (!r.ok) throw new Error('poll http ' + r.status);
      if (!connected) { connected = true; lastError = ''; diag('connected', port); }
      const msg = await r.json();
      if (msg && msg.cmd) await runCommand(msg.cmd);
    } catch (e) {
      if (connected) diag('disconnected', String((e && e.message) || e));
      connected = false;
      if (!/aborted|AbortError/i.test(String((e && e.message) || e))) setError(e);
      await sleep(900);
    }
  }
}

async function forceRepair() {
  token = '';
  try { await browser.storage.local.set({ token: '' }); } catch (e) {}
  try { await pair(); } catch (e) { setError(e); }
  try {
    const h = await bridgeFetch('/health');
    connected = !!h.extension || connected;
    return { ok: true, bridge: true, extension: !!h.extension, waiting: h.waiting || 0 };
  } catch (e) {
    setError(e);
    return { ok: false, bridge: false };
  }
}

function restart() {
  connected = false;
  for (const a of [...aborters]) { try { a.abort(); } catch (e) {} }
  aborters.clear();
  for (let i = pollerCount; i < POLLERS; i++) pollLoop();
}

/* --------------------------------------------------------------- plumbing */

const RESTRICTED = /^(about:(?!blank)|chrome:|moz-extension:|resource:|view-source:|edge:|devtools:)/i;

function assertScriptable(tab) {
  if (!tab) throw new Error('no active tab');
  if (RESTRICTED.test(tab.url || '')) {
    throw new Error(`cannot script ${tab.url} — Firefox forbids extensions on this page. Open a normal http(s) page.`);
  }
}

async function lastFocusedNormalWindow() {
  try {
    const w = await browser.windows.getLastFocused({ windowTypes: ['normal'] });
    return w;
  } catch (e) { return null; }
}

async function activeTab() {
  const w = await lastFocusedNormalWindow();
  const q = w ? { active: true, windowId: w.id } : { active: true };
  let tabs = await browser.tabs.query(q);
  if (!tabs.length) tabs = await browser.tabs.query({ active: true });
  if (!tabs.length) throw new Error('no tab found');
  return tabs[0];
}

async function runInPage(op, tabId, forceIsolated) {
  const tab = tabId ? await browser.tabs.get(tabId) : await activeTab();
  assertScriptable(tab);
  const payload = { ...op, highlight: cfg.highlight };
  const exec = async (world) => {
    const options = { target: { tabId: tab.id }, func: pageExec, args: [payload] };
    if (world) options.world = world;
    const r = await browser.scripting.executeScript(options);
    const first = Array.isArray(r) ? r[0] : r;
    return first ? first.result : null;
  };
  if (useMainWorld && !forceIsolated) {
    try { return await exec('MAIN'); } catch (e) {
      const m = String((e && e.message) || e);
      if (/world|not supported|invalid/i.test(m)) { useMainWorld = false; } else throw new Error(m);
    }
  }
  return await exec(null);
}

/* ---- the little textbox in the page -------------------------------- */

async function openChat(tabId) {
  const tab = tabId ? await browser.tabs.get(tabId) : await activeTab();
  assertScriptable(tab);
  try { await browser.scripting.insertCSS({ target: { tabId: tab.id }, files: ['chat.css'] }); } catch (e) {}
  const r = await runInPage({ op: 'chat' }, tab.id, true);
  return { ...r, tabId: tab.id, url: tab.url };
}

/* ------------------------------------------------- docked chat box ------ */
// With the user's "always on" switch, the box follows them: every tab they
// activate gets it, new tabs and reloads included. Closing it on one tab hides
// it there until that tab is closed.
let dockChat = false;
const dockHidden = new Set();

async function syncDock() {
  try {
    const h = await bridgeFetch('/health');
    dockChat = !!(h.settings && h.settings.alwaysOn);
  } catch (e) {
    /* bridge down: keep the last known value */
  }
  return dockChat;
}

async function dockIfNeeded(tab) {
  if (!dockChat || !tab || !tab.id) return;
  if (RESTRICTED.test(tab.url || '')) return;
  if (dockHidden.has(tab.id)) return;
  try { await openChat(tab.id); } catch (e) { /* CSP, PDF, about: pages */ }
}

browser.tabs.onActivated.addListener(({ tabId }) => { browser.tabs.get(tabId).then(dockIfNeeded).catch(() => {}); });
browser.tabs.onUpdated.addListener((tabId, info, tab) => { if (info.status === 'complete') dockIfNeeded(tab); });
browser.tabs.onRemoved.addListener((tabId) => { dockHidden.delete(tabId); });
browser.runtime.onStartup.addListener(() => { syncDock().then(() => browser.tabs.query({ active: true, currentWindow: true }).then(([t]) => dockIfNeeded(t)).catch(() => {})); });

async function closeChat(tabId) {
  const tab = tabId ? await browser.tabs.get(tabId) : await activeTab();
  const r = await runInPage({ op: 'chat-close' }, tab.id, true);
  return { ...r, tabId: tab.id };
}

async function toggleChat(tabId) {
  const r = await openChat(tabId);
  if (r && r.already) return closeChat(tabId);
  return r;
}

async function bridgeFetch(pathAndQuery, body) {
  const sep = pathAndQuery.includes('?') ? '&' : '?';
  const url = `${base()}${pathAndQuery}${sep}token=${encodeURIComponent(token)}`;
  if (!token) await pair();
  const ac = new AbortController();
  const t = setTimeout(() => { try { ac.abort(); } catch (e) {} }, 10000);
  try {
    const r = await fetch(url, body
      ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: ac.signal }
      : { cache: 'no-store', signal: ac.signal });
    if (!r.ok) throw new Error('bridge http ' + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}

function guardReadOnly(action) {
  if (!cfg.readonly) return;
  if (['click', 'hover', 'type', 'keys', 'press', 'select', 'check', 'eval'].includes(action)) {
    throw new Error(`extension is in read-only mode (Options) — "${action}" blocked`);
  }
}

/* --------------------------------------------------------------- commands */

async function handle(msg) {
  const action = msg.action;
  const p = msg.params || {};
  guardReadOnly(action);

  switch (action) {
    case 'status': {
      const tab = await activeTab();
      return {
        url: tab.url, title: tab.title, tabId: tab.id, windowId: tab.windowId,
        incognito: !!tab.incognito, readonly: cfg.readonly, extension: VERSION, port,
      };
    }

    case 'tabs': {
      const tabs = await browser.tabs.query({});
      return tabs
        .filter((t) => !/^about:(blank|newtab)/.test(t.url || ''))
        .map((t) => ({ id: t.id, active: !!t.active, window: t.windowId, title: (t.title || '').slice(0, 110), url: (t.url || '').slice(0, 300) }));
    }

    case 'activate': {
      const t = await browser.tabs.get(p.tabId);
      await browser.tabs.update(t.id, { active: true });
      await browser.windows.update(t.windowId, { focused: true });
      return { tabId: t.id, url: t.url, title: t.title };
    }

    case 'goto': {
      let url = String(p.url || '').trim();
      if (!url) throw new Error('no url given');
      if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) {
        url = /^[\w-]+(\.[\w-]+)+(\/|$)/.test(url) ? 'https://' + url : 'https://duckduckgo.com/?q=' + encodeURIComponent(url);
      }
      if (p.newTab) {
        const tab = await browser.tabs.create({ url, active: true });
        return { tabId: tab.id, url, newTab: true };
      }
      const tab = await activeTab();
      const updated = await browser.tabs.update(tab.id, { url, active: true });
      return { tabId: updated.id, url };
    }

    case 'history': {
      const tab = await activeTab();
      // tabs.goBack/goForward are Chrome-only; Firefox uses browser.tabs.goBack/goForward too.
      if (p.dir < 0) await browser.tabs.goBack(tab.id);
      else await browser.tabs.goForward(tab.id);
      await sleep(300);
      const after = await browser.tabs.get(tab.id);
      return { url: after.url, title: after.title };
    }

    case 'reload': {
      const tab = await activeTab();
      await browser.tabs.reload(tab.id);
      return { reloading: tab.url };
    }

    case 'stop': {
      // Firefox has no tabs.halt(); pressing Escape on the page stops loads.
      const tab = await activeTab();
      return { stopped: false, url: tab.url, note: 'Firefox cannot abort a load from an extension — use reload' };
    }

    case 'close': {
      const tab = await activeTab();
      await browser.tabs.remove(tab.id);
      return { closed: tab.id };
    }

    case 'options': {
      await browser.runtime.openOptionsPage();
      return { ok: true, opened: true };
    }
    case 'shot': {
      const tab = await activeTab();
      await browser.windows.update(tab.windowId, { focused: true });
      await sleep(120);
      const dataUrl = await browser.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
      return { dataUrl, tab: { url: tab.url, title: tab.title } };
    }

    // the box's browser-local preferences, from the terminal:
    //   bx raw chat-pref
    //   bx raw chat-pref '{"patch":{"loadingStyle":"ring"}}'
    case 'chat-pref': {
      const KEYS = { chatMax: false, autoFocus: true, showThinking: true, dockSide: 'right', loadingStyle: 'line' };
      if (p.patch && typeof p.patch === 'object') {
        const patch = {};
        if ('chatMax' in p.patch) patch.chatMax = !!p.patch.chatMax;
        if ('autoFocus' in p.patch) patch.autoFocus = !!p.patch.autoFocus;
        if ('showThinking' in p.patch) patch.showThinking = !!p.patch.showThinking;
        if ('dockSide' in p.patch) patch.dockSide = p.patch.dockSide === 'left' ? 'left' : 'right';
        if ('loadingStyle' in p.patch) patch.loadingStyle = p.patch.loadingStyle === 'ring' ? 'ring' : 'line';
        await browser.storage.local.set(patch);
      }
      return { ok: true, ...(await browser.storage.local.get(KEYS)) };
    }

    case 'chat': return openChat(p.tabId);

    case 'chat-close': return closeChat(p.tabId);

    case 'chat-toggle': return toggleChat(p.tabId);

    case 'reload-ext': {
      // dev helper: pick up edited extension files without restarting Firefox
      setTimeout(() => { try { browser.runtime.reload(); } catch (e) {} }, 700);
      return { reloading: true, version: VERSION };
    }

    case 'wait': {
      const deadline = Date.now() + Math.min(Number(p.timeout || 10000), 60000);
      if (p.ms) await sleep(Number(p.ms));
      let lastInfo = null;
      while (Date.now() < deadline) {
        if (p.selector || p.text) {
          const r = await runInPage({
            op: 'eval',
            code: p.selector
              ? `(() => { const e = document.querySelector(${JSON.stringify(p.selector)}); return e ? 'found' : null })()`
              : `(() => document.body && document.body.innerText.toLowerCase().includes(${JSON.stringify(String(p.text).toLowerCase())}) ? 'found' : null)()`,
          }, undefined, true);
          lastInfo = r;
          if (r && r.value === 'found') return { waited: true, matched: p.selector || p.text };
        } else {
          return { waited: true, ms: p.ms || 0 };
        }
        await sleep(180);
      }
      throw new Error('timeout waiting for ' + (p.selector || p.text));
    }

    case 'digest':
    case 'find':
    case 'click':
    case 'hover':
    case 'type':
    case 'keys':
    case 'press':
    case 'select':
    case 'check':
    case 'scroll':
    case 'text':
    case 'eval': {
      const tab = p.tabId ? await browser.tabs.get(p.tabId) : await activeTab();
      const urlBefore = tab.url;
      const out = await runInPage(
        action === 'digest' ? { op: 'digest', maxText: p.maxText, maxEls: p.maxEls }
          : action === 'find' ? { op: 'find', query: p.query, max: p.max }
            : action === 'click' ? { op: 'click', target: p.target, dbl: !!p.dbl }
              : action === 'hover' ? { op: 'hover', target: p.target }
                : action === 'type' ? { op: 'type', target: p.target, text: p.text, clear: !!p.clear, submit: !!p.submit }
                  : action === 'keys' ? { op: 'keys', target: p.target, text: p.text, delay: p.delay }
                    : action === 'press' ? { op: 'press', target: p.target, key: p.key }
                      : action === 'select' ? { op: 'select', target: p.target, value: p.value }
                        : action === 'check' ? { op: 'check', target: p.target, on: !!p.on }
                          : action === 'scroll' ? { op: 'scroll', by: p.by, to: p.to, into: p.into }
                            : action === 'text' ? { op: 'text', target: p.target }
                              : { op: 'eval', code: p.code },
        tab.id,
        action === 'eval'   // new Function() must run in the isolated world, page CSP blocks it
      );
      if (action === 'type' || action === 'keys' || action === 'press') await sleep(60);
      if (action === 'click' && out && !out.error) {
        // give a link/form a moment to actually navigate, so the terminal knows
        for (let i = 0; i < 12; i++) {
          await sleep(100);
          const now = await browser.tabs.get(tab.id).catch(() => null);
          if (now && now.url !== urlBefore) {
            let cur = now;
            for (let j = 0; j < 30 && cur && cur.status !== 'complete'; j++) {
              await sleep(100);
              cur = await browser.tabs.get(tab.id).catch(() => null);
            }
            return { ...out, navigated: true, url: cur && cur.url, title: cur && cur.title, status: cur && cur.status };
          }
        }
        return { ...out, navigated: false };
      }
      return out;
    }

    default:
      throw new Error('unknown action: ' + action);
  }
}

/* ------------------------------------------------------------------ boot */

browser.runtime.onMessage.addListener((msg, sender) => {
  if (!msg || !msg.type) return;
  if (msg.type === 'chat-send') {
    const tab = sender && sender.tab ? sender.tab : {};
    return bridgeFetch('/chat/user', { tab: tab.id || 0, url: tab.url || '', title: tab.title || '', text: msg.text, thread: msg.thread })
      .then((r) => ({ ok: !!(r && r.ok), id: r && r.id }))
      .catch((e) => { setError(e); return { ok: false, error: String((e && e.message) || e) }; });
  }
  if (msg.type === 'chat-pending') {
    const th = msg.thread ? `?thread=${encodeURIComponent(msg.thread)}` : '';
    return bridgeFetch(`/chat/pending${th}`)
      .then((r) => ({ ok: true, ...r }))
      .catch(() => ({ ok: false, pending: 0, agentOnline: false }));
  }

  if (msg.type === 'chat-poll') {
    const tab = sender && sender.tab ? sender.tab : {};
    const th = msg.thread ? `&thread=${encodeURIComponent(msg.thread)}` : '';
    return bridgeFetch(`/chat/replies?tab=${tab.id || 0}&since=${Number(msg.since) || 0}${th}`)
      .then((r) => ({ connected: true, replies: r.replies || [], now: r.now }))
      .catch(() => ({ connected: false, replies: [] }));
  }
  if (msg.type === 'bridge-status') return Promise.resolve({ connected, port, lastError, version: VERSION });
  if (msg.type === 'chat-history') {
    const t = msg.thread ? `&thread=${encodeURIComponent(msg.thread)}` : '';
    return bridgeFetch(`/chat/history?limit=200${t}`)
      .then((r) => ({ ok: true, messages: r.messages || [], seq: r.seq || 0 }))
      .catch((e) => ({ ok: false, error: String((e && e.message) || e) }));
  }
  if (msg.type === 'chat-threads') {
    return bridgeFetch('/chat/threads')
      .then((r) => ({ ok: true, threads: r.threads || [], current: r.current || 'main' }))
      .catch((e) => ({ ok: false, error: String((e && e.message) || e) }));
  }
  if (msg.type === 'chat-new') {
    return bridgeFetch('/chat/new', {})
      .then((r) => ({ ok: true, thread: r.thread }))
      .catch((e) => ({ ok: false, error: String((e && e.message) || e) }));
  }
  if (msg.type === 'chat-select') {
    return bridgeFetch('/chat/select', { thread: msg.thread })
      .then((r) => ({ ok: true, thread: r.thread }))
      .catch((e) => ({ ok: false, error: String((e && e.message) || e) }));
  }
  if (msg.type === 'chat-pref-get') {
    return browser.storage.local
      .get({ chatMax: false, autoFocus: true, showThinking: true, dockSide: 'right', loadingStyle: 'line' })
      .then((v) => ({ ok: true, ...v }));
  }
  if (msg.type === 'chat-pref-set') {
    const patch = {};
    if ('chatMax' in msg) patch.chatMax = !!msg.chatMax;
    if ('autoFocus' in msg) patch.autoFocus = !!msg.autoFocus;
    if ('showThinking' in msg) patch.showThinking = !!msg.showThinking;
    if ('dockSide' in msg) patch.dockSide = msg.dockSide === 'left' ? 'left' : 'right';
    if ('loadingStyle' in msg) patch.loadingStyle = msg.loadingStyle === 'ring' ? 'ring' : 'line';
    return browser.storage.local.set(patch).then(() => ({ ok: true, ...patch }));
  }
  if (msg.type === 'chat-hide-tab') {
    const id = msg.tabId || (sender && sender.tab && sender.tab.id);
    if (id) dockHidden.add(id);
    return Promise.resolve({ ok: true, tabId: id || null });
  }
  if (msg.type === 'dock-info') {
    return Promise.resolve({ docked: dockChat });
  }
  if (msg.type === 'bridge-ping') {
    // truth for the popup: is the local bridge answering right now?
    return bridgeFetch('/health').then((h) => ({
      bridge: true, extension: !!h.extension, waiting: h.waiting || 0, queued: h.queued || 0, port,
    })).catch(() => ({ bridge: false, port }));
  }
  if (msg.type === 'chat-toggle') {
    return toggleChat(msg.tabId).then((r) => ({ ok: true, result: r })).catch((e) => ({ ok: false, error: String((e && e.message) || e) }));
  }
  if (msg.type === 'bridge-settings-get') {
    return bridgeFetch('/settings')
      .then((r) => ({ ok: true, settings: r.settings || {} }))
      .catch((e) => ({ ok: false, error: String((e && e.message) || e) }));
  }
  if (msg.type === 'bridge-settings-set') {
    return bridgeFetch('/settings', msg.settings || {})
      .then((r) => ({ ok: true, settings: r.settings || {}, autostart: r.autostart }))
      .catch((e) => ({ ok: false, error: String((e && e.message) || e) }));
  }
  if (msg.type === 'bridge-reconnect' || msg.type === 'chat-reconnect') {
    return loadConfig().then(() => forceRepair());
  }
});

browser.runtime.onInstalled.addListener(() => { loadConfig().then(restart);
// keep the dock flag in step with the user's switch, and dock the tab in front
syncDock().then(() => browser.tabs.query({ active: true, currentWindow: true }).then(([t]) => dockIfNeeded(t)).catch(() => {}));
setInterval(syncDock, 30000); });
browser.runtime.onStartup.addListener(() => { loadConfig().then(restart);
// keep the dock flag in step with the user's switch, and dock the tab in front
syncDock().then(() => browser.tabs.query({ active: true, currentWindow: true }).then(([t]) => dockIfNeeded(t)).catch(() => {}));
setInterval(syncDock, 30000); });

browser.commands.onCommand.addListener((cmd) => {
  if (cmd === 'toggle-chat') toggleChat().catch((e) => setError(e));
});

browser.alarms.create('bridge-keepalive', { periodInMinutes: 1 });
browser.alarms.onAlarm.addListener((a) => {
  if (a.name !== 'bridge-keepalive') return;
  if (!connected) { log('keepalive restart'); restart(); }
});

try {
  self.addEventListener('error', (e) => diag('pageerror', (e && (e.message || e.type)) || 'unknown'));
  self.addEventListener('unhandledrejection', (e) => diag('rejection', String((e && e.reason && e.reason.message) || (e && e.reason) || 'unknown')));
} catch (e) {}

diag('boot', navigator.userAgent + ' cid=' + CID);
loadConfig().then(restart);
// keep the dock flag in step with the user's switch, and dock the tab in front
syncDock().then(() => browser.tabs.query({ active: true, currentWindow: true }).then(([t]) => dockIfNeeded(t)).catch(() => {}));
setInterval(syncDock, 30000);
