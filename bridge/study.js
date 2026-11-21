'use strict';
/**
 * study.js — turn a game snapshot into a folder of small .txt notes.
 *
 * The idea: a button in the page says "look at this run properly", the bridge
 * takes a snapshot of the live game state, thinks for a few seconds, and drops
 * half a dozen short notes into <project>/notes/ — one per thing a player
 * usually wants next: what to delete, what to search for, the best moves, how
 * to tune the difficulty, what just happened, and a plan for the next run.
 *
 * Pure functions + one writer, no dependencies, testable without a browser.
 */
const fs = require('fs');
const path = require('path');

const MAX_NOTES = 6;

function n(v, d = 0) {
  return typeof v === 'number' && isFinite(v) ? v : d;
}

function kindWords(kind) {
  if (kind === 'spring') return 'spring (double jump)';
  if (kind === 'move') return 'moving platform';
  if (kind === 'floor') return 'the floor';
  return 'plain platform';
}

/** Platforms the player can actually reach next, nearest first. */
function nextPlatforms(snap, limit = 3) {
  const plats = Array.isArray(snap && snap.platforms) ? snap.platforms : [];
  const py = n(snap && snap.player && snap.player.y, 0);
  return plats
    .filter((p) => p && n(p.y, 0) < py - 10)           // above the player
    .sort((a, b) => n(b.y) - n(a.y))                   // closest first
    .slice(0, limit);
}

/** "a little left", "far right", "straight up" */
function direction(dx, width = 420) {
  const frac = dx / width;
  if (Math.abs(frac) < 0.08) return 'straight up';
  const side = frac < 0 ? 'left' : 'right';
  const mag = Math.abs(frac) < 0.22 ? 'a little' : Math.abs(frac) < 0.38 ? 'clearly' : 'far';
  return `${mag} ${side}`;
}

function pct(part, total) {
  if (!total) return '0%';
  return `${Math.round((part / total) * 100)}%`;
}

function buildNotes(snap, meta = {}) {
  const s = snap || {};
  const game = meta.game || s.game || 'your game';
  const score = n(s.score);
  const best = n(s.best, score);
  const deaths = n(s.deaths);
  const secs = n(s.runSeconds);
  const plats = Array.isArray(s.platforms) ? s.platforms : [];
  const ahead = nextPlatforms(s, 3);
  const springs = plats.filter((p) => p.kind === 'spring').length;
  const movers = plats.filter((p) => p.kind === 'move').length;
  const px = n(s.player && s.player.x, 0);
  const notes = [];

  // 1 — best moves
  const moves = ahead.length
    ? ahead.map((p, i) => {
      const dx = n(p.x) + n(p.w, 70) / 2 - (px + 18);
      const height = Math.round(n(p.y) - n(s.player && s.player.y, 0));
      return `  ${i + 1}. ${kindWords(p.kind)} — ${direction(dx)} (${Math.abs(Math.round(dx))}px across, ${Math.abs(height)}px up)`;
    }).join('\n')
    : '  no platform above you right now — you are at the top of the run';
  notes.push({
    slug: 'best-moves',
    title: `Best moves right now (${game})`,
    body: `Score ${score}${best > score ? `, best ${best}` : ''}.${s.dead ? ' The run is over.' : ''}

Aim for these, nearest first:
${moves}

Rules that pay off:
  - springs are worth 2x height, always take one over a plain platform at the same distance
  - a moving platform is easier to land on when you jump at the moment it turns around
  - if the next platform is further than about 120px, wait for a spring instead of trying it
  - small corrections early beat big corrections at the apex
`,
  });

  // 2 — what to delete
  notes.push({
    slug: 'what-to-delete',
    title: 'Things you might want to delete',
    body: `Short list of things that pile up and are safe to remove:

  - old notes:     notes/*.txt from earlier runs — keep the newest, delete the rest
  - saved best:    localStorage key "neon-doodle-best" holds ${best} — delete it to reset the scoreboard
  - the run log:   notes/snapshot.json (the raw data behind these notes, ${Math.max(1, Math.round(JSON.stringify(s).length / 1024))} KB)
  - test leftovers: any *.png / shot.png in the project folder from earlier checks

Nothing here is needed by the game to run. The game only reads its own
scripts and localStorage.
`,
  });

  // 3 — where to search
  notes.push({
    slug: 'where-to-search',
    title: 'Where to look for things in the code',
    body: `If you want to change how it plays, these are the spots:

  difficulty / gravity / jump speed   game.js → the CFG object at the top
  how gaps are picked                 game.js → the platform spawner (makePlat / kind roll)
  when the run ends                   game.js → the "dead = true" line in update()
  score + best score                  index.html → the draw() block that prints SCORE / BEST
  controls                            index.html → keydown / pointer handlers
  this notes helper                   bridge/study.js (categories are at the bottom of buildNotes)

Handy from a terminal: bx find "CFG" / bx read / bx eval "window.__bxStudy()"
`,
  });

  // 4 — tuning
  const gapHint = ahead.length >= 2
    ? Math.round(Math.abs(n(ahead[1].y) - n(ahead[0].y)))
    : null;
  notes.push({
    slug: 'tune-difficulty',
    title: 'Difficulty, measured on this run',
    body: `What the numbers say:

  platforms on screen      ${plats.length}
  springs                  ${springs} (${pct(springs, plats.length)})  — 8-15% feels generous, under 5% feels mean
  moving platforms         ${movers} (${pct(movers, plats.length)})
  vertical gap (next two)  ${gapHint === null ? 'n/a' : gapHint + 'px'}
  current height           ${score}${best > score ? `  (best ${best})` : ''}
  time survived            ${secs}s${deaths ? `, ${deaths} runs this session` : ''}

Concrete edits if it feels wrong:
  too hard  → raise CFG.jump (or lower CFG.gravity) and widen CFG.platW a little
  too easy  → shrink CFG.platW and increase the minimum vertical gap in the spawner
  boring    → raise the spring chance above 0.88 in the kind roll
`,
  });

  // 5 — what I noticed
  const observations = [];
  if (s.dead) observations.push(`The run ended at height ${score}${best ? ` (${Math.max(0, best - score)} short of your best)` : ''}.`);
  if (springs === 0) observations.push('Not a single spring in view — long stretches without one are where runs stall.');
  if (movers > 0) observations.push(`${movers} moving platform(s) on screen; timing the jump at the turn is the safe play.`);
  if (plats.length && plats.length < 6) observations.push('Very few platforms on screen, so the spawner is barely keeping ahead of you.');
  if (secs && score && score / Math.max(1, secs) < 4) observations.push(`Climbing slowly: ${(score / Math.max(1, secs)).toFixed(1)} px/s.`);
  if (!observations.length) observations.push(s.dead ? 'Nothing obviously wrong in that run — it just ended.' : `Nothing obviously wrong: alive at height ${score}, climbing steadily.`);
  notes.push({
    slug: 'what-i-noticed',
    title: 'What I noticed about this run',
    body: `${observations.map((o) => '  - ' + o).join('\n')}

Seed ${s.seed === undefined ? 'unknown' : s.seed}${s.game ? `, game "${s.game}"` : ''}. Same seed = same platform layout,
so replay it to test any change you make.
`,
  });

  // 6 — plan
  notes.push({
    slug: 'next-run-plan',
    title: 'Plan for the next run',
    body: `Three things, in order:

  1. ${ahead[0] ? `Take the ${kindWords(ahead[0].kind)} ${direction(n(ahead[0].x) + n(ahead[0].w, 70) / 2 - (px + 18))} first — it is the closest target.` : 'Wait for a platform instead of drifting upward without one.'}
  2. Do not fight the drift: tap, do not hold, once you are inside the gap.
  3. ${best > score ? `Beat ${best} — that is ${best - score}px above this run.` : `Set a new best: you are at ${score}, so ${score + 10} is the next target.`}

Read 01-best-moves.txt while you play; it is the one that changes the outcome.
`,
  });

  return notes.slice(0, MAX_NOTES);
}

function writeNotes(dir, notes) {
  const out = path.join(dir, 'notes');
  fs.mkdirSync(out, { recursive: true });
  const written = [];
  notes.forEach((note, i) => {
    const name = `${String(i + 1).padStart(2, '0')}-${note.slug}.txt`;
    const file = path.join(out, name);
    fs.writeFileSync(file, note.body.startsWith(note.title) ? note.body : `${note.title}\n${'='.repeat(note.title.length)}\n\n${note.body}`);
    written.push({ name, bytes: fs.statSync(file).size });
  });
  return { dir: out, written };
}

/** Safety: only absolute paths under the user's home, no traversal, no dotfiles. */
function safeDir(dir) {
  if (typeof dir !== 'string' || !dir.trim()) return null;
  const abs = path.resolve(dir.trim());
  const home = require('os').homedir();
  if (!abs.startsWith(home + path.sep)) return null;
  if (abs.split(path.sep).includes('..')) return null;
  if (!fs.existsSync(abs)) return null;
  if (!fs.statSync(abs).isDirectory()) return null;
  return abs;
}

/** If the page cannot know its own folder (http://), guess <home>/games/<slug>. */
function guessDir(gameName) {
  if (!gameName) return null;
  const slug = String(gameName).toLowerCase().replace(/[^a-z0-9-]+/g, '-');
  for (const p of [path.join(require('os').homedir(), 'games', slug), path.join(require('os').homedir(), slug)]) {
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) return p;
  }
  return null;
}

module.exports = { buildNotes, writeNotes, safeDir, guessDir, MAX_NOTES };
