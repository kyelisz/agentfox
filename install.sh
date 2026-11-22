#!/usr/bin/env bash
# free-pi browser bridge — one-shot setup for Linux and macOS.
#
#   ./install.sh             # install, wire your Firefox icon, build the add-on
#   ./install.sh --no-icon   # skip the desktop-icon override
#
# Needs Node 22+ and Firefox. free-pi is optional but recommended: it is what
# answers the chat box on its own. No sudo, nothing outside your home folder.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"
BIN_DIR="${BX_BIN_DIR:-$HOME/.local/bin}"
NO_ICON=0
[ "${1:-}" = "--no-icon" ] && NO_ICON=1

say() { printf '\n\033[1;33m%s\033[0m\n' "$*"; }
ok()  { printf '  \033[32m✓\033[0m %s\n' "$*"; }
bad() { printf '  \033[31m✗\033[0m %s\n' "$*"; }
tip() { printf '    \033[2m%s\033[0m\n' "$*"; }

say "free-pi browser bridge"
echo "  drive your real Firefox from a terminal agent"

say "1/7  Node 22"
if ! command -v node >/dev/null 2>&1; then
  bad "Node.js is not installed"
  tip "install Node 22 from https://nodejs.org  (or: nvm install 22)"
  exit 1
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 22 ]; then
  bad "Node $(node -v) is too old — this needs Node 22 or newer"
  tip "nvm install 22 && nvm use 22      (or download it from nodejs.org)"
  exit 1
fi
ok "node $(node -v)"

say "2/7  Firefox"
FF="$(node -p 'require("./bin/lib/platform").findFirefox() || ""')"
[ -n "$FF" ] || { bad "Firefox not found"; tip "install Firefox, or set BX_FIREFOX_BIN=/path/to/firefox and run this again"; exit 1; }
ok "firefox: $FF"
PROFILE="$(node -p 'require("./bin/lib/platform").findProfile() || ""')"
[ -n "$PROFILE" ] && [ -d "$PROFILE" ] || { bad "no Firefox profile found"; tip "start Firefox once, close it, then run this again"; exit 1; }
ok "profile: $PROFILE"

say "3/7  free-pi"
if command -v free-pi >/dev/null 2>&1; then
  ok "free-pi: $(command -v free-pi)"
elif npx --yes free-pi-cli@latest --version >/dev/null 2>&1; then
  ok "free-pi: available through npx"
else
  bad "free-pi not found (the box still queues messages, but nothing answers them)"
  tip "npm install -g free-pi-cli@latest     then run ./install.sh again"
fi

say "4/7  bridge dependencies"
npm install --omit=dev --no-audit --no-fund >/dev/null 2>&1 || npm install --omit=dev
ok "ws installed"

say "5/7  Firefox prefs + add-on"
node bin/bx forever >/dev/null
ok "debugger prefs written to user.js"
node bridge/make-xpi.js | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log("  \033[32m✓\033[0m "+j.size+" bytes → dist/firefox-bridge.xpi")})'

say "6/7  commands ($BIN_DIR)"
mkdir -p "$BIN_DIR"
for tool in bx bx-firefox bx-watch-firefox bx-chat-agent; do
  chmod +x "$DIR/bin/$tool" 2>/dev/null || true
  ln -sf "$DIR/bin/$tool" "$BIN_DIR/$tool"
done
ok "bx  ·  bx-firefox  ·  bx-watch-firefox  ·  bx-chat-agent"
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) bad "$BIN_DIR is not on your PATH"
     tip "add:  export PATH=\"$BIN_DIR:\$PATH\"   to your ~/.bashrc or ~/.zshrc" ;;
esac

say "7/7  starting the bridge"
node bin/bx up >/dev/null 2>&1 || true
node bin/bx status 2>/dev/null | head -3 || true

if [ "$NO_ICON" -eq 0 ] && [ "$(uname -s)" = "Linux" ]; then
  for entry in /usr/share/applications/firefox.desktop /usr/local/share/applications/firefox.desktop; do
    [ -f "$entry" ] || continue
    dst="$HOME/.local/share/applications/firefox.desktop"
    mkdir -p "$(dirname "$dst")"
    sed "s|^Exec=firefox |Exec=$BIN_DIR/bx-firefox |" "$entry" > "$dst"
    command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$(dirname "$dst")" >/dev/null 2>&1 || true
    ok "your Firefox icon now installs the add-on at every start"
    break
  done
fi

say "almost done — two steps"
cat <<EOF

  1. Quit Firefox completely, then start it again from the normal Firefox icon.
     Give it ~10 seconds. (Nothing appears — that is the install happening.)

  2. In a terminal:
        bx status      → should say "extension": true
        bx read        → reads the page in front of you
        bx panel on    → the chat box appears bottom-right

  Make the box answer on its own:   bx chatagent on
  Anything broken?                  bx doctor

  Guides: docs/SETUP.md · docs/USAGE.md · docs/TROUBLESHOOTING.md
EOF
