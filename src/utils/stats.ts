import { TimerPhase, type PomodoroTask, type Project, type SessionRecord } from '../types';

// Fonctions pures d'agrégation des sessions (aucun accès au DOM ni à l'horloge,
// sauf via le paramètre `today` optionnel, pour rester testables).

export const NO_PROJECT_LABEL = 'Sans projet';

export interface DayStat {
  /** Date locale YYYY-MM-DD */
  date: string;
  minutes: number;
  sessions: number;
}

export interface GroupStat {
  /** `project:<id>` ou `category:<nom>` */
  key: string;
  kind: 'project' | 'category';
  label: string;
  /** Couleur du projet ; null pour une catégorie (couleur attribuée par l'UI) */
  color: string | null;
  minutes: number;
  sessions: number;
}

export interface HourStat {
  hour: number;
  /** Minutes de concentration tombant dans cette heure */
  minutes: number;
  /** Sessions démarrées dans cette heure */
  sessions: number;
}

export interface PeakWindow {
  start: number;
  end: number;
  minutes: number;
  /** Ex. « 09h–11h » */
  label: string;
}

export interface FocusScore {
  score: number;
  /** Part des sessions sans interruption (0–1) */
  cleanRatio: number;
  /** Part des jours actifs sur la période (0–1) */
  regularity: number;
  focusSessions: number;
  activeDays: number;
  days: number;
}

export interface Streaks {
  current: number;
  best: number;
}

export interface TaskStat {
  title: string;
  minutes: number;
  sessions: number;
}

export interface DateRange {
  /** Inclus, YYYY-MM-DD */
  from: string;
  /** Inclus, YYYY-MM-DD */
  to: string;
}

// --- Dates locales ---------------------------------------------------------

const pad = (n: number) => String(n).padStart(2, '0');

export function toIsoDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Interprète YYYY-MM-DD comme une date locale à midi (évite les sauts d'heure d'été). */
export function parseIsoDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 12);
}

export function addDays(iso: string, days: number): string {
  const date = parseIsoDate(iso);
  date.setDate(date.getDate() + days);
  return toIsoDate(date);
}

/** Nombre de jours inclusifs entre deux dates. */
export function daysBetween(from: string, to: string): number {
  return Math.round((parseIsoDate(to).getTime() - parseIsoDate(from).getTime()) / 86_400_000) + 1;
}

/** 0 = lundi … 6 = dimanche */
export function mondayIndex(iso: string): number {
  return (parseIsoDate(iso).getDay() + 6) % 7;
}

/** Les `days` derniers jours se terminant à `today` (inclus). */
export function lastDaysRange(days: number, today: string = toIsoDate(new Date())): DateRange {
  return { from: addDays(today, -(days - 1)), to: today };
}

export function periodRange(period: 'week' | 'month', today?: string): DateRange {
  return lastDaysRange(period === 'week' ? 7 : 30, today);
}

const inRange = (date: string, range?: DateRange) =>
  !range || (date >= range.from && date <= range.to);

// --- Sessions ---------------------------------------------------------------

export const isFocusSession = (s: SessionRecord) => s.phase === TimerPhase.FOCUS;

/** Date locale d'une session ; les très anciennes sessions sans date sont rattachées à `today` (comme le journal). */
export function sessionDate(s: SessionRecord, today: string = toIsoDate(new Date())): string {
  if (s.completedDate) return s.completedDate;
  if (s.startedAt) {
    const d = new Date(s.startedAt);
    if (!Number.isNaN(d.getTime())) return toIsoDate(d);
  }
  return today;
}

export function focusSessionsInRange(
  sessions: SessionRecord[],
  range?: DateRange,
  today?: string
): SessionRecord[] {
  return sessions.filter((s) => isFocusSession(s) && inRange(sessionDate(s, today), range));
}

/** Minute de début dans la journée (0–1439), depuis `startedAt` ou `completedAt` − durée. */
export function sessionStartMinute(s: SessionRecord): number | null {
  if (s.startedAt) {
    const d = new Date(s.startedAt);
    if (!Number.isNaN(d.getTime())) return d.getHours() * 60 + d.getMinutes();
  }
  const match = /^(\d{1,2}):(\d{2})/.exec(s.completedAt || '');
  if (!match) return null;
  const end = Number(match[1]) * 60 + Number(match[2]);
  return (((end - Math.max(0, s.durationMinutes || 0)) % 1440) + 1440) % 1440;
}

// --- Agrégations ------------------------------------------------------------

/** Minutes et nombre de sessions de focus par jour (seuls les jours actifs sont présents). */
export function aggregateByDay(
  sessions: SessionRecord[],
  range?: DateRange,
  today?: string
): Map<string, DayStat> {
  const map = new Map<string, DayStat>();
  for (const s of focusSessionsInRange(sessions, range, today)) {
    const date = sessionDate(s, today);
    const entry = map.get(date) ?? { date, minutes: 0, sessions: 0 };
    entry.minutes += s.durationMinutes || 0;
    entry.sessions += 1;
    map.set(date, entry);
  }
  return map;
}

/** Série continue (jours vides inclus) sur une plage. */
export function dailySeries(sessions: SessionRecord[], range: DateRange, today?: string): DayStat[] {
  const byDay = aggregateByDay(sessions, range, today);
  const out: DayStat[] = [];
  for (let d = range.from; d <= range.to; d = addDays(d, 1)) {
    out.push(byDay.get(d) ?? { date: d, minutes: 0, sessions: 0 });
  }
  return out;
}

/** Répartition par projet (session puis tâche liée), à défaut par catégorie, sinon « Sans projet ». Triée par minutes décroissantes. */
export function aggregateByGroup(
  sessions: SessionRecord[],
  tasks: PomodoroTask[],
  projects: Project[],
  range?: DateRange,
  today?: string
): GroupStat[] {
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const groups = new Map<string, GroupStat>();

  for (const s of focusSessionsInRange(sessions, range, today)) {
    const task = s.taskId ? taskById.get(s.taskId) : undefined;
    const project = projectById.get(s.projectId ?? task?.projectId ?? '');
    let group: Omit<GroupStat, 'minutes' | 'sessions'>;
    if (project) {
      group = { key: `project:${project.id}`, kind: 'project', label: project.name, color: project.color };
    } else {
      const category = (s.category ?? task?.category ?? '').trim() || NO_PROJECT_LABEL;
      group = { key: `category:${category}`, kind: 'category', label: category, color: null };
    }
    const entry = groups.get(group.key) ?? { ...group, minutes: 0, sessions: 0 };
    entry.minutes += s.durationMinutes || 0;
    entry.sessions += 1;
    groups.set(group.key, entry);
  }

  return [...groups.values()].sort((a, b) => b.minutes - a.minutes || a.label.localeCompare(b.label, 'fr'));
}

/** Tâches les plus travaillées (repli sur « Sans tâche » quand aucun titre). */
export function topTasks(
  sessions: SessionRecord[],
  range?: DateRange,
  limit = 5,
  today?: string
): TaskStat[] {
  const map = new Map<string, TaskStat>();
  for (const s of focusSessionsInRange(sessions, range, today)) {
    const title = (s.taskTitle ?? '').trim() || 'Sans tâche';
    const key = s.taskId || `title:${title}`;
    const entry = map.get(key) ?? { title, minutes: 0, sessions: 0 };
    entry.minutes += s.durationMinutes || 0;
    entry.sessions += 1;
    map.set(key, entry);
  }
  return [...map.values()].sort((a, b) => b.minutes - a.minutes).slice(0, limit);
}

/** Histogramme 0–23 h : les minutes sont réparties sur les heures couvertes par chaque session. */
export function hourlyHistogram(sessions: SessionRecord[], range?: DateRange, today?: string): HourStat[] {
  const hours: HourStat[] = Array.from({ length: 24 }, (_, hour) => ({ hour, minutes: 0, sessions: 0 }));
  for (const s of focusSessionsInRange(sessions, range, today)) {
    const start = sessionStartMinute(s);
    if (start === null) continue;
    hours[Math.floor(start / 60)].sessions += 1;
    let cursor = start;
    let remaining = Math.max(0, s.durationMinutes || 0);
    while (remaining > 0) {
      const hour = Math.floor(cursor / 60) % 24;
      const chunk = Math.min(remaining, 60 - (cursor % 60));
      hours[hour].minutes += chunk;
      remaining -= chunk;
      cursor = (cursor + chunk) % 1440;
    }
  }
  return hours;
}

export const formatHourWindow = (start: number, end: number) =>
  `${pad(start % 24)}h–${pad(end % 24)}h`;

/** Meilleur créneau de `width` heures consécutives (minuit inclus) ; null sans données. */
export function peakHours(hist: HourStat[], width = 2): PeakWindow | null {
  let best: PeakWindow | null = null;
  for (let start = 0; start < 24; start++) {
    let minutes = 0;
    for (let i = 0; i < width; i++) minutes += hist[(start + i) % 24]?.minutes ?? 0;
    if (minutes > 0 && (!best || minutes > best.minutes)) {
      best = { start, end: (start + width) % 24, minutes, label: formatHourWindow(start, start + width) };
    }
  }
  return best;
}

/**
 * Score de concentration sur les `days` derniers jours.
 * Formule : score = round(100 × (0,7 × part des sessions sans interruption + 0,3 × part des jours actifs)).
 * Une session sans champ `interruptions` (ancienne donnée) est comptée sans interruption.
 */
export function focusScore(sessions: SessionRecord[], days = 14, today?: string): FocusScore | null {
  const range = lastDaysRange(days, today);
  const focus = focusSessionsInRange(sessions, range, today);
  if (focus.length === 0) return null;
  const clean = focus.filter((s) => !s.interruptions).length;
  const activeDays = aggregateByDay(focus, range, today).size;
  const cleanRatio = clean / focus.length;
  const regularity = activeDays / days;
  return {
    score: Math.round(100 * (0.7 * cleanRatio + 0.3 * regularity)),
    cleanRatio,
    regularity,
    focusSessions: focus.length,
    activeDays,
    days,
  };
}

/** Séries de jours consécutifs avec au moins une session de focus. La série en cours tolère un jour courant encore vide. */
export function streaks(sessions: SessionRecord[], today: string = toIsoDate(new Date())): Streaks {
  const active = new Set(aggregateByDay(sessions, undefined, today).keys());
  const sorted = [...active].sort();
  let best = 0;
  let run = 0;
  let prev: string | null = null;
  for (const d of sorted) {
    run = prev && addDays(prev, 1) === d ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  let current = 0;
  let cursor = active.has(today) ? today : addDays(today, -1);
  while (active.has(cursor)) {
    current += 1;
    cursor = addDays(cursor, -1);
  }
  return { current, best };
}

/** « 1 h 35 », « 45 min » */
export function formatMinutes(total: number): string {
  const m = Math.round(total);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h} h ${pad(rest)}` : `${h} h`;
}
