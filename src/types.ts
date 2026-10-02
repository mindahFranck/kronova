export enum TimerPhase {
  FOCUS = 'FOCUS',
  SHORT_BREAK = 'SHORT_BREAK',
  LONG_BREAK = 'LONG_BREAK',
}

export enum TaskFilter {
  ALL = 'ALL',
  ACTIVE = 'ACTIVE',
  COMPLETED = 'COMPLETED',
}

export enum ActiveView {
  WORKSPACE = 'WORKSPACE',
  TASKS = 'TASKS',
  JOURNAL = 'JOURNAL',
  SETTINGS = 'SETTINGS',
}

export interface Subtask {
  id: string;
  title: string;
  done: boolean;
}

export interface PomodoroTask {
  id: string;
  title: string;
  category: string;
  estimatedPomodoros: number;
  completedPomodoros: number;
  completed: boolean;
  createdAt: string;
  /** Étapes cochables */
  subtasks?: Subtask[];
  /** Notes libres sur la tâche */
  notes?: string;
  /** Projet / tag (Workspace.projects) */
  projectId?: string | null;
}

/** Projet ou tag avec code couleur sobre */
export interface Project {
  id: string;
  name: string;
  /** Couleur hexadécimale, ex. #6366f1 */
  color: string;
}

/** Note rapide « Vide-Esprit » */
export interface BrainNote {
  id: string;
  text: string;
  /** ISO 8601 */
  createdAt: string;
}

/** Modèle de routine récurrente (ex. Routine du matin) */
export interface RoutineTemplate {
  id: string;
  name: string;
  tasks: Array<{
    title: string;
    category: string;
    estimatedPomodoros: number;
    projectId?: string | null;
    subtasks?: string[];
  }>;
}

/** Données d'organisation personnelles, synchronisées avec le compte */
export interface Workspace {
  projects: Project[];
  routines: RoutineTemplate[];
  notes: BrainNote[];
  /** Ordre du planning de la journée (ids de tâches) */
  dayPlan: string[];
}

/** Volumes 0–100 des générateurs d'ambiance intégrés */
export interface AmbientMix {
  rain: number;
  brown: number;
  fire: number;
  cafe: number;
}

export interface SessionRecord {
  id: string;
  phase: TimerPhase;
  durationMinutes: number;
  taskTitle: string | null;
  completedAt: string;
  completedDate?: string;
  cycleIndex: number;
  taskId?: string | null;
  category?: string | null;
  projectId?: string | null;
  /** Sorties d'onglet / sites bloqués pendant la session */
  interruptions?: number;
  /** Début de la session, ISO 8601 */
  startedAt?: string;
}

export interface TimerSettings {
  focusMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
  cyclesBeforeLongBreak: number;
  autoStartBreaks: boolean;
  autoStartFocus: boolean;
  soundEnabled: boolean;
  ambientTickEnabled: boolean;
  zenModeEnabled: boolean;
  notificationsEnabled: boolean;
  youtubeAmbientEnabled: boolean;
  youtubeUrl: string;
  /** Playlist d'ambiance : un morceau est tiré au hasard à chaque session de concentration */
  youtubePlaylist: string[];
  youtubeSyncWithTimer: boolean;
  youtubeVolume: number;
  blockerEnabled: boolean;
  blockedDomains: string[];
  strictTabGuardEnabled: boolean;
  autoFullscreenOnFocus: boolean;
  /** Objectif quotidien en Pomodoros */
  dailyGoal: number;
  ambientMixEnabled: boolean;
  ambientMix: AmbientMix;
}
