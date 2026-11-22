const DEFAULTS = { port: 8788, readonly: false, highlight: true };

async function load() {
  const cfg = { ...DEFAULTS, ...(await browser.storage.local.get(DEFAULTS)) };
  document.getElementById('port').value = cfg.port;
  document.getElementById('readonly').checked = !!cfg.readonly;
  document.getElementById('highlight').checked = !!cfg.highlight;
}

document.getElementById('save').addEventListener('click', async () => {
  const port = Number(document.getElementById('port').value) || DEFAULTS.port;
  await browser.storage.local.set({
    port,
    readonly: document.getElementById('readonly').checked,
    highlight: document.getElementById('highlight').checked,
  });
  await browser.runtime.sendMessage({ type: 'bridge-reconnect' }).catch(() => {});
  const s = document.getElementById('saved');
  s.textContent = 'saved — reconnecting';
  setTimeout(() => { s.textContent = ''; }, 2000);
});

// --- the two policy switches, stored in the bridge so the agent sees them ---
async function loadPolicy() {
  const r = await browser.runtime.sendMessage({ type: 'bridge-settings-get' }).catch(() => null);
  const s = (r && r.settings) || {};
  document.getElementById('askLocalhost').checked = s.askLocalhost !== false;
  document.getElementById('alwaysOn').checked = !!s.alwaysOn;
  document.getElementById('historyDays').value = Number(s.historyDays) || 30;
  const saved = document.getElementById('policySaved');
  if (!r || !r.ok) saved.textContent = 'bridge not running — start it with `bx up`';
}

document.getElementById('savePolicy').addEventListener('click', async () => {
  const saved = document.getElementById('policySaved');
  saved.textContent = 'saving…';
  const r = await browser.runtime.sendMessage({
    type: 'bridge-settings-set',
    settings: {
      askLocalhost: document.getElementById('askLocalhost').checked,
      alwaysOn: document.getElementById('alwaysOn').checked,
    },
  }).catch(() => null);
  if (r && r.ok) {
    saved.textContent = r.settings.alwaysOn
      ? 'saved — starts with your desktop from now on'
      : 'saved';
    setTimeout(loadPolicy, 2500);
  } else {
    saved.textContent = 'could not save — is the bridge running? (bx up)';
  }
});

// --- the chat box itself: browser-local preferences ---
async function loadBox() {
  const r = await browser.runtime.sendMessage({ type: 'chat-pref-get' }).catch(() => null);
  const p = (r && r.ok) ? r : { autoFocus: true, showThinking: true, dockSide: 'right', loadingStyle: 'line', chatMax: false };
  document.getElementById('autoFocus').checked = p.autoFocus !== false;
  document.getElementById('showThinking').checked = p.showThinking !== false;
  document.getElementById('dockSide').value = p.dockSide === 'left' ? 'left' : 'right';
  document.getElementById('openMax').checked = !!p.chatMax;
  document.getElementById('loadingStyle').value = p.loadingStyle === 'ring' ? 'ring' : 'line';
}

document.getElementById('saveBox').addEventListener('click', async () => {
  const label = document.getElementById('boxSaved');
  const r = await browser.runtime.sendMessage({
    type: 'chat-pref-set',
    autoFocus: document.getElementById('autoFocus').checked,
    showThinking: document.getElementById('showThinking').checked,
    dockSide: document.getElementById('dockSide').value,
    loadingStyle: document.getElementById('loadingStyle').value,
    chatMax: document.getElementById('openMax').checked,
  }).catch(() => null);
  label.textContent = (r && r.ok)
    ? 'saved — reload a tab (or press Alt+Shift+B twice) to see it'
    : 'could not save';
  setTimeout(() => { label.textContent = ''; }, 4000);
});

document.getElementById('saveHistory').addEventListener('click', async () => {
  const label = document.getElementById('historySaved');
  const days = Number(document.getElementById('historyDays').value) || 30;
  const r = await browser.runtime.sendMessage({
    type: 'bridge-settings-set',
    settings: { historyDays: days },
  }).catch(() => null);
  label.textContent = (r && r.ok) ? 'saved — keeps the last ' + days + ' days' : 'could not save — is the bridge running?';
  setTimeout(() => { label.textContent = ''; }, 4000);
});

load();
loadPolicy();
loadBox();
