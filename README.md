# agentfox

**A browser AI agent for your real Firefox.** Read pages, click, type, log in and
switch tabs from a terminal agent — and talk to it from a white-and-gold box that
lives inside the page.

No cloud, no Playwright, no second browser profile. Everything stays on
`127.0.0.1`, and the add-on is yours: a local folder you load, not something from
a store.

<p align="center">
  <img src="docs/images/widget.png" alt="the chat box" width="620">
</p>

---

## Install (3 steps, ~2 minutes)

### Step 1 — Node 22

```bash
node -v          # must print v22.x or newer
```
No Node? Install it from **https://nodejs.org** (or `nvm install 22`).

### Step 2 — free-pi

```bash
npm install -g free-pi-cli@latest
free-pi --version
```
free-pi is the agent. Without it the browser side still works and the chat box
still collects your messages — there is just nothing to answer them. (If you
only ever run free-pi through `npx free-pi-cli@latest`, that is fine too.)

### Step 3 — this repo

```bash
git clone https://github.com/kyelisz/agentfox
cd agentfox
./install.sh
```

**Windows:** run `install.bat` instead of `./install.sh` (same thing).

The script checks Node 22, free-pi and Firefox, installs one dependency, builds
the add-on, puts `bx` on your PATH, starts the bridge and (on Linux) points your
Firefox icon at the launcher.

### Step 4 — restart Firefox the right way

**Quit Firefox completely, then open it from its normal Firefox icon.** Nothing
appears for ~10 seconds; that is the add-on installing itself.

Then:

```bash
bx status          # "extension": true
bx read            # the text of the page in front of you
bx panel on        # the chat box, bottom right
bx chatagent on    # optional: let it answer the box by itself
```

Stuck? `bx doctor` names the broken link and the fix. Full walkthrough:
**[docs/SETUP.md](docs/SETUP.md)** · **[docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)**

---

## What you get

| | |
|---|---|
| **Browse for the agent** | `bx read`, `bx find`, `bx click`, `bx type`, `bx press`, `bx scroll`, `bx shot`, `bx eval`, `bx wait` — across every window and tab |
| **A chat box in the page** | white/gold panel with `⤢` maximize, `＋ New` chat, `History` to continue an old conversation, per-tab docking |
| **It answers by itself** | an optional second free-pi session in tmux answers from the box in ~5–12 s |
| **A "study this" button** | one click in your page: the agent looks at the live state for a few seconds, then writes a folder of small `.txt` notes — best moves, what to delete, where to search ([docs](docs/STUDY-BUTTON.md)) |
| **Survives restarts** | the launcher re-installs the add-on over Firefox's remote debugger at every start |
| **Two safety switches** | "ask before starting anything on localhost" and "always on" |

### The chat box is isolated on purpose

The panel runs in its own `moz-extension://` iframe, not in the page's DOM. So
sites and games that bind space, arrows or letters — or that grab focus — cannot
eat what you type, and the page's CSS cannot reach the panel. Verified against a
page with a capture-phase `preventDefault()` on every key.

## Command cheat sheet

```
bx status · tabs · read [--full] · find "text" · click "text" · type "hi" [--into CSS]
bx keys · press · select · check · scroll · shot · eval · wait · raw · options
bx goto URL · open URL · back · forward · reload
bx panel on|off|toggle          the chat box
bx inbox · watch · say "…"      the mailbox, from the terminal side
bx threads · bx notes           past chats · note folders the 🧠 button wrote
bx settings [set alwaysOn on]   the two switches
bx chatagent on|off|status      the self-answering session
bx up · down · logs · doctor    the local bridge
bx forever · setup · pack       installation helpers
```

Everything, with flags: **[docs/USAGE.md](docs/USAGE.md)**.

## How it works (short)

```
pi / free-pi agent ── bx CLI ──HTTP──▶ bridge (127.0.0.1:8788) ──long-poll──▶ Firefox extension ──▶ tab
                                              ▲
                                    chat box in its own iframe
```

The extension polls the bridge, runs the command against the tab in an isolated
world (so page CSP cannot block it), and posts the result back. A random loopback
token means no web page can drive your browser. Details:
**[docs/HOW-IT-WORKS.md](docs/HOW-IT-WORKS.md)**.

## Requirements

| | |
|---|---|
| **Node 22+** | hard requirement |
| **free-pi** | `npm install -g free-pi-cli@latest` — answers the chat box |
| **Firefox** | any recent version; Developer/Nightly not needed |
| **tmux** *(optional)* | only for `bx chatagent`, the session that answers the box |

## Why the add-on is re-installed at every start

Release Firefox refuses unsigned add-ons, and a temporary add-on disappears when
the browser closes. So `bx-firefox` starts Firefox with `-start-debugger-server`
and installs `dist/firefox-bridge.xpi` over the Remote Debugging Protocol before
the window is usable. `install.sh` wires that into your Firefox icon, and
`bx-watch-firefox` repairs it if Firefox was started some other way.

## Security

- binds `127.0.0.1` only, token-protected, token rotates per bridge run
- pages cannot read the token (no CORS headers on `/pair`)
- `bx type --stdin` keeps secrets out of your shell history
- nothing is uploaded anywhere; the transcript lives in `run/chat.jsonl`
- the two switches let you forbid localhost servers and turn everything off

## License

MIT — see [LICENSE](LICENSE).
