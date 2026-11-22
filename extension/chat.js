'use strict';
/**
 * chat.js — the chat panel, running inside its own moz-extension:// iframe.
 *
 * Isolation is the point: keystrokes inside this document never reach the page,
 * so games and sites that bind space / arrows / letters cannot eat them, and the
 * page's styles cannot touch this UI. The panel talks to the background through
 * browser.runtime.sendMessage, and to the page only through window.parent.postMessage
 * for the two things the page owns: the frame size and hiding the frame.
 */
(function () {
  'use strict';

  const D = document;
  const HOST = D.getElementById('bxchat-host');
  const parentMsg = (msg) => { try { window.parent.postMessage({ bx: msg }, '*'); } catch (e) {} };
  // the page (or `bx panel on`) can ask this frame to take the caret
  window.addEventListener('message', (ev) => {
    if (ev.data && ev.data.bxFocus) setTimeout(() => { try { input.focus(); } catch (e) {} }, 30);
  });

  HOST.innerHTML = `
    <div class="bx-box">
      <div class="bx-head">
        <span class="bx-dot"></span>
        <span class="bx-title">agentfox</span>
        <span class="bx-mini">connecting…</span>
        <button class="bx-max" title="maximize / restore">⤢</button>
        <button class="bx-newc" title="start a new chat">＋ New</button>
        <button class="bx-hist" title="past chats">History</button>
        <button class="bx-connect" title="connect to the local bridge">Connect</button>
        <span class="bx-x" title="hide (Alt+Shift+B)">×</span>
      </div>
      <div class="bx-log"></div>
      <div class="bx-foot">
        <textarea rows="1" placeholder="type to the agent…"></textarea>
        <button class="bx-send" disabled>Send</button>
      </div>
      <div class="bx-hint">Enter sends · Shift+Enter newline · ⤢ maximize · ＋ New chat · History to continue an old one</div>
      <div class="bx-history" hidden>
        <div class="bx-history-head"><span>past chats</span><button class="bx-history-close">close</button></div>
        <div class="bx-history-list"></div>
      </div>
    </div>`;

  const log = HOST.querySelector('.bx-log');
  const input = HOST.querySelector('textarea');
  const sendBtn = HOST.querySelector('.bx-send');
  const dot = HOST.querySelector('.bx-dot');
  const mini = HOST.querySelector('.bx-mini');
  const connectBtn = HOST.querySelector('.bx-connect');
  const histPanel = HOST.querySelector('.bx-history');
  const histList = HOST.querySelector('.bx-history-list');

  let since = 0;
  let thread = null;
  let alive = true;
  let backoff = 2000;
  let timer = null;
  let thinkTimer = null;
  let thinkStart = 0;
  let showThinking = true;

  const add = (cls, text) => {
    const el = D.createElement('div');
    el.className = 'bx-msg ' + cls;
    el.textContent = text;
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
    while (log.children.length > 300) log.removeChild(log.firstChild);
  };

  const setOnline = (on, note) => {
    dot.className = 'bx-dot' + (on ? ' on' : '');
    mini.textContent = on ? (thread ? 'chat ' + thread.slice(-4) : 'connected') : (note || 'offline');
    connectBtn.textContent = on ? 'Reconnect' : 'Connect';
    connectBtn.className = 'bx-connect' + (on ? ' soft' : '');
  };

  /* ---- threads: the transcript lives on the bridge, not in this tab ---- */
  const seed = async (t) => {
    thread = t || thread;
    const r = await browser.runtime.sendMessage({ type: 'chat-history', thread });
    stopThinking();
    log.textContent = '';
    since = 0;
    if (r && r.ok) {
      for (const m of r.messages || []) {
        add(m.from === 'user' ? 'bx-me' : 'bx-agent', m.text);
        since = Math.max(since, m.ts || 0);
      }
      if (!(r.messages || []).length) add('bx-sys', 'new chat — say something');
    }
  };

  const loadCurrent = async () => {
    const r = await browser.runtime.sendMessage({ type: 'chat-threads' });
    if (r && r.ok) {
      thread = r.current || 'main';
      await seed(thread);
      setOnline(true);
    }
  };

  connectBtn.addEventListener('click', async () => {
    setOnline(false, 'connecting…');
    connectBtn.disabled = true;
    try {
      const r = await browser.runtime.sendMessage({ type: 'chat-reconnect' });
      if (r && r.bridge) {
        setOnline(true);
        add('bx-sys', r.extension ? 'reconnected to the bridge' : 'bridge is up but no agent is listening yet');
        await loadCurrent();
      } else {
        setOnline(false, 'no bridge');
        add('bx-sys', 'no bridge on 127.0.0.1:8788 — run `bx up` in the terminal, then press Connect');
      }
    } catch (e) {
      setOnline(false, 'extension reloaded');
      add('bx-sys', 'the add-on was reloaded — reopen this box (Alt+Shift+B)');
    }
    connectBtn.disabled = false;
    backoff = 2000;
    poll();
  });

  /* ---- maximize: the frame size is owned by the page, so ask it ---- */
  const applyMax = (on) => {
    HOST.querySelector('.bx-max').textContent = on ? '⤡' : '⤢';
    parentMsg({ op: 'chat-max', on });
  };
  HOST.querySelector('.bx-max').addEventListener('click', () => {
    applyMax(!HOST.classList.toggle('bx-max'));
  });

  /* ---- new chat ---- */
  HOST.querySelector('.bx-newc').addEventListener('click', async () => {
    const btn = HOST.querySelector('.bx-newc');
    btn.disabled = true;
    const r = await browser.runtime.sendMessage({ type: 'chat-new' }).catch(() => null);
    btn.disabled = false;
    if (r && r.ok) {
      thread = r.thread;
      log.textContent = '';
      since = 0;
      add('bx-sys', 'new chat started — everything below is a fresh conversation');
      setOnline(true);
    } else {
      add('bx-sys', 'could not start a new chat — is the bridge running? (bx up)');
    }
    input.focus();
  });

  /* ---- history ---- */
  const renderHistory = async () => {
    histList.textContent = '';
    const r = await browser.runtime.sendMessage({ type: 'chat-threads' }).catch(() => null);
    if (!r || !r.ok) {
      histList.textContent = '';
      add('bx-sys', 'could not load chats — is the bridge running?');
      return;
    }
    for (const t of r.threads || []) {
      const btn = D.createElement('button');
      btn.className = 'bx-thread' + (t.id === thread ? ' current' : '');
      const title = D.createElement('span');
      title.className = 'bx-thread-title';
      title.textContent = t.title || '(untitled chat)';
      const meta = D.createElement('span');
      meta.className = 'bx-thread-meta';
      const when = new Date(t.lastTs || Date.now());
      meta.textContent = `${t.count} messages · ${when.toLocaleDateString()} ${when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
      btn.appendChild(title);
      btn.appendChild(meta);
      btn.addEventListener('click', async () => {
        const s = await browser.runtime.sendMessage({ type: 'chat-select', thread: t.id }).catch(() => null);
        if (s && s.ok) {
          histPanel.hidden = true;
          await seed(s.thread);
          setOnline(true);
          poll();
        }
      });
      histList.appendChild(btn);
    }
    if (!(r.threads || []).length) histList.textContent = 'no chats yet';
  };
  HOST.querySelector('.bx-hist').addEventListener('click', async () => {
    histPanel.hidden = false;
    await renderHistory();
  });
  HOST.querySelector('.bx-history-close').addEventListener('click', () => { histPanel.hidden = true; });

  /* ---- "working on it": a real progress bar when the stages are known ---- */
  // one thin gold line that keeps sweeping until the answer lands; nothing else
  const startThinking = () => {
    if (!showThinking) return;
    thinkStart = Date.now();
    dot.className = 'bx-dot on busy';
    parentMsg({ op: 'busy', on: true });        // the page draws the hairline
    clearInterval(thinkTimer);
    thinkTimer = setInterval(thinkTick, 1500);
  };

  const stopThinking = () => {
    clearInterval(thinkTimer);
    thinkTimer = null;
    dot.className = 'bx-dot on';
    parentMsg({ op: 'busy', on: false });
  };

  // the line is the feedback; this only decides when it should disappear
  const thinkTick = async () => {
    if (Date.now() - thinkStart > 240000) { stopThinking(); return; }
    let p = null;
    try { p = await browser.runtime.sendMessage({ type: 'chat-pending', thread }); } catch (e) {}
    if (p && p.ok && p.pending === 0 && Date.now() - thinkStart > 1500) stopThinking();
  };

  /* ---- send ---- */
  const send = async () => {
    const text = input.value.trim();
    if (!text || !alive) return;
    add('bx-me', text);
    input.value = '';
    input.style.height = 'auto';
    sendBtn.disabled = true;
    try {
      const r = await browser.runtime.sendMessage({ type: 'chat-send', text, thread });
      if (!r || !r.ok) {
        add('bx-sys', 'not delivered — is the bridge running? (bx up)');
      } else {
        setOnline(true);
        add('bx-sys', 'queued — the agent reads this on its next turn');
        startThinking();
      }
    } catch (e) {
      add('bx-sys', 'not delivered: ' + ((e && e.message) || e));
    }
  };

  /* ---- polling ---- */
  const poll = async () => {
    if (!alive) return;
    clearTimeout(timer);
    try {
      const r = await browser.runtime.sendMessage({ type: 'chat-poll', since, thread });
      if (!r) throw new Error('no answer from the extension');
      setOnline(!!r.connected, r.connected ? '' : 'agent offline');
      for (const m of r.replies || []) {
        add('bx-agent', m.text);
        since = Math.max(since, m.ts);
      }
      if ((r.replies || []).length) stopThinking();
      if (backoff !== 2000) backoff = 2000;
      timer = setTimeout(poll, 2000);
    } catch (e) {
      setOnline(false, 'no bridge');
      backoff = Math.min(backoff * 2, 15000);
      timer = setTimeout(poll, backoff);
    }
  };

  const grow = () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 92) + 'px'; };

  input.addEventListener('input', () => { grow(); sendBtn.disabled = !input.value.trim(); });
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); send(); }
    if (ev.key === 'Escape') { if (!histPanel.hidden) histPanel.hidden = true; else input.blur(); }
  });
  sendBtn.addEventListener('click', send);
  HOST.querySelector('.bx-x').addEventListener('click', () => {
    alive = false;
    clearTimeout(timer);
    parentMsg({ op: 'chat-close' });
  });

  (async () => {
    try {
      const p = await browser.runtime.sendMessage({ type: 'chat-pref-get' });
      if (p && p.ok) {
        showThinking = p.showThinking !== false;
        parentMsg({ op: 'dock-side', side: p.dockSide === 'left' ? 'left' : 'right' });
      }
      if (p && p.ok && p.chatMax) {
        HOST.classList.add('bx-max');
        HOST.querySelector('.bx-max').textContent = '⤡';
        parentMsg({ op: 'chat-max', on: true });
      }
    } catch (e) {}
    await loadCurrent();
    poll();
  })();
  setTimeout(async () => {
    let autofocus = true;
    try { const p = await browser.runtime.sendMessage({ type: 'chat-pref-get' }); autofocus = p ? p.autoFocus !== false : true; } catch (e) {}
    if (autofocus) { try { input.focus(); } catch (e) {} }
  }, 60);
})();