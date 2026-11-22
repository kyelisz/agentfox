#!/usr/bin/env node
/**
 * bx-watch-firefox — keeps the add-on installed even when Firefox was started
 * some way I do not control (panel entry, file manager, `firefox` in a shell,
 * a Firefox self-update restart).
 *
 * Loop, every few seconds:
 *   1. Firefox running and the bridge already sees the extension?  -> nothing.
 *   2. RDP port open but no extension?                          -> install it now.
 *   3. Firefox running, no port, no extension for a while?      -> tell the user
 *      once (desktop notification) that this instance was not started through
 *      bx-firefox, so it cannot be healed in place.
 *
 *   bx-watch-firefox            # foreground
 *   bx-watch-firefox --daemon   # detach (used by autostart)
 */
import { execFileSync, spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(new URL(import.meta.url).pathname), '..');
const RUN = join(ROOT, 'run');
const LOG = join(RUN, 'watch.log');
const XPI = join(ROOT, 'dist', 'firefox-bridge.xpi');
const PORT = process.env.BX_RDP_PORT || '6011';
mkdirSync(RUN, { recursive: true });

const log = (...a) => {
  const line = `[${new Date().toISOString()}] ${a.join(' ')}\n`;
  appendFileSync(LOG, line);
  if (process.stdout.isTTY) process.stdout.write(line);
};

function firefoxRunning() {
  for (const pid of readdirSync('/proc')) {
    if (!/^\d+$/.test(pid)) continue;
    try {
      const comm = readFileSync(`/proc/${pid}/comm`, 'utf8').trim();
      if (comm !== 'firefox-bin') continue;
      const cl = readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ');
      if (!cl.includes('-contentproc') && !cl.includes('crashhelper')) return true;
    } catch {}
  }
  return false;
}

function portOpen(port) {
  try {
    execFileSync('bash', ['-c', `timeout 1 bash -c "exec 3<>/dev/tcp/127.0.0.1/${port}" 2>/dev/null`], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

async function extensionAttached() {
  try {
    const token = readFileSync(join(RUN, 'token'), 'utf8').trim();
    const r = await fetch(`http://127.0.0.1:8788/health?token=${token}`, { cache: 'no-store' });
    const h = await r.json();
    return !!(h && h.extension);
  } catch {
    return false;
  }
}

function notify(title, body) {
  try {
    execFileSync('notify-send', ['-a', 'free-pi', title, body], { stdio: 'ignore' });
  } catch {
    log('notify-send missing:', title, '-', body);
  }
}

function install() {
  try {
    const out = execFileSync('node', [join(ROOT, 'bridge', 'rdp-install.js'), PORT, XPI, '40000'], { encoding: 'utf8' });
    log('installed:', out.trim().slice(0, 200));
    return true;
  } catch (e) {
    log('install failed:', String((e.stdout || '') + (e.stderr || '')).slice(0, 200));
    return false;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  log('watcher up, pid', process.pid);
  let warned = false;
  let blindSince = 0;
  for (;;) {
    await sleep(4000);
    const ff = firefoxRunning();
    if (!ff) { warned = false; blindSince = 0; continue; }
    if (await extensionAttached()) { warned = false; blindSince = 0; continue; }
    if (portOpen(PORT)) {
      log('extension missing but the debugger port is open — installing');
      if (install()) { await sleep(3000); if (await extensionAttached()) { warned = false; continue; } }
      continue;
    }
    if (!blindSince) blindSince = Date.now();
    if (!warned && Date.now() - blindSince > 20000) {
      warned = true;
      log('Firefox is running without the debugger port — cannot install in place');
      notify('free-pi bridge', 'This Firefox was not started through the free-pi launcher. Quit it and start Firefox from your panel icon to get the add-on back.');
    }
  }
}

if (process.argv.includes('--daemon')) {
  const child = spawn(process.execPath, [process.argv[1]], { detached: true, stdio: 'ignore' });
  child.unref();
  process.exit(0);
}
main();
