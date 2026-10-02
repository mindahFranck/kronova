# Kronova — le temps, un nouvel élan

Fusion de *chronos* (le temps) et *nova* (un nouvel élan). Déploiement : voir [DEPLOY.md](DEPLOY.md).

Serveur Express + React (Vite), données en direct dans MongoDB Atlas, coach vocal Gemini Live.

## Configuration

1. `npm install`
2. Copier `.env.example` en `.env` et renseigner `MONGODB_URI`, `MONGODB_DB` et `GEMINI_API_KEY`.
   Sur Atlas, l'IP de la machine doit être autorisée (Network Access).

## Lancer

- Développement (HMR) : `npm run dev`
- Production : `npm run build && npm start`

## Démarrage automatique au boot (Linux / systemd)

```bash
npm run service:install     # installe, active et démarre le service utilisateur « kronova »
systemctl --user status kronova
journalctl --user -u kronova -f
npm run service:uninstall   # supprime le service
```

Le service reconstruit le frontend si les sources ont changé, redémarre en cas de crash
et démarre dès le boot (grâce à `loginctl enable-linger`). Il occupe le port 3000 :
arrêtez-le (`systemctl --user stop kronova`) avant `npm run dev`.

## Synchronisation en direct

Une fois connecté, les tâches, le journal et les réglages sont enregistrés dans MongoDB
et poussés en temps réel (change streams + Server-Sent Events sur `/api/user/stream`)
à tous les onglets et appareils ouverts sur le même compte. Hors ligne, les modifications
restent en local et sont renvoyées automatiquement au retour de la connexion.

## Bouclier anti-distraction (blocage réel dans les autres onglets)

Une page web ne peut pas contrôler les autres onglets : le blocage est fait par l'extension
Chrome fournie dans `browser-extension/`. Pendant une session de concentration, elle redirige
vers une page « Site bloqué » tout onglet (nouveau, déjà ouvert ou activé) visant un domaine
de la liste, sous-domaines compris. Le verrou tient jusqu'à la fin prévue de la session, même
si l'onglet Kronova est fermé ou rechargé ; mettre le minuteur en pause le lève.

Installation (une fois) :
1. Ouvrir `chrome://extensions` et activer le **mode développeur**.
2. **Charger l'extension non empaquetée** → choisir le dossier `browser-extension`.
3. (Recommandé) Détails de l'extension → **Autoriser en navigation privée**.

L'application affiche « Extension navigateur : connectée » dans Réglages une fois l'extension active.
