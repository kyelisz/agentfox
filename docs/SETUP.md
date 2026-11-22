# agentfox — setup, step by step

Two minutes on Linux/macOS, three on Windows. Nothing here needs `sudo`.

---

## 0. What you need

| | why |
|---|---|
| **Firefox**, any recent version | Developer Edition / Nightly are *not* required |
| **Node.js 22+** | runs the bridge, the CLI and the launcher |
| **free-pi** (`npm install -g free-pi-cli@latest`) | the agent; it is what answers the chat box |
| **tmux** *(optional)* | only for `bx chatagent`, the session that answers the chat box by itself |
| **git** | to clone the repo (you can also download a zip) |

Check quickly:

```bash
node -v                    # v22 or higher
free-pi --version          # if this fails: npm install -g free-pi-cli@latest
tmux -V                    # optional, only for bx chatagent
```

---

## 1. Install (Linux / macOS)

```bash
git clone https://github.com/kyelisz/agentfox
cd agentfox
./install.sh
```

What the script does, in order:

1. checks Node 22, free-pi and your Firefox + profile
2. `npm install` (one dependency: `ws`)
3. writes three prefs into `<profile>/user.js` — this is what lets Firefox open
   its debugger port at startup
4. builds `dist/firefox-bridge.xpi` (pure Node, no `zip` needed)
5. symlinks `bx`, `bx-firefox`, `bx-watch-firefox`, `bx-chat-agent` into
   `~/.local/bin`
6. starts the bridge and, on Linux, points your Firefox desktop icon at
   `bx-firefox`

Skip the icon step with `./install.sh --no-icon`.

## 2. Install (Windows)

```bat
git clone https://github.com/kyelisz/agentfox
cd agentfox
install.bat
```

It writes the prefs, builds the add-on, starts the bridge and creates
`bx.cmd` / `bx-firefox.cmd` in the repo folder. See **[WINDOWS.md](WINDOWS.md)**
for the differences (no tmux, shortcut instead of icon override).

## 3. Restart Firefox the right way

**Quit Firefox completely, then start it from your normal Firefox icon.**

The launcher starts Firefox with its debugger port open, waits for that port
(usually 2–10 s), and installs the add-on over it. You see nothing happen —
that is the point.

Already had Firefox open? Either quit it and use the icon again, or do the
manual route once:

```bash
bx setup      # opens about:debugging + the dist folder, copies the xpi path
```

then in Firefox: **about:debugging#/runtime/this-firefox** → *Load Temporary
Add-on…* → pick `dist/firefox-bridge.xpi`.

## 4. Check that it worked

```bash
bx status
```

```json
{ "bridge": "http://127.0.0.1:8788", "extension": true, ... }
```

`extension: true` means Firefox is talking to the bridge. If it says `false`,
`bx doctor` tells you exactly which link is broken.

Then try it on a normal page (not `about:`, not addons.mozilla.org — Firefox
forbids extensions there):

```bash
bx read              # the text of the page
bx find "login"      # where things are
bx click "Sign in"   # click by visible text
bx type "hello" --into "input[name=q]" --enter
bx panel on          # the chat box
```

## 5. Make the box answer on its own (optional)

Without this, messages you type in the box wait until you next write in the
terminal.

```bash
bx chatagent on
```

That starts a second free-pi session in tmux whose only job is the box. First
answer after a cold start takes ~30–90 s while it boots; after that, 5–12 s.

## 6. Turn on "always on"

Options page: `about:addons` → **Firefox Bridge** → **Options**, or:

```bash
bx settings set alwaysOn on
bx settings set askLocalhost on     # default: ask before any localhost server
```

`alwaysOn` gives you: autostart entries for the bridge, the chat agent and a
watcher; the chat box docking itself into whatever tab you activate; and the
watcher repairing the add-on if Firefox was started some other way.

---

## Uninstall

```bash
bx chatagent off
bx down
rm -f ~/.local/bin/bx ~/.local/bin/bx-firefox ~/.local/bin/bx-watch-firefox ~/.local/bin/bx-chat-agent
rm -f ~/.config/autostart/free-pi-*.desktop
rm -rf ~/agentfox
```

Then remove the three `user_pref("devtools…")` lines from `<profile>/user.js`
and remove `~/.local/share/applications/firefox.desktop` (Linux) if you added it.
The add-on itself is not persisted by Firefox, so it disappears on the next
restart anyway.
