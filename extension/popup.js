async function render() {
  const st = await browser.runtime.sendMessage({ type: 'bridge-status' }).catch(() => null);
  const state = document.getElementById('state');
  const label = document.getElementById('label');
  const detail = document.getElementById('detail');
  if (!st) {
    state.className = 'row off';
    label.textContent = 'background unavailable';
    return;
  }
  if (st.connected) {
    state.className = 'row on';
    label.textContent = `connected to ${st.port}`;
    detail.textContent = st.lastError ? `last error: ${st.lastError}` : 'agent can read and click in your tabs';
  } else {
    state.className = 'row off';
    label.textContent = 'not connected';
    detail.textContent = st.lastError
      ? `${st.lastError} — run \`bx up\` in the terminal`
      : 'run `bx up` in the terminal, then reconnect';
  }
}

document.getElementById('reconnect').addEventListener('click', async () => {
  const label = document.getElementById('label');
  const detail = document.getElementById('detail');
  label.textContent = 'reconnecting…';
  detail.textContent = 're-pairing with 127.0.0.1:8788';
  const r = await browser.runtime.sendMessage({ type: 'bridge-reconnect' }).catch(() => null);
  if (r && r.bridge) {
    label.textContent = r.extension ? 'reconnected' : 'bridge ok, agent not polling';
    detail.textContent = r.extension ? 'agent is listening' : 'the bridge is up but nothing is polling it';
  }
  setTimeout(render, 1200);
});
document.getElementById('chat').addEventListener('click', async () => {
  const r = await browser.tabs.query({ active: true, currentWindow: true });
  const tab = r[0];
  if (!tab) return;
  await browser.runtime.sendMessage({ type: 'chat-toggle', tabId: tab.id }).catch(() => {});
  window.close();
});
document.getElementById('options').addEventListener('click', () => browser.runtime.openOptionsPage());
render();
setInterval(render, 1500);
