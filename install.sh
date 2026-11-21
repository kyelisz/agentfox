#!/usr/bin/env bash
# free-pi browser bridge — one-shot setup for Linux and macOS.
#
#   ./install.sh          # install, wire your Firefox icon, build the add-on
#   ./install.sh --no-icon   # skip the desktop-icon override
#
# It never asks for sudo and never touches another app's files.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"
BIN_DIR="${BX_BIN_DIR:-$HOME/.local/bin}"
NO_ICON=0
[ "${1:-}" = "--no-icon" ] && NO_ICON=1

say() { printf '\n\033[1;33m%s\033[0m\n' "$*"; }
ok()  { printf '  \033[32m✓\033[0m %s\n' "$*"; }
bad() { printf '  \033[31m✗\033[0m %s\n' "$*"; }

say "1/6  checking requirements"
if ! command -v node >/dev/null 2>&1; then
  bad "Node.js is missing — install Node 18+ from https://nodejs.org and run this again"
  exit 1
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 18 ] || { bad "Node $(node -v) is too old — need 18 or newer"; exit 1; }
ok "node $(node -v)"

if ! node -e 'const p=require("./bin/lib/platform"); const f=p.findFirefox(); process.exit(f?0:1)'; then
  bad "Firefox not found — install Firefox, or set BX_FIREFOX_BIN=/path/to/firefox"
  exit 1
fi
ok "firefox: $(node -p 'require("./bin/lib/platform").findFirefox()')"

PROFILE="$(node -p 'require("./bin/lib/platform").findProfile() || ""')"
[ -n "$PROFILE" ] && [ -d "$PROFILE" ] || { bad "no Firefox profile found — start Firefox once, then run this again"; exit 1; }
ok "profile: $PROFILE"

say "2/6  installing the bridge dependencies"
npm install --omit=dev --no-audit --no-fund >/dev/null 2>&1 || npm install --omit=dev
ok "ws installed"

say "3/6  teaching Firefox to open its debugger port"
node bin/bx forever >/dev/null
ok "prefs written to user.js"

say "4/6  building the add-on"
node bridge/make-xpi.js | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log("  \033[32m✓\033[0m "+j.size+" bytes → dist/firefox-bridge.xpi")})'

say "5/6  putting bx on your PATH ($BIN_DIR)"
mkdir -p "$BIN_DIR"
for tool in bx bx-firefox bx-watch-firefox bx-chat-agent; do
  chmod +x "$DIR/bin/$tool" 2>/dev/null || true
  ln -sf "$DIR/bin/$tool" "$BIN_DIR/$tool"
done
ok "bx, bx-firefox, bx-watch-firefox, bx-chat-agent"
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) bad "$BIN_DIR is not on your PATH — add it to your shell profile" ;;
esac

say "6/6  starting the bridge"
node bin/bx up >/dev/null 2>&1 || true
node bin/bx status 2>/dev/null | head -3 || true

if [ "$NO_ICON" -eq 0 ] && [ "$(uname -s)" = "Linux" ]; then
  # point every desktop entry that says Exec=firefox at our launcher
  for entry in /usr/share/applications/firefox.desktop /usr/local/share/applications/firefox.desktop; do
    [ -f "$entry" ] || continue
    dst="$HOME/.local/share/applications/firefox.desktop"
    mkdir -p "$(dirname "$dst")"
    sed "s|^Exec=firefox |Exec=$BIN_DIR/bx-firefox |" "$entry" > "$dst"
    command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$(dirname "$dst")" >/dev/null 2>&1 || true
    ok "Firefox icon now launches through bx-firefox"
    break
  done
fi

say "done — two steps left"
cat <<EOF

  1. Quit Firefox completely, then start it from your normal Firefox icon.
     (Already open? \`bx setup\` opens the two windows you need and copies the xpi path.)

  2. Wait ~7 seconds, then check:
        bx status          → "extension": true
        bx read            → the text of the page in front of you
        bx panel on        → the chat box appears bottom-right

  Want the box to answer on its own?   bx chatagent on
  Something off?                       bx doctor

  Docs: docs/SETUP.md · docs/USAGE.md · docs/TROUBLESHOOTING.md
EOF
