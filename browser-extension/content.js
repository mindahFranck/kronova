// S'exécute sur les pages Kronova : associe l'extension au compte connecté dans cet onglet.
const TOKEN_KEY = 'cadence_pomodoro_mongo_token_v1';
let lastSent;

function syncSession() {
  let token = null;
  try {
    token = localStorage.getItem(TOKEN_KEY);
  } catch {
    // Stockage indisponible
  }
  if (token === lastSent) return;
  lastSent = token;
  chrome.runtime.sendMessage({ type: 'kronova-session', server: location.origin, token }).catch(() => {});
}

syncSession();
setInterval(syncSession, 3000);
window.addEventListener('storage', syncSession);
