/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Play,
  Pause,
  RotateCcw,
  SkipForward,
  Check,
  Plus,
  Trash2,
  Volume2,
  VolumeX,
  Sun,
  Moon,
  Search,
  Download,
  CheckCircle2,
  Circle,
  Clock,
  Sliders,
  ArrowUpRight,
  Bell,
  X,
  Shield,
  ShieldAlert,
  RefreshCw,
  Maximize2,
  Lock,
  User,
} from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
} from 'recharts';
import {
  TimerPhase,
  TaskFilter,
  ActiveView,
  PomodoroTask,
  SessionRecord,
  TimerSettings,
} from './types';
import { playTactileClick, playSoftTick, playCompletionChime } from './utils/sound';
import {
  BrowserNotificationStatus,
  getNotificationPermission,
  requestBrowserNotificationPermission,
  triggerPhaseNotification,
} from './utils/notifications';
import {
  YouTubeAmbientPlayer,
  DEFAULT_YOUTUBE_URL,
  isYouTubeLink,
} from './components/YouTubeAmbientPlayer';
import {
  PRODUCTIVITY_QUOTES,
  DEFAULT_BLOCKED_DOMAINS,
  PRESET_DISTRACTION_SITES,
} from './data/quotes';
import { LiveVoiceCoach } from './components/LiveVoiceCoach';
import {
  MongoAuthModal,
  AuthenticatedUser,
  DbStatusInfo,
  SyncStatus,
} from './components/MongoAuthPanel';

const STORAGE_KEYS = {
  TASKS: 'cadence_pomodoro_tasks_v1',
  SESSIONS: 'cadence_pomodoro_sessions_v1',
  SETTINGS: 'cadence_pomodoro_settings_v1',
  THEME: 'cadence_pomodoro_theme_v1',
  AUTH_TOKEN: 'cadence_pomodoro_mongo_token_v1',
};

const DEFAULT_SETTINGS: TimerSettings = {
  focusMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  cyclesBeforeLongBreak: 4,
  autoStartBreaks: false,
  autoStartFocus: false,
  soundEnabled: true,
  ambientTickEnabled: false,
  zenModeEnabled: false,
  notificationsEnabled: true,
  youtubeAmbientEnabled: true,
  youtubeUrl: DEFAULT_YOUTUBE_URL,
  youtubePlaylist: [DEFAULT_YOUTUBE_URL],
  youtubeSyncWithTimer: true,
  youtubeVolume: 50,
  blockerEnabled: true,
  blockedDomains: DEFAULT_BLOCKED_DOMAINS,
  strictTabGuardEnabled: true,
  autoFullscreenOnFocus: false,
  dailyGoal: 6,
  ambientMixEnabled: false,
  ambientMix: { rain: 0, brown: 0, fire: 0, cafe: 0 },
};

// Anciennes données de démonstration (ids fixes) : purgées du stockage local et de la base.
// Les vraies entrées utilisent des ids horodatés (`task-<timestamp>`, `sess-<timestamp>`).
const DEMO_ID_PATTERN = /^(task-[1-3]|sess-[1-3]|sess-hist-\d+)$/;

function withoutDemoEntries<T extends { id: string }>(items: T[]): T[] {
  return items.filter((item) => !DEMO_ID_PATTERN.test(item.id));
}

interface BlockerInfo {
  active: boolean;
  domains: string[];
  endsAt: number | null;
  attempts: number;
  lastAttempt: { domain: string; at: number } | null;
  extensionConnected: boolean;
}

// Index aléatoire dans [0, length), différent de `exclude` quand c'est possible
function randomIndex(length: number, exclude = -1): number {
  if (length <= 1) return 0;
  let next = Math.floor(Math.random() * (length - 1));
  if (next >= exclude && exclude >= 0) next += 1;
  return next;
}

const QUOTE_ROTATION_MS = 90000;

function getLocalIsoDate(daysAgo = 0): string {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}


function formatTime(totalSeconds: number): string {
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function getCurrentTimeLabel(): string {
  const now = new Date();
  return now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

export default function App() {
  // Theme state
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.THEME);
      return saved ? JSON.parse(saved) : false;
    } catch {
      return false;
    }
  });

  // Settings state
  const [settings, setSettings] = useState<TimerSettings>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.SETTINGS);
      return saved ? { ...DEFAULT_SETTINGS, ...JSON.parse(saved) } : DEFAULT_SETTINGS;
    } catch {
      return DEFAULT_SETTINGS;
    }
  });

  // Tasks state
  const [tasks, setTasks] = useState<PomodoroTask[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.TASKS);
      return saved ? withoutDemoEntries(JSON.parse(saved) as PomodoroTask[]) : [];
    } catch {
      return [];
    }
  });

  // Session history state
  const [sessions, setSessions] = useState<SessionRecord[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.SESSIONS);
      if (!saved) return [];
      return withoutDemoEntries(JSON.parse(saved) as SessionRecord[]).map((s) => ({
        ...s,
        completedDate: s.completedDate || getLocalIsoDate(0),
      }));
    } catch {
      return [];
    }
  });

  // Navigation & UI state
  const [activeView, setActiveView] = useState<ActiveView>(ActiveView.WORKSPACE);
  const [phase, setPhase] = useState<TimerPhase>(TimerPhase.FOCUS);
  const [secondsLeft, setSecondsLeft] = useState<number>(settings.focusMinutes * 60);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [currentCycle, setCurrentCycle] = useState<number>(1);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(() => {
    const firstActive = tasks.find((t) => !t.completed);
    return firstActive ? firstActive.id : null;
  });

  // Task creation & filtering state
  const [newTaskTitle, setNewTaskTitle] = useState<string>('');
  const [newTaskCategory, setNewTaskCategory] = useState<string>('Concentration');
  const [newTaskEstimate, setNewTaskEstimate] = useState<number>(2);
  const [taskFilter, setTaskFilter] = useState<TaskFilter>(TaskFilter.ALL);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [journalFilter, setJournalFilter] = useState<'ALL' | TimerPhase>('ALL');
  const [notificationPermission, setNotificationPermission] =
    useState<BrowserNotificationStatus>(() => getNotificationPermission());
  const [phaseBanner, setPhaseBanner] = useState<{ title: string; body: string } | null>(null);

  // Productivity quote index (updated on each new focus session)
  const [quoteIndex, setQuoteIndex] = useState<number>(() =>
    randomIndex(PRODUCTIVITY_QUOTES.length)
  );

  // Rotation automatique et aléatoire des citations
  useEffect(() => {
    const interval = window.setInterval(() => {
      setQuoteIndex((prev) => randomIndex(PRODUCTIVITY_QUOTES.length, prev));
    }, QUOTE_ROTATION_MS);
    return () => window.clearInterval(interval);
  }, []);

  // Playlist d'ambiance personnelle : un morceau tiré au hasard
  const ambientPlaylist = useMemo(() => {
    const list = (settings.youtubePlaylist || []).filter((url) => url.trim());
    return list.length > 0 ? list : [settings.youtubeUrl || DEFAULT_YOUTUBE_URL];
  }, [settings.youtubePlaylist, settings.youtubeUrl]);
  const [trackIndex, setTrackIndex] = useState<number>(() => randomIndex(ambientPlaylist.length));
  const playlistLengthRef = useRef(ambientPlaylist.length);
  playlistLengthRef.current = ambientPlaylist.length;
  const currentTrackUrl = ambientPlaylist[trackIndex % ambientPlaylist.length];
  const [newTrackUrl, setNewTrackUrl] = useState<string>('');

  // Anti-distraction shield state
  const [customDomainInput, setCustomDomainInput] = useState<string>('');
  const [distractionsIntercepted, setDistractionsIntercepted] = useState<number>(0);
  const [interceptedSiteWarning, setInterceptedSiteWarning] = useState<string | null>(null);

  // MongoDB Auth & Live Persistence State
  const [authToken, setAuthToken] = useState<string | null>(() => {
    try {
      return localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN);
    } catch {
      return null;
    }
  });
  const [currentUser, setCurrentUser] = useState<AuthenticatedUser | null>(null);
  const [dbStatus, setDbStatus] = useState<DbStatusInfo | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle');
  const [isLiveConnected, setIsLiveConnected] = useState<boolean>(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState<boolean>(false);

  // Identifiant de cet onglet : permet d'ignorer l'écho de nos propres écritures dans le flux live
  const clientIdRef = useRef<string>(
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  );
  // Dernier état (JSON) connu comme identique à la base ; null tant qu'aucun instantané n'a été reçu
  const lastSyncedJsonRef = useRef<string | null>(null);
  const latestStateRef = useRef({ tasks, sessions, settings });
  latestStateRef.current = { tasks, sessions, settings };
  const authTokenRef = useRef<string | null>(authToken);
  authTokenRef.current = authToken;
  const retryTimeoutRef = useRef<number | null>(null);

  const timerRef = useRef<number | null>(null);

  const clearSession = useCallback(() => {
    try {
      localStorage.removeItem(STORAGE_KEYS.AUTH_TOKEN);
    } catch {
      // Ignore
    }
    if (retryTimeoutRef.current) window.clearTimeout(retryTimeoutRef.current);
    lastSyncedJsonRef.current = null;
    setAuthToken(null);
    setCurrentUser(null);
    setLastSyncedAt(null);
    setSyncStatus('idle');
    setIsLiveConnected(false);
  }, []);

  // Applique l'état venant de MongoDB (la base fait foi) sans le renvoyer au serveur
  const applyRemoteState = useCallback(
    (state: { tasks?: PomodoroTask[]; sessions?: SessionRecord[]; settings?: Partial<TimerSettings> }) => {
      const rawTasks = Array.isArray(state.tasks) ? state.tasks : [];
      const rawSessions = Array.isArray(state.sessions) ? state.sessions : [];
      const nextSettings = { ...DEFAULT_SETTINGS, ...(state.settings || {}) };
      const next = {
        tasks: withoutDemoEntries(rawTasks),
        sessions: withoutDemoEntries(rawSessions),
        settings: nextSettings,
      };
      // Si des entrées de démo ont été retirées, l'écart est détecté et la base est nettoyée
      lastSyncedJsonRef.current = JSON.stringify({
        tasks: rawTasks,
        sessions: rawSessions,
        settings: nextSettings,
      });
      if (JSON.stringify(next) === JSON.stringify(latestStateRef.current)) return;
      setTasks(next.tasks);
      setSessions(next.sessions);
      setSettings(next.settings);
    },
    []
  );

  const flushState = useCallback(function flush() {
    const token = authTokenRef.current;
    if (!token) return;
    if (retryTimeoutRef.current) window.clearTimeout(retryTimeoutRef.current);
    const snapshot = latestStateRef.current;
    const json = JSON.stringify(snapshot);
    if (json === lastSyncedJsonRef.current) {
      setSyncStatus('saved');
      return;
    }
    setSyncStatus('saving');
    fetch('/api/user/state', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ ...snapshot, clientId: clientIdRef.current }),
    })
      .then(async (r) => {
        if (r.status === 401) {
          clearSession();
          return;
        }
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const res = await r.json();
        lastSyncedJsonRef.current = json;
        if (res?.updatedAt) setLastSyncedAt(res.updatedAt);
        setSyncStatus(JSON.stringify(latestStateRef.current) === json ? 'saved' : 'saving');
      })
      .catch(() => {
        // Hors ligne ou base indisponible : on garde les données en local et on réessaie
        setSyncStatus('offline');
        retryTimeoutRef.current = window.setTimeout(flush, 5000);
      });
  }, [clearSession]);

  // Statut de la base (rafraîchi périodiquement ; poussé en direct via le flux quand connecté)
  useEffect(() => {
    const load = () =>
      fetch('/api/db/status')
        .then((r) => (r.ok ? r.json() : null))
        .then((info) => {
          if (info) setDbStatus(info);
        })
        .catch(() => {});
    load();
    const interval = window.setInterval(load, 30000);
    return () => window.clearInterval(interval);
  }, []);

  // Flux live : instantané initial puis chaque modification en base (autres onglets / appareils)
  useEffect(() => {
    if (!authToken) return;
    const source = new EventSource(`/api/user/stream?token=${encodeURIComponent(authToken)}`);

    source.addEventListener('open', () => setIsLiveConnected(true));
    source.addEventListener('error', () => setIsLiveConnected(false));
    source.addEventListener('db', (e) => {
      setDbStatus(JSON.parse((e as MessageEvent).data));
    });
    source.addEventListener('unauthorized', () => {
      source.close();
      clearSession();
    });
    source.addEventListener('state', (e) => {
      const payload = JSON.parse((e as MessageEvent).data) as {
        user?: AuthenticatedUser;
        state: { tasks?: PomodoroTask[]; sessions?: SessionRecord[]; settings?: Partial<TimerSettings> };
        originClientId: string | null;
        snapshot?: boolean;
        updatedAt?: string;
      };
      setIsLiveConnected(true);
      if (payload.user) setCurrentUser(payload.user);
      if (payload.updatedAt) setLastSyncedAt(payload.updatedAt);
      if (payload.originClientId === clientIdRef.current) return;

      const hasUnsyncedLocalChanges =
        lastSyncedJsonRef.current !== null &&
        JSON.stringify(latestStateRef.current) !== lastSyncedJsonRef.current;
      if (payload.snapshot && hasUnsyncedLocalChanges) {
        // Reconnexion après coupure : nos modifications hors ligne sont renvoyées à la base
        flushState();
        return;
      }
      applyRemoteState(payload.state);
      setSyncStatus('saved');
    });

    return () => {
      source.close();
      setIsLiveConnected(false);
    };
  }, [authToken, applyRemoteState, clearSession, flushState]);

  // Sauvegarde automatique (debounce) des tâches, sessions et réglages dans MongoDB
  useEffect(() => {
    if (!authToken || !currentUser || lastSyncedJsonRef.current === null) return;
    if (JSON.stringify({ tasks, sessions, settings }) === lastSyncedJsonRef.current) return;
    setSyncStatus('saving');
    const timeout = window.setTimeout(flushState, 500);
    return () => window.clearTimeout(timeout);
  }, [tasks, sessions, settings, authToken, currentUser, flushState]);

  // Persist to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.THEME, JSON.stringify(darkMode));
    } catch {
      // Ignore storage errors
    }
  }, [darkMode]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
    } catch {
      // Ignore storage errors
    }
  }, [settings]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.TASKS, JSON.stringify(tasks));
    } catch {
      // Ignore storage errors
    }
  }, [tasks]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.SESSIONS, JSON.stringify(sessions));
    } catch {
      // Ignore storage errors
    }
  }, [sessions]);

  // Total duration for current phase
  const totalPhaseSeconds = useMemo(() => {
    switch (phase) {
      case TimerPhase.FOCUS:
        return settings.focusMinutes * 60;
      case TimerPhase.SHORT_BREAK:
        return settings.shortBreakMinutes * 60;
      case TimerPhase.LONG_BREAK:
        return settings.longBreakMinutes * 60;
    }
  }, [phase, settings.focusMinutes, settings.shortBreakMinutes, settings.longBreakMinutes]);

  // Active task object
  const activeTask = useMemo(
    () => tasks.find((t) => t.id === activeTaskId) || null,
    [tasks, activeTaskId]
  );

  // Switch phase helper
  const switchPhase = useCallback(
    (nextPhase: TimerPhase, autoStart = false) => {
      setIsRunning(autoStart);
      setPhase(nextPhase);
      if (nextPhase === TimerPhase.FOCUS) {
        setSecondsLeft(settings.focusMinutes * 60);
        // Nouvelle citation et nouveau morceau d'ambiance tirés au hasard à chaque session
        setQuoteIndex((prev) => randomIndex(PRODUCTIVITY_QUOTES.length, prev));
        setTrackIndex((prev) => randomIndex(playlistLengthRef.current, prev));
      } else if (nextPhase === TimerPhase.SHORT_BREAK) {
        setSecondsLeft(settings.shortBreakMinutes * 60);
      } else {
        setSecondsLeft(settings.longBreakMinutes * 60);
      }
    },
    [settings.focusMinutes, settings.shortBreakMinutes, settings.longBreakMinutes]
  );

  // Handle timer completion
  const handlePhaseComplete = useCallback(() => {
    const completedDuration =
      phase === TimerPhase.FOCUS
        ? settings.focusMinutes
        : phase === TimerPhase.SHORT_BREAK
        ? settings.shortBreakMinutes
        : settings.longBreakMinutes;

    const newSession: SessionRecord = {
      id: `sess-${Date.now()}`,
      phase,
      durationMinutes: completedDuration,
      taskTitle: phase === TimerPhase.FOCUS && activeTask ? activeTask.title : null,
      completedAt: getCurrentTimeLabel(),
      completedDate: getLocalIsoDate(0),
      cycleIndex: currentCycle,
    };

    setSessions((prev) => [newSession, ...prev]);

    const nextPhase =
      phase === TimerPhase.FOCUS
        ? currentCycle >= settings.cyclesBeforeLongBreak
          ? TimerPhase.LONG_BREAK
          : TimerPhase.SHORT_BREAK
        : TimerPhase.FOCUS;

    if (settings.notificationsEnabled) {
      const notifResult = triggerPhaseNotification(
        phase,
        nextPhase,
        activeTask ? activeTask.title : null
      );
      setPhaseBanner({ title: notifResult.title, body: notifResult.body });
    }

    if (phase === TimerPhase.FOCUS) {
      playCompletionChime(settings.soundEnabled, true);

      // Increment active task completed pomodoros
      if (activeTaskId) {
        setTasks((prev) =>
          prev.map((task) => {
            if (task.id !== activeTaskId) return task;
            const updatedCount = task.completedPomodoros + 1;
            return {
              ...task,
              completedPomodoros: updatedCount,
            };
          })
        );
      }

      // Check if we reached long break threshold
      if (currentCycle >= settings.cyclesBeforeLongBreak) {
        switchPhase(TimerPhase.LONG_BREAK, settings.autoStartBreaks);
      } else {
        switchPhase(TimerPhase.SHORT_BREAK, settings.autoStartBreaks);
      }
    } else {
      playCompletionChime(settings.soundEnabled, false);
      if (phase === TimerPhase.LONG_BREAK) {
        setCurrentCycle(1);
      } else {
        setCurrentCycle((prev) => prev + 1);
      }
      switchPhase(TimerPhase.FOCUS, settings.autoStartFocus);
    }
  }, [
    phase,
    settings,
    activeTask,
    activeTaskId,
    currentCycle,
    switchPhase,
  ]);

  // Countdown interval
  useEffect(() => {
    if (!isRunning) {
      if (timerRef.current) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    timerRef.current = window.setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          window.setTimeout(() => handlePhaseComplete(), 0);
          return 0;
        }
        if (settings.ambientTickEnabled && phase === TimerPhase.FOCUS) {
          playSoftTick(true);
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [isRunning, handlePhaseComplete, settings.ambientTickEnabled, phase]);

  // Update document title with live countdown
  useEffect(() => {
    const phaseLabel =
      phase === TimerPhase.FOCUS
        ? 'Concentration'
        : phase === TimerPhase.SHORT_BREAK
        ? 'Pause courte'
        : 'Pause longue';

    if (isRunning) {
      document.title = `(${formatTime(secondsLeft)}) ${phaseLabel} — Kronova`;
    } else {
      document.title = 'Kronova — Le temps, un nouvel élan';
    }
  }, [secondsLeft, isRunning, phase]);

  // Toggle timer start/pause
  const toggleTimer = useCallback(() => {
    playTactileClick(settings.soundEnabled);
    setPhaseBanner(null);
    setInterceptedSiteWarning(null);
    if (!isRunning) {
      if (settings.notificationsEnabled && getNotificationPermission() === 'default') {
        requestBrowserNotificationPermission().then((perm) => {
          setNotificationPermission(perm);
        });
      }
      // If starting a fresh Focus session from full duration, refresh quote & optionally enter fullscreen
      if (phase === TimerPhase.FOCUS && secondsLeft === settings.focusMinutes * 60) {
        setQuoteIndex((prev) => randomIndex(PRODUCTIVITY_QUOTES.length, prev));
        setTrackIndex((prev) => randomIndex(playlistLengthRef.current, prev));
      }
      if (
        phase === TimerPhase.FOCUS &&
        settings.blockerEnabled &&
        settings.autoFullscreenOnFocus &&
        document.documentElement.requestFullscreen &&
        !document.fullscreenElement
      ) {
        document.documentElement.requestFullscreen().catch(() => {});
      }
    }
    setIsRunning((prev) => !prev);
  }, [
    settings.soundEnabled,
    settings.notificationsEnabled,
    settings.focusMinutes,
    settings.blockerEnabled,
    settings.autoFullscreenOnFocus,
    isRunning,
    phase,
    secondsLeft,
  ]);

  // Handle toggling or requesting browser notifications
  const handleToggleNotifications = async () => {
    playTactileClick(settings.soundEnabled);
    const nextEnabled = !settings.notificationsEnabled;
    setSettings((prev) => ({ ...prev, notificationsEnabled: nextEnabled }));

    if (nextEnabled) {
      const currentPerm = getNotificationPermission();
      if (currentPerm === 'default') {
        const result = await requestBrowserNotificationPermission();
        setNotificationPermission(result);
      } else {
        setNotificationPermission(currentPerm);
      }
    }
  };

  const handleRequestOrTestNotification = async () => {
    playTactileClick(settings.soundEnabled);
    const currentPerm = getNotificationPermission();
    if (currentPerm === 'default') {
      const result = await requestBrowserNotificationPermission();
      setNotificationPermission(result);
      if (result === 'granted') {
        const res = triggerPhaseNotification(
          TimerPhase.FOCUS,
          TimerPhase.SHORT_BREAK,
          activeTask ? activeTask.title : null
        );
        setPhaseBanner({ title: res.title, body: res.body });
      }
    } else {
      setNotificationPermission(currentPerm);
      const res = triggerPhaseNotification(
        phase,
        phase === TimerPhase.FOCUS ? TimerPhase.SHORT_BREAK : TimerPhase.FOCUS,
        activeTask ? activeTask.title : null
      );
      setPhaseBanner({ title: res.title, body: res.body });
    }
  };

  // Reset current timer
  const resetTimer = useCallback(() => {
    playTactileClick(settings.soundEnabled);
    setIsRunning(false);
    setSecondsLeft(totalPhaseSeconds);
  }, [settings.soundEnabled, totalPhaseSeconds]);

  // Skip to next phase manually
  const skipPhase = useCallback(() => {
    playTactileClick(settings.soundEnabled);
    setIsRunning(false);
    if (phase === TimerPhase.FOCUS) {
      if (currentCycle >= settings.cyclesBeforeLongBreak) {
        switchPhase(TimerPhase.LONG_BREAK, false);
      } else {
        switchPhase(TimerPhase.SHORT_BREAK, false);
      }
    } else {
      if (phase === TimerPhase.LONG_BREAK) {
        setCurrentCycle(1);
      } else {
        setCurrentCycle((prev) => prev + 1);
      }
      switchPhase(TimerPhase.FOCUS, false);
    }
  }, [phase, currentCycle, settings.cyclesBeforeLongBreak, settings.soundEnabled, switchPhase]);

  // Keyboard shortcuts (Space to toggle, R to reset, S to skip when not typing in an input)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable
      ) {
        return;
      }

      if (e.code === 'Space') {
        e.preventDefault();
        toggleTimer();
      } else if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        resetTimer();
      } else if (e.key === 's' || e.key === 'S') {
        e.preventDefault();
        skipPhase();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleTimer, resetTimer, skipPhase]);

  // Add new task
  const handleAddTask = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newTaskTitle.trim();
    if (!trimmed) return;

    playTactileClick(settings.soundEnabled);
    const created: PomodoroTask = {
      id: `task-${Date.now()}`,
      title: trimmed,
      category: newTaskCategory.trim() || 'Concentration',
      estimatedPomodoros: Math.max(1, Math.min(12, newTaskEstimate)),
      completedPomodoros: 0,
      completed: false,
      createdAt: getCurrentTimeLabel(),
    };

    setTasks((prev) => [created, ...prev]);
    if (!activeTaskId) {
      setActiveTaskId(created.id);
    }
    setNewTaskTitle('');
    setNewTaskEstimate(2);
  };

  // Toggle task completion
  const toggleTaskCompleted = (id: string) => {
    playTactileClick(settings.soundEnabled);
    setTasks((prev) =>
      prev.map((task) => (task.id === id ? { ...task, completed: !task.completed } : task))
    );
  };

  // Delete task
  const deleteTask = (id: string) => {
    playTactileClick(settings.soundEnabled);
    setTasks((prev) => prev.filter((task) => task.id !== id));
    if (activeTaskId === id) {
      const remaining = tasks.filter((t) => t.id !== id && !t.completed);
      setActiveTaskId(remaining.length > 0 ? remaining[0].id : null);
    }
  };

  // Adjust task estimated pomodoros
  const adjustTaskEstimate = (id: string, delta: number) => {
    setTasks((prev) =>
      prev.map((task) =>
        task.id === id
          ? {
              ...task,
              estimatedPomodoros: Math.max(1, Math.min(16, task.estimatedPomodoros + delta)),
            }
          : task
      )
    );
  };

  // Filtered tasks
  const filteredTasks = useMemo(() => {
    return tasks.filter((task) => {
      if (taskFilter === TaskFilter.ACTIVE && task.completed) return false;
      if (taskFilter === TaskFilter.COMPLETED && !task.completed) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          task.title.toLowerCase().includes(q) || task.category.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [tasks, taskFilter, searchQuery]);

  // Filtered sessions
  const filteredSessions = useMemo(() => {
    if (journalFilter === 'ALL') return sessions;
    return sessions.filter((s) => s.phase === journalFilter);
  }, [sessions, journalFilter]);

  // Summary metrics (today's focus sessions + overall task queue)
  const metrics = useMemo(() => {
    const todayIso = getLocalIsoDate(0);
    const todayFocusSessions = sessions.filter(
      (s) => s.phase === TimerPhase.FOCUS && (s.completedDate || todayIso) === todayIso
    );
    const totalFocusMinutes = todayFocusSessions.reduce((acc, s) => acc + s.durationMinutes, 0);
    const completedTasksCount = tasks.filter((t) => t.completed).length;
    const remainingPomodoros = tasks
      .filter((t) => !t.completed)
      .reduce((acc, t) => acc + Math.max(0, t.estimatedPomodoros - t.completedPomodoros), 0);

    return {
      focusCount: todayFocusSessions.length,
      totalFocusMinutes,
      completedTasksCount,
      remainingPomodoros,
      estimatedFinishMinutes: remainingPomodoros * settings.focusMinutes,
    };
  }, [sessions, tasks, settings.focusMinutes]);

  // Weekly chart data for the past 7 days (Recharts)
  const weeklyFocusData = useMemo(() => {
    const dayFormatter = new Intl.DateTimeFormat('fr-FR', { weekday: 'short' });
    const fullDateFormatter = new Intl.DateTimeFormat('fr-FR', {
      weekday: 'long',
      day: 'numeric',
      month: 'short',
    });
    const todayIso = getLocalIsoDate(0);

    return Array.from({ length: 7 }).map((_, idx) => {
      const daysAgo = 6 - idx;
      const isoDate = getLocalIsoDate(daysAgo);
      const dateObj = new Date();
      dateObj.setDate(dateObj.getDate() - daysAgo);

      const rawDay = dayFormatter.format(dateObj).replace('.', '');
      const shortDay = rawDay.charAt(0).toUpperCase() + rawDay.slice(1);
      const dateNumber = dateObj.getDate();

      const daySessions = sessions.filter(
        (s) =>
          s.phase === TimerPhase.FOCUS &&
          (s.completedDate || todayIso) === isoDate
      );

      const minutes = daySessions.reduce((sum, s) => sum + s.durationMinutes, 0);
      const cycles = daySessions.length;

      return {
        isoDate,
        label: `${shortDay} ${dateNumber}`,
        fullDate: fullDateFormatter.format(dateObj),
        minutes,
        cycles,
        isToday: daysAgo === 0,
      };
    });
  }, [sessions]);

  const weeklySummary = useMemo(() => {
    const totalMinutes = weeklyFocusData.reduce((acc, d) => acc + d.minutes, 0);
    const dailyAverage = Math.round(totalMinutes / 7);
    const totalCycles = weeklyFocusData.reduce((acc, d) => acc + d.cycles, 0);
    return { totalMinutes, dailyAverage, totalCycles };
  }, [weeklyFocusData]);

  // Export sessions to CSV
  const exportJournalCsv = () => {
    playTactileClick(settings.soundEnabled);
    const headers = ['ID', 'Phase', 'Duree (min)', 'Tache associee', 'Heure', 'Cycle'];
    const rows = sessions.map((s) => [
      s.id,
      s.phase === TimerPhase.FOCUS
        ? 'Concentration'
        : s.phase === TimerPhase.SHORT_BREAK
        ? 'Pause courte'
        : 'Pause longue',
      String(s.durationMinutes),
      `"${(s.taskTitle || 'Session libre').replace(/"/g, '""')}"`,
      s.completedAt,
      String(s.cycleIndex),
    ]);
    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `kronova-sessions-${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Apply timer preset
  const applyPreset = (focus: number, shortB: number, longB: number) => {
    playTactileClick(settings.soundEnabled);
    const updated: TimerSettings = {
      ...settings,
      focusMinutes: focus,
      shortBreakMinutes: shortB,
      longBreakMinutes: longB,
    };
    setSettings(updated);
    setIsRunning(false);
    if (phase === TimerPhase.FOCUS) setSecondsLeft(focus * 60);
    if (phase === TimerPhase.SHORT_BREAK) setSecondsLeft(shortB * 60);
    if (phase === TimerPhase.LONG_BREAK) setSecondsLeft(longB * 60);
  };

  // Progress calculation for SVG ring
  const progressFraction =
    totalPhaseSeconds > 0
      ? Math.max(0, Math.min(1, (totalPhaseSeconds - secondsLeft) / totalPhaseSeconds))
      : 0;
  const ringRadius = 134;
  const ringCircumference = 2 * Math.PI * ringRadius;
  const strokeDashoffset = ringCircumference * (1 - progressFraction);

  // Semantic phase accent (10% accent budget, always paired with text label)
  const phaseConfig = {
    [TimerPhase.FOCUS]: {
      label: 'Concentration profonde',
      shortLabel: 'Concentration',
      strokeClass: darkMode ? 'stroke-rose-500' : 'stroke-slate-900',
      buttonBg: darkMode
        ? 'bg-rose-500 text-white hover:bg-rose-400'
        : 'bg-slate-900 text-white hover:bg-slate-800',
      indicatorDot: 'bg-rose-500',
      description: 'Travaillez sur une seule tâche sans interruption jusqu’au signal sonore.',
    },
    [TimerPhase.SHORT_BREAK]: {
      label: 'Pause courte régénérante',
      shortLabel: 'Pause courte',
      strokeClass: 'stroke-emerald-600 dark:stroke-emerald-400',
      buttonBg: 'bg-emerald-600 text-white hover:bg-emerald-500',
      indicatorDot: 'bg-emerald-500',
      description: 'Éloignez-vous de l’écran, respirez profondément et hydratez-vous.',
    },
    [TimerPhase.LONG_BREAK]: {
      label: 'Pause longue complète',
      shortLabel: 'Pause longue',
      strokeClass: 'stroke-amber-600 dark:stroke-amber-400',
      buttonBg: 'bg-amber-600 text-white hover:bg-amber-500',
      indicatorDot: 'bg-amber-500',
      description: 'Cycle complet terminé. Prenez le temps de marcher et de relâcher votre attention.',
    },
  }[phase];

  const isMaxFocusActive =
    settings.zenModeEnabled && isRunning && activeView === ActiveView.WORKSPACE;

  const blockedDomainsList = settings.blockedDomains || DEFAULT_BLOCKED_DOMAINS;
  const isShieldEnforced =
    Boolean(settings.blockerEnabled) && isRunning && phase === TimerPhase.FOCUS;
  const isYouTubeVideoBlocked =
    isShieldEnforced &&
    blockedDomainsList.some((d) => d.toLowerCase().includes('youtube'));

  const currentQuote = PRODUCTIVITY_QUOTES[quoteIndex % PRODUCTIVITY_QUOTES.length];

  // Active tab-leave guard during Focus sessions when blocker is enabled
  useEffect(() => {
    if (!isShieldEnforced || !settings.strictTabGuardEnabled) return;

    const handleVisibilityChange = () => {
      if (document.hidden) {
        setDistractionsIntercepted((prev) => prev + 1);
        const blockedSummary = blockedDomainsList.slice(0, 3).join(', ');
        setInterceptedSiteWarning(
          `Sortie d’onglet détectée pendant la concentration. Accès restreint vers ${blockedSummary}.`
        );
        playCompletionChime(settings.soundEnabled, false);

        if (
          typeof window !== 'undefined' &&
          'Notification' in window &&
          Notification.permission === 'granted'
        ) {
          try {
            new Notification('Bouclier Anti-Distraction Kronova', {
              body: `Restez concentré ! Les sites (${blockedSummary}) sont bloqués pendant cette session de travail.`,
              tag: 'cadence-shield-alert',
            });
          } catch {
            // Ignore notification errors
          }
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [
    isShieldEnforced,
    settings.strictTabGuardEnabled,
    settings.soundEnabled,
    blockedDomainsList,
  ]);

  // Blocage réel dans les autres onglets : la session est publiée au serveur local,
  // que l'extension navigateur Kronova interroge pour rediriger les sites bloqués.
  const [blockerInfo, setBlockerInfo] = useState<BlockerInfo | null>(null);
  const secondsLeftRef = useRef(secondsLeft);
  secondsLeftRef.current = secondsLeft;
  const hasPublishedBlockerRef = useRef(false);
  const lastBlockerAttemptsRef = useRef<number | null>(null);
  const blockedDomainsKey = blockedDomainsList.join(',');

  useEffect(() => {
    // Au chargement, on ne lève pas un verrou posé avant un rechargement de la page
    if (!authToken) return;
    if (!isShieldEnforced && !hasPublishedBlockerRef.current) return;
    hasPublishedBlockerRef.current = true;
    fetch('/api/blocker/state', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({
        active: isShieldEnforced,
        domains: blockedDomainsList,
        endsAt: Date.now() + secondsLeftRef.current * 1000,
      }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((info) => {
        if (info) setBlockerInfo(info);
      })
      .catch(() => {});
  }, [isShieldEnforced, blockedDomainsKey, authToken]);

  useEffect(() => {
    if (!authToken) {
      setBlockerInfo(null);
      lastBlockerAttemptsRef.current = null;
      return;
    }
    const load = () =>
      fetch('/api/blocker/state', { headers: { Authorization: `Bearer ${authToken}` } })
        .then((r) => (r.ok ? r.json() : null))
        .then((info: BlockerInfo | null) => {
          if (!info) return;
          setBlockerInfo(info);
          const previous = lastBlockerAttemptsRef.current;
          if (previous !== null && info.attempts > previous && info.active) {
            setDistractionsIntercepted((prev) => prev + info.attempts - previous);
            setInterceptedSiteWarning(
              `Accès à ${info.lastAttempt?.domain || 'un site bloqué'} bloqué dans un autre onglet — il reste ${formatTime(secondsLeftRef.current)} de concentration.`
            );
          }
          lastBlockerAttemptsRef.current = info.attempts;
        })
        .catch(() => {});
    load();
    const interval = window.setInterval(load, isShieldEnforced ? 3000 : 15000);
    return () => window.clearInterval(interval);
  }, [isShieldEnforced, authToken]);

  const toggleBlockedDomain = (domain: string) => {
    playTactileClick(settings.soundEnabled);
    setSettings((prev) => {
      const current = prev.blockedDomains || DEFAULT_BLOCKED_DOMAINS;
      const exists = current.includes(domain);
      return {
        ...prev,
        blockedDomains: exists
          ? current.filter((d) => d !== domain)
          : [...current, domain],
      };
    });
  };

  const handleAddCustomDomain = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = customDomainInput
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .split('/')[0];
    if (!cleaned || !cleaned.includes('.')) return;

    playTactileClick(settings.soundEnabled);
    setSettings((prev) => {
      const current = prev.blockedDomains || DEFAULT_BLOCKED_DOMAINS;
      if (current.includes(cleaned)) return prev;
      return {
        ...prev,
        blockedDomains: [...current, cleaned],
      };
    });
    setCustomDomainInput('');
  };

  const handleSimulateBlockedAttempt = (domain: string) => {
    playTactileClick(settings.soundEnabled);
    if (isShieldEnforced && blockedDomainsList.includes(domain)) {
      setDistractionsIntercepted((prev) => prev + 1);
      setInterceptedSiteWarning(
        `Accès à ${domain} bloqué par Kronova — Il reste ${formatTime(secondsLeft)} dans votre session de travail.`
      );
    } else {
      setInterceptedSiteWarning(
        `Le domaine ${domain} sera verrouillé dès que vous démarrerez une session de concentration.`
      );
    }
  };

  const downloadHostsBlockerFile = () => {
    playTactileClick(settings.soundEnabled);
    const lines = [
      '# Kronova — Bouclier Anti-Distraction',
      '# Règles de blocage générées pour les sessions de travail',
      ...blockedDomainsList.flatMap((domain) => [
        `127.0.0.1 ${domain}`,
        `127.0.0.1 www.${domain}`,
      ]),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'kronova-blocage-hosts.txt');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const toggleFullscreenLock = () => {
    playTactileClick(settings.soundEnabled);
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else if (document.exitFullscreen && document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }
  };

  return (
    <div
      className={
        darkMode
          ? 'dark min-h-screen bg-[#0B0F17] text-slate-100 transition-colors duration-150 flex flex-col'
          : 'min-h-screen bg-[#FAFAFA] text-slate-900 transition-colors duration-150 flex flex-col'
      }
    >
      {/* Top Bar Contract: Hidden when Mode Concentration Maximale is active and timer is running */}
      {!isMaxFocusActive && (
        <header className="sticky top-0 z-30 border-b border-neutral-200/80 dark:border-slate-800/80 bg-[#FAFAFA]/90 dark:bg-[#0B0F17]/90 backdrop-blur-md">
          <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
            {/* Zone 1: Single text element wordmark */}
            <button
              type="button"
              onClick={() => setActiveView(ActiveView.WORKSPACE)}
              className="font-display text-2xl tracking-tight text-slate-900 dark:text-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-slate-900 dark:focus-visible:outline-white cursor-pointer"
            >
              Kronova
            </button>

            {/* Zone 2: 4 clean text navigation links */}
            <nav aria-label="Navigation principale" className="flex items-center gap-6 sm:gap-8">
              <button
                type="button"
                onClick={() => setActiveView(ActiveView.WORKSPACE)}
                className={`text-sm font-medium py-1 border-b-2 transition-colors whitespace-nowrap cursor-pointer ${
                  activeView === ActiveView.WORKSPACE
                    ? 'border-slate-900 dark:border-white text-slate-900 dark:text-white'
                    : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                Minuteur
              </button>
              <button
                type="button"
                onClick={() => setActiveView(ActiveView.TASKS)}
                className={`text-sm font-medium py-1 border-b-2 transition-colors whitespace-nowrap cursor-pointer ${
                  activeView === ActiveView.TASKS
                    ? 'border-slate-900 dark:border-white text-slate-900 dark:text-white'
                    : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                Tâches
              </button>
              <button
                type="button"
                onClick={() => setActiveView(ActiveView.JOURNAL)}
                className={`text-sm font-medium py-1 border-b-2 transition-colors whitespace-nowrap cursor-pointer ${
                  activeView === ActiveView.JOURNAL
                    ? 'border-slate-900 dark:border-white text-slate-900 dark:text-white'
                    : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                Journal
              </button>
              <button
                type="button"
                onClick={() => setActiveView(ActiveView.SETTINGS)}
                className={`text-sm font-medium py-1 border-b-2 transition-colors whitespace-nowrap cursor-pointer ${
                  activeView === ActiveView.SETTINGS
                    ? 'border-slate-900 dark:border-white text-slate-900 dark:text-white'
                    : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                Réglages
              </button>
            </nav>

            {/* Zone 3: 2 primary actions (Compte MongoDB & Theme) */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIsAuthModalOpen(true)}
                aria-label={
                  currentUser
                    ? `Compte connecté : ${currentUser.name}`
                    : 'Se connecter avec MongoDB'
                }
                className="min-h-[40px] px-3 py-2 rounded-lg border border-neutral-200 dark:border-slate-800 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-neutral-100 dark:hover:bg-slate-800/70 transition-colors flex items-center gap-2 whitespace-nowrap cursor-pointer"
              >
                <User className="w-4 h-4 shrink-0" />
                <span>{currentUser ? currentUser.name : 'Connexion'}</span>
                {authToken && (
                  <span
                    aria-hidden="true"
                    title={
                      isLiveConnected && syncStatus !== 'offline'
                        ? 'Synchronisé en direct avec MongoDB'
                        : 'Reconnexion à MongoDB…'
                    }
                    className={`w-2 h-2 rounded-full shrink-0 ${
                      !isLiveConnected || syncStatus === 'offline'
                        ? 'bg-amber-500'
                        : syncStatus === 'saving'
                        ? 'bg-sky-500 animate-pulse'
                        : 'bg-emerald-500'
                    }`}
                  />
                )}
              </button>

              <button
                type="button"
                onClick={() => setDarkMode((prev) => !prev)}
                aria-label={darkMode ? 'Passer au mode clair' : 'Passer au mode sombre'}
                className="min-h-[40px] min-w-[40px] p-2 rounded-lg border border-neutral-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-neutral-100 dark:hover:bg-slate-800/70 transition-colors flex items-center justify-center cursor-pointer"
              >
                {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </header>
      )}

      {/* Main Content Container */}
      <main
        className={
          isMaxFocusActive
            ? 'flex-1 flex items-center justify-center px-6 py-8'
            : 'max-w-6xl w-full mx-auto px-6 py-8 md:py-12'
        }
      >
        {/* Phase Completion Notification Banner */}
        {phaseBanner && (
          <div
            role="status"
            aria-live="assertive"
            className="mb-6 bg-white dark:bg-[#111827] border border-neutral-200 dark:border-slate-800 rounded-xl px-4 py-3.5 flex items-center justify-between gap-4"
          >
            <div className="flex items-center gap-3 min-w-0">
              <Bell className="w-4 h-4 text-slate-900 dark:text-white shrink-0" />
              <div className="text-xs sm:text-sm min-w-0">
                <span className="font-semibold text-slate-900 dark:text-white">
                  {phaseBanner.title}
                </span>
                <span className="text-slate-400 mx-2" aria-hidden="true">
                  ·
                </span>
                <span className="text-slate-600 dark:text-slate-300">{phaseBanner.body}</span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setPhaseBanner(null)}
              aria-label="Fermer la notification"
              className="p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white rounded-lg transition-colors cursor-pointer shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Anti-Distraction Interception Alert Banner */}
        {interceptedSiteWarning && (
          <div
            role="alert"
            className="mb-6 bg-white dark:bg-[#111827] border border-rose-300 dark:border-rose-800 rounded-xl px-4 py-3.5 flex items-center justify-between gap-4"
          >
            <div className="flex items-center gap-3 min-w-0">
              <ShieldAlert className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
              <div className="text-xs sm:text-sm min-w-0">
                <span className="font-semibold text-slate-900 dark:text-white">
                  Bouclier Anti-Distraction actif
                </span>
                <span className="text-slate-400 mx-2" aria-hidden="true">
                  ·
                </span>
                <span className="text-slate-600 dark:text-slate-300">
                  {interceptedSiteWarning}
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setInterceptedSiteWarning(null)}
              aria-label="Fermer l'alerte de blocage"
              className="p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white rounded-lg transition-colors cursor-pointer shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {activeView === ActiveView.WORKSPACE && (
          <div
            className={
              isMaxFocusActive
                ? 'w-full max-w-xl mx-auto flex flex-col items-center justify-center'
                : 'grid grid-cols-1 lg:grid-cols-12 gap-8 items-start'
            }
          >
            {/* Left Column (7 cols or centered in Mode Concentration Maximale): Precision Pomodoro Instrument */}
            <section
              aria-label="Instrument de chronométrage Pomodoro"
              className={
                isMaxFocusActive
                  ? 'w-full flex flex-col items-center justify-center py-8'
                  : 'lg:col-span-7 bg-white dark:bg-[#111827] border border-neutral-200 dark:border-slate-800 rounded-2xl p-6 sm:p-10 flex flex-col items-center'
              }
            >
              {/* Interactive Phase Segmented Control (Hidden in Mode Concentration Maximale) */}
              {!isMaxFocusActive && (
                <div
                  role="tablist"
                  aria-label="Phases de la méthode Pomodoro"
                  className="w-full max-w-md grid grid-cols-3 gap-1 p-1 bg-neutral-100 dark:bg-slate-800/90 rounded-xl mb-8"
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={phase === TimerPhase.FOCUS}
                    onClick={() => {
                      playTactileClick(settings.soundEnabled);
                      switchPhase(TimerPhase.FOCUS, false);
                    }}
                    className={`py-2 px-3 rounded-lg text-xs font-medium transition-colors whitespace-nowrap truncate cursor-pointer ${
                      phase === TimerPhase.FOCUS
                        ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    Concentration · {settings.focusMinutes}m
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={phase === TimerPhase.SHORT_BREAK}
                    onClick={() => {
                      playTactileClick(settings.soundEnabled);
                      switchPhase(TimerPhase.SHORT_BREAK, false);
                    }}
                    className={`py-2 px-3 rounded-lg text-xs font-medium transition-colors whitespace-nowrap truncate cursor-pointer ${
                      phase === TimerPhase.SHORT_BREAK
                        ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    Pause courte · {settings.shortBreakMinutes}m
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={phase === TimerPhase.LONG_BREAK}
                    onClick={() => {
                      playTactileClick(settings.soundEnabled);
                      switchPhase(TimerPhase.LONG_BREAK, false);
                    }}
                    className={`py-2 px-3 rounded-lg text-xs font-medium transition-colors whitespace-nowrap truncate cursor-pointer ${
                      phase === TimerPhase.LONG_BREAK
                        ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    Pause longue · {settings.longBreakMinutes}m
                  </button>
                </div>
              )}

              {/* Explicit Semantic Phase Label & Cycle Status (Zero-Pill Unboxed Metadata) */}
              <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 mb-4">
                <span className={`w-2 h-2 rounded-full ${phaseConfig.indicatorDot}`} />
                <span className="font-medium text-slate-800 dark:text-slate-200">
                  {phaseConfig.label}
                </span>
                <span aria-hidden="true">·</span>
                <span className="font-mono-tabular">
                  Cycle {currentCycle} sur {settings.cyclesBeforeLongBreak}
                </span>
                {!isMaxFocusActive && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>{isRunning ? 'En cours' : 'En attente'}</span>
                  </>
                )}
              </div>

              {/* Radial SVG Dial + Tabular Monospace Countdown */}
              <div className="relative my-2 flex items-center justify-center">
                <svg
                  className={
                    isMaxFocusActive
                      ? 'w-80 h-80 sm:w-96 sm:h-96 -rotate-90 transform transition-transform duration-300'
                      : 'w-72 h-72 sm:w-80 sm:h-80 -rotate-90 transform transition-transform duration-300'
                  }
                  viewBox="0 0 300 300"
                  aria-hidden="true"
                >
                  {/* Background Track */}
                  <circle
                    cx="150"
                    cy="150"
                    r={ringRadius}
                    fill="none"
                    strokeWidth="6"
                    className="stroke-neutral-200/70 dark:stroke-slate-800"
                  />
                  {/* Subtle Minute Tick Marks (12 indices) */}
                  {Array.from({ length: 12 }).map((_, index) => {
                    const angle = (index * 30 * Math.PI) / 180;
                    const x1 = 150 + (ringRadius - 12) * Math.cos(angle);
                    const y1 = 150 + (ringRadius - 12) * Math.sin(angle);
                    const x2 = 150 + (ringRadius - 6) * Math.cos(angle);
                    const y2 = 150 + (ringRadius - 6) * Math.sin(angle);
                    return (
                      <line
                        key={index}
                        x1={x1}
                        y1={y1}
                        x2={x2}
                        y2={y2}
                        strokeWidth="1.5"
                        className="stroke-neutral-300 dark:stroke-slate-700"
                      />
                    );
                  })}
                  {/* Active Progress Ring */}
                  <circle
                    cx="150"
                    cy="150"
                    r={ringRadius}
                    fill="none"
                    strokeWidth="6"
                    strokeLinecap="round"
                    strokeDasharray={ringCircumference}
                    strokeDashoffset={strokeDashoffset}
                    className={`${phaseConfig.strokeClass} transition-all duration-300`}
                  />
                </svg>

                {/* Center Readout */}
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6">
                  <div
                    role="timer"
                    aria-live="polite"
                    aria-label={formatTime(secondsLeft)}
                    className="font-mono-tabular text-6xl sm:text-7xl font-semibold tracking-tight text-slate-900 dark:text-white select-none inline-flex items-center justify-center overflow-hidden leading-none py-1"
                  >
                    {formatTime(secondsLeft)
                      .split('')
                      .map((char, index) => {
                        if (char === ':') {
                          return (
                            <span
                              key={`sep-${index}`}
                              aria-hidden="true"
                              className={`inline-block px-0.5 transition-opacity duration-300 ${
                                isRunning && phase === TimerPhase.FOCUS
                                  ? 'opacity-80'
                                  : 'opacity-100'
                              }`}
                            >
                              :
                            </span>
                          );
                        }
                        return (
                          <span
                            key={`slot-${index}`}
                            aria-hidden="true"
                            className="relative inline-flex justify-center overflow-hidden w-[1ch]"
                          >
                            <AnimatePresence mode="popLayout" initial={false}>
                              <motion.span
                                key={`${index}-${char}`}
                                initial={{ y: 14, opacity: 0 }}
                                animate={{ y: 0, opacity: 1 }}
                                exit={{ y: -14, opacity: 0 }}
                                transition={{
                                  duration: 0.18,
                                  ease: [0.16, 1, 0.3, 1],
                                }}
                                className="inline-block"
                              >
                                {char}
                              </motion.span>
                            </AnimatePresence>
                          </span>
                        );
                      })}
                  </div>
                  <p className="mt-3 text-xs text-slate-500 dark:text-slate-400 font-mono-tabular">
                    {Math.round(progressFraction * 100)}% accompli
                  </p>
                </div>
              </div>

              {/* Active Task Minimal Caption in Mode Concentration Maximale */}
              {isMaxFocusActive && activeTask && (
                <p className="mt-2 mb-4 text-sm font-medium text-slate-600 dark:text-slate-300 text-center max-w-md truncate">
                  {activeTask.title}
                </p>
              )}

              {/* Cycle Visual Dots */}
              <div
                className="flex items-center gap-2.5 my-5"
                aria-label={`Progression des cycles : ${currentCycle} sur ${settings.cyclesBeforeLongBreak}`}
              >
                {Array.from({ length: settings.cyclesBeforeLongBreak }).map((_, idx) => {
                  const cycleNum = idx + 1;
                  const isCompleted = cycleNum < currentCycle;
                  const isCurrent = cycleNum === currentCycle;
                  return (
                    <span
                      key={cycleNum}
                      className={`h-2 rounded-full transition-all ${
                        isCurrent
                          ? 'w-6 bg-slate-900 dark:bg-white'
                          : isCompleted
                          ? 'w-2 bg-slate-400 dark:bg-slate-500'
                          : 'w-2 bg-neutral-200 dark:bg-slate-800'
                      }`}
                    />
                  );
                })}
              </div>

              {/* Primary Instrument Controls */}
              <div className="flex items-center gap-3 mt-2 w-full max-w-sm justify-center">
                {!isMaxFocusActive && (
                  <button
                    type="button"
                    onClick={resetTimer}
                    title="Réinitialiser (Touche R)"
                    aria-label="Réinitialiser le minuteur"
                    className="min-h-[44px] min-w-[44px] px-4 py-2.5 rounded-xl border border-neutral-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-neutral-100 dark:hover:bg-slate-800 transition-colors flex items-center justify-center cursor-pointer"
                  >
                    <RotateCcw className="w-4 h-4" />
                  </button>
                )}

                <button
                  type="button"
                  onClick={toggleTimer}
                  className={`min-h-[48px] px-6 py-3 rounded-xl font-medium text-sm transition-transform active:scale-[0.99] flex items-center justify-center gap-2.5 whitespace-nowrap cursor-pointer ${
                    isMaxFocusActive
                      ? 'border border-neutral-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-neutral-100 dark:hover:bg-slate-800'
                      : `flex-1 ${phaseConfig.buttonBg}`
                  }`}
                >
                  {isRunning ? (
                    <>
                      <Pause className="w-4 h-4 fill-current" />
                      <span>Mettre en pause</span>
                    </>
                  ) : (
                    <>
                      <Play className="w-4 h-4 fill-current" />
                      <span>Démarrer la session</span>
                    </>
                  )}
                </button>

                {!isMaxFocusActive && (
                  <button
                    type="button"
                    onClick={skipPhase}
                    title="Passer à l'étape suivante (Touche S)"
                    aria-label="Passer à l'étape suivante"
                    className="min-h-[44px] min-w-[44px] px-4 py-2.5 rounded-xl border border-neutral-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-neutral-100 dark:hover:bg-slate-800 transition-colors flex items-center justify-center cursor-pointer"
                  >
                    <SkipForward className="w-4 h-4" />
                  </button>
                )}
              </div>

              {/* Active Task Focus Footer inside Instrument (Hidden in Mode Concentration Maximale) */}
              {!isMaxFocusActive && (
                <>
                  <div className="w-full mt-8 pt-6 border-t border-neutral-200/80 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-2">
                        <span>Tâche associée</span>
                        {activeTask && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono-tabular">
                              {activeTask.completedPomodoros} / {activeTask.estimatedPomodoros} cycles
                            </span>
                          </>
                        )}
                      </div>
                      <p className="text-sm font-medium text-slate-900 dark:text-white truncate mt-0.5">
                        {activeTask
                          ? activeTask.title
                          : 'Aucune tâche sélectionnée — Session libre'}
                      </p>
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      {activeTask && !activeTask.completed && (
                        <button
                          type="button"
                          onClick={() => toggleTaskCompleted(activeTask.id)}
                          className="min-h-[40px] px-3 py-1.5 rounded-lg border border-neutral-200 dark:border-slate-800 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-neutral-100 dark:hover:bg-slate-800 transition-colors flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
                        >
                          <Check className="w-3.5 h-3.5" />
                          <span>Marquer terminée</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Subtle Keyboard Shortcuts Legend */}
                  <div className="w-full mt-4 pt-3 border-t border-neutral-100 dark:border-slate-800/60 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400 dark:text-slate-500">
                    <span>{phaseConfig.description}</span>
                    <span className="font-mono-tabular hidden sm:inline">
                      Espace : Démarrer/Pause · R : Réinitialiser · S : Passer
                    </span>
                  </div>
                </>
              )}

              {/* YouTube Ambient Audio Player (https://www.youtube.com/watch?v=IJbIvkm4S_M) */}
              <YouTubeAmbientPlayer
                enabled={Boolean(settings.youtubeAmbientEnabled)}
                youtubeUrl={currentTrackUrl}
                trackPosition={
                  ambientPlaylist.length > 1
                    ? `${(trackIndex % ambientPlaylist.length) + 1}/${ambientPlaylist.length}`
                    : undefined
                }
                onShuffle={
                  ambientPlaylist.length > 1
                    ? () => setTrackIndex((prev) => randomIndex(ambientPlaylist.length, prev))
                    : undefined
                }
                syncWithTimer={Boolean(settings.youtubeSyncWithTimer)}
                isTimerRunning={isRunning}
                isFocusPhase={phase === TimerPhase.FOCUS}
                volume={settings.youtubeVolume ?? 50}
                isMaxFocusActive={isMaxFocusActive}
                isVideoBlockedByShield={isYouTubeVideoBlocked}
                onToggleEnabled={() =>
                  setSettings((prev) => ({
                    ...prev,
                    youtubeAmbientEnabled: !prev.youtubeAmbientEnabled,
                  }))
                }
                onVolumeChange={(vol) =>
                  setSettings((prev) => ({
                    ...prev,
                    youtubeVolume: vol,
                  }))
                }
              />

              {/* Inspirational Productivity Quote Section (Updated on each new Focus session) */}
              <div
                aria-label="Citation inspirante sur la productivité"
                className={
                  isMaxFocusActive
                    ? 'mt-8 max-w-md text-center'
                    : 'w-full mt-6 pt-5 border-t border-neutral-200/80 dark:border-slate-800'
                }
              >
                <div className="flex items-start justify-between gap-4">
                  <AnimatePresence mode="wait">
                    <motion.blockquote
                      key={currentQuote.id}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -6 }}
                      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                      className="flex-1"
                    >
                      <p className="font-display italic text-lg sm:text-xl text-slate-800 dark:text-slate-200 leading-relaxed">
                        « {currentQuote.text} »
                      </p>
                      <footer className="mt-1.5 text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5 justify-start">
                        <span className="font-medium text-slate-700 dark:text-slate-300">
                          {currentQuote.author}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>{currentQuote.work}</span>
                      </footer>
                    </motion.blockquote>
                  </AnimatePresence>

                  {!isMaxFocusActive && (
                    <button
                      type="button"
                      onClick={() => {
                        playTactileClick(settings.soundEnabled);
                        setQuoteIndex((prev) => randomIndex(PRODUCTIVITY_QUOTES.length, prev));
                      }}
                      title="Afficher une autre citation"
                      aria-label="Afficher une autre citation inspirante"
                      className="p-2 rounded-lg text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-slate-800 transition-colors cursor-pointer shrink-0"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Anti-Distraction Shield Control Strip under the Timer */}
              {!isMaxFocusActive && (
                <div className="w-full mt-5 pt-5 border-t border-neutral-200/80 dark:border-slate-800">
                  <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                    <div className="flex items-center gap-2 text-xs">
                      <Shield
                        className={`w-4 h-4 shrink-0 ${
                          isShieldEnforced
                            ? 'text-rose-600 dark:text-rose-400'
                            : 'text-slate-500 dark:text-slate-400'
                        }`}
                      />
                      <span className="font-semibold text-slate-900 dark:text-white">
                        Bouclier Anti-Distraction
                      </span>
                      <span aria-hidden="true" className="text-slate-400">
                        ·
                      </span>
                      <span className="text-slate-500 dark:text-slate-400">
                        {isShieldEnforced
                          ? `Verrouillage actif (${blockedDomainsList.length} sites)`
                          : settings.blockerEnabled
                          ? 'Prêt pour la session de travail'
                          : 'Désactivé'}
                      </span>
                      {settings.blockerEnabled && blockerInfo && (
                        <>
                          <span aria-hidden="true" className="text-slate-400">
                            ·
                          </span>
                          <span
                            className={
                              blockerInfo.extensionConnected
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : 'text-amber-600 dark:text-amber-400'
                            }
                          >
                            {blockerInfo.extensionConnected
                              ? 'Blocage dans tous les onglets'
                              : 'Extension Kronova non détectée'}
                          </span>
                        </>
                      )}
                      {distractionsIntercepted > 0 && (
                        <>
                          <span aria-hidden="true" className="text-slate-400">
                            ·
                          </span>
                          <span className="font-mono-tabular text-rose-600 dark:text-rose-400 font-medium">
                            {distractionsIntercepted} distraction{distractionsIntercepted > 1 ? 's' : ''} bloquée{distractionsIntercepted > 1 ? 's' : ''}
                          </span>
                        </>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={toggleFullscreenLock}
                        className="px-2.5 py-1 rounded-lg border border-neutral-200 dark:border-slate-800 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-neutral-100 dark:hover:bg-slate-800 transition-colors flex items-center gap-1.5 cursor-pointer"
                      >
                        <Maximize2 className="w-3 h-3" />
                        <span>Plein écran</span>
                      </button>

                      <button
                        type="button"
                        role="switch"
                        aria-checked={Boolean(settings.blockerEnabled)}
                        aria-label="Activer le blocage anti-distraction"
                        onClick={() =>
                          setSettings((prev) => ({
                            ...prev,
                            blockerEnabled: !prev.blockerEnabled,
                          }))
                        }
                        className={`w-9 h-5 rounded-full transition-colors p-0.5 cursor-pointer ${
                          settings.blockerEnabled
                            ? 'bg-slate-900 dark:bg-white'
                            : 'bg-neutral-200 dark:bg-slate-700'
                        }`}
                      >
                        <span
                          className={`block w-4 h-4 rounded-full bg-white dark:bg-slate-900 transition-transform ${
                            settings.blockerEnabled ? 'translate-x-4' : 'translate-x-0'
                          }`}
                        />
                      </button>
                    </div>
                  </div>

                  {/* Quick Site Blocker Toggles (YouTube, Facebook, Netflix, etc.) */}
                  {settings.blockerEnabled && (
                    <div className="flex flex-wrap items-center gap-2">
                      {PRESET_DISTRACTION_SITES.slice(0, 5).map((site) => {
                        const isBlocked = blockedDomainsList.includes(site.domain);
                        return (
                          <button
                            key={site.domain}
                            type="button"
                            onClick={() =>
                              isShieldEnforced && isBlocked
                                ? handleSimulateBlockedAttempt(site.domain)
                                : toggleBlockedDomain(site.domain)
                            }
                            className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 cursor-pointer ${
                              isBlocked
                                ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900'
                                : 'border border-neutral-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                            }`}
                          >
                            {isBlocked && <Lock className="w-3 h-3" />}
                            <span>{site.label}</span>
                          </button>
                        );
                      })}
                      <button
                        type="button"
                        onClick={() => setActiveView(ActiveView.SETTINGS)}
                        className="px-2.5 py-1 rounded-lg text-xs text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
                      >
                        Gérer la liste ({blockedDomainsList.length}) →
                      </button>
                    </div>
                  )}
                </div>
              )}
            </section>

            {/* Right Column (5 cols): Task Queue & Session Metrics (Hidden in Mode Concentration Maximale) */}
            {!isMaxFocusActive && (
              <aside className="lg:col-span-5 flex flex-col gap-6">
              {/* Real-Time Gemini 3.8 Live Voice Coach */}
              <LiveVoiceCoach
                currentTaskTitle={activeTask ? activeTask.title : null}
                currentPhaseLabel={phaseConfig.shortLabel}
                isMaxFocusActive={isMaxFocusActive}
                authToken={authToken}
              />

              {/* Compact Quantitative Summary Strip (Single-Elevation Surface) */}
              <div className="bg-white dark:bg-[#111827] border border-neutral-200 dark:border-slate-800 rounded-2xl p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                    Bilan de la journée
                  </h2>
                  <button
                    type="button"
                    onClick={() => setActiveView(ActiveView.JOURNAL)}
                    className="text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white flex items-center gap-1 transition-colors cursor-pointer"
                  >
                    <span>Journal complet</span>
                    <ArrowUpRight className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="grid grid-cols-3 divide-x divide-neutral-200 dark:divide-slate-800">
                  <div className="pr-4">
                    <div className="font-mono-tabular text-2xl font-semibold text-slate-900 dark:text-white">
                      {metrics.focusCount}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      Cycles finis
                    </div>
                  </div>
                  <div className="px-4">
                    <div className="font-mono-tabular text-2xl font-semibold text-slate-900 dark:text-white">
                      {metrics.totalFocusMinutes}m
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      Concentration
                    </div>
                  </div>
                  <div className="pl-4">
                    <div className="font-mono-tabular text-2xl font-semibold text-slate-900 dark:text-white">
                      {metrics.estimatedFinishMinutes}m
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      Reste estimé
                    </div>
                  </div>
                </div>
              </div>

              {/* Active Task Queue Panel */}
              <div className="bg-white dark:bg-[#111827] border border-neutral-200 dark:border-slate-800 rounded-2xl p-6">
                <div className="flex items-center justify-between gap-2 mb-4">
                  <div>
                    <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                      File de tâches
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      Sélectionnez une tâche pour y associer vos prochains Pomodoros
                    </p>
                  </div>

                  {/* Interactive Filter Segmented Control */}
                  <div className="flex items-center gap-1 p-1 bg-neutral-100 dark:bg-slate-800 rounded-lg shrink-0">
                    <button
                      type="button"
                      onClick={() => setTaskFilter(TaskFilter.ALL)}
                      className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                        taskFilter === TaskFilter.ALL
                          ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                      }`}
                    >
                      Toutes
                    </button>
                    <button
                      type="button"
                      onClick={() => setTaskFilter(TaskFilter.ACTIVE)}
                      className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                        taskFilter === TaskFilter.ACTIVE
                          ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                      }`}
                    >
                      À faire
                    </button>
                    <button
                      type="button"
                      onClick={() => setTaskFilter(TaskFilter.COMPLETED)}
                      className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                        taskFilter === TaskFilter.COMPLETED
                          ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                      }`}
                    >
                      Finies
                    </button>
                  </div>
                </div>

                {/* Quick Task Creation Form */}
                <form onSubmit={handleAddTask} className="mb-5">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newTaskTitle}
                      onChange={(e) => setNewTaskTitle(e.target.value)}
                      placeholder="Ajouter une tâche et estimer ses cycles..."
                      aria-label="Titre de la nouvelle tâche"
                      className="flex-1 min-h-[42px] px-3.5 py-2 text-sm bg-neutral-50 dark:bg-slate-900 border border-neutral-200 dark:border-slate-800 rounded-xl text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-slate-900 dark:focus:border-slate-400 transition-colors"
                    />
                    <div className="flex items-center border border-neutral-200 dark:border-slate-800 rounded-xl bg-neutral-50 dark:bg-slate-900 px-2">
                      <label htmlFor="quick-estimate" className="sr-only">
                        Nombre de Pomodoros estimés
                      </label>
                      <input
                        id="quick-estimate"
                        type="number"
                        min={1}
                        max={12}
                        value={newTaskEstimate}
                        onChange={(e) => setNewTaskEstimate(Number(e.target.value) || 1)}
                        title="Nombre de cycles Pomodoro estimés"
                        className="w-10 text-center font-mono-tabular text-xs font-medium bg-transparent text-slate-900 dark:text-white focus:outline-none"
                      />
                      <span className="text-[11px] text-slate-400 pr-1">cyc.</span>
                    </div>
                    <button
                      type="submit"
                      aria-label="Ajouter la tâche"
                      className="min-h-[42px] px-4 py-2 bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-medium rounded-xl hover:bg-slate-800 dark:hover:bg-slate-200 transition-colors flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
                    >
                      <Plus className="w-4 h-4" />
                      <span>Ajouter</span>
                    </button>
                  </div>
                </form>

                {/* Task Rows (Divide-y hairline list, no cards within cards) */}
                {filteredTasks.length === 0 ? (
                  <div className="py-10 text-center border-t border-neutral-100 dark:border-slate-800/70">
                    <p className="text-sm text-slate-600 dark:text-slate-400">
                      Aucune tâche dans cette vue.
                    </p>
                    <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
                      Ajoutez un objectif ci-dessus pour structurer votre séance Pomodoro.
                    </p>
                  </div>
                ) : (
                  <ul className="divide-y divide-neutral-200/70 dark:divide-slate-800/80 border-t border-neutral-200/70 dark:border-slate-800/80">
                    {filteredTasks.map((task) => {
                      const isSelected = task.id === activeTaskId;
                      return (
                        <li
                          key={task.id}
                          className={`py-3.5 flex items-start justify-between gap-3 transition-colors ${
                            isSelected ? 'bg-neutral-50/80 dark:bg-slate-800/30 -mx-3 px-3 rounded-xl' : ''
                          }`}
                        >
                          <div className="flex items-start gap-3 min-w-0 flex-1">
                            <button
                              type="button"
                              onClick={() => toggleTaskCompleted(task.id)}
                              aria-label={
                                task.completed
                                  ? `Marquer "${task.title}" comme non terminée`
                                  : `Marquer "${task.title}" comme terminée`
                              }
                              className="mt-0.5 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer shrink-0"
                            >
                              {task.completed ? (
                                <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                              ) : (
                                <Circle className="w-4 h-4" />
                              )}
                            </button>

                            <button
                              type="button"
                              onClick={() => setActiveTaskId(task.id)}
                              className="text-left min-w-0 flex-1 cursor-pointer group"
                            >
                              <p
                                className={`text-sm font-medium leading-snug transition-colors ${
                                  task.completed
                                    ? 'line-through text-slate-400 dark:text-slate-500'
                                    : 'text-slate-900 dark:text-white group-hover:text-slate-600 dark:group-hover:text-slate-300'
                                }`}
                              >
                                {task.title}
                              </p>
                              {/* Zero-Pill Metadata: Unboxed text with subtle separators */}
                              <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 mt-1">
                                <span>{task.category}</span>
                                <span aria-hidden="true">·</span>
                                <span className="font-mono-tabular">
                                  {task.completedPomodoros} / {task.estimatedPomodoros} cycles
                                </span>
                                {isSelected && (
                                  <>
                                    <span aria-hidden="true">·</span>
                                    <span className="font-medium text-slate-900 dark:text-white">
                                      Cible active
                                    </span>
                                  </>
                                )}
                              </div>
                            </button>
                          </div>

                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => deleteTask(task.id)}
                              aria-label={`Supprimer la tâche ${task.title}`}
                              className="p-1.5 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 rounded-lg transition-colors cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </aside>
            )}
          </div>
        )}

        {/* Dedicated Full-Width Tasks View */}
        {activeView === ActiveView.TASKS && (
          <section aria-label="Gestionnaire de tâches Pomodoro" className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-neutral-200 dark:border-slate-800 pb-6">
              <div>
                <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">
                  Planification des tâches
                </h1>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                  Décomposez votre travail en unités de {settings.focusMinutes} minutes et suivez l’écart entre estimation et réel.
                </p>
              </div>

              <div className="flex items-center gap-3">
                <div className="relative">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="search"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Rechercher une tâche..."
                    className="pl-9 pr-3.5 py-2 text-xs bg-white dark:bg-[#111827] border border-neutral-200 dark:border-slate-800 rounded-xl text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-slate-900 dark:focus:border-slate-400"
                  />
                </div>

                <div className="flex items-center gap-1 p-1 bg-neutral-100 dark:bg-slate-800 rounded-xl">
                  <button
                    type="button"
                    onClick={() => setTaskFilter(TaskFilter.ALL)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
                      taskFilter === TaskFilter.ALL
                        ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    Toutes ({tasks.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setTaskFilter(TaskFilter.ACTIVE)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
                      taskFilter === TaskFilter.ACTIVE
                        ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    En cours ({tasks.filter((t) => !t.completed).length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setTaskFilter(TaskFilter.COMPLETED)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
                      taskFilter === TaskFilter.COMPLETED
                        ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    Terminées ({tasks.filter((t) => t.completed).length})
                  </button>
                </div>
              </div>
            </div>

            {/* New Task Bar */}
            <form
              onSubmit={handleAddTask}
              className="bg-white dark:bg-[#111827] border border-neutral-200 dark:border-slate-800 rounded-2xl p-5 flex flex-col sm:flex-row items-stretch sm:items-center gap-3"
            >
              <input
                type="text"
                value={newTaskTitle}
                onChange={(e) => setNewTaskTitle(e.target.value)}
                placeholder="Intitulé de la tâche à planifier..."
                className="flex-1 min-h-[42px] px-3.5 py-2 text-sm bg-neutral-50 dark:bg-slate-900 border border-neutral-200 dark:border-slate-800 rounded-xl text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-slate-900 dark:focus:border-slate-400"
              />
              <input
                type="text"
                value={newTaskCategory}
                onChange={(e) => setNewTaskCategory(e.target.value)}
                placeholder="Domaine (ex: Conception)"
                className="sm:w-44 min-h-[42px] px-3.5 py-2 text-sm bg-neutral-50 dark:bg-slate-900 border border-neutral-200 dark:border-slate-800 rounded-xl text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-slate-900 dark:focus:border-slate-400"
              />
              <div className="flex items-center gap-2 px-3 min-h-[42px] bg-neutral-50 dark:bg-slate-900 border border-neutral-200 dark:border-slate-800 rounded-xl">
                <span className="text-xs text-slate-500 dark:text-slate-400">Cycles :</span>
                <input
                  type="number"
                  min={1}
                  max={16}
                  value={newTaskEstimate}
                  onChange={(e) => setNewTaskEstimate(Number(e.target.value) || 1)}
                  className="w-12 text-center font-mono-tabular text-sm font-medium bg-transparent text-slate-900 dark:text-white focus:outline-none"
                />
              </div>
              <button
                type="submit"
                className="min-h-[42px] px-5 py-2 bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-medium rounded-xl hover:bg-slate-800 dark:hover:bg-slate-200 transition-colors flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>Ajouter à la liste</span>
              </button>
            </form>

            {/* High-Density Task Table */}
            <div className="bg-white dark:bg-[#111827] border border-neutral-200 dark:border-slate-800 rounded-2xl overflow-hidden">
              {filteredTasks.length === 0 ? (
                <div className="p-12 text-center">
                  <p className="text-sm font-medium text-slate-900 dark:text-white">
                    Aucune tâche trouvée
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    Modifiez vos filtres ou ajoutez une nouvelle tâche ci-dessus.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-neutral-200 dark:border-slate-800 text-xs font-medium text-slate-500 dark:text-slate-400">
                        <th className="py-3.5 pl-6 pr-3 w-10">État</th>
                        <th className="py-3.5 px-3">Tâche</th>
                        <th className="py-3.5 px-3">Domaine · Heure</th>
                        <th className="py-3.5 px-3 text-right">Cycles (Réel / Estimé)</th>
                        <th className="py-3.5 pl-3 pr-6 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-200/70 dark:divide-slate-800 text-sm">
                      {filteredTasks.map((task) => {
                        const isTarget = task.id === activeTaskId;
                        return (
                          <tr
                            key={task.id}
                            className="hover:bg-neutral-50/80 dark:hover:bg-slate-800/40 transition-colors"
                          >
                            <td className="py-3.5 pl-6 pr-3">
                              <button
                                type="button"
                                onClick={() => toggleTaskCompleted(task.id)}
                                className="text-slate-400 hover:text-slate-900 dark:hover:text-white cursor-pointer"
                              >
                                {task.completed ? (
                                  <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                                ) : (
                                  <Circle className="w-4 h-4" />
                                )}
                              </button>
                            </td>
                            <td className="py-3.5 px-3 font-medium text-slate-900 dark:text-white">
                              <span className={task.completed ? 'line-through text-slate-400' : ''}>
                                {task.title}
                              </span>
                            </td>
                            <td className="py-3.5 px-3 text-xs text-slate-500 dark:text-slate-400">
                              <span>{task.category}</span>
                              <span aria-hidden="true"> · </span>
                              <span className="font-mono-tabular">{task.createdAt}</span>
                            </td>
                            <td className="py-3.5 px-3 text-right font-mono-tabular text-xs">
                              <div className="inline-flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => adjustTaskEstimate(task.id, -1)}
                                  className="w-6 h-6 rounded border border-neutral-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-neutral-100 dark:hover:bg-slate-800 cursor-pointer"
                                >
                                  -
                                </button>
                                <span className="min-w-[44px] text-center font-medium text-slate-900 dark:text-white">
                                  {task.completedPomodoros} / {task.estimatedPomodoros}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => adjustTaskEstimate(task.id, 1)}
                                  className="w-6 h-6 rounded border border-neutral-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-neutral-100 dark:hover:bg-slate-800 cursor-pointer"
                                >
                                  +
                                </button>
                              </div>
                            </td>
                            <td className="py-3.5 pl-3 pr-6 text-right">
                              <div className="inline-flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setActiveTaskId(task.id);
                                    setActiveView(ActiveView.WORKSPACE);
                                  }}
                                  className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                                    isTarget
                                      ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900'
                                      : 'border border-neutral-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-neutral-100 dark:hover:bg-slate-800'
                                  }`}
                                >
                                  {isTarget ? 'Cible active' : 'Cibler'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => deleteTask(task.id)}
                                  aria-label={`Supprimer ${task.title}`}
                                  className="p-1.5 text-slate-400 hover:text-rose-600 transition-colors cursor-pointer"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>
        )}

        {/* Dedicated Session Journal View */}
        {activeView === ActiveView.JOURNAL && (
          <section aria-label="Journal des sessions Pomodoro" className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-neutral-200 dark:border-slate-800 pb-6">
              <div>
                <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">
                  Journal de concentration
                </h1>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                  Historique chronologique des cycles accomplis et temps de concentration cumulé.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-1 p-1 bg-neutral-100 dark:bg-slate-800 rounded-xl">
                  <button
                    type="button"
                    onClick={() => setJournalFilter('ALL')}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
                      journalFilter === 'ALL'
                        ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    Toutes ({sessions.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setJournalFilter(TimerPhase.FOCUS)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
                      journalFilter === TimerPhase.FOCUS
                        ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    Concentration
                  </button>
                  <button
                    type="button"
                    onClick={() => setJournalFilter(TimerPhase.SHORT_BREAK)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
                      journalFilter === TimerPhase.SHORT_BREAK
                        ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    Pauses
                  </button>
                </div>

                <button
                  type="button"
                  onClick={exportJournalCsv}
                  disabled={sessions.length === 0}
                  className="min-h-[38px] px-3.5 py-2 rounded-xl border border-neutral-200 dark:border-slate-800 bg-white dark:bg-[#111827] text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-neutral-50 dark:hover:bg-slate-800 disabled:opacity-40 transition-colors flex items-center gap-2 whitespace-nowrap cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Exporter CSV</span>
                </button>
              </div>
            </div>

            {/* Weekly Focus Time Chart (Recharts) */}
            <div className="bg-white dark:bg-[#111827] border border-neutral-200 dark:border-slate-800 rounded-2xl p-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-6">
                <div>
                  <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                    Temps de concentration sur la semaine écoulée
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Cumul quotidien en minutes sur les 7 derniers jours
                  </p>
                </div>

                {/* Unboxed Tabular Summary Metadata */}
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400 font-mono-tabular">
                  <span>
                    Total 7j :{' '}
                    <strong className="font-semibold text-slate-900 dark:text-white">
                      {weeklySummary.totalMinutes} min
                    </strong>
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>
                    Moyenne :{' '}
                    <strong className="font-semibold text-slate-900 dark:text-white">
                      {weeklySummary.dailyAverage} min/j
                    </strong>
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>
                    {weeklySummary.totalCycles} sessions
                  </span>
                </div>
              </div>

              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={weeklyFocusData}
                    margin={{ top: 8, right: 8, left: -18, bottom: 0 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      vertical={false}
                      stroke={darkMode ? '#1E293B' : '#F1F5F9'}
                    />
                    <XAxis
                      dataKey="label"
                      axisLine={false}
                      tickLine={false}
                      tick={{
                        fill: darkMode ? '#94A3B8' : '#64748B',
                        fontSize: 12,
                        fontFamily: 'JetBrains Mono, monospace',
                      }}
                      dy={8}
                    />
                    <YAxis
                      axisLine={false}
                      tickLine={false}
                      tick={{
                        fill: darkMode ? '#94A3B8' : '#64748B',
                        fontSize: 12,
                        fontFamily: 'JetBrains Mono, monospace',
                      }}
                      unit="m"
                    />
                    <Tooltip
                      cursor={{
                        fill: darkMode ? 'rgba(255, 255, 255, 0.03)' : 'rgba(15, 23, 42, 0.03)',
                      }}
                      content={({ active, payload }) => {
                        if (!active || !payload || !payload.length) return null;
                        const item = payload[0].payload as {
                          fullDate: string;
                          minutes: number;
                          cycles: number;
                          isToday: boolean;
                        };
                        return (
                          <div className="bg-white dark:bg-slate-900 border border-neutral-200 dark:border-slate-700 rounded-xl px-3.5 py-2.5 shadow-sm text-xs">
                            <div className="font-medium text-slate-900 dark:text-white capitalize">
                              {item.fullDate} {item.isToday ? '(Aujourd’hui)' : ''}
                            </div>
                            <div className="font-mono-tabular text-slate-600 dark:text-slate-300 mt-1">
                              {item.minutes} min de concentration · {item.cycles}{' '}
                              {item.cycles > 1 ? 'sessions' : 'session'}
                            </div>
                          </div>
                        );
                      }}
                    />
                    <Bar dataKey="minutes" radius={[6, 6, 0, 0]} maxBarSize={44}>
                      {weeklyFocusData.map((entry) => (
                        <Cell
                          key={entry.isoDate}
                          fill={
                            entry.isToday
                              ? darkMode
                                ? '#F43F5E'
                                : '#0F172A'
                              : darkMode
                              ? '#334155'
                              : '#CBD5E1'
                          }
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="bg-white dark:bg-[#111827] border border-neutral-200 dark:border-slate-800 rounded-2xl overflow-hidden">
              {filteredSessions.length === 0 ? (
                <div className="p-12 text-center">
                  <Clock className="w-6 h-6 text-slate-400 mx-auto mb-2" />
                  <p className="text-sm font-medium text-slate-900 dark:text-white">
                    Aucune session enregistrée
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 mb-4">
                    Lancez votre premier cycle Pomodoro pour alimenter automatiquement ce journal.
                  </p>
                  <button
                    type="button"
                    onClick={() => setActiveView(ActiveView.WORKSPACE)}
                    className="px-4 py-2 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-medium cursor-pointer"
                  >
                    Aller au minuteur
                  </button>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-neutral-200 dark:border-slate-800 text-xs font-medium text-slate-500 dark:text-slate-400">
                        <th className="py-3.5 pl-6 pr-3">Phase</th>
                        <th className="py-3.5 px-3">Tâche associée</th>
                        <th className="py-3.5 px-3">Cycle</th>
                        <th className="py-3.5 px-3 text-right">Durée</th>
                        <th className="py-3.5 pl-3 pr-6 text-right">Terminée à</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-200/70 dark:divide-slate-800 text-sm">
                      {filteredSessions.map((session) => (
                        <tr
                          key={session.id}
                          className="hover:bg-neutral-50/80 dark:hover:bg-slate-800/40 transition-colors"
                        >
                          <td className="py-3.5 pl-6 pr-3 font-medium text-slate-900 dark:text-white whitespace-nowrap">
                            <span className="inline-flex items-center gap-2">
                              <span
                                className={`w-2 h-2 rounded-full ${
                                  session.phase === TimerPhase.FOCUS
                                    ? 'bg-rose-500'
                                    : session.phase === TimerPhase.SHORT_BREAK
                                    ? 'bg-emerald-500'
                                    : 'bg-amber-500'
                                }`}
                              />
                              <span>
                                {session.phase === TimerPhase.FOCUS
                                  ? 'Concentration'
                                  : session.phase === TimerPhase.SHORT_BREAK
                                  ? 'Pause courte'
                                  : 'Pause longue'}
                              </span>
                            </span>
                          </td>
                          <td className="py-3.5 px-3 text-slate-600 dark:text-slate-300">
                            {session.taskTitle || 'Session libre'}
                          </td>
                          <td className="py-3.5 px-3 font-mono-tabular text-xs text-slate-500 dark:text-slate-400">
                            Cycle #{session.cycleIndex}
                          </td>
                          <td className="py-3.5 px-3 text-right font-mono-tabular text-slate-900 dark:text-white">
                            {session.durationMinutes} min
                          </td>
                          <td className="py-3.5 pl-3 pr-6 text-right font-mono-tabular text-xs text-slate-500 dark:text-slate-400">
                            {session.completedAt}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>
        )}

        {/* Dedicated Settings View */}
        {activeView === ActiveView.SETTINGS && (
          <section aria-label="Paramètres du minuteur Pomodoro" className="max-w-3xl mx-auto space-y-8">
            <div className="border-b border-neutral-200 dark:border-slate-800 pb-6">
              <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">
                Réglages de la cadence
              </h1>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                Adaptez les durées des cycles Pomodoro et le comportement acoustique selon votre rythme de travail.
              </p>
            </div>

            {/* Preset Profiles */}
            <div className="bg-white dark:bg-[#111827] border border-neutral-200 dark:border-slate-800 rounded-2xl p-6 space-y-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
                <Sliders className="w-4 h-4" />
                <h2>Profils de cadence prédéfinis</h2>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <button
                  type="button"
                  onClick={() => applyPreset(25, 5, 15)}
                  className={`p-4 rounded-xl border text-left transition-colors cursor-pointer ${
                    settings.focusMinutes === 25 && settings.shortBreakMinutes === 5
                      ? 'border-slate-900 dark:border-white bg-neutral-50 dark:bg-slate-800/60'
                      : 'border-neutral-200 dark:border-slate-800 hover:border-slate-400'
                  }`}
                >
                  <div className="text-sm font-semibold text-slate-900 dark:text-white">
                    Classique Cirillo
                  </div>
                  <div className="font-mono-tabular text-xs text-slate-500 dark:text-slate-400 mt-1">
                    25m · 5m · 15m
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => applyPreset(50, 10, 25)}
                  className={`p-4 rounded-xl border text-left transition-colors cursor-pointer ${
                    settings.focusMinutes === 50 && settings.shortBreakMinutes === 10
                      ? 'border-slate-900 dark:border-white bg-neutral-50 dark:bg-slate-800/60'
                      : 'border-neutral-200 dark:border-slate-800 hover:border-slate-400'
                  }`}
                >
                  <div className="text-sm font-semibold text-slate-900 dark:text-white">
                    Immersion longue
                  </div>
                  <div className="font-mono-tabular text-xs text-slate-500 dark:text-slate-400 mt-1">
                    50m · 10m · 25m
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => applyPreset(15, 3, 10)}
                  className={`p-4 rounded-xl border text-left transition-colors cursor-pointer ${
                    settings.focusMinutes === 15 && settings.shortBreakMinutes === 3
                      ? 'border-slate-900 dark:border-white bg-neutral-50 dark:bg-slate-800/60'
                      : 'border-neutral-200 dark:border-slate-800 hover:border-slate-400'
                  }`}
                >
                  <div className="text-sm font-semibold text-slate-900 dark:text-white">
                    Sprint rapide
                  </div>
                  <div className="font-mono-tabular text-xs text-slate-500 dark:text-slate-400 mt-1">
                    15m · 3m · 10m
                  </div>
                </button>
              </div>
            </div>

            {/* Custom Durations & Automation */}
            <div className="bg-white dark:bg-[#111827] border border-neutral-200 dark:border-slate-800 rounded-2xl p-6 divide-y divide-neutral-200/70 dark:divide-slate-800">
              <div className="pb-6 grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div>
                  <label
                    htmlFor="focus-mins"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-2"
                  >
                    Durée de concentration (minutes)
                  </label>
                  <input
                    id="focus-mins"
                    type="number"
                    min={1}
                    max={120}
                    value={settings.focusMinutes}
                    onChange={(e) => {
                      const val = Math.max(1, Math.min(120, Number(e.target.value) || 25));
                      setSettings((prev) => ({ ...prev, focusMinutes: val }));
                      if (phase === TimerPhase.FOCUS && !isRunning) setSecondsLeft(val * 60);
                    }}
                    className="w-full px-3.5 py-2 font-mono-tabular text-sm bg-neutral-50 dark:bg-slate-900 border border-neutral-200 dark:border-slate-800 rounded-xl text-slate-900 dark:text-white"
                  />
                </div>

                <div>
                  <label
                    htmlFor="short-mins"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-2"
                  >
                    Pause courte (minutes)
                  </label>
                  <input
                    id="short-mins"
                    type="number"
                    min={1}
                    max={30}
                    value={settings.shortBreakMinutes}
                    onChange={(e) => {
                      const val = Math.max(1, Math.min(30, Number(e.target.value) || 5));
                      setSettings((prev) => ({ ...prev, shortBreakMinutes: val }));
                      if (phase === TimerPhase.SHORT_BREAK && !isRunning) setSecondsLeft(val * 60);
                    }}
                    className="w-full px-3.5 py-2 font-mono-tabular text-sm bg-neutral-50 dark:bg-slate-900 border border-neutral-200 dark:border-slate-800 rounded-xl text-slate-900 dark:text-white"
                  />
                </div>

                <div>
                  <label
                    htmlFor="long-mins"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-2"
                  >
                    Pause longue (minutes)
                  </label>
                  <input
                    id="long-mins"
                    type="number"
                    min={5}
                    max={60}
                    value={settings.longBreakMinutes}
                    onChange={(e) => {
                      const val = Math.max(5, Math.min(60, Number(e.target.value) || 15));
                      setSettings((prev) => ({ ...prev, longBreakMinutes: val }));
                      if (phase === TimerPhase.LONG_BREAK && !isRunning) setSecondsLeft(val * 60);
                    }}
                    className="w-full px-3.5 py-2 font-mono-tabular text-sm bg-neutral-50 dark:bg-slate-900 border border-neutral-200 dark:border-slate-800 rounded-xl text-slate-900 dark:text-white"
                  />
                </div>

                <div>
                  <label
                    htmlFor="cycles-count"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-2"
                  >
                    Cycles avant une pause longue
                  </label>
                  <input
                    id="cycles-count"
                    type="number"
                    min={2}
                    max={8}
                    value={settings.cyclesBeforeLongBreak}
                    onChange={(e) => {
                      const val = Math.max(2, Math.min(8, Number(e.target.value) || 4));
                      setSettings((prev) => ({ ...prev, cyclesBeforeLongBreak: val }));
                    }}
                    className="w-full px-3.5 py-2 font-mono-tabular text-sm bg-neutral-50 dark:bg-slate-900 border border-neutral-200 dark:border-slate-800 rounded-xl text-slate-900 dark:text-white"
                  />
                </div>
              </div>

              {/* Toggles */}
              <div className="py-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <div className="text-sm font-medium text-slate-900 dark:text-white">
                    Notifications du navigateur
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Avertit lorsque la phase de travail ou de pause est terminée · Permission :{' '}
                    <span className="font-medium text-slate-700 dark:text-slate-300">
                      {notificationPermission === 'granted'
                        ? 'Autorisée'
                        : notificationPermission === 'denied'
                        ? 'Refusée par le navigateur'
                        : notificationPermission === 'default'
                        ? 'En attente d’autorisation'
                        : 'Non prise en charge'}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  {notificationPermission !== 'unsupported' && (
                    <button
                      type="button"
                      onClick={handleRequestOrTestNotification}
                      className="px-3 py-1.5 rounded-lg border border-neutral-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-neutral-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap cursor-pointer"
                    >
                      {notificationPermission === 'default'
                        ? 'Autoriser'
                        : 'Tester l’alerte'}
                    </button>
                  )}
                  <button
                    type="button"
                    role="switch"
                    aria-checked={Boolean(settings.notificationsEnabled)}
                    onClick={handleToggleNotifications}
                    className={`w-11 h-6 rounded-full transition-colors p-0.5 cursor-pointer shrink-0 ${
                      settings.notificationsEnabled
                        ? 'bg-slate-900 dark:bg-white'
                        : 'bg-neutral-200 dark:bg-slate-700'
                    }`}
                  >
                    <span
                      className={`block w-5 h-5 rounded-full bg-white dark:bg-slate-900 transition-transform ${
                        settings.notificationsEnabled ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
              </div>

              <div className="py-5 flex items-center justify-between gap-4">
                <div>
                  <div className="text-sm font-medium text-slate-900 dark:text-white">
                    Mode Concentration Maximale
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    Masque l’en-tête et les colonnes secondaires lorsque le minuteur est en cours pour se focaliser uniquement sur le cercle de progression.
                  </div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={Boolean(settings.zenModeEnabled)}
                  onClick={() =>
                    setSettings((prev) => ({ ...prev, zenModeEnabled: !prev.zenModeEnabled }))
                  }
                  className={`w-11 h-6 rounded-full transition-colors p-0.5 cursor-pointer shrink-0 ${
                    settings.zenModeEnabled
                      ? 'bg-slate-900 dark:bg-white'
                      : 'bg-neutral-200 dark:bg-slate-700'
                  }`}
                >
                  <span
                    className={`block w-5 h-5 rounded-full bg-white dark:bg-slate-900 transition-transform ${
                      settings.zenModeEnabled ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              <div className="py-5 flex items-center justify-between gap-4">
                <div>
                  <div className="text-sm font-medium text-slate-900 dark:text-white">
                    Démarrer automatiquement les pauses
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    Enchaîne immédiatement la pause dès la fin d’un cycle de concentration.
                  </div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={settings.autoStartBreaks}
                  onClick={() =>
                    setSettings((prev) => ({ ...prev, autoStartBreaks: !prev.autoStartBreaks }))
                  }
                  className={`w-11 h-6 rounded-full transition-colors p-0.5 cursor-pointer ${
                    settings.autoStartBreaks
                      ? 'bg-slate-900 dark:bg-white'
                      : 'bg-neutral-200 dark:bg-slate-700'
                  }`}
                >
                  <span
                    className={`block w-5 h-5 rounded-full bg-white dark:bg-slate-900 transition-transform ${
                      settings.autoStartBreaks ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              <div className="py-5 flex items-center justify-between gap-4">
                <div>
                  <div className="text-sm font-medium text-slate-900 dark:text-white">
                    Tic-tac acoustique discret
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    Émet une pulsation sonore douce chaque seconde pendant la concentration.
                  </div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={settings.ambientTickEnabled}
                  onClick={() =>
                    setSettings((prev) => ({
                      ...prev,
                      ambientTickEnabled: !prev.ambientTickEnabled,
                    }))
                  }
                  className={`w-11 h-6 rounded-full transition-colors p-0.5 cursor-pointer ${
                    settings.ambientTickEnabled
                      ? 'bg-slate-900 dark:bg-white'
                      : 'bg-neutral-200 dark:bg-slate-700'
                  }`}
                >
                  <span
                    className={`block w-5 h-5 rounded-full bg-white dark:bg-slate-900 transition-transform ${
                      settings.ambientTickEnabled ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {/* YouTube Ambient Sound Settings */}
              <div className="pt-6 space-y-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="text-sm font-medium text-slate-900 dark:text-white">
                      Ambiance sonore YouTube
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      Diffuse votre flux d’ambiance YouTube directement depuis l’interface du minuteur.
                    </div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={Boolean(settings.youtubeAmbientEnabled)}
                    onClick={() =>
                      setSettings((prev) => ({
                        ...prev,
                        youtubeAmbientEnabled: !prev.youtubeAmbientEnabled,
                      }))
                    }
                    className={`w-11 h-6 rounded-full transition-colors p-0.5 cursor-pointer shrink-0 ${
                      settings.youtubeAmbientEnabled
                        ? 'bg-slate-900 dark:bg-white'
                        : 'bg-neutral-200 dark:bg-slate-700'
                    }`}
                  >
                    <span
                      className={`block w-5 h-5 rounded-full bg-white dark:bg-slate-900 transition-transform ${
                        settings.youtubeAmbientEnabled ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>

                <div className="space-y-2">
                  <div className="text-xs font-medium text-slate-700 dark:text-slate-300">
                    Ma playlist d’ambiance ({ambientPlaylist.length})
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Ajoutez vos mélodies YouTube : Kronova en choisit une au hasard à chaque session de
                    concentration.
                  </p>
                  <ul className="space-y-1.5">
                    {ambientPlaylist.map((url, index) => (
                      <li
                        key={`${url}-${index}`}
                        className="flex items-center gap-2 px-3 py-2 rounded-xl bg-neutral-50 dark:bg-slate-900 border border-neutral-200 dark:border-slate-800"
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                            url === currentTrackUrl ? 'bg-emerald-500' : 'bg-neutral-300 dark:bg-slate-700'
                          }`}
                          aria-hidden="true"
                        />
                        <span className="flex-1 min-w-0 truncate font-mono-tabular text-xs text-slate-700 dark:text-slate-300">
                          {url}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setSettings((prev) => ({
                              ...prev,
                              youtubePlaylist: ambientPlaylist.filter((_, i) => i !== index),
                            }))
                          }
                          disabled={ambientPlaylist.length <= 1}
                          aria-label={`Retirer ${url} de la playlist`}
                          className="p-1 text-slate-400 hover:text-rose-600 disabled:opacity-30 disabled:hover:text-slate-400 cursor-pointer disabled:cursor-not-allowed"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                  <form
                    className="grid grid-cols-1 sm:grid-cols-12 gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const url = newTrackUrl.trim();
                      if (!isYouTubeLink(url)) return;
                      setSettings((prev) => ({
                        ...prev,
                        youtubePlaylist: ambientPlaylist.includes(url)
                          ? ambientPlaylist
                          : [...ambientPlaylist, url],
                      }));
                      setNewTrackUrl('');
                    }}
                  >
                    <label htmlFor="youtube-ambient-url" className="sr-only">
                      Lien YouTube à ajouter
                    </label>
                    <input
                      id="youtube-ambient-url"
                      type="url"
                      value={newTrackUrl}
                      onChange={(e) => setNewTrackUrl(e.target.value)}
                      placeholder="https://www.youtube.com/watch?v=…"
                      className="sm:col-span-9 w-full px-3.5 py-2 font-mono-tabular text-xs bg-neutral-50 dark:bg-slate-900 border border-neutral-200 dark:border-slate-800 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:border-slate-900 dark:focus:border-slate-400"
                    />
                    <button
                      type="submit"
                      className="sm:col-span-3 w-full min-h-[36px] px-3 py-2 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-medium hover:bg-slate-800 dark:hover:bg-slate-200 transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Ajouter</span>
                    </button>
                  </form>
                </div>

                <div className="flex items-center justify-between gap-4 pt-2">
                  <div>
                    <div className="text-xs font-medium text-slate-800 dark:text-slate-200">
                      Synchroniser automatiquement avec le minuteur de concentration
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      Démarre le son lors d’une phase de concentration et le met en pause automatiquement pendant les pauses.
                    </div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={Boolean(settings.youtubeSyncWithTimer)}
                    onClick={() =>
                      setSettings((prev) => ({
                        ...prev,
                        youtubeSyncWithTimer: !prev.youtubeSyncWithTimer,
                      }))
                    }
                    className={`w-11 h-6 rounded-full transition-colors p-0.5 cursor-pointer shrink-0 ${
                      settings.youtubeSyncWithTimer
                        ? 'bg-slate-900 dark:bg-white'
                        : 'bg-neutral-200 dark:bg-slate-700'
                    }`}
                  >
                    <span
                      className={`block w-5 h-5 rounded-full bg-white dark:bg-slate-900 transition-transform ${
                        settings.youtubeSyncWithTimer ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
              </div>

              {/* Anti-Distraction Blocker Settings Section */}
              <div className="pt-6 space-y-5">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="text-sm font-medium text-slate-900 dark:text-white">
                      Bouclier Anti-Distraction (YouTube, Facebook, Netflix)
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      Verrouille l’aperçu vidéo, surveille les sorties d’onglet et bloque les sites distrayants pendant les sessions de travail.
                    </div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={Boolean(settings.blockerEnabled)}
                    onClick={() =>
                      setSettings((prev) => ({
                        ...prev,
                        blockerEnabled: !prev.blockerEnabled,
                      }))
                    }
                    className={`w-11 h-6 rounded-full transition-colors p-0.5 cursor-pointer shrink-0 ${
                      settings.blockerEnabled
                        ? 'bg-slate-900 dark:bg-white'
                        : 'bg-neutral-200 dark:bg-slate-700'
                    }`}
                  >
                    <span
                      className={`block w-5 h-5 rounded-full bg-white dark:bg-slate-900 transition-transform ${
                        settings.blockerEnabled ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>

                {/* Preset Distraction Services Grid */}
                <div>
                  <div className="text-xs font-medium text-slate-700 dark:text-slate-300 mb-2">
                    Services bloqués pendant la concentration
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {PRESET_DISTRACTION_SITES.map((site) => {
                      const isBlocked = blockedDomainsList.includes(site.domain);
                      return (
                        <button
                          key={site.domain}
                          type="button"
                          onClick={() => toggleBlockedDomain(site.domain)}
                          className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-colors flex items-center gap-2 cursor-pointer ${
                            isBlocked
                              ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900'
                              : 'border border-neutral-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:border-slate-400'
                          }`}
                        >
                          {isBlocked && <Lock className="w-3 h-3" />}
                          <span>{site.label}</span>
                          <span className="opacity-60 font-mono-tabular">({site.domain})</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Add Custom Domain to Blocklist */}
                <form onSubmit={handleAddCustomDomain} className="flex gap-2">
                  <input
                    type="text"
                    value={customDomainInput}
                    onChange={(e) => setCustomDomainInput(e.target.value)}
                    placeholder="Ajouter un domaine à bloquer (ex: twitch.tv, lemonde.fr)..."
                    className="flex-1 px-3.5 py-2 text-xs font-mono-tabular bg-neutral-50 dark:bg-slate-900 border border-neutral-200 dark:border-slate-800 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:border-slate-900 dark:focus:border-slate-400"
                  />
                  <button
                    type="submit"
                    className="px-4 py-2 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-medium hover:bg-slate-800 dark:hover:bg-slate-200 transition-colors whitespace-nowrap cursor-pointer"
                  >
                    Bloquer ce site
                  </button>
                </form>

                {/* Active Custom Domains List */}
                {blockedDomainsList.length > 0 && (
                  <div className="text-xs text-slate-500 dark:text-slate-400 flex flex-wrap items-center gap-2">
                    <span>Domaines actifs :</span>
                    {blockedDomainsList.map((domain, index) => (
                      <React.Fragment key={domain}>
                        {index > 0 && <span aria-hidden="true">·</span>}
                        <span className="inline-flex items-center gap-1 font-mono-tabular text-slate-800 dark:text-slate-200">
                          {domain}
                          <button
                            type="button"
                            onClick={() => toggleBlockedDomain(domain)}
                            aria-label={`Retirer ${domain} de la liste de blocage`}
                            className="text-slate-400 hover:text-rose-600 cursor-pointer"
                          >
                            ×
                          </button>
                        </span>
                      </React.Fragment>
                    ))}
                  </div>
                )}

                <div className="flex items-center justify-between gap-4 pt-2">
                  <div>
                    <div className="text-xs font-medium text-slate-800 dark:text-slate-200">
                      Alerte immédiate en cas de changement d’onglet
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      Détecte toute tentative de quitter Kronova vers un autre onglet pendant une session de concentration et déclenche un rappel sonore et visuel.
                    </div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={Boolean(settings.strictTabGuardEnabled)}
                    onClick={() =>
                      setSettings((prev) => ({
                        ...prev,
                        strictTabGuardEnabled: !prev.strictTabGuardEnabled,
                      }))
                    }
                    className={`w-11 h-6 rounded-full transition-colors p-0.5 cursor-pointer shrink-0 ${
                      settings.strictTabGuardEnabled
                        ? 'bg-slate-900 dark:bg-white'
                        : 'bg-neutral-200 dark:bg-slate-700'
                    }`}
                  >
                    <span
                      className={`block w-5 h-5 rounded-full bg-white dark:bg-slate-900 transition-transform ${
                        settings.strictTabGuardEnabled ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>

                <div className="pt-2 space-y-1.5">
                  <div className="flex items-center gap-2 text-xs font-medium text-slate-800 dark:text-slate-200">
                    <span
                      aria-hidden="true"
                      className={`w-2 h-2 rounded-full shrink-0 ${
                        blockerInfo?.extensionConnected ? 'bg-emerald-500' : 'bg-amber-500'
                      }`}
                    />
                    <span>
                      Extension navigateur :{' '}
                      {blockerInfo?.extensionConnected ? 'connectée' : 'non détectée'}
                    </span>
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    Une page web ne peut pas contrôler les autres onglets : c’est l’extension Kronova qui
                    redirige les sites bloqués dans tous les onglets (nouveaux, déjà ouverts ou activés)
                    pendant la concentration. Elle se connecte automatiquement à votre compte.
                  </div>
                  {!blockerInfo?.extensionConnected && (
                    <ol className="text-xs text-slate-500 dark:text-slate-400 list-decimal pl-5 space-y-0.5">
                      <li>
                        <a
                          href="/downloads/kronova-extension.zip"
                          download
                          className="font-medium text-slate-900 dark:text-white underline underline-offset-2"
                        >
                          Télécharger l’extension
                        </a>{' '}
                        puis décompresser le fichier.
                      </li>
                      <li>
                        Ouvrir <code className="font-mono-tabular">chrome://extensions</code> et activer le
                        mode développeur.
                      </li>
                      <li>« Charger l’extension non empaquetée » → choisir le dossier décompressé.</li>
                      <li>Revenir sur Kronova : l’indicateur passe à « connectée ».</li>
                    </ol>
                  )}
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    Pour un blocage réseau système complet sur votre machine, téléchargez le fichier de règles <code className="font-mono-tabular">hosts</code> synchronisé avec votre liste.
                  </div>
                  <button
                    type="button"
                    onClick={downloadHostsBlockerFile}
                    className="px-3.5 py-2 rounded-xl border border-neutral-200 dark:border-slate-800 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-neutral-100 dark:hover:bg-slate-800 transition-colors flex items-center gap-2 whitespace-nowrap cursor-pointer self-start sm:self-auto"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Exporter règles hosts</span>
                  </button>
                </div>
              </div>
            </div>
          </section>
        )}
      </main>

      {/* MongoDB Authentication & Sync Modal */}
      <MongoAuthModal
        isOpen={isAuthModalOpen || !authToken}
        mandatory={!authToken}
        onClose={() => setIsAuthModalOpen(false)}
        currentUser={currentUser}
        dbStatus={dbStatus}
        lastSyncedAt={lastSyncedAt}
        currentTasks={tasks}
        currentSessions={sessions}
        currentSettings={settings}
        syncStatus={syncStatus}
        isLiveConnected={isLiveConnected}
        onAuthSuccess={(token, user, state) => {
          try {
            localStorage.setItem(STORAGE_KEYS.AUTH_TOKEN, token);
          } catch {
            // Ignore
          }
          applyRemoteState(state);
          setCurrentUser(user);
          setSyncStatus('saved');
          setAuthToken(token);
        }}
        onLogout={() => {
          const token = authTokenRef.current;
          if (token) {
            // Lève le bouclier de ce compte puis révoque la session
            fetch('/api/blocker/state', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
              body: JSON.stringify({ active: false, domains: [] }),
            })
              .catch(() => {})
              .finally(() =>
                fetch('/api/auth/logout', {
                  method: 'POST',
                  headers: { Authorization: `Bearer ${token}` },
                }).catch(() => {})
              );
          }
          clearSession();
          // Rien ne doit rester visible pour la personne suivante sur ce navigateur
          setIsRunning(false);
          setTasks([]);
          setSessions([]);
          setSettings(DEFAULT_SETTINGS);
          setActiveTaskId(null);
          setDistractionsIntercepted(0);
          hasPublishedBlockerRef.current = false;
          try {
            localStorage.removeItem(STORAGE_KEYS.TASKS);
            localStorage.removeItem(STORAGE_KEYS.SESSIONS);
            localStorage.removeItem(STORAGE_KEYS.SETTINGS);
          } catch {
            // Ignore
          }
        }}
      />
    </div>
  );
}
