# When something is off

Start here:

```bash
bx doctor
```

It checks Node, the Firefox binary, the profile, the debugger prefs, the xpi,
the `ws` module, the bridge, the extension link and tmux — and prints the exact
fix for whatever fails.

---

## `extension: false`

The add-on is not running. In order of likelihood:

**Firefox was started some other way.** Only `bx-firefox` opens the debugger port
needed to install the add-on. Quit Firefox and start it from the normal icon
(the Linux installer points that icon at `bx-firefox`), or from the repo:
`./bin/bx-firefox`.

**The port never opened.** Check:

```bash
ss -ltn | grep 6011          # Linux      (macOS: lsof -iTCP:6011 -sTCP:LISTEN)
tail -5 run/watch.log
tail -20 /tmp/bx-rdp.log
```

No port means the `devtools.chrome.enabled=true` pref is missing (it is written
by `bx forever`) or Firefox was started without `-start-debugger-server`.

**The installer never ran for this profile.** `bx forever` writes to the profile
`profiles.ini` marks as `default-release`. If you use another profile:

```bash
BX_PROFILE=/path/to/profile bx forever
BX_PROFILE=/path/to/profile bx-firefox
```

## Loading the add-on by hand (always works)

```bash
bx setup
```

Firefox opens `about:debugging#/runtime/this-firefox` and the `dist/` folder, and
the xpi path is on your clipboard. *Load Temporary Add-on…* → pick the xpi →
`bx status` flips to `true`. The catch: Firefox drops temporary add-ons when it
closes, so this is a per-session rescue, not a fix.

## `Missing host permission for the tab`

The manifest was loaded as MV3. Firefox does not grant `<all_urls>` at install
time for MV3, so each tab needs a manual toggle. Use the MV2 manifest shipped
here (`extension/manifest.json`); the MV3 version is kept only in
`docs/manifest-mv3.json` for reference.

## `NO_EXTENSION: …`

The bridge has no extension attached. Wait 8 s (a restarted browser has a grace
window) and retry; if it persists, `bx status` and the section above.

## `TIMEOUT: Firefox did not answer "…"`

The tab was busy, navigated mid-command, or the page is a privileged one
(`about:`, `addons.mozilla.org`, `moz-extension:`). `bx tabs` to see where you
really are; extension scripting is simply forbidden on those.

## `call to Function() blocked by CSP`

Something tried to `eval` in the page's main world. This repo always evaluates in
the isolated world for exactly that reason — if you see it, you are calling the
extension with an older `page.js`: `bx pack && bx raw reload-ext`.

## The box does not appear

- `about:` / addons pages: forbidden, expected.
- `bx panel on` says ok but nothing shows: reload the tab (`bx reload`), the
  content script is injected per page load.
- Turned on `alwaysOn` and nothing docks: `bx settings` must show
  `"alwaysOn": true`, and the page must be `http(s)`.
- Old widget without the new buttons: the version marker in
  `#bxchat-host[data-bxver]` forces a rebuild — reload the tab.

## The box queues but nothing answers

That is by design unless the helper session is on:

```bash
bx chatagent on
bx chatagent status     # {"listening":true,...}
bx chatagent log        # tail run/chat-agent.log
```

Needs `tmux`. On Windows use WSL, or keep the box as a queue and answer from your
own free-pi session with `bx inbox` / `bx say "…"`.

## `bx-firefox` starts Firefox but the port stays closed

Some setups (Firefox from a snap, or a profile lock from a still-running
instance) delay startup. The launcher waits 20 s for a shutting-down instance to
release the profile. If you see "profile in use", quit every Firefox window
(`pkill firefox`) and retry. With snap Firefox, `BX_FIREFOX_BIN` should point at
the real `/snap/bin/firefox`.

## Bridge port is taken

```bash
BX_PORT=8799 bx up      # and BX_PORT=8799 for every later command
```

## Everything is broken, start over

```bash
bx chatagent off; bx down
node bin/bx forever && node bridge/make-xpi.js && node bin/bx up
# quit Firefox, start it from the icon, wait 10 s
node bin/bx doctor
```

State lives only in `run/` (token, transcript, logs) — deleting it is safe and
reseeds the chat history empty.
