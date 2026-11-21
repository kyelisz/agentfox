# Every command

`bx` talks to the bridge on `127.0.0.1:8788` (start it with `bx up`; most
commands start it for you). Actions apply to the **active tab** unless you pass
`--tab N`, and to the most recently active Firefox if you run several.

```
bx <command> [args] [--flags]
```

## Looking at a page

| command | what it does |
|---|---|
| `bx read` | title, URL, headings, text and every interactive element with a ref (`e1`, `e2`…) |
| `bx read --full` | same without the text cap |
| `bx read --tab 7` | read a different tab by id |
| `bx tabs` | every tab: id, window, title, URL |
| `bx find "text"` | search the page for text/selectors, returns refs and boxes |
| `bx shot [--out file.png]` | screenshot the visible tab |
| `bx eval "expr"` | run JavaScript in the page (isolated world) and get the value |
| `bx wait [--selector css] [--text "…"] [--ms 500]` | wait for something to appear |

## Acting on a page

| command | what it does |
|---|---|
| `bx click "Sign in"` | click by visible text, ref (`e12`), or CSS selector; waits for navigation |
| `bx dblclick …`, `bx hover …` | same targeting rules |
| `bx type "hi"` | type into the focused field, human-ish key events |
| `bx type "…" --into "input[name=q]"` | focus a field first |
| `bx type "…" --into … --enter` | then press Enter |
| `bx type "…" --clear` | clear the field first |
| `bx type --stdin` | read the text from stdin — keeps secrets out of shell history |
| `bx keys "Ctrl+a"` | send a key combination |
| `bx press Enter` | single key |
| `bx select "label" "option"` | choose in a `<select>` |
| `bx check "label" [--off]` | toggle a checkbox/radio |
| `bx scroll down\|up\|<px>` | scroll the page |

## Navigation

```
bx goto https://example.com     bx open https://example.com   (new tab)
bx back   bx forward   bx reload
```

## The chat box

```
bx panel on | off | toggle       show/hide the box (Alt+Shift+B toggles too)
bx inbox [--peek]                what the user typed (marks read unless --peek)
bx watch [--timeout 240]         block until they type, then return the messages
bx say "text" [--tab N | --all]  answer into the box
bx threads                       conversations behind the History button
```

With `alwaysOn` on, the box docks itself into every tab you activate. Closing it
with `×` hides it on that tab only.

In the box: `⤢` maximize, `＋ New` fresh conversation, `History` past
conversations (click one to continue it), `Connect`/`Reconnect` for the local
bridge, `×` hide here. Enter sends, Shift+Enter adds a line.

## Notes the page asked for ("study this")

```
bx notes                          every study run: when, game, folder, files written
bx study <dir> [<snapshot json>]  run the same study from the terminal
```

The `🧠` button in a page posts to `POST /study`; the bridge writes
`notes/*.txt` next to that project. See [STUDY-BUTTON.md](STUDY-BUTTON.md),
and `examples/study-button.html` for the drop-in snippet.

## Settings the user owns

```
bx settings                              {"askLocalhost":true,"alwaysOn":false}
bx settings set askLocalhost on|off      ask before binding any localhost port
bx settings set alwaysOn on|off          autostart + box docking + watcher
```

## The auto-answering session

```
bx chatagent on|off|status|log
```

A second free-pi session in tmux that answers the box on its own. Needs `tmux`.
Without it the box still works — messages queue for your own session.

## The bridge itself

```
bx up        start it (idempotent)
bx down      stop it
bx status    bridge + extension + current tab
bx logs      tail run/server.log
bx doctor    what is broken and how to fix it
```

Advanced: `bx raw <action> '<json>'` sends any bridge action verbatim
(`bx raw options` opens the extension options page, `bx raw reload-ext` reloads
the add-on).

## Installation helpers

```
bx forever    write the debugger prefs, install the launcher, point the icon
bx setup      manual route: about:debugging + dist folder + xpi on clipboard
bx pack       rebuild dist/firefox-bridge.xpi
```

## Environment variables

| variable | meaning |
|---|---|
| `BX_PORT` | bridge port, default `8788` |
| `BX_FIREFOX_BIN` | firefox executable to use |
| `BX_PROFILE` | Firefox profile directory |
| `BX_RDP_PORT` | debugger port used by the launcher, default `6011` |
| `BX_CLIENT` | pin commands to one connected browser (`bx health` lists client ids) |
| `BX_BIN_DIR` | where `install.sh` puts the symlinks (default `~/.local/bin`) |
