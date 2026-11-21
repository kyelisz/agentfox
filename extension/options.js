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

load();
loadPolicy();
