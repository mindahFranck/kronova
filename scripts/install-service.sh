#!/usr/bin/env bash
# Installe Kronova comme service systemd utilisateur, lancé automatiquement au démarrage de la machine.
#   bash scripts/install-service.sh              installe / met à jour et démarre le service
#   bash scripts/install-service.sh --uninstall  arrête et supprime le service
set -euo pipefail

SERVICE=kronova
PROJECT_DIR="$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)"
UNIT_DIR="$HOME/.config/systemd/user"
UNIT_FILE="$UNIT_DIR/$SERVICE.service"

if [[ "${1:-}" == "--uninstall" ]]; then
  systemctl --user disable --now "$SERVICE.service" 2>/dev/null || true
  rm -f "$UNIT_FILE"
  systemctl --user daemon-reload
  echo "Service $SERVICE supprimé."
  exit 0
fi

NODE_BIN_DIR="$(dirname "$(command -v node)")"
if [[ ! -f "$PROJECT_DIR/.env" ]]; then
  echo "Fichier .env manquant : copiez .env.example en .env et renseignez MONGODB_URI." >&2
  exit 1
fi

mkdir -p "$UNIT_DIR"
cat > "$UNIT_FILE" <<EOF
[Unit]
Description=Kronova — le temps, un nouvel élan (MongoDB live + Gemini)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
Environment=CADENCE_NODE_BIN=$NODE_BIN_DIR
ExecStart=/bin/bash "$PROJECT_DIR/scripts/start.sh"
Restart=always
RestartSec=5
TimeoutStartSec=180

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable "$SERVICE.service"
systemctl --user restart "$SERVICE.service"

# Sans « linger », les services utilisateur ne démarrent qu'à l'ouverture de session.
# Avec, ils démarrent dès le boot de la machine.
if [[ "$(loginctl show-user "$USER" -p Linger --value 2>/dev/null)" != "yes" ]]; then
  loginctl enable-linger "$USER" || sudo loginctl enable-linger "$USER"
fi

echo "Service $SERVICE installé et démarré (démarrage automatique au boot activé)."
echo "  Statut : systemctl --user status $SERVICE"
echo "  Logs   : journalctl --user -u $SERVICE -f"
