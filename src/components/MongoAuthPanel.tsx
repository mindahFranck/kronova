import React, { useEffect, useState } from 'react';
import { LogOut, User, X, Check } from 'lucide-react';
import loginBackground from '../assets/images/kronova-login-bg.webp';
import { PomodoroTask, SessionRecord, TimerSettings, Workspace } from '../types';

export interface AuthenticatedUser {
  userId: string;
  email: string;
  name: string;
}

export interface DbStatusInfo {
  connectedToMongoCluster: boolean;
  engine: string;
  message: string;
  hasEnvUri: boolean;
  live?: boolean;
  signupCodeRequired?: boolean;
}

export type SyncStatus = 'idle' | 'saving' | 'saved' | 'offline';

interface MongoAuthModalProps {
  isOpen: boolean;
  /** Onglet affiché à l'ouverture (connexion ou création de compte) */
  initialMode?: 'login' | 'register';
  onClose: () => void;
  currentUser: AuthenticatedUser | null;
  dbStatus: DbStatusInfo | null;
  lastSyncedAt: string | null;
  currentTasks: PomodoroTask[];
  currentSessions: SessionRecord[];
  currentSettings: TimerSettings;
  currentWorkspace: Workspace;
  syncStatus: SyncStatus;
  isLiveConnected: boolean;
  onAuthSuccess: (
    token: string,
    user: AuthenticatedUser,
    state: {
      tasks: PomodoroTask[];
      sessions: SessionRecord[];
      settings: Partial<TimerSettings>;
      workspace?: Partial<Workspace>;
    }
  ) => void;
  onLogout: () => void;
}

export const MongoAuthModal: React.FC<MongoAuthModalProps> = ({
  isOpen,
  initialMode = 'login',
  onClose,
  currentUser,
  dbStatus,
  lastSyncedAt,
  currentTasks,
  currentSessions,
  currentSettings,
  currentWorkspace,
  syncStatus,
  isLiveConnected,
  onAuthSuccess,
  onLogout,
}) => {
  const [mode, setMode] = useState<'login' | 'register'>(initialMode);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setMode(initialMode);
      setError(null);
    }
  }, [isOpen, initialMode]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const endpoint = mode === 'register' ? '/api/auth/register' : '/api/auth/login';
      const payload =
        mode === 'register'
          ? {
              name,
              email,
              password,
              inviteCode,
              initialState: {
                tasks: currentTasks,
                sessions: currentSessions,
                settings: currentSettings,
                workspace: currentWorkspace,
              },
            }
          : { email, password };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Une erreur est survenue.');
        setLoading(false);
        return;
      }

      onAuthSuccess(data.token, data.user, data.state);
      setLoading(false);
      onClose();
    } catch {
      setError('Impossible de joindre le serveur Kronova.');
      setLoading(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="kronova-auth-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/65 backdrop-blur-sm overflow-y-auto"
    >
      <div className="w-full max-w-4xl my-auto bg-white dark:bg-[#111827] border border-neutral-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-2xl grid grid-cols-1 md:grid-cols-12">
        {/* Panneau visuel : bureau en travertin et horloge Kronova */}
        <div className="relative md:col-span-6 min-h-[200px] md:min-h-[520px] flex flex-col justify-between p-6 sm:p-8 overflow-hidden bg-slate-950">
          <img
            src={loginBackground}
            alt=""
            aria-hidden="true"
            className="absolute inset-0 w-full h-full object-cover object-center"
          />
          {/* Voile sombre pour garantir le contraste du texte */}
          <div className="absolute inset-0 bg-gradient-to-t from-[#0B0F17]/90 via-[#0B0F17]/40 to-[#0B0F17]/30" />

          <span className="relative z-10 font-display text-2xl tracking-tight text-white">Kronova</span>

          <div className="relative z-10 mt-auto pt-8">
            <p className="font-display italic text-xl sm:text-2xl text-white leading-snug">
              « L’architecture du temps au service de votre attention profonde. »
            </p>
            <p className="mt-2 text-xs text-slate-300">
              Cycles Pomodoro · Bouclier anti-distraction · Assistant vocal IA
            </p>
          </div>
        </div>

        {/* Formulaire */}
        <div className="md:col-span-6 p-6 sm:p-8 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between border-b border-neutral-200 dark:border-slate-800 pb-4 mb-5">
              <h2
                id="kronova-auth-title"
                className="text-base font-semibold text-slate-900 dark:text-white"
              >
                {currentUser
                  ? 'Mon compte'
                  : mode === 'register'
                  ? 'Créer mon espace Kronova'
                  : 'Connexion à Kronova'}
              </h2>
              <button
                type="button"
                onClick={onClose}
                aria-label="Fermer la fenêtre"
                className="p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white rounded-lg cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {currentUser ? (
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-neutral-100 dark:bg-slate-800 flex items-center justify-center text-slate-900 dark:text-white font-semibold">
                    <User className="w-5 h-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                      {currentUser.name}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
                      {currentUser.email}
                    </div>
                  </div>
                </div>

                <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-2 pt-2 border-t border-neutral-100 dark:border-slate-800">
                  {isLiveConnected && syncStatus !== 'offline' ? (
                    <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  ) : (
                    <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" aria-hidden="true" />
                  )}
                  <span>
                    {syncStatus === 'offline'
                      ? 'Serveur injoignable — vos modifications sont conservées localement et seront renvoyées automatiquement.'
                      : !isLiveConnected
                      ? 'Reconnexion à la synchronisation en direct…'
                      : syncStatus === 'saving'
                      ? 'Enregistrement en cours…'
                      : `Synchronisé en direct sur tous vos appareils${
                          lastSyncedAt ? ` (dernière mise à jour à ${lastSyncedAt})` : ''
                        }.`}
                  </span>
                </div>

                <div className="pt-3 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      onLogout();
                      onClose();
                    }}
                    className="px-4 py-2 rounded-xl border border-neutral-200 dark:border-slate-800 text-xs font-medium text-rose-600 dark:text-rose-400 hover:bg-neutral-50 dark:hover:bg-slate-800 transition-colors flex items-center gap-2 cursor-pointer"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span>Se déconnecter</span>
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                {/* Segmented Mode Selector */}
                <div className="grid grid-cols-2 gap-1 p-1 bg-neutral-100 dark:bg-slate-800 rounded-xl">
                  <button
                    type="button"
                    onClick={() => {
                      setMode('login');
                      setError(null);
                    }}
                    className={`py-1.5 text-xs font-medium rounded-lg transition-colors cursor-pointer ${
                      mode === 'login'
                        ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    Se connecter
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMode('register');
                      setError(null);
                    }}
                    className={`py-1.5 text-xs font-medium rounded-lg transition-colors cursor-pointer ${
                      mode === 'register'
                        ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    Créer un compte
                  </button>
                </div>

                {mode === 'register' && (
                  <div>
                    <label
                      htmlFor="auth-name"
                      className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                    >
                      Nom ou prénom
                    </label>
                    <input
                      id="auth-name"
                      type="text"
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Ex: Camille"
                      className="w-full px-3.5 py-2 text-sm bg-neutral-50 dark:bg-slate-900 border border-neutral-200 dark:border-slate-800 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:border-slate-900 dark:focus:border-slate-400"
                    />
                  </div>
                )}

                <div>
                  <label
                    htmlFor="auth-email"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                  >
                    Adresse e-mail
                  </label>
                  <input
                    id="auth-email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="vous@kro-nova.com"
                    className="w-full px-3.5 py-2 text-sm bg-neutral-50 dark:bg-slate-900 border border-neutral-200 dark:border-slate-800 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:border-slate-900 dark:focus:border-slate-400"
                  />
                </div>

                <div>
                  <label
                    htmlFor="auth-password"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                  >
                    Mot de passe
                  </label>
                  <input
                    id="auth-password"
                    type="password"
                    required
                    minLength={mode === 'register' ? 8 : 1}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full px-3.5 py-2 text-sm bg-neutral-50 dark:bg-slate-900 border border-neutral-200 dark:border-slate-800 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:border-slate-900 dark:focus:border-slate-400"
                  />
                </div>

                {mode === 'register' && dbStatus?.signupCodeRequired && (
                  <div>
                    <label
                      htmlFor="auth-invite"
                      className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                    >
                      Code d’invitation
                    </label>
                    <input
                      id="auth-invite"
                      type="text"
                      required
                      value={inviteCode}
                      onChange={(e) => setInviteCode(e.target.value)}
                      placeholder="Fourni par votre équipe"
                      className="w-full px-3.5 py-2 text-sm bg-neutral-50 dark:bg-slate-900 border border-neutral-200 dark:border-slate-800 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:border-slate-900 dark:focus:border-slate-400"
                    />
                  </div>
                )}

                {error && (
                  <p className="text-xs text-rose-600 dark:text-rose-400">{error}</p>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full min-h-[42px] py-2.5 px-4 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-medium hover:bg-slate-800 dark:hover:bg-slate-200 disabled:opacity-50 transition-colors cursor-pointer"
                >
                  {loading
                    ? 'Synchronisation...'
                    : mode === 'register'
                    ? 'Créer mon compte'
                    : 'Se connecter'}
                </button>
              </form>
            )}
          </div>

          <div className="pt-6 mt-6 border-t border-neutral-100 dark:border-slate-800/70 flex items-center justify-between text-[11px] text-slate-400 dark:text-slate-500">
            <span>Kronova · Horlogerie de concentration</span>
            <span>kro-nova.com</span>
          </div>
        </div>
      </div>
    </div>
  );
};
