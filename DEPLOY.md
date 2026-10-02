# Déployer Kronova sur kro-nova.com

Même pipeline que Meet 237 : GitHub Actions construit l'image Docker, la pousse sur
Docker Hub, puis la lance par SSH sur le serveur derrière `nginx-proxy` (réseau `proxy-tier`).

## 1. Prérequis (une seule fois)

**Serveur.** Le serveur de Meet 237 convient : `nginx-proxy` y tourne déjà sur le réseau
`proxy-tier`. Kronova y ajoute un seul conteneur, `kronova-app`.

**DNS (chez Amen).** Le domaine pointe aujourd'hui vers la page de parking Amen (81.88.57.68).
Dans la zone DNS de kro-nova.com :

| Type | Nom   | Valeur              |
|------|-------|---------------------|
| A    | `@`   | IP du serveur       |
| A    | `www` | IP du serveur       |

Supprimer les anciens enregistrements A/CNAME de `@` et `www`. Alternative : déléguer le
domaine à Cloudflare comme meet237online.com, pour avoir la même gestion des certificats.

**Certificat HTTPS.** Deux options, selon la configuration de `nginx-proxy` sur le serveur :
- `acme-companion` actif : rien à faire, `LETSENCRYPT_HOST` déclenche l'émission automatique ;
- certificats Cloudflare Origin CA posés à la main (cas actuel de Meet 237) : passer le domaine
  sur Cloudflare, générer un certificat Origin pour `kro-nova.com` et `www.kro-nova.com`, puis
  le déposer dans le volume certs de `nginx-proxy` sous `kro-nova.com.crt` / `kro-nova.com.key`.

**MongoDB Atlas.** Network Access → ajouter l'IP publique du serveur.

## 2. Dépôt GitHub et secrets

Créer le dépôt, pousser le code sur `main`, puis renseigner les secrets dans
Settings → Secrets and variables → Actions :

| Secret                  | Valeur                                                        |
|-------------------------|---------------------------------------------------------------|
| `DOCKER_USERNAME`       | compte Docker Hub (le même que Meet 237)                      |
| `DOCKER_PASSWORD`       | jeton d'accès Docker Hub                                      |
| `SSH_HOST`              | IP du serveur                                                 |
| `SERVER_USER`           | utilisateur SSH                                               |
| `SSH_KEY`               | clé privée SSH (ou `SSH_PASSWORD`)                            |
| `SSH_PORT`              | optionnel, 22 par défaut                                      |
| `ADMIN_EMAIL`           | e-mail de contact Let's Encrypt                               |
| `MONGODB_URI`           | `mongodb+srv://…` (nouveau mot de passe Atlas)                |
| `MONGODB_DB`            | optionnel, `kronova` par défaut                               |
| `GEMINI_API_KEY`        | clé Gemini (régénérée)                                        |
| `SIGNUP_CODE`           | code d'invitation à donner aux collègues (recommandé)         |
| `ALLOWED_EMAIL_DOMAINS` | optionnel, ex. `kamer-center.net`                             |
| `GOOGLE_CLIENT_ID`      | optionnel — ID client OAuth pour Google Agenda / Tasks (voir §5) |

Sans `SIGNUP_CODE` ni `ALLOWED_EMAIL_DOMAINS`, n'importe qui peut créer un compte sur le site
public.

## 3. Déployer

Chaque push sur `main` déploie automatiquement. On peut aussi relancer à la main :
Actions → Deploy Kronova → Run workflow. Le pipeline échoue si `nginx-proxy` est absent ou si
le conteneur n'est pas sain, et termine par un test de `https://kro-nova.com/api/health`.

Les pull requests et la branche `develop` passent par `ci.yml` (type-check + build).

## 4. L'extension navigateur pour les collègues

L'extension est empaquetée à chaque build et téléchargeable sur
`https://kro-nova.com/downloads/kronova-extension.zip`. Le lien figure aussi dans Réglages →
Bouclier. Elle se lie toute seule au compte connecté sur kro-nova.com : aucune configuration.

| Option | Pour qui | Effort |
|---|---|---|
| **Zip + « Charger l'extension non empaquetée »** | test, petite équipe | immédiat ; Chrome affiche un avertissement « mode développeur » |
| **Chrome Web Store, visibilité « Non répertoriée »** | toute l'équipe | compte développeur (5 $ une fois), envoyer le zip, revue de quelques jours ; installation en un clic et mises à jour automatiques |
| **Installation forcée par stratégie (Google Workspace / GPO)** | postes gérés | publier sur le Web Store, puis l'imposer depuis la console d'administration ; les utilisateurs ne peuvent pas la désactiver |

Recommandé : Chrome Web Store en « Non répertoriée », puis partage du lien de la fiche.

## 5. Google Agenda / Google Tasks (optionnel)

1. Google Cloud Console → créer un ID client OAuth de type « Application Web ».
2. Origines JavaScript autorisées : `https://kro-nova.com` et `http://localhost:3000`.
3. Activer **Google Calendar API** et **Google Tasks API**.
4. Écran de consentement : scopes `calendar.events` et `tasks.readonly` ; ajouter les collègues
   comme utilisateurs de test tant que l'application n'est pas validée par Google.
5. Renseigner le secret `GOOGLE_CLIENT_ID`. Sans lui, le panneau du Journal explique la configuration.
