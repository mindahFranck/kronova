// Kronova — bouclier anti-distraction.
// Interroge le serveur Kronova avec le compte de l'utilisateur et, pendant une session de
// concentration, redirige tout onglet (nouveau, déjà ouvert ou activé) visant un site bloqué.

const DEFAULT_SERVER = 'https://kro-nova.com';
const KRONOVA_ORIGINS = ['https://kro-nova.com', 'https://www.kro-nova.com', 'http://localhost:3000'];
const POLL_MS = 5000;

let state = { active: false, domains: [], endsAt: null };
let lastFetchAt = 0;
let restored = false;

async function getSession() {
  const { server, token } = await chrome.storage.local.get(['server', 'token']);
  return { server: server || DEFAULT_SERVER, token: token || null };
}

function isActive() {
  return Boolean(state.active && state.endsAt && state.endsAt > Date.now());
}

function blockedDomainFor(rawUrl) {
  if (!rawUrl) return null;
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  const host = url.hostname.toLowerCase();
  return state.domains.find((d) => host === d || host.endsWith(`.${d}`)) || null;
}

async function restoreState() {
  if (restored) return;
  restored = true;
  const saved = await chrome.storage.session.get('state');
  if (saved.state) state = saved.state;
}

// Règles réseau : bloquent la page avant même son chargement (onglets principaux uniquement,
// pour ne pas casser les lecteurs intégrés comme l'ambiance YouTube de Kronova).
async function syncRules() {
  try {
    const existing = await chrome.declarativeNetRequest.getDynamicRules();
    const addRules = isActive()
      ? state.domains.map((domain, i) => ({
          id: i + 1,
          priority: 1,
          action: {
            type: 'redirect',
            redirect: { extensionPath: `/blocked.html?d=${encodeURIComponent(domain)}` },
          },
          condition: { requestDomains: [domain], resourceTypes: ['main_frame'] },
        }))
      : [];
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: existing.map((r) => r.id),
      addRules,
    });
  } catch (err) {
    // Les écouteurs d'onglets ci-dessous restent actifs même si les règles échouent
    console.warn('Kronova: règles réseau indisponibles', err);
  }
}

function redirectTab(tabId, domain, url) {
  const target = chrome.runtime.getURL(
    `blocked.html?d=${encodeURIComponent(domain)}&u=${encodeURIComponent(url)}`
  );
  chrome.tabs.update(tabId, { url: target }).catch(() => {});
}

async function sweepTabs() {
  if (!isActive()) return;
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    const url = tab.pendingUrl || tab.url;
    const domain = blockedDomainFor(url);
    if (domain) redirectTab(tab.id, domain, url);
  }
}

async function refresh(force = false) {
  await restoreState();
  if (!force && Date.now() - lastFetchAt < 2000) return;
  lastFetchAt = Date.now();
  const before = JSON.stringify([isActive(), state.domains]);
  const { server, token } = await getSession();
  try {
    if (!token) {
      // Aucun compte associé : ouvrez Kronova et connectez-vous pour lier l'extension
      state = { active: false, domains: [], endsAt: null };
    } else {
      const res = await fetch(`${server}/api/blocker/state`, {
        headers: { 'X-Kronova-Client': 'extension', Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      if (res.ok) state = await res.json();
      else if (res.status === 401) state = { active: false, domains: [], endsAt: null };
    }
  } catch {
    // Serveur injoignable : on garde le dernier état connu jusqu'à la fin prévue de la session
  }
  // Un appel d'API extension par cycle garde le service worker actif
  await chrome.storage.session.set({ state });
  if (JSON.stringify([isActive(), state.domains]) !== before) {
    await syncRules();
    await sweepTabs();
  }
}

async function checkTab(tabId, url) {
  await refresh();
  if (!isActive()) return;
  const domain = blockedDomainFor(url);
  if (domain) redirectTab(tabId, domain, url);
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  const url = changeInfo.url || (changeInfo.status === 'loading' ? tab.url : null);
  if (url) checkTab(tabId, url);
});

chrome.tabs.onCreated.addListener((tab) => {
  checkTab(tab.id, tab.pendingUrl || tab.url);
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  chrome.tabs.get(tabId).then((tab) => checkTab(tabId, tab.pendingUrl || tab.url)).catch(() => {});
});

// Le script de contenu des pages Kronova transmet le compte connecté
chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type !== 'kronova-session') return;
  const origin = sender.origin || (sender.url ? new URL(sender.url).origin : '');
  if (!KRONOVA_ORIGINS.includes(origin) || message.server !== origin) return;
  chrome.storage.local.get(['server', 'token']).then(async (current) => {
    // Une déconnexion n'efface la liaison que pour le serveur auquel l'extension est liée
    if (!message.token && current.server && current.server !== origin) return;
    if (current.server === origin && current.token === message.token) return;
    await chrome.storage.local.set({ server: origin, token: message.token || null });
    refresh(true);
  });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'kronova-poll') refresh(true);
});

function boot() {
  chrome.alarms.create('kronova-poll', { periodInMinutes: 0.5 });
  refresh(true).then(syncRules);
}

chrome.runtime.onInstalled.addListener(boot);
chrome.runtime.onStartup.addListener(boot);

setInterval(() => refresh(true), POLL_MS);
refresh(true);
