import { PomodoroTask, SessionRecord, TimerPhase, TimerSettings } from '../types';

export function localIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function formatClock(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}h${String(date.getMinutes()).padStart(2, '0')}`;
}

/** Pomodoros restants : d'après les sous-tâches non cochées si elles existent, sinon l'estimation */
export function remainingPomodoros(task: PomodoroTask): number {
  if (task.completed) return 0;
  const byEstimate = Math.max(0, task.estimatedPomodoros - task.completedPomodoros);
  const subtasks = task.subtasks || [];
  if (subtasks.length === 0) return Math.max(1, byEstimate);
  const undone = subtasks.filter((s) => !s.done).length;
  if (undone === 0) return 0;
  return Math.max(1, Math.ceil((task.estimatedPomodoros * undone) / subtasks.length) - task.completedPomodoros);
}

export interface PlannedSlot {
  task: PomodoroTask;
  pomodoros: number;
  start: Date;
  end: Date;
}

/** Ordre du planning : ids enregistrés d'abord, puis les tâches actives non encore placées */
export function orderedPlanTasks(tasks: PomodoroTask[], dayPlan: string[]): PomodoroTask[] {
  const active = tasks.filter((t) => !t.completed);
  const byId = new Map(active.map((t) => [t.id, t]));
  const planned = dayPlan.map((id) => byId.get(id)).filter((t): t is PomodoroTask => Boolean(t));
  const rest = active.filter((t) => !dayPlan.includes(t.id));
  return [...planned, ...rest];
}

/**
 * Enchaîne les Pomodoros des tâches à partir de `start`, pauses comprises
 * (pause longue tous les `cyclesBeforeLongBreak` Pomodoros, sans pause après le dernier).
 */
export function buildDaySchedule(
  ordered: PomodoroTask[],
  settings: Pick<TimerSettings, 'focusMinutes' | 'shortBreakMinutes' | 'longBreakMinutes' | 'cyclesBeforeLongBreak'>,
  start: Date
): { slots: PlannedSlot[]; end: Date } {
  const slots: PlannedSlot[] = [];
  let cursor = start.getTime();
  let done = 0;
  const total = ordered.reduce((acc, t) => acc + remainingPomodoros(t), 0);
  for (const task of ordered) {
    const pomodoros = remainingPomodoros(task);
    if (pomodoros === 0) continue;
    const slotStart = new Date(cursor);
    for (let i = 0; i < pomodoros; i++) {
      cursor += settings.focusMinutes * 60000;
      done += 1;
      if (done < total) {
        const isLong = done % Math.max(1, settings.cyclesBeforeLongBreak) === 0;
        cursor += (isLong ? settings.longBreakMinutes : settings.shortBreakMinutes) * 60000;
      }
    }
    slots.push({ task, pomodoros, start: slotStart, end: new Date(cursor) });
  }
  return { slots, end: new Date(cursor) };
}

/** Nombre de Pomodoros (sessions de concentration) par jour, clé YYYY-MM-DD */
export function focusCountByDay(sessions: SessionRecord[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const s of sessions) {
    if (s.phase !== TimerPhase.FOCUS || !s.completedDate) continue;
    counts.set(s.completedDate, (counts.get(s.completedDate) || 0) + 1);
  }
  return counts;
}

/**
 * Série de jours consécutifs où l'objectif est atteint. Aujourd'hui compte s'il est atteint ;
 * sinon la série en cours part d'hier (elle n'est pas encore perdue).
 */
export function computeStreaks(sessions: SessionRecord[], dailyGoal: number, today = new Date()) {
  const counts = focusCountByDay(sessions);
  const goal = Math.max(1, dailyGoal);
  const reached = (d: Date) => (counts.get(localIsoDate(d)) || 0) >= goal;

  const cursor = new Date(today);
  if (!reached(cursor)) cursor.setDate(cursor.getDate() - 1);
  let current = 0;
  while (reached(cursor)) {
    current += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  const days = [...counts.entries()].filter(([, n]) => n >= goal).map(([d]) => d).sort();
  let best = 0;
  let run = 0;
  let previous: string | null = null;
  for (const day of days) {
    if (previous) {
      const next = new Date(`${previous}T12:00:00`);
      next.setDate(next.getDate() + 1);
      run = localIsoDate(next) === day ? run + 1 : 1;
    } else {
      run = 1;
    }
    best = Math.max(best, run);
    previous = day;
  }

  return { current, best: Math.max(best, current), todayCount: counts.get(localIsoDate(today)) || 0 };
}
