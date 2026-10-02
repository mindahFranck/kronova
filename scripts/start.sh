#!/usr/bin/env bash
# Lance Kronova en production (utilisé par le service systemd au démarrage de la machine).
set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")/.."

# nvm n'est pas chargé par systemd : on ajoute le dossier du binaire node détecté à l'installation
if [[ -n "${CADENCE_NODE_BIN:-}" ]]; then
  export PATH="$CADENCE_NODE_BIN:$PATH"
fi

# Reconstruit le frontend si les sources sont plus récentes que le build
if [[ ! -f dist/index.html ]] || [[ -n "$(find src index.html vite.config.ts browser-extension -newer dist/index.html -print -quit)" ]]; then
  echo "Construction du frontend…"
  npm run build
fi

exec npm start
