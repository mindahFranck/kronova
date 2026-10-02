const DEFAULT_SERVER = 'https://kro-nova.com';
const params = new URLSearchParams(location.search);
const domain = params.get('d') || '';
const originalUrl = params.get('u') || (domain ? `https://${domain}` : '');

const $ = (id) => document.getElementById(id);
$('domain').textContent = domain ? `${domain} est verrouillé par Kronova.` : '';

async function getSession() {
  const { server, token } = await chrome.storage.local.get(['server', 'token']);
  return { server: server || DEFAULT_SERVER, token: token || null };
}

function format(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

let endsAt = null;

function render() {
  const left = endsAt ? endsAt - Date.now() : 0;
  if (left > 0) {
    $('remaining').textContent = format(left);
    return;
  }
  $('title').textContent = 'Session terminée';
  $('remaining').textContent = '00:00';
  $('hint').textContent = 'Le site est de nouveau accessible.';
  if (originalUrl) {
    $('continue').href = originalUrl;
    $('continue').hidden = false;
  }
}

async function loadState() {
  try {
    const { server, token } = await getSession();
    const res = await fetch(`${server}/api/blocker/state`, {
      headers: { 'X-Kronova-Client': 'extension', Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    const state = await res.json();
    endsAt = state.active ? state.endsAt : null;
  } catch {
    const { state } = await chrome.storage.session.get('state');
    endsAt = state?.active ? state.endsAt : null;
  }
  render();
}

// Comptabilise la tentative dans Kronova (compteur de distractions du compte)
getSession().then(({ server, token }) =>
  fetch(`${server}/api/blocker/attempt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ domain }),
  }).catch(() => {})
);

$('back').addEventListener('click', async () => {
  const { server } = await getSession();
  const tabs = await chrome.tabs.query({ url: `${server}/*` });
  if (tabs.length > 0) {
    await chrome.tabs.update(tabs[0].id, { active: true });
    await chrome.windows.update(tabs[0].windowId, { focused: true });
    const current = await chrome.tabs.getCurrent();
    if (current) chrome.tabs.remove(current.id);
  } else {
    location.href = server;
  }
});

loadState();
setInterval(render, 1000);
setInterval(loadState, 10000);
