# agentfox on Windows

Everything works on Windows except two conveniences, so here is the honest
version.

## What works

- the bridge, the CLI (`bx`), every page command
- the chat box, maximize / New / History
- the launcher: `bx-firefox.cmd` starts Firefox with `-start-debugger-server 6011`
  and installs the add-on over the debugger port, exactly like on Linux
- `bx-watch-firefox` repairs the add-on if Firefox was started another way

## What does not

| | why | workaround |
|---|---|---|
| `bx chatagent` | it drives a free-pi session inside `tmux`, which Windows does not have | run the bridge inside **WSL** (tmux available) or keep the box as a queue and answer with `bx inbox` / `bx say` |
| desktop-icon override | Windows shortcuts store their target, not a shell command | point your Firefox shortcut at `bx-firefox.cmd` (below) |

## Install

```bat
git clone https://github.com/kyelisz/agentfox
cd agentfox
install.bat
```

It checks Node, installs `ws`, writes the Firefox prefs, builds
`dist\firefox-bridge.xpi`, starts the bridge and creates:

```
bx.cmd            -> node bin\bx %*
bx-firefox.cmd    -> node bin\bx-firefox.mjs %*
```

Add the repo folder to `PATH` (Settings → System → About → Advanced system
settings → Environment Variables → *Path* → New) so `bx` works anywhere.

## Point your Firefox shortcut at the launcher

1. Right-click your Firefox icon → **Properties**
2. replace *Target* with:

   ```
   C:\path\to\agentfox\bx-firefox.cmd
   ```

3. *Start in*: `C:\path\to\agentfox`

Then quit Firefox, start it from that shortcut, give it ~10 s and run:

```bat
bx status
bx read
bx panel on
```

## If the add-on is missing after a restart

Windows closes the debugger port with the browser just like Linux does, so use
the shortcut (which re-installs it). If you started Firefox some other way:

```bat
bx-watch-firefox        REM run once, it repairs the running browser
```

or the manual route:

```bat
bx setup
```

then `about:debugging#/runtime/this-firefox` → *Load Temporary Add-on…* →
`dist\firefox-bridge.xpi`.

## Notes

- The Node process is the bridge, not the agent: leaving it running costs a few
  MB. `bx down` stops it.
- Antivirus sometimes flags a Node process listening on loopback. It only ever
  binds `127.0.0.1`.
- Paths with spaces are fine; the `.cmd` wrappers quote for you.
