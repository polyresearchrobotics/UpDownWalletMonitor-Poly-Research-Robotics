#!/bin/bash
# Double-click this file in Finder to start Wallet Tracker.
# It will install dependencies on first run, build the app, and open it
# in your browser at http://localhost:3030. Close this terminal window
# to stop the server.

set -e

# Always run from the directory that contains this script, regardless
# of where it was double-clicked from.
cd "$(dirname "$0")"

# Use a login shell so PATH picks up Homebrew / nvm-installed node.
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required but was not found on PATH."
  echo "Install it from https://nodejs.org (LTS is fine), then re-open this file."
  read -n 1 -s -r -p "Press any key to close…"
  exit 1
fi

npm run launch
