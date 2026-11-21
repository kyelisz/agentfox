# The "study this" button

A button in your page that makes the agent **take a noticeably longer look** at
whatever is on screen, then writes a **folder of small `.txt` notes** next to
your project — one note per thing a player or user usually wants next:

```
notes/
  01-best-moves.txt        what to aim for right now, nearest first
  02-what-to-delete.txt    things that pile up and are safe to remove
  03-where-to-search.txt   where in the code a change would go
  04-tune-difficulty.txt   the numbers this run produced, and what to change
  05-what-i-noticed.txt    what the current state actually shows
  06-next-run-plan.txt     three steps for the next attempt
  snapshot.json            the raw state the notes were made from
```

Verified working on a real game: click → five staged steps over ~6 s →
`notes written · 6 small files · 6s` → the panel lists each file as a link.

## Drop it into any project

`examples/study-button.html` is the whole thing in one file: styles, button,
panel and ~70 lines of script. Copy the three blocks into your page and replace
`snapshot()` with whatever state you have.

```js
function snapshot() {
  return {
    game: 'my-project',            // used as the note title and the folder hint
    score: 12, best: 40,           // any numbers you want quoted in the notes
    dead: false, deaths: 3, runSeconds: 95,
    player: { x: 140, y: 420 },    // where the interesting thing is
    platforms: [{ x: 90, y: 350, w: 70, kind: 'spring' }], // what you can move to
  };
}
```

The note writer only needs two ideas: **where am I** and **what can I move
toward**. A chess board fits the same contract — `player` is the piece you have
selected, `platforms` are the legal destinations, `kind` is the piece type — and
the notes come out as best moves, what to delete (the game, the last move), and
where the move generator lives.

## The request

```http
POST http://127.0.0.1:8788/study
content-type: application/json

{ "game": "neon-doodle", "dir": "/home/you/games/neon-doodle", "snapshot": { … } }
```

```json
{ "ok": true, "dir": "/home/you/games/neon-doodle/notes",
  "notes": [{ "name": "01-best-moves.txt", "bytes": 643 }, …], "tookMs": 4 }
```

`dir` may be omitted: the bridge then looks for `~/games/<game>` and
`~/<game>`. Over `http://` it cannot know the folder at all, so pass
`?notes=/absolute/path` in your page URL.

## Why the token is not required

A page cannot know the loopback token (that is the whole point of the pairing),
so `/study` is the one route that answers without it. Guard rails instead of a
token:

- loopback caller only (`127.0.0.1` / `::1`)
- rejected unless the origin is `null` (a `file://` page) or a loopback dev
  server — a real website can never reach it
- the directory must be an absolute existing folder **under your home**, with no
  `..`
- body capped at 256 KB, and the note filenames are fixed, so nothing arbitrary
  is ever written
- every run is logged in `run/study/index.jsonl` and `bx notes` lists them

## Notes from the terminal

```bash
bx notes                                  # every study run: when, game, dir, files
bx study ~/games/neon-doodle '{"score":58}'   # same thing without a browser
```

The agent also gets a message in the chat box on its next turn, so it can add
one deeper note of its own if the mechanical ones missed something.

## Changing what the notes say

All six notes are generated in `bridge/study.js` → `buildNotes()`. Each entry is
`{ slug, title, body }`; add or remove entries and the folder follows. The
generator is deliberately plain text with no dependencies, so it works with the
bridge alone, no model required — a model (the chat agent) adds prose on top
when it is running.
