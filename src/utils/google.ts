/**
 * Intégration Google Agenda / Google Tasks côté navigateur.
 *
 * Authentification via Google Identity Services (token client OAuth 2) :
 * aucun secret serveur, le jeton d'accès reste uniquement en mémoire.
 */
import { SessionRecord, TimerPhase } from '../types';

export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/tasks.readonly',
];

const GSI_SRC = 'https://accounts.google.com/gsi/client';
const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
const TASKS_API = 'https://tasks.googleapis.com/tasks/v1';
const KRONOVA_APP_TAG = 'kronova';
const MAX_IMPORTED_TASKS = 100;

/* ------------------------------------------------------------------ */
/* Types minimaux de Google Identity Services                          */
/* ------------------------------------------------------------------ */

interface GsiTokenResponse {
  access_token?: string;
  expires_in?: number | string;
  scope?: string;
  error?: string;
  error_description?: string;
}

interface GsiClientConfigError {
  type?: 'popup_failed_to_open' | 'popup_closed' | 'unknown' | string;
  message?: string;
}

interface GsiTokenClient {
  requestAccessToken: (overrides?: { prompt?: string; scope?: string }) => void;
}

interface GsiOAuth2 {
  initTokenClient: (config: {
    client_id: string;
    scope: string;
    prompt?: string;
    include_granted_scopes?: boolean;
    callback: (response: GsiTokenResponse) => void;
    error_callback?: (error: GsiClientConfigError) => void;
  }) => GsiTokenClient;
  hasGrantedAllScopes: (response: GsiTokenResponse, ...scopes: string[]) => boolean;
  revoke: (accessToken: string, done?: () => void) => void;
}

declare global {
  interface Window {
    google?: { accounts?: { oauth2?: GsiOAuth2 } };
  }
}

/* ------------------------------------------------------------------ */
/* Erreurs                                                             */
/* ------------------------------------------------------------------ */

export type GoogleErrorCode =
  | 'script_load_failed'
  | 'popup_blocked'
  | 'popup_closed'
  | 'access_denied'
  | 'scopes_missing'
  | 'unauthorized'
  | 'api_disabled'
  | 'forbidden'
  | 'rate_limited'
  | 'network'
  | 'unknown';

export class GoogleSyncError extends Error {
  readonly code: GoogleErrorCode;
  readonly status?: number;

  constructor(code: GoogleErrorCode, message: string, status?: number) {
    super(message);
    this.name = 'GoogleSyncError';
    this.code = code;
    this.status = status;
  }
}

/** Indique si l'erreur nécessite de redemander un jeton à l'utilisateur. */
export const needsReauth = (error: unknown): boolean =>
  error instanceof GoogleSyncError &&
  (error.code === 'unauthorized' || error.code === 'scopes_missing');

/* ------------------------------------------------------------------ */
/* Chargement du script GSI (paresseux, unique)                        */
/* ------------------------------------------------------------------ */

let gsiPromise: Promise<GsiOAuth2> | null = null;

export function loadGoogleIdentityScript(): Promise<GsiOAuth2> {
  if (typeof window === 'undefined') {
    return Promise.reject(new GoogleSyncError('script_load_failed', 'Environnement navigateur requis.'));
  }
  const ready = window.google?.accounts?.oauth2;
  if (ready) return Promise.resolve(ready);
  if (gsiPromise) return gsiPromise;

  gsiPromise = new Promise<GsiOAuth2>((resolve, reject) => {
    const fail = () => {
      gsiPromise = null;
      reject(
        new GoogleSyncError(
          'script_load_failed',
          'Impossible de charger Google Identity Services (connexion réseau ou bloqueur de contenu ?).'
        )
      );
    };
    const done = () => {
      const oauth2 = window.google?.accounts?.oauth2;
      if (oauth2) resolve(oauth2);
      else fail();
    };

    let script = document.querySelector<HTMLScriptElement>(`script[src="${GSI_SRC}"]`);
    if (!script) {
      script = document.createElement('script');
      script.src = GSI_SRC;
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
    script.addEventListener('load', done, { once: true });
    script.addEventListener('error', fail, { once: true });
  });
  return gsiPromise;
}

/* ------------------------------------------------------------------ */
/* Jeton d'accès (mémoire uniquement)                                  */
/* ------------------------------------------------------------------ */

export interface GoogleToken {
  accessToken: string;
  /** Horodatage (ms) d'expiration */
  expiresAt: number;
  scopes: string[];
}

let cachedToken: GoogleToken | null = null;

/** Jeton en mémoire encore valide (marge d'une minute), sinon null. */
export function getCachedGoogleToken(): GoogleToken | null {
  if (cachedToken && cachedToken.expiresAt - 60_000 > Date.now()) return cachedToken;
  cachedToken = null;
  return null;
}

/** Oublie le jeton (et le révoque côté Google si demandé). */
export function clearGoogleToken(revoke = false): void {
  const token = cachedToken;
  cachedToken = null;
  if (revoke && token) {
    try {
      window.google?.accounts?.oauth2?.revoke(token.accessToken);
    } catch {
      /* révocation best effort */
    }
  }
}

/**
 * Ouvre la fenêtre de consentement Google et retourne un jeton d'accès.
 * À appeler depuis un geste utilisateur (clic) pour éviter le blocage de la popup :
 * précharger le script via `loadGoogleIdentityScript()` au montage.
 */
export async function requestGoogleToken(
  clientId: string,
  scopes: string[] = GOOGLE_SCOPES,
  options: { prompt?: '' | 'consent' | 'select_account' } = {}
): Promise<GoogleToken> {
  const oauth2 = await loadGoogleIdentityScript();

  return new Promise<GoogleToken>((resolve, reject) => {
    let client: GsiTokenClient;
    try {
      client = oauth2.initTokenClient({
        client_id: clientId,
        scope: scopes.join(' '),
        include_granted_scopes: true,
        callback: (response) => {
          if (response.error || !response.access_token) {
            const denied = response.error === 'access_denied';
            reject(
              new GoogleSyncError(
                denied ? 'access_denied' : 'unknown',
                denied
                  ? 'Accès refusé : autorisez Kronova à accéder à Google Agenda et Google Tasks.'
                  : `Échec de l’autorisation Google${
                      response.error_description ? ` : ${response.error_description}` : '.'
                    }`
              )
            );
            return;
          }
          if (!oauth2.hasGrantedAllScopes(response, ...scopes)) {
            reject(
              new GoogleSyncError(
                'scopes_missing',
                'Toutes les autorisations n’ont pas été accordées : cochez l’accès à l’agenda et aux tâches.'
              )
            );
            return;
          }
          const expiresIn = Number(response.expires_in) || 3600;
          cachedToken = {
            accessToken: response.access_token,
            expiresAt: Date.now() + expiresIn * 1000,
            scopes: (response.scope || scopes.join(' ')).split(' ').filter(Boolean),
          };
          resolve(cachedToken);
        },
        error_callback: (error) => {
          if (error.type === 'popup_failed_to_open') {
            reject(
              new GoogleSyncError(
                'popup_blocked',
                'La fenêtre de connexion Google a été bloquée : autorisez les popups pour ce site puis réessayez.'
              )
            );
          } else if (error.type === 'popup_closed') {
            reject(new GoogleSyncError('popup_closed', 'Fenêtre de connexion Google fermée avant la fin.'));
          } else {
            reject(new GoogleSyncError('unknown', error.message || 'Erreur inattendue lors de la connexion Google.'));
          }
        },
      });
    } catch {
      reject(new GoogleSyncError('unknown', 'Configuration OAuth Google invalide (ID client ?).'));
      return;
    }
    client.requestAccessToken(options.prompt !== undefined ? { prompt: options.prompt } : undefined);
  });
}

/* ------------------------------------------------------------------ */
/* Appels HTTP                                                         */
/* ------------------------------------------------------------------ */

type TokenLike = GoogleToken | string;
const accessOf = (token: TokenLike) => (typeof token === 'string' ? token : token.accessToken);

interface GoogleApiErrorBody {
  error?: {
    message?: string;
    errors?: Array<{ reason?: string }>;
    details?: Array<{ reason?: string }>;
  };
}

async function googleFetch<T>(token: TokenLike, url: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${accessOf(token)}`,
        Accept: 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
    });
  } catch {
    throw new GoogleSyncError('network', 'Impossible de joindre les services Google (connexion réseau ?).');
  }

  if (res.ok) {
    return (res.status === 204 ? undefined : await res.json()) as T;
  }

  let body: GoogleApiErrorBody = {};
  try {
    body = (await res.json()) as GoogleApiErrorBody;
  } catch {
    /* corps non JSON */
  }
  const reasons = [
    ...(body.error?.errors ?? []).map((e) => e.reason),
    ...(body.error?.details ?? []).map((e) => e.reason),
  ].filter(Boolean) as string[];

  if (res.status === 401) {
    clearGoogleToken();
    throw new GoogleSyncError('unauthorized', 'Session Google expirée : reconnectez-vous à Google.', 401);
  }
  if (res.status === 403) {
    const api = url.includes('tasks') ? 'Google Tasks API' : 'Google Calendar API';
    if (reasons.some((r) => /accessNotConfigured|SERVICE_DISABLED/i.test(r)) || /has not been used|is disabled/i.test(body.error?.message ?? '')) {
      throw new GoogleSyncError(
        'api_disabled',
        `${api} n’est pas activée pour ce projet Google Cloud : activez-la dans la console puis réessayez.`,
        403
      );
    }
    if (reasons.some((r) => /rateLimit|quota/i.test(r))) {
      throw new GoogleSyncError('rate_limited', 'Quota Google atteint : réessayez dans quelques instants.', 403);
    }
    if (reasons.some((r) => /insufficientPermissions|ACCESS_TOKEN_SCOPE_INSUFFICIENT/i.test(r))) {
      clearGoogleToken();
      throw new GoogleSyncError('scopes_missing', 'Autorisations Google insuffisantes : reconnectez-vous en acceptant tous les accès.', 403);
    }
    throw new GoogleSyncError('forbidden', `Accès refusé par ${api}.`, 403);
  }
  if (res.status === 429) {
    throw new GoogleSyncError('rate_limited', 'Trop de requêtes vers Google : réessayez dans quelques instants.', 429);
  }
  throw new GoogleSyncError(
    'unknown',
    `Erreur Google (${res.status})${body.error?.message ? ` : ${body.error.message}` : '.'}`,
    res.status
  );
}

/* ------------------------------------------------------------------ */
/* Logique pure (testable sans réseau)                                 */
/* ------------------------------------------------------------------ */

const pad = (n: number) => String(n).padStart(2, '0');

/** Date locale au format YYYY-MM-DD. */
export const toLocalDateKey = (d: Date): string =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Jour (local) auquel appartient une session, ou null si indéterminable. */
export function sessionDateKey(session: SessionRecord): string | null {
  if (session.startedAt) {
    const start = new Date(session.startedAt);
    if (!Number.isNaN(start.getTime())) return toLocalDateKey(start);
  }
  return session.completedDate && /^\d{4}-\d{2}-\d{2}$/.test(session.completedDate)
    ? session.completedDate
    : null;
}

/** Créneau d'une session : début/fin réels. */
export function computeSessionSlot(session: SessionRecord): { start: Date; end: Date } | null {
  const durationMs = Math.max(1, session.durationMinutes || 0) * 60_000;
  if (session.startedAt) {
    const start = new Date(session.startedAt);
    if (!Number.isNaN(start.getTime())) return { start, end: new Date(start.getTime() + durationMs) };
  }
  const date = session.completedDate?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const time = session.completedAt?.match(/^(\d{1,2}):(\d{2})/);
  if (!date || !time) return null;
  const end = new Date(+date[1], +date[2] - 1, +date[3], +time[1], +time[2]);
  if (Number.isNaN(end.getTime())) return null;
  return { start: new Date(end.getTime() - durationMs), end };
}

/** Sessions de concentration du jour donné, exportables (créneau calculable). */
export function selectTodayFocusSessions(sessions: SessionRecord[], now: Date = new Date()): SessionRecord[] {
  const today = toLocalDateKey(now);
  return sessions.filter(
    (s) => s.phase === TimerPhase.FOCUS && sessionDateKey(s) === today && computeSessionSlot(s) !== null
  );
}

export interface CalendarEventPayload {
  summary: string;
  description: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  extendedProperties: { private: Record<string, string> };
  source?: { title: string; url: string };
}

export const localTimeZone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
};

export function buildCalendarEvent(session: SessionRecord, timeZone = localTimeZone()): CalendarEventPayload | null {
  const slot = computeSessionSlot(session);
  if (!slot) return null;
  const title = session.taskTitle?.trim() || 'Session de concentration';
  const lines = [
    `Session de concentration Kronova de ${session.durationMinutes} min.`,
    session.taskTitle ? `Tâche : ${session.taskTitle}` : null,
    session.category ? `Catégorie : ${session.category}` : null,
    typeof session.interruptions === 'number' ? `Interruptions : ${session.interruptions}` : null,
  ].filter(Boolean);
  return {
    summary: `🍅 Kronova — ${title}`,
    description: lines.join('\n'),
    start: { dateTime: slot.start.toISOString(), timeZone },
    end: { dateTime: slot.end.toISOString(), timeZone },
    extendedProperties: { private: { kronovaSessionId: session.id, kronovaApp: KRONOVA_APP_TAG } },
  };
}

/** Sépare les sessions à créer de celles déjà présentes dans l'agenda. */
export function partitionNewSessions(
  sessions: SessionRecord[],
  existingIds: Iterable<string>
): { toCreate: SessionRecord[]; skipped: number } {
  const known = new Set(existingIds);
  const queued = new Set<string>();
  const toCreate: SessionRecord[] = [];
  let skipped = 0;
  for (const s of sessions) {
    if (queued.has(s.id)) continue; // doublon interne : ignoré sans être compté
    queued.add(s.id);
    if (known.has(s.id)) skipped++;
    else toCreate.push(s);
  }
  return { toCreate, skipped };
}

export interface GoogleTaskRaw {
  id: string;
  title?: string;
  notes?: string;
  due?: string;
  status?: 'needsAction' | 'completed';
  deleted?: boolean;
  hidden?: boolean;
  parent?: string;
}

export interface ImportedGoogleTask {
  id: string;
  title: string;
  notes?: string;
  due?: string;
}

/**
 * Tâches non terminées dont l'échéance est aujourd'hui ou absente.
 * L'API Tasks ne stocke que la date de `due` (heure toujours à minuit UTC).
 */
export function filterTodayTasks(tasks: GoogleTaskRaw[], now: Date = new Date()): ImportedGoogleTask[] {
  const today = toLocalDateKey(now);
  const out: ImportedGoogleTask[] = [];
  for (const t of tasks) {
    const title = t.title?.trim();
    if (!title || t.deleted || t.hidden || t.status === 'completed') continue;
    if (t.due && t.due.slice(0, 10) !== today) continue;
    out.push({ id: t.id, title, ...(t.notes ? { notes: t.notes } : {}), ...(t.due ? { due: t.due.slice(0, 10) } : {}) });
  }
  return out;
}

const normalizeTitle = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().replace(/\s+/g, ' ').toLowerCase();

/** Retire les tâches dont le titre existe déjà (casse, accents et espaces ignorés), et les doublons internes. */
export function dedupeTasksByTitle<T extends { title: string }>(tasks: T[], existingTitles: string[]): T[] {
  const seen = new Set(existingTitles.map(normalizeTitle));
  return tasks.filter((t) => {
    const key = normalizeTitle(t.title);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/* ------------------------------------------------------------------ */
/* Google Agenda                                                       */
/* ------------------------------------------------------------------ */

interface CalendarEventsList {
  items?: Array<{ extendedProperties?: { private?: Record<string, string> } }>;
  nextPageToken?: string;
}

async function listExportedSessionIds(token: TokenLike, timeMin: Date, timeMax: Date): Promise<Set<string>> {
  const ids = new Set<string>();
  let pageToken: string | undefined;
  let guard = 0;
  do {
    const params = new URLSearchParams({
      privateExtendedProperty: `kronovaApp=${KRONOVA_APP_TAG}`,
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      singleEvents: 'true',
      showDeleted: 'false',
      maxResults: '250',
      fields: 'items(extendedProperties/private),nextPageToken',
    });
    if (pageToken) params.set('pageToken', pageToken);
    const data = await googleFetch<CalendarEventsList>(
      token,
      `${CALENDAR_API}/calendars/primary/events?${params.toString()}`
    );
    for (const ev of data.items ?? []) {
      const id = ev.extendedProperties?.private?.kronovaSessionId;
      if (id) ids.add(id);
    }
    pageToken = data.nextPageToken;
  } while (pageToken && ++guard < 10);
  return ids;
}

/**
 * Crée un évènement dans l'agenda principal pour chaque session de concentration
 * du jour qui n'y figure pas encore.
 */
export async function exportSessionsToCalendar(
  token: TokenLike,
  sessions: SessionRecord[],
  now: Date = new Date()
): Promise<{ created: number; skipped: number }> {
  const todays = selectTodayFocusSessions(sessions, now);
  if (todays.length === 0) return { created: 0, skipped: 0 };

  // Fenêtre de recherche : la journée locale, élargie aux créneaux qui débordent.
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let timeMin = dayStart.getTime();
  let timeMax = dayStart.getTime() + 24 * 3_600_000;
  for (const s of todays) {
    const slot = computeSessionSlot(s)!;
    timeMin = Math.min(timeMin, slot.start.getTime());
    timeMax = Math.max(timeMax, slot.end.getTime());
  }

  const existing = await listExportedSessionIds(token, new Date(timeMin - 60_000), new Date(timeMax + 60_000));
  const { toCreate, skipped } = partitionNewSessions(todays, existing);

  const timeZone = localTimeZone();
  let created = 0;
  for (const session of toCreate) {
    const event = buildCalendarEvent(session, timeZone);
    if (!event) continue;
    await googleFetch(token, `${CALENDAR_API}/calendars/primary/events`, {
      method: 'POST',
      body: JSON.stringify(event),
    });
    created++;
  }
  return { created, skipped };
}

/* ------------------------------------------------------------------ */
/* Google Tasks                                                        */
/* ------------------------------------------------------------------ */

interface TaskListsResponse {
  items?: Array<{ id: string; title?: string }>;
  nextPageToken?: string;
}

interface TasksResponse {
  items?: GoogleTaskRaw[];
  nextPageToken?: string;
}

/** Tâches Google non terminées, dues aujourd'hui ou sans échéance (100 au maximum). */
export async function importTodayTasks(token: TokenLike, now: Date = new Date()): Promise<ImportedGoogleTask[]> {
  const lists: Array<{ id: string }> = [];
  let pageToken: string | undefined;
  let guard = 0;
  do {
    const params = new URLSearchParams({ maxResults: '100' });
    if (pageToken) params.set('pageToken', pageToken);
    const data = await googleFetch<TaskListsResponse>(token, `${TASKS_API}/users/@me/lists?${params.toString()}`);
    lists.push(...(data.items ?? []));
    pageToken = data.nextPageToken;
  } while (pageToken && ++guard < 5);

  const result: ImportedGoogleTask[] = [];
  for (const list of lists) {
    pageToken = undefined;
    guard = 0;
    do {
      const params = new URLSearchParams({
        showCompleted: 'false',
        showHidden: 'false',
        showDeleted: 'false',
        maxResults: '100',
      });
      if (pageToken) params.set('pageToken', pageToken);
      const data = await googleFetch<TasksResponse>(
        token,
        `${TASKS_API}/lists/${encodeURIComponent(list.id)}/tasks?${params.toString()}`
      );
      result.push(...filterTodayTasks(data.items ?? [], now));
      if (result.length >= MAX_IMPORTED_TASKS) return result.slice(0, MAX_IMPORTED_TASKS);
      pageToken = data.nextPageToken;
    } while (pageToken && ++guard < 10);
  }
  return result;
}
