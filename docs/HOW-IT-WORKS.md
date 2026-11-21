# How it works

```
┌──────────────┐   bx CLI    ┌────────────────────┐   long-poll   ┌──────────────────┐
│ pi / free-pi │ ──────────▶ │ bridge             │ ◀──────────── │ Firefox          │
│ agent        │  HTTP+token │ 127.0.0.1:8788     │   /poll       │  extension       │
└──────────────┘             │                    │ ────────────▶ │  (background)    │
                             │  queue, queue      │   /reply      └────────┬─────────┘
                             │  chat threads      │                        │ scripting
                             └─────────▲──────────┘                        ▼
                                       │                            ┌──────────────┐
                                  the chat box in the page  ◀──────│ the web page │
                                       (fetch /chat/*)              └──────────────┘
```

## The three pieces

**1. The extension** (`extension/`) is a Manifest V2 add-on with `<all_urls>`.
MV2 on purpose: MV3 host permissions are *not* granted at install time in
Firefox, so every tab would answer `Missing host permission for the tab`.

It holds two long-poll requests to the bridge at all times. A command arrives as
JSON, the background picks the target tab (`tabId` or the active one), injects
`page.js` into that tab's **isolated world** via `browser.scripting.executeScript`,
and posts the result back. Isolated world matters: a page's CSP can block
`new Function()` in the MAIN world, and then `eval`-style probes die.

**2. The bridge** (`bridge/server.js`) is a small Node HTTP server on loopback.
It keeps a command queue with a short grace window, so a command issued between
two polls is not lost; it holds `/poll` requests open for up to 20 s; and it
serves the chat endpoints. State lives in `run/`: the pairing token and
`chat.jsonl` (the transcript, replayed at startup).

**3. The CLI** (`bin/bx`) is the agent's hand. Every verb maps to one bridge
action, so the same surface works from a shell, from a script, or from the
agent's bash tool.

## Pairing without a login

`GET /pair` hands the loopback token to whoever asks. That sounds sloppy, so:

- the token is random per bridge run, stored `0600` in `run/token`
- `/pair` never sends CORS headers, so a web page cannot *read* the response —
  only an extension (whose fetches bypass CORS) can
- every other endpoint requires the token in `x-bx-token` or `?token=`
- the server binds `127.0.0.1` and refuses non-loopback origins

## Installing without a signature

Release Firefox refuses unsigned add-ons, and a temporary add-on dies with the
browser. Neither can be worked around from inside the extension, so the
installer goes around it:

1. `user.js` gets `devtools.debugger.remote-enabled=true`,
   `devtools.debugger.prompt-connection=false` and — the one that costs an hour
   to discover — **`devtools.chrome.enabled=true`**. Without the third, a release
   build silently refuses to bind the debugger port.
2. `bx-firefox` starts `firefox -foreground -no-remote -start-debugger-server 6011`.
   `-foreground` matters: otherwise Firefox re-execs into the background and
   drops the flag, leaving no port and no way to install.
3. `bridge/rdp-install.js` speaks Firefox's Remote Debugging Protocol — JSON
   frames prefixed with `<byteLength>:` over TCP — and calls
   `addons.installTemporaryAddon` with the **absolute** path of the xpi. It retries
   for up to 90 s because the port opens late in startup.
4. `bx-watch-firefox` repeats step 3 whenever it sees the port without the
   extension, and notifies you when Firefox was started some other way (no port
   means nothing can be installed in place).

## Chat threads

The box is per tab, the transcript is not. Every message carries a `thread`:
`POST /chat/new` mints one, `POST /chat/select` switches the current one,
`GET /chat/threads` feeds the History list, `GET /chat/history?thread=` seeds a
newly mounted box. An agent reply without an explicit thread lands in the thread
of the most recent user message, so an answer can never appear in another
conversation.

## `/study`: the page as a client

One route on the bridge deliberately works without the token, because a `file://`
page can never know it: `POST /study { game, dir, snapshot }`. It is safe by
geometry rather than by secret — loopback caller only, origin must be `null` or a
loopback dev server (so a website cannot use it), `dir` must be an existing
absolute folder under `$HOME` with no `..`, body capped at 256 KB, fixed note
filenames. In return the page gets the list of notes that were written, so the
button can show real results instead of pretending. The generator
(`bridge/study.js`) is plain text arithmetic on the snapshot — no model needed —
and the chat agent gets a message about it so it can add prose.

## The self-answering session

`bx chatagent on` starts `free-pi-cli` inside `tmux -d -s bxchat`, in `/tmp/bxchat`.
The listener blocks on `bx watch`, writes the message to `request.txt`, types a
short brief into the session, and the session writes its answer to `reply.txt`.
Polling a file beats scraping the TUI, and tmux gives the session a real
terminal without a window. It is a normal free-pi session: same login, same
allowance, own small context (which is why it answers in seconds while a
long coding session crawls).

## What the browser can and cannot do

- **Can** script normal `http(s)` tabs in any window, read and write the DOM,
  click anything, fill logins, screenshot the visible tab.
- **Cannot** script `about:` pages, `addons.mozilla.org`, PDF viewers, or
  `moz-extension://` pages — Firefox blocks extension scripting there, and the
  CLI says so instead of failing silently.
- **Cannot** drive Chrome/Chromium/Safari. This is a Firefox extension.
