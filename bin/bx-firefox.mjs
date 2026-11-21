#!/usr/bin/env node
/**
 * bx-firefox — start Firefox so the bridge extension is there.
 *
 * Release Firefox refuses unsigned add-ons and a temporary add-on dies with the
 * browser, so the only way to keep it is to install it over the Remote Debugging
 * Protocol at every start. This launcher does that: it starts Firefox with the
 * debugger port open, waits for the port, installs the add-on, then stays as the
 * parent process.
 *
 *   bx-firefox                 # normal start
 *   bx-firefox https://x.dev   # start with a URL, like firefox
 *   BX_RDP_PORT=6011 bx-firefox
 */
const { spawn, spawnSync } = require('child_process');
const path = require('path');
const net = require('net');

const ROOT = path.resolve(__dirname, '..');
const XPI = path.join(ROOT, 'dist', 'firefox-bridge.xpi');
const PORT = Number(process.env.BX_RDP_PORT || 6011);
const pl = require('./lib/platform');

const log = (...a) => process.stderr.write(`[bx-firefox] ${a.join(' ')}\n`);

function portOpen(port, timeoutMs = 800) {
  return new Promise((resolve) => {
    const sock = net.connect({ host: '127.0.0.1', port });
    const done = (ok) => { try { sock.destroy(); } catch {} resolve(ok); };
    sock.setTimeout(timeoutMs);
    sock.once('connect', () => done(true));
    sock.once('timeout', () => done(false));
    sock.once('error', () => done(false));
  });
}

function ensureXpi() {
  if (pl.exists(XPI)) return true;
  log('building dist/firefox-bridge.xpi');
  const r = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'bx'), 'pack'], { stdio: 'inherit' });
  return r.status === 0 && pl.exists(XPI);
}

function installInto(port, timeoutMs) {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'bridge', 'rdp-install.js'), String(port), XPI, String(timeoutMs)],
    { encoding: 'utf8' });
  const out = `${r.stdout || ''}${r.stderr || ''}`.trim();
  if (r.status === 0) log('add-on installed:', out.slice(0, 160));
  else log('could not install over RDP:', out.slice(0, 240));
  return r.status === 0;
}

async function main() {
  const ff = pl.findFirefox();
  if (!ff) {
    log('Firefox not found. Set BX_FIREFOX_BIN to the firefox executable and retry.');
    process.exit(1);
  }
  const profile = pl.findProfile();
  if (!profile) {
    log('no Firefox profile found (looked in', pl.profileRoot() + '). Starting Firefox normally.');
    spawn(ff, process.argv.slice(2), { stdio: 'inherit' });
    return;
  }
  log('profile:', profile);

  // the debugger server needs these; user.js is read at every start
  const userjs = path.join(profile, 'user.js');
  const prefs = [
    'user_pref("devtools.debugger.remote-enabled", true);',
    'user_pref("devtools.debugger.prompt-connection", false);',
    'user_pref("devtools.chrome.enabled", true);',   // without this a release build never opens the port
  ];
  let current = '';
  try { current = require('fs').readFileSync(userjs, 'utf8'); } catch {}
  const missing = prefs.filter((p) => !current.split('\n').includes(p));
  if (missing.length) {
    require('fs').appendFileSync(userjs, `\n${missing.join('\n')}\n`);
    log('prefs added to user.js');
  }

  if (!ensureXpi()) log('warning: no xpi, will only install if dist exists');

  // Firefox is already up with our port open? install into it and hand off.
  if (await portOpen(PORT)) {
    log(`debugger port ${PORT} already open — installing into the running Firefox`);
    installInto(PORT, 30000);
    spawn(ff, process.argv.slice(2), { stdio: 'inherit', detached: true }).unref();
    return;
  }

  // wait for a shutting-down instance to release the profile
  for (let i = 0; i < 20; i++) {
    if (!pl.processRunning('-foreground', { comms: ['firefox', 'firefox-bin'] }) &&
        !pl.processRunning(profile, { comms: ['firefox', 'firefox-bin', 'firefox.exe'] })) break;
    await new Promise((r) => setTimeout(r, 1000));
  }

  const args = [];
  if (!pl.isWin) args.push('-foreground');          // keeps this process owning the port
  if (!pl.isWin) args.push('-no-remote');
  args.push('-start-debugger-server', String(PORT));
  if (!pl.isWin) args.push('-profile', profile);
  else args.push('-profile', profile);
  args.push(...process.argv.slice(2));

  log('starting Firefox with the debugger port');
  const child = spawn(ff, args, { stdio: 'inherit' });
  child.on('exit', (code) => process.exit(code || 0));

  // the port opens late in startup; rdp-install retries internally
  installInto(PORT, 90000);
  try { spawn(process.execPath, [path.join(ROOT, 'bin', 'bx'), 'up'], { stdio: 'ignore', detached: true }).unref(); } catch {}
}

main().catch((e) => {
  log('failed:', String((e && e.message) || e));
  process.exit(1);
});
