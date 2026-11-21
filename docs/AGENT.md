---
name: firefox-bridge
description: Drive the user's real Firefox from the terminal. Use whenever a task means looking at, reading, filling in, clicking through or debugging a website — logins, sign-up flows, forms, dashboards, docs, checking what a page actually renders, taking screenshots, or testing a local dev server in the browser. Works through a private local-only extension plus the `bx` CLI; no cloud, no Playwright, no separate browser profile.
---

# firefox-bridge — the user's browser, from your shell

The user has Firefox open with their own logins, tabs and cookies. `bx` lets you
read the page they see and act on it. Everything is local: `bx` talks to a bridge
on `127.0.0.1:8788`, the extension long-polls that bridge.

Install once (`bash ~/.agents/skills/firefox-bridge/install.sh`), then:

```bash
bx status                   # bridge + extension + the tab you are looking at
bx goto https://site.tld    # navigate the active tab (or: bx open <url> new tab)
bx read                     # page digest: visible text + interactive elements with refs
bx click e12                # click by ref (also accepts CSS or visible text)
bx type "hello" --into e4 --enter
bx shot                     # screenshot of the visible tab -> .pi-browser/*.png
```

## The loop you should actually follow

1. `bx status` — if it says the extension is not connected, print the three
   instructions it prints and stop (the user has to click "Load Temporary
   Add-on"). Do not fake progress.
2. `bx read` — this is your eyes. You get `url`, `title`, a trimmed `text`,
   `headings`, and `elements[]` with `ref`, `tag`, `text`, `box`, `value`,
   `checked`, `href`, plus `forms[]` with their fields.
3. Act with refs: `bx click e7`, `bx type "user@x" --into e3`, `bx press Enter`,
   `bx scroll --by 800`, `bx select e9 "Germany"`, `bx check e11`.
   `bx click` waits for a link/form and answers with `navigated`, the landing
   `url`, `title` and `status` — that is usually enough to know it worked.
4. Re-`read` after anything that changes the DOM. **Refs belong to the page you
   read** — after a navigation they are gone; just read again.
5. Confirm what the user will see: `bx shot` saves a PNG, then look at it with
   `look_at_image` (or `read(path=…)`). Say what the screenshot showed.
6. When something is genuinely the user's call (a password, 2FA code, a captcha,
   a "confirm purchase"), stop and ask — never guess those.

## Commands

```
bx status | tabs | up | down | logs | pack
bx goto <url> | open <url> | back | forward | reload
bx read [--full]            # digest (default caps: 5k text, 120 elements)
bx find <text>              # refs of elements whose text matches
bx click <ref|css|text> [--index N]      bx dblclick | bx hover
bx type <text> [--into <ref|css>] [--enter] [--clear] [--stdin]
bx keys "abc"               # char-by-char typing, for picky React inputs
bx press "Enter" | "Escape" | "Control+a"
bx select <ref|css> <value>             bx check <ref|css> [--off]
bx scroll [--by 700 | --to bottom | --into <ref>]
bx shot [--out file.png]
bx eval "<js>"              # value back as JSON (runs in the page, isolated world)
bx wait [--ms 500] [--selector ".toast"] [--text "Signed in"] [--timeout 10000]
bx raw <action> '<json>'    # any bridge action directly
bx panel on|off|toggle    bx inbox    bx watch    bx say "text"
```

Pinning a browser: with two Firefox instances (e.g. your real one plus a test
one) the bridge talks to the most recently active; `bx --client <cid>` pins a
specific one, `bx status`/`curl /health` lists the `cid`s.

All commands print JSON. Errors are one line: `bx: <reason>`.

## The two switches the user owns (options page)

`about:addons` → Firefox Bridge → Options, or `bx settings` in the terminal. They
live in `run/settings.json` on the bridge, so the agent can read them before it
acts — that is the whole point: they are rules, not decoration.

```bash
bx settings                                  # {"askLocalhost":true,"alwaysOn":true}
bx settings set askLocalhost on|off
bx settings set alwaysOn on|off
```

`askLocalhost` (default **on**) — before you bind any port on the machine
(`python -m http.server`, `vite`, `npm run dev`, `node server.js`, `docker -p`,
`flask run`, anything that ends up listening), read the switch and, when it is
on, **ask the user in the chat box and wait for a yes**. No exceptions for
"just a quick preview". When they say yes, build it; when they say nothing, do
not open the port. Turning it off is their call, never yours.

`alwaysOn` also **docks the chat box**: it mounts itself in whatever tab you
activate (new tabs and reloads included), so it no longer disappears when you
switch tabs. Closing it with × on a tab hides it in that tab only, until the tab
is closed; `bx panel on` or Alt+Shift+B brings it back there.

`alwaysOn` (default **off**) — when on, the bridge and the chat agent come up
with the desktop (`~/.config/autostart/free-pi-bridge.desktop` and
`free-pi-chat-agent.desktop`), the Firefox launcher re-installs the add-on at
every start, and the widget reconnects on its own. The agent can then act in
any Firefox window and any tab, at any time, with no reconnect step. It does
not touch other browsers: Chrome/Chromium are not supported by the bridge.

## The box itself: white/gold, maximize, new chat, history

The widget is a small docked panel styled white-and-gold (`extension/chat.css`,
scoped under `#bxchat-host`, injected with `scripting.insertCSS` so page CSP
cannot touch it). Header, left to right: status dot, title, status text, then
`⤢` maximize (78vw × 82vh, remembered in `browser.storage`), `＋ New`,
`History`, `Connect`/`Reconnect`, `×`.

Conversations are **threads** on the bridge, not in the tab:

- `POST /chat/new` → new thread id, becomes current for every tab
- `POST /chat/select {thread}` → switch the current thread
- `GET /chat/threads` → `[{id, title, count, lastTs, lastText}]`, newest first
- `GET /chat/history?thread=` → that thread's messages
- agent replies without an explicit thread land in the thread of the most recent
  user message, so an answer can never appear in a different conversation

```bash
bx threads      # the same list the History button shows
```

## A second free-pi session that answers the box on its own

Nothing wakes the main session while it is idle, so the box also has a dedicated
responder: its own `free-pi-cli` running inside tmux, its own tiny context, its
own model — started with the browser, independent of your coding session.

```bash
bx chatagent on | off | status | log      # or: bx-chat-agent start|stop|status
```

How it works (and why it is built this way):

1. `bx-chat-agent.mjs start` opens `tmux new-session -d -s bxchat` running
   `npx free-pi-cli@latest --new` in `/tmp/bxchat` — a neutral cwd, so no project
   AGENTS.md and no presence gate.
2. The listener blocks on `bx watch --timeout 600`. On a message it writes
   `/tmp/bxchat/request.txt` and types a short brief into the tmux session.
3. The session is told to answer in one or two sentences, use at most one `bx`
   command, and write the answer into `/tmp/bxchat/reply.txt`. The listener polls
   that file (no TUI scraping — the pane is unreadable), then `bx say --tab N`.
4. Reply latency measured: 5–12s warm, ~90s for the first message while the
   session is still starting.
5. `bx-firefox` starts it automatically when Firefox launches if it is not up.
6. Log: `run/chat-agent.log` (message ids included, so a message is never
   answered twice — the bridge marks a message read the moment it hands it to a
   waiter).

Cost: it is a real second session, so it spends the same daily allowance. Turn it
off with `bx chatagent off` when you do not need instant answers.

## Staying installed across Firefox restarts ("forever mode")

Release Firefox will not keep an unsigned add-on, and a temporary add-on dies
when the browser closes. The fix is not signing — it is installing it over the
Remote Debugging Protocol at every start:

```bash
bx forever        # prefs + ~/.local/bin/bx-firefox + Firefox icon override
bx-firefox        # start Firefox: add-on is installed ~7s into startup
```

What it does, and why each piece is needed:

1. `<profile>/user.js` gets `devtools.debugger.remote-enabled`,
   `devtools.debugger.prompt-connection=false` and **`devtools.chrome.enabled=true`**
   — without the last one a release build silently refuses to open the debugger
   port, even though `-start-debugger-server` is passed.
2. `bx-firefox` starts `firefox -foreground -no-remote -start-debugger-server 6011`.
   `-foreground` matters: otherwise Firefox re-execs and drops the flag.
3. `bridge/rdp-install.js` speaks the debugger protocol (length-prefixed JSON on
   the TCP port) and calls `addons.installTemporaryAddon` with the XPI's
   **absolute** path. It retries for up to 60s because the port opens late.
4. `~/.local/share/applications/firefox.desktop` is a copy of the system entry
   with `Exec=` pointing at the launcher, so the normal Firefox icon does it.

Manual fallback if anything is off: quit Firefox, `bx setup`, and pick
`dist/firefox-bridge.xpi` in `about:debugging`.
Diagnosing a dead port: `ss -ltn | grep 6011`, `/tmp/bx-rdp.log`, and
`bx status` (it shows `extension: false` when nobody is polling).

## The chat box in the page (the user types straight to you)

The extension can drop a small "free-pi" box into any tab — a textbox the user
can type into without leaving the browser. It is per-tab and per-tab only:
no box on a tab means nothing is listening there.

```bash
bx panel on | off | toggle     # show/hide in the active tab (Alt+Shift+B toggles too)
bx inbox [--peek]              # what the user typed (marks read unless --peek)
bx watch --timeout 240         # block until the user types something, then return it
bx say "text" [--tab N | --all]  # reply into their box
```

**Rule:** at the start of every turn, run `bx inbox` once. The user types in the
box while you are idle, and nothing wakes you — so anything they wrote lands in
the queue and is silently ignored unless you look. The box says
"queued — the agent reads this on its next turn in the terminal" for exactly
that reason; it is a mailbox, not a live wire.

How to actually use it in a turn:

1. If the task needs small decisions while you work ("which account?", "this
   the right page?"), say so in your reply **and** offer the box:
   `bx panel on`, then tell them they can type in it.
2. Next turn (or while still working) call `bx watch` — if they typed, you get
   their text with the tab id/title; reply with `bx say`.
3. `bx say` without `--tab` answers in the tab of their last message.
4. The box polls every 2s, so a reply lands almost immediately. It shows
   "connected"/"offline" — offline means the bridge is down (`bx up`).
5. The transcript is not per tab even though the box is: on mount the widget
   seeds itself from `GET /chat/history` (bridge-side, replayed from
   `run/chat.jsonl` at startup), so every new tab — and the bridge after a
   restart — shows the conversation so far, then continues from there.
6. It is page DOM, restyled by `extension/chat.css` via `scripting.insertCSS`,
   so site CSP cannot hide or break it. It survives navigation? No — a new page
   load drops it; re-run `bx panel on` (or Alt+Shift+B).
6. Nothing in the box is a shell: it is a text feed, safe to render as text
   (the widget uses `textContent`).

## Login and sign-up flows

```bash
bx goto https://app.example.com
bx read                                  # find the email/password refs
bx type "me@example.com" --into e1
bx type --stdin --into e2 <<< "$PASSWORD"   # keeps the secret out of argv
bx press Enter
bx wait --selector ".dashboard" --timeout 15000 || bx shot
```

- Prefer `--into <css>` when the field is obvious (`input[type=password]`,
  `input[name=q]`); it survives re-reads.
- `bx type` sets the value and fires `input`/`change`; if a framework ignores it,
  use `bx keys "text"` (real per-character key events) or click the field first.
- Checkbox/radio: `bx check e5` flips it only when needed.
- Password managers can autofill and overwrite what you typed — if the value
  looks wrong, re-`read` the field before submitting.
- Firefox refuses extension script on `about:` pages, `addons.mozilla.org` and
  PDFs. `bx read` will say so; use `bx shot` there instead.

## Reading a page properly

- `bx read` gives text + controls. For specifics: `bx eval "document.title"`,
  `bx eval "[...document.querySelectorAll('table tr')].length"`, or
  `bx eval "document.querySelector('main').innerText.slice(0,3000)"`.
- `bx shot` is the ground truth for layout, CSS, and "is it actually rendering".
  Screenshots need the browser window focused; `bx` focuses it for you, which
  may pull Firefox in front of the terminal for a moment.
- Scroll before screenshotting if the thing you care about is below the fold, or
  `bx scroll --into e20`.

## How it is wired (only if something breaks)

- `bx up` starts `bridge/server.js` detached on `127.0.0.1:8788`, log in
  `~/.agents/skills/firefox-bridge/run/server.log`, token in `run/token`.
- Extension dials out to the bridge (no inbound port, no listening socket in
  Firefox) using long-poll: `GET /poll` held ~20s, results `POST /reply`.
- The browser side must present the loopback token, which it gets from `/pair`.
  A web page cannot read `/pair` (no CORS headers) so random sites cannot drive
  the browser even though they can reach `127.0.0.1`.
- `bx logs` shows both sides: `diag boot/connected/paired/error` lines come from
  the extension itself.
- Toolbar popup = live connection status. Options = port, read-only mode,
  click highlight.
- Temporary add-on disappears when Firefox restarts: reload it from
  `about:debugging#/runtime/this-firefox` (Load Temporary Add-on →
  `~/.agents/skills/firefox-bridge/extension/manifest.json`). For a permanent
  install see SKILL-INSTALL in `install.sh` output (`bx pack` builds the XPI).
- The manifest is MV2 on purpose: Firefox MV3 does not grant `<all_urls>` host
  permissions at install, so scripting every tab needs a manual toggle.
  `extension-manifest-mv3.json` is kept for the future; see that file's header.
- Multiple Firefox windows/tabs: commands act on the active tab of the most
  recently focused window. `bx tabs` lists ids; `bx raw activate '{"tabId":7}'`
  switches, and `--tab <id>` works on `bx read`.

## Safety

- Never print the token, cookies, or page passwords. `bx type` reports only the
  number of characters typed.
- Read-only mode (extension Options) blocks click/type/eval — respect it.
- Anything irreversible on a page (payments, deletes, sending mail) gets an
  explicit yes from the user first.
- `.pi-browser/` holds screenshots; they are local, but they may contain the
  user's private data. Do not paste them into other tools or share them.
