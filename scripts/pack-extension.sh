#!/usr/bin/env bash
# Empaquette l'extension navigateur en zip téléchargeable depuis l'application (/downloads/).
set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")/.."
mkdir -p public/downloads
rm -f public/downloads/kronova-extension.zip
(cd browser-extension && zip -qr ../public/downloads/kronova-extension.zip . -x '.*')
echo "Extension empaquetée : public/downloads/kronova-extension.zip"
