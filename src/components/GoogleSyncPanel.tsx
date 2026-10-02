import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { CalendarPlus, Check, ListTodo, Loader2, LogOut, RefreshCw } from 'lucide-react';
import { SessionRecord, TimerPhase } from '../types';
import {
  GOOGLE_SCOPES,
  GoogleSyncError,
  GoogleToken,
  ImportedGoogleTask,
  clearGoogleToken,
  dedupeTasksByTitle,
  exportSessionsToCalendar,
  getCachedGoogleToken,
  importTodayTasks,
  loadGoogleIdentityScript,
  needsReauth,
  requestGoogleToken,
  selectTodayFocusSessions,
} from '../utils/google';

interface GoogleSyncPanelProps {
  clientId: string | null;
  sessions: SessionRecord[];
  /** Titres des tâches existantes, pour ignorer les doublons à l'import */
  existingTaskTitles: string[];
  onImportTasks: (tasks: Array<{ title: string; notes?: string }>) => void;
}

const AUTO_EXPORT_KEY = 'kronova_google_auto_export';

const readAutoExport = (): boolean => {
  try {
    return localStorage.getItem(AUTO_EXPORT_KEY) === '1';
  } catch {
    return false;
  }
};

const writeAutoExport = (value: boolean) => {
  try {
    localStorage.setItem(AUTO_EXPORT_KEY, value ? '1' : '0');
  } catch {
    /* stockage indisponible : préférence non mémorisée */
  }
};

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

const formatExportResult = ({ created, skipped }: { created: number; skipped: number }): string => {
  if (created === 0 && skipped === 0) return 'Aucune session de concentration à exporter aujourd’hui.';
  const parts: string[] = [];
  if (created > 0) parts.push(plural(created, 'session ajoutée', 'sessions ajoutées'));
  if (skipped > 0) parts.push(plural(skipped, 'déjà présente', 'déjà présentes'));
  if (created === 0) return `Rien de nouveau : ${parts.join(', ')}.`;
  return `${parts.join(', ')}.`.replace(/^./, (c) => c.toUpperCase());
};

const errorMessage = (e: unknown): string =>
  e instanceof GoogleSyncError ? e.message : 'Erreur inattendue avec Google. Réessayez.';

const btnPrimary =
  'min-h-[38px] px-4 py-2 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-medium hover:bg-slate-800 dark:hover:bg-slate-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer flex items-center justify-center gap-2';
const btnSecondary =
  'min-h-[38px] px-4 py-2 rounded-xl border border-neutral-200 dark:border-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-neutral-50 dark:hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer flex items-center justify-center gap-2';

type Busy = null | 'connect' | 'export' | 'import';

export const GoogleSyncPanel: React.FC<GoogleSyncPanelProps> = ({
  clientId,
  sessions,
  existingTaskTitles,
  onImportTasks,
}) => {
  const uid = useId();
  const [token, setToken] = useState<GoogleToken | null>(() => getCachedGoogleToken());
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [autoExport, setAutoExport] = useState<boolean>(readAutoExport);
  const [preview, setPreview] = useState<ImportedGoogleTask[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const busyRef = useRef<Busy>(null);
  busyRef.current = busy;

  const todayFocusCount = useMemo(() => selectTodayFocusSessions(sessions).length, [sessions]);

  // Préchargement du script pour que la popup s'ouvre dans le geste utilisateur.
  useEffect(() => {
    if (clientId) loadGoogleIdentityScript().catch(() => undefined);
  }, [clientId]);

  // Le jeton expire : on repasse à l'état déconnecté au bon moment.
  useEffect(() => {
    if (!token) return;
    const delay = Math.max(0, token.expiresAt - 60_000 - Date.now());
    const timer = window.setTimeout(() => setToken(getCachedGoogleToken()), delay);
    return () => window.clearTimeout(timer);
  }, [token]);

  const handleError = useCallback((e: unknown) => {
    if (needsReauth(e)) setToken(null);
    setError(errorMessage(e));
  }, []);

  /** Jeton valide, ou demande de consentement (doit être appelé depuis un clic). */
  const ensureToken = useCallback(async (): Promise<GoogleToken> => {
    const current = getCachedGoogleToken();
    if (current) return current;
    if (!clientId) throw new GoogleSyncError('unknown', 'Intégration Google non configurée.');
    const fresh = await requestGoogleToken(clientId, GOOGLE_SCOPES);
    setToken(fresh);
    return fresh;
  }, [clientId]);

  const connect = async () => {
    setError(null);
    setStatus(null);
    setBusy('connect');
    try {
      await ensureToken();
      setStatus('Connecté à Google.');
    } catch (e) {
      handleError(e);
    } finally {
      setBusy(null);
    }
  };

  const disconnect = () => {
    clearGoogleToken(true);
    setToken(null);
    setPreview(null);
    setError(null);
    setStatus('Déconnecté de Google.');
  };

  const runExport = useCallback(
    async (opts: { interactive: boolean }) => {
      setError(null);
      setStatus(null);
      setBusy('export');
      try {
        const t = opts.interactive ? await ensureToken() : getCachedGoogleToken();
        if (!t) {
          setToken(null);
          setStatus('Export automatique en attente : reconnectez-vous à Google.');
          return;
        }
        const result = await exportSessionsToCalendar(t, sessions);
        setStatus((opts.interactive ? '' : 'Export automatique : ') + formatExportResult(result));
      } catch (e) {
        handleError(e);
      } finally {
        setBusy(null);
      }
    },
    [ensureToken, handleError, sessions]
  );

  const runImport = async () => {
    setError(null);
    setStatus(null);
    setPreview(null);
    setBusy('import');
    try {
      const t = await ensureToken();
      const tasks = dedupeTasksByTitle(await importTodayTasks(t), existingTaskTitles);
      if (tasks.length === 0) {
        setStatus('Aucune nouvelle tâche Google pour aujourd’hui.');
      } else {
        setPreview(tasks);
        setSelected(new Set(tasks.map((task) => task.id)));
      }
    } catch (e) {
      handleError(e);
    } finally {
      setBusy(null);
    }
  };

  const confirmImport = () => {
    if (!preview) return;
    const chosen = preview.filter((t) => selected.has(t.id));
    if (chosen.length === 0) return;
    onImportTasks(chosen.map((t) => (t.notes ? { title: t.title, notes: t.notes } : { title: t.title })));
    setStatus(`${plural(chosen.length, 'tâche ajoutée', 'tâches ajoutées')} à Kronova.`);
    setPreview(null);
  };

  const toggleSelected = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Export automatique quand une nouvelle session de concentration apparaît.
  const seenFocusIds = useRef<Set<string> | null>(null);
  useEffect(() => {
    const focusIds = sessions.filter((s) => s.phase === TimerPhase.FOCUS).map((s) => s.id);
    if (seenFocusIds.current === null) {
      seenFocusIds.current = new Set(focusIds);
      return;
    }
    const seen = seenFocusIds.current;
    const hasNew = focusIds.some((id) => !seen.has(id));
    focusIds.forEach((id) => seen.add(id));
    if (hasNew && autoExport && clientId && token && busyRef.current === null) {
      void runExport({ interactive: false });
    }
  }, [sessions, autoExport, clientId, token, runExport]);

  const toggleAutoExport = (value: boolean) => {
    setAutoExport(value);
    writeAutoExport(value);
  };

  const titleId = `${uid}-title`;
  const connected = token !== null;

  return (
    <section
      aria-labelledby={titleId}
      className="bg-white dark:bg-[#111827] border border-neutral-200 dark:border-slate-800 rounded-2xl p-5"
    >
      <div className="flex items-center justify-between gap-3 mb-1">
        <div className="flex items-center gap-2.5">
          <CalendarPlus className="w-4 h-4 text-slate-900 dark:text-white" aria-hidden="true" />
          <h3 id={titleId} className="text-sm font-semibold text-slate-900 dark:text-white">
            Google Agenda &amp; Tasks
          </h3>
        </div>
        {clientId && connected && (
          <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
            <Check className="w-3.5 h-3.5" aria-hidden="true" />
            Connecté
          </span>
        )}
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
        Exportez vos sessions de concentration dans votre agenda et importez vos tâches Google du jour.
      </p>

      {!clientId ? (
        <div className="text-xs text-slate-600 dark:text-slate-300 space-y-2 bg-neutral-50 dark:bg-slate-900/60 border border-neutral-200 dark:border-slate-800 rounded-xl p-4">
          <p className="font-medium text-slate-900 dark:text-white">Intégration Google non configurée</p>
          <ol className="list-decimal pl-4 space-y-1">
            <li>
              Dans Google Cloud Console, créez un ID client OAuth de type « Application Web ».
            </li>
            <li>
              Origines JavaScript autorisées : <code className="font-mono">https://kro-nova.com</code> et{' '}
              <code className="font-mono">http://localhost:3000</code>.
            </li>
            <li>Activez Google Calendar API et Google Tasks API pour ce projet.</li>
            <li>
              Renseignez la variable serveur <code className="font-mono">GOOGLE_CLIENT_ID</code>, puis redémarrez
              Kronova.
            </li>
          </ol>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {connected ? (
              <button type="button" onClick={disconnect} disabled={busy !== null} className={btnSecondary}>
                <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
                Se déconnecter de Google
              </button>
            ) : (
              <button type="button" onClick={connect} disabled={busy !== null} className={btnPrimary}>
                {busy === 'connect' ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                )}
                {busy === 'connect' ? 'Connexion…' : 'Se connecter à Google'}
              </button>
            )}
          </div>

          <div className="flex flex-col sm:flex-row flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void runExport({ interactive: true })}
              disabled={busy !== null}
              aria-busy={busy === 'export'}
              className={btnSecondary}
            >
              {busy === 'export' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <CalendarPlus className="w-3.5 h-3.5" aria-hidden="true" />
              )}
              Exporter les sessions du jour dans Google Agenda
              <span className="text-slate-400 dark:text-slate-500 font-mono-tabular">({todayFocusCount})</span>
            </button>
            <button
              type="button"
              onClick={() => void runImport()}
              disabled={busy !== null}
              aria-busy={busy === 'import'}
              className={btnSecondary}
            >
              {busy === 'import' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <ListTodo className="w-3.5 h-3.5" aria-hidden="true" />
              )}
              Importer mes tâches Google du jour
            </button>
          </div>

          <label className="flex items-start gap-2.5 text-xs text-slate-700 dark:text-slate-300 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={autoExport}
              onChange={(e) => toggleAutoExport(e.target.checked)}
              className="mt-0.5 w-4 h-4 accent-slate-900 dark:accent-white cursor-pointer"
            />
            <span>
              Export automatique à la fin de chaque session
              <span className="block text-[11px] text-slate-400 dark:text-slate-500">
                Actif tant que vous êtes connecté à Google dans cet onglet.
              </span>
            </span>
          </label>

          {preview && (
            <fieldset className="border border-neutral-200 dark:border-slate-800 rounded-xl p-3">
              <legend className="px-1 text-xs font-medium text-slate-900 dark:text-white">
                Tâches Google du jour ({preview.length})
              </legend>
              <div className="flex gap-3 mb-2 text-[11px]">
                <button
                  type="button"
                  onClick={() => setSelected(new Set(preview.map((t) => t.id)))}
                  className="text-slate-500 hover:text-slate-900 dark:hover:text-white underline cursor-pointer"
                >
                  Tout cocher
                </button>
                <button
                  type="button"
                  onClick={() => setSelected(new Set())}
                  className="text-slate-500 hover:text-slate-900 dark:hover:text-white underline cursor-pointer"
                >
                  Tout décocher
                </button>
              </div>
              <ul className="max-h-60 overflow-y-auto space-y-1.5 pr-1">
                {preview.map((task) => (
                  <li key={task.id}>
                    <label className="flex items-start gap-2.5 text-xs cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selected.has(task.id)}
                        onChange={() => toggleSelected(task.id)}
                        className="mt-0.5 w-4 h-4 accent-slate-900 dark:accent-white cursor-pointer shrink-0"
                      />
                      <span className="min-w-0">
                        <span className="block text-slate-900 dark:text-white break-words">{task.title}</span>
                        {(task.due || task.notes) && (
                          <span className="block text-[11px] text-slate-400 dark:text-slate-500 truncate">
                            {task.due ? 'Échéance aujourd’hui' : ''}
                            {task.due && task.notes ? ' · ' : ''}
                            {task.notes ?? ''}
                          </span>
                        )}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
              <div className="flex justify-end gap-2 mt-3">
                <button type="button" onClick={() => setPreview(null)} className={btnSecondary}>
                  Annuler
                </button>
                <button
                  type="button"
                  onClick={confirmImport}
                  disabled={selected.size === 0}
                  className={btnPrimary}
                >
                  Ajouter {plural(selected.size, 'tâche', 'tâches')}
                </button>
              </div>
            </fieldset>
          )}

          <div aria-live="polite" className="min-h-[1rem]">
            {status && !error && <p className="text-xs text-slate-600 dark:text-slate-300">{status}</p>}
          </div>
          {error && (
            <p role="alert" className="text-xs text-rose-600 dark:text-rose-400">
              {error}
            </p>
          )}
        </div>
      )}
    </section>
  );
};
