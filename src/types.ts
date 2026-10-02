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

export interface PomodoroTask {
  id: string;
  title: string;
  category: string;
  estimatedPomodoros: number;
  completedPomodoros: number;
  completed: boolean;
  createdAt: string;
}

export interface SessionRecord {
  id: string;
  phase: TimerPhase;
  durationMinutes: number;
  taskTitle: string | null;
  completedAt: string;
  completedDate?: string;
  cycleIndex: number;
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
}
