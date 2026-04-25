#!/usr/bin/env bash
# project-q installer
# Run from the project-q directory: bash install.sh

set -e

CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BOLD='\033[1m'
NC='\033[0m'

PQ_DIR="$(cd "$(dirname "$0")" && pwd)"
BIN="$PQ_DIR/bin/pq.js"

echo ""
echo -e "${CYAN}${BOLD}  project-q installer${NC}"
echo -e "${CYAN}  ────────────────────${NC}"
echo ""

# 1. Make sure pq.js is executable
chmod +x "$BIN"
echo -e "  ${GREEN}✓${NC} bin/pq.js is executable"

# 2. Install dependencies if needed
if [ ! -d "$PQ_DIR/server/node_modules" ]; then
  echo -e "  ${CYAN}▶${NC} Installing server dependencies..."
  cd "$PQ_DIR/server" && npm install --silent
  cd "$PQ_DIR"
  echo -e "  ${GREEN}✓${NC} Server dependencies installed"
else
  echo -e "  ${GREEN}✓${NC} Server dependencies already installed"
fi

# 3. Try symlinking to /usr/local/bin (works without sudo on most Macs)
SYMLINK="/usr/local/bin/pq"

if [ -w "/usr/local/bin" ]; then
  ln -sf "$BIN" "$SYMLINK"
  echo -e "  ${GREEN}✓${NC} Symlinked: pq → $BIN"
  echo ""
  echo -e "  ${GREEN}${BOLD}Done!${NC} You can now run ${CYAN}pq start${NC} from any project directory."
  echo ""
  exit 0
fi

# 4. Try with sudo
echo -e "  ${YELLOW}⚠${NC}  /usr/local/bin is not writable — trying with sudo..."
if sudo ln -sf "$BIN" "$SYMLINK" 2>/dev/null; then
  echo -e "  ${GREEN}✓${NC} Symlinked with sudo: pq → $BIN"
  echo ""
  echo -e "  ${GREEN}${BOLD}Done!${NC} You can now run ${CYAN}pq start${NC} from any project directory."
  echo ""
  exit 0
fi

# 5. Fall back: add alias to shell config
echo -e "  ${YELLOW}⚠${NC}  Could not write to /usr/local/bin. Adding shell alias instead..."
echo ""

ALIAS_LINE="alias pq=\"node $BIN\""

# Detect shell config file
if [ -f "$HOME/.zshrc" ]; then
  SHELL_RC="$HOME/.zshrc"
elif [ -f "$HOME/.bashrc" ]; then
  SHELL_RC="$HOME/.bashrc"
elif [ -f "$HOME/.bash_profile" ]; then
  SHELL_RC="$HOME/.bash_profile"
else
  SHELL_RC="$HOME/.zshrc"
  touch "$SHELL_RC"
fi

# Don't add duplicate
if grep -q "alias pq=" "$SHELL_RC" 2>/dev/null; then
  # Update the existing alias
  if [[ "$OSTYPE" == "darwin"* ]]; then
    sed -i '' "s|alias pq=.*|$ALIAS_LINE|" "$SHELL_RC"
  else
    sed -i "s|alias pq=.*|$ALIAS_LINE|" "$SHELL_RC"
  fi
  echo -e "  ${GREEN}✓${NC} Updated existing alias in $SHELL_RC"
else
  echo "" >> "$SHELL_RC"
  echo "# project-q — AI dev workflow agent" >> "$SHELL_RC"
  echo "$ALIAS_LINE" >> "$SHELL_RC"
  echo -e "  ${GREEN}✓${NC} Added alias to $SHELL_RC"
fi

echo ""
echo -e "  ${GREEN}${BOLD}Done!${NC} Reload your shell, then use ${CYAN}pq start${NC} from any project:"
echo ""
echo -e "    ${CYAN}source $SHELL_RC${NC}"
echo -e "    ${CYAN}cd ~/your-project && pq start${NC}"
echo ""
