'use strict';
/**
 * Platform helpers shared by every script in this repo.
 * Kept in CommonJS so both `require()` (bin/bx) and `createRequire()`
 * (the .mjs helpers) can use it without a build step.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const isWin = process.platform === 'win32';
const isMac = process.platform === 'darwin';
const isLinux = process.platform === 'linux';

function exists(p) {
  try { return fs.existsSync(p); } catch { return false; }
}

function firstExisting(list) {
  for (const p of list) if (p && exists(p)) return p;
  return null;
}

/** Where the Firefox binary is, on any of the three platforms. */
function findFirefox() {
  if (process.env.BX_FIREFOX_BIN) return process.env.BX_FIREFOX_BIN;
  const candidates = [];
  if (isWin) {
    for (const base of [process.env['ProgramFiles'], process.env['ProgramFiles(x86)'], process.env['LOCALAPPDATA']]) {
      if (base) candidates.push(path.join(base, 'Mozilla Firefox', 'firefox.exe'));
    }
    candidates.push('C:\\Program Files\\Mozilla Firefox\\firefox.exe');
  } else if (isMac) {
    candidates.push('/Applications/Firefox.app/Contents/MacOS/firefox');
    candidates.push(path.join(os.homedir(), 'Applications/Firefox.app/Contents/MacOS/firefox'));
  } else {
    candidates.push('/usr/lib/firefox/firefox', '/usr/bin/firefox', '/usr/bin/firefox-esr',
      '/opt/firefox/firefox', '/snap/bin/firefox', '/var/lib/flatpak/exports/bin/org.mozilla.firefox');
  }
  const hit = firstExisting(candidates);
  if (hit) return hit;
  for (const cmd of ['firefox', 'firefox-esr', 'firefox.exe']) {
    try {
      const out = execFileSync(isWin ? 'where' : 'which', [cmd], { encoding: 'utf8' }).split('\n')[0].trim();
      if (out) return out;
    } catch {}
  }
  return null;
}

/** Mozilla profile root for the current platform. */
function profileRoot() {
  if (process.env.BX_PROFILE_ROOT) return process.env.BX_PROFILE_ROOT;
  if (isWin) return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Mozilla', 'Firefox');
  if (isMac) return path.join(os.homedir(), 'Library', 'Application Support', 'Firefox');
  return path.join(os.homedir(), '.mozilla', 'firefox');
}

/** Parse profiles.ini and return the default release profile directory. */
function findProfile() {
  if (process.env.BX_PROFILE) return process.env.BX_PROFILE;
  const base = profileRoot();
  const ini = path.join(base, 'profiles.ini');
  let text = '';
  try { text = fs.readFileSync(ini, 'utf8'); } catch { return null; }
  const blocks = text.split(/\n(?=\[)/);
  let fallback = null;
  for (const block of blocks) {
    if (!/^\[Profile\d*\]/.test(block)) continue;
    const name = (block.match(/^Name=(.+)$/m) || [])[1];
    const rel = (block.match(/^Path=(.+)$/m) || [])[1];
    if (!rel) continue;
    const dir = rel.trim().match(/^([A-Za-z]:|[\\/])/) ? rel.trim() : path.join(base, rel.trim());
    if (!fallback) fallback = dir;
    if (name && /default-release/i.test(name)) return dir;
  }
  return fallback;
}

/** Is a process with this command line running? Best effort, no dependencies. */
function processRunning(needle, opts = {}) {
  const wantComms = opts.comms || null;
  try {
    if (isLinux) {
      for (const pid of fs.readdirSync('/proc')) {
        if (!/^\d+$/.test(pid)) continue;
        try {
          if (wantComms) {
            const comm = fs.readFileSync(`/proc/${pid}/comm`, 'utf8').trim();
            if (!wantComms.includes(comm)) continue;
          }
          const cl = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ');
          if (cl.includes(needle)) return Number(pid);
        } catch {}
      }
      return 0;
    }
    if (isWin) {
      const out = execFileSync('powershell', ['-NoProfile', '-Command',
        `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${needle.replace(/'/g, "''")}*' } | Select-Object -First 1 -ExpandProperty ProcessId`],
      { encoding: 'utf8' }).trim();
      return Number(out) || 0;
    }
    const out = execFileSync('ps', ['-Ao', 'pid=,command='], { encoding: 'utf8' });
    const line = out.split('\n').find((l) => l.includes(needle));
    return line ? Number(line.trim().split(/\s+/)[0]) || 0 : 0;
  } catch {
    return 0;
  }
}

function killPid(pid, signal = 'SIGTERM') {
  try { process.kill(Number(pid), signal); return true; } catch { return false; }
}

/** Where "start with my desktop" files live for this platform. */
function autostartDir() {
  if (isWin) {
    const appdata = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appdata, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
  }
  if (isMac) return path.join(os.homedir(), 'Library', 'LaunchAgents');
  return path.join(os.homedir(), '.config', 'autostart');
}

/** Does this URL/page allow extension scripting? */
const RESTRICTED = /^(about:(?!blank)|chrome:|moz-extension:|resource:|view-source:|edge:|devtools:|https?:\/\/addons\.mozilla\.org)/i;

module.exports = {
  isWin, isMac, isLinux, exists, firstExisting, findFirefox, findProfile, profileRoot,
  processRunning, killPid, autostartDir, RESTRICTED,
};
