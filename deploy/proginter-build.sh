#!/bin/bash
# Builds the site on the Proginter server into public_html/.app
# (dot folders are not served by nginx, so the source stays private).
# public_html/package.json only runs: cd .app && npm start
# Secrets (DATABASE_URL, ADMIN_SETUP_KEY, RESEND_API_KEY) live in the Node.js
# app's environment variables in the Proginter panel, never in files.
set -e
cd "$HOME"
export PATH="$HOME/.nvm/versions/node/v22.23.3/bin:$PATH"
(cd .src-yk && git fetch -q --depth 1 origin claude/dreamy-hopper-nd6zpn && git reset -q --hard FETCH_HEAD && git log --oneline -1)
mkdir -p .app .yk-storage
rsync -a --delete --exclude node_modules --exclude .next --exclude test .src-yk/web/ .app/
printf '{\n  "name": "yk-runner",\n  "private": true,\n  "scripts": { "start": "cd .app && npm start" }\n}\n' > package.json
cd .app
npm ci --no-audit --no-fund
NOINDEX_ALL=1 NEXT_TELEMETRY_DISABLED=1 npx next build
# Then restart the Node.js app in the panel (the start script runs the DB migration).
