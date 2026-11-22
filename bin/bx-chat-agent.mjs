#!/usr/bin/env node
/**
 * bx-chat-agent — a second free-pi session that exists only to answer the chat
 * box in the browser. It runs its own `free-pi-cli` inside tmux (so it has its
 * own login, model and context, and never touches your coding session), blocks
 * on `bx watch`, and replies through `bx say`.
 *
 *   bx-chat-agent start     # launch the session and start listening
 *   bx-chat-agent status    # is it up? last log lines
 *   bx-chat-agent stop      # kill the tmux session
 *   bx-chat-agent once      # handle whatever is queued now, then exit
 *   bx-chat-agent log       # tail the log
 *
 * The wrapper talks to its session through files, not by scraping the TUI:
 *   /tmp/bxchat/request.txt  -> what to answer
 *   /tmp/bxchat/reply.txt    <- what the session wrote back
 */
import { spawn, execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, existsSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(new URL(import.meta.url).pathname), '..');
const RUN = join(ROOT, 'run');
const WORK = '/tmp/bxchat';
const SESSION = process.env.BX_CHAT_TMUX || 'bxchat';
const LOG = join(RUN, 'chat-agent.log');
const REQ = join(WORK, 'request.txt');
const REPLY = join(WORK, 'reply.txt');
const cmd = (process.argv[2] || 'start').toLowerCase();
mkdirSync(RUN, { recursive: true });
mkdirSync(WORK, { recursive: true });

const log = (...a) => {
  const line = `[${new Date().toISOString()}] ${a.join(' ')}\n`;
  appendFileSync(LOG, line);
  if (cmd !== 'start' && cmd !== 'once') process.stdout.write(line);
};
const sh = (c, args, timeout = 30000) => {
  try {
    return execFileSync(c, args, { encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    return (e.stdout || '') + (e.stderr || '');
  }
};
const tmux = (...args) => sh('tmux', args);
const hasSession = () => tmux('has-session', '-t', SESSION).trim() === '' && sh('tmux', ['list-sessions']).includes(SESSION);

function bx(args, timeoutMs = 660000) {
  return new Promise((resolve) => {
    const child = spawn('bx', args, { env: process.env });
    let out = '';
    let err = '';
    const t = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('close', () => {
      clearTimeout(t);
      resolve({ out, err });
    });
  });
}

const BRIEF = [
  'Answer the message in /tmp/bxchat/request.txt. It is a chat message from the user, written in',
  'a small box inside their Firefox window, and speed matters more than depth.',
  'Rules:',
  '1. Reply in one or two plain sentences. No markdown, no headings, no preamble, no code blocks.',
  '2. Use at most ONE command in total, and only if the answer truly needs the browser',
  '   (e.g. `bx read --tab N` or `bx tabs`). Never explore, never grep, never list files.',
  '3. If the message is a greeting, a test, or a question you can answer from context, answer',
  '   straight away with no command at all.',
  '4. Then write ONLY your final answer into /tmp/bxchat/reply.txt with the write tool, overwriting it.',
].join(' ');

function startSession() {
  if (hasSession()) return log('tmux session already running:', SESSION);
  tmux('new-session', '-d', '-s', SESSION, '-x', '140', '-y', '45', '-c', WORK,
    'npx free-pi-cli@latest --new; echo "[chat agent session ended]"');
  log('started tmux session', SESSION);
}

// wait until the TUI is taking input: the input box shows up and no ad/consent
// screen is in the way. Cheap heuristic: the pane mentions the composer hints.
function waitReady(ms = 90000) {
  const until = Date.now() + ms;
  let text = '';
  while (Date.now() < until) {
    text = tmux('capture-pane', '-p', '-t', SESSION);
    if (/esc to interrupt|Enter|shift\+enter|send|❯|> /i.test(text)) return true;
    sh('sleep', ['2']);
  }
  log('session did not look ready; last pane:', String(text).slice(-160).replace(/\s+/g, ' '));
  return false;
}

async function answer(msg) {
  try { rmSync(REPLY, { force: true }); } catch {}
  writeFileSync(REQ, `tab: ${msg.tab}\npage: ${msg.title || ''} — ${msg.url || ''}\n\n${msg.text}\n`);
  const ask = `${BRIEF} The user's message is in /tmp/bxchat/request.txt (tab ${msg.tab}). Answer it now.`;
  // keep keys short and unquoted-newline-free: tmux send-keys -l types literally
  tmux('send-keys', '-t', SESSION, '-l', ask);
  tmux('send-keys', '-t', SESSION, 'Enter');
  const until = Date.now() + 240000;
  while (Date.now() < until) {
    if (existsSync(REPLY)) {
      const body = readFileSync(REPLY, 'utf8').trim();
      if (body) return body;
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return '';
}

const seen = new Set();

async function loop(once) {
  if (!hasSession()) startSession();
  if (!waitReady()) log('continuing anyway');
  for (;;) {
    const watchArgs = ['watch', '--timeout', '600'];
    const { out, err } = await bx(watchArgs);
    if (err.trim()) log('watch stderr:', err.trim().slice(0, 160));
    let msgs = [];
    try { msgs = JSON.parse(out); } catch {}
    if (!Array.isArray(msgs) || !msgs.length) {
      if (once) break;
      continue;
    }
    for (const m of msgs) {
      if (m.id && seen.has(m.id)) continue;      // the same message must never be answered twice
      if (m.id) seen.add(m.id);
      log(`\n── message #${m.id} (tab ${m.tab}): ${String(m.text).replace(/\s+/g, ' ').slice(0, 140)}`);
      const reply = (await answer(m)) || 'sorry — my second session did not answer in time.';
      log('reply:', reply.replace(/\s+/g, ' ').slice(0, 200));
      const say = ['say', reply, '--tab', String(m.tab || 'all')];
      await bx(say, 60000);
    }
    if (once) break;
  }
  log('listener exit');
}

if (cmd === 'start') {
  startSession();
  loop(false);
} else if (cmd === 'once') {
  loop(true);
} else if (cmd === 'stop') {
  tmux('kill-session', '-t', SESSION);
  // kill any listener process too, otherwise it keeps watching with a dead session
  const self = process.pid;
  for (const pid of (await import('node:fs')).readdirSync('/proc')) {
    if (!/^\d+$/.test(pid) || Number(pid) === self) continue;
    try {
      if ((await import('node:fs')).readFileSync(`/proc/${pid}/comm`, 'utf8').trim() !== 'node') continue;
      const cl = (await import('node:fs')).readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ');
      if (cl.includes('bx-chat-agent.mjs') && cl.includes('start')) process.kill(Number(pid), 'SIGTERM');
    } catch {}
  }
  log('stopped');
} else if (cmd === 'status') {
  const up = hasSession();
  const pane = up ? tmux('capture-pane', '-p', '-t', SESSION).trim().split('\n').slice(-6).join('\n') : '(no session)';
  log('tmux session', SESSION, up ? 'UP' : 'DOWN');
  process.stdout.write(pane + '\n');
  process.exit(0);
} else if (cmd === 'log') {
  process.stdout.write(existsSync(LOG) ? readFileSync(LOG, 'utf8').split('\n').slice(-40).join('\n') : 'no log yet\n');
  process.exit(0);
} else {
  process.stdout.write('usage: bx-chat-agent start|stop|status|once|log\n');
  process.exit(2);
}
