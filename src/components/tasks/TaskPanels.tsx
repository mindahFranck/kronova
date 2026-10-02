import React, { useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  CalendarClock,
  Check,
  FolderKanban,
  Play,
  Plus,
  Repeat,
  Trash2,
  X,
} from 'lucide-react';
import { PomodoroTask, Project, RoutineTemplate, TimerSettings } from '../../types';
import { buildDaySchedule, formatClock, orderedPlanTasks, remainingPomodoros } from '../../utils/planning';

export const PROJECT_COLORS = ['#64748b', '#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#a855f7', '#ec4899'];

const card = 'bg-white dark:bg-[#111827] border border-neutral-200 dark:border-slate-800 rounded-2xl p-5';
const input =
  'w-full min-w-0 px-3 py-2 text-xs bg-neutral-50 dark:bg-slate-900 border border-neutral-200 dark:border-slate-800 rounded-xl text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-slate-900 dark:focus:border-slate-400';
const iconButton =
  'p-1.5 rounded-lg text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-slate-800 transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed';

function newId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export const ProjectDot: React.FC<{ project?: Project | null }> = ({ project }) =>
  project ? (
    <span
      className="inline-block w-2 h-2 rounded-full shrink-0"
      style={{ backgroundColor: project.color }}
      aria-hidden="true"
    />
  ) : null;

/* ---------- Projets / tags ---------- */

interface ProjectManagerProps {
  projects: Project[];
  tasks: PomodoroTask[];
  selectedProjectId: string | null;
  onSelect: (projectId: string | null) => void;
  onChange: (projects: Project[]) => void;
}

export const ProjectManager: React.FC<ProjectManagerProps> = ({
  projects,
  tasks,
  selectedProjectId,
  onSelect,
  onChange,
}) => {
  const [name, setName] = useState('');
  const [color, setColor] = useState(PROJECT_COLORS[1]);

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = name.trim();
    if (!clean || projects.some((p) => p.name.toLowerCase() === clean.toLowerCase())) return;
    onChange([...projects, { id: newId('proj'), name: clean, color }]);
    setName('');
    setColor(PROJECT_COLORS[(projects.length + 2) % PROJECT_COLORS.length]);
  };

  return (
    <div className={card}>
      <div className="flex items-center gap-2 mb-3">
        <FolderKanban className="w-4 h-4 text-slate-500 dark:text-slate-400" />
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Projets</h2>
      </div>
      <div className="flex flex-wrap gap-1.5 mb-3">
        <button
          type="button"
          onClick={() => onSelect(null)}
          className={`px-2.5 py-1 rounded-lg text-xs font-medium cursor-pointer ${
            selectedProjectId === null
              ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900'
              : 'border border-neutral-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
          }`}
        >
          Tous
        </button>
        {projects.map((project) => {
          const count = tasks.filter((t) => t.projectId === project.id && !t.completed).length;
          const selected = selectedProjectId === project.id;
          return (
            <span key={project.id} className="inline-flex items-center">
              <button
                type="button"
                onClick={() => onSelect(selected ? null : project.id)}
                aria-pressed={selected}
                className={`pl-2 pr-2.5 py-1 rounded-l-lg text-xs font-medium flex items-center gap-1.5 cursor-pointer ${
                  selected
                    ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900'
                    : 'border border-r-0 border-neutral-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                }`}
              >
                <ProjectDot project={project} />
                <span>{project.name}</span>
                <span className="font-mono-tabular opacity-60">{count}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  if (selected) onSelect(null);
                  onChange(projects.filter((p) => p.id !== project.id));
                }}
                aria-label={`Supprimer le projet ${project.name}`}
                className={`px-1.5 py-1 rounded-r-lg text-xs cursor-pointer ${
                  selected
                    ? 'bg-slate-900 dark:bg-white text-white/70 dark:text-slate-900/70'
                    : 'border border-neutral-200 dark:border-slate-700 text-slate-400 hover:text-rose-600'
                }`}
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          );
        })}
      </div>
      <form onSubmit={add} className="flex items-center gap-2">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nouveau projet (ex. Études)"
          aria-label="Nom du nouveau projet"
          maxLength={40}
          className={input}
        />
        <div className="flex items-center gap-1" role="radiogroup" aria-label="Couleur du projet">
          {PROJECT_COLORS.slice(0, 6).map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={color === c}
              aria-label={`Couleur ${c}`}
              onClick={() => setColor(c)}
              className={`w-4 h-4 rounded-full cursor-pointer ${color === c ? 'ring-2 ring-offset-2 ring-slate-400 dark:ring-offset-[#111827]' : ''}`}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
        <button type="submit" aria-label="Ajouter le projet" className={iconButton}>
          <Plus className="w-4 h-4" />
        </button>
      </form>
    </div>
  );
};

/* ---------- Détail d'une tâche : sous-tâches, notes, projet ---------- */

interface TaskDetailPanelProps {
  task: PomodoroTask;
  projects: Project[];
  focusMinutes: number;
  onChange: (task: PomodoroTask) => void;
}

export const TaskDetailPanel: React.FC<TaskDetailPanelProps> = ({ task, projects, focusMinutes, onChange }) => {
  const [newStep, setNewStep] = useState('');
  const subtasks = task.subtasks || [];
  const doneCount = subtasks.filter((s) => s.done).length;
  const remaining = remainingPomodoros(task);

  const addStep = (e: React.FormEvent) => {
    e.preventDefault();
    const title = newStep.trim();
    if (!title) return;
    onChange({ ...task, subtasks: [...subtasks, { id: newId('sub'), title, done: false }] });
    setNewStep('');
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-5 px-6 py-4 bg-neutral-50/70 dark:bg-slate-900/40">
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
            Étapes {subtasks.length > 0 && <span className="font-mono-tabular">({doneCount}/{subtasks.length})</span>}
          </span>
          <span className="text-xs text-slate-500 dark:text-slate-400 font-mono-tabular">
            {remaining > 0 ? `≈ ${remaining * focusMinutes} min restantes` : 'Terminé'}
          </span>
        </div>
        {subtasks.length > 0 && (
          <div className="h-1 rounded-full bg-neutral-200 dark:bg-slate-800 mb-2 overflow-hidden">
            <div
              className="h-full bg-emerald-500 transition-all"
              style={{ width: `${(doneCount / subtasks.length) * 100}%` }}
            />
          </div>
        )}
        <ul className="space-y-1 mb-2">
          {subtasks.map((step) => (
            <li key={step.id} className="flex items-center gap-2 group">
              <input
                type="checkbox"
                checked={step.done}
                onChange={() =>
                  onChange({
                    ...task,
                    subtasks: subtasks.map((s) => (s.id === step.id ? { ...s, done: !s.done } : s)),
                  })
                }
                aria-label={`Étape : ${step.title}`}
                className="w-3.5 h-3.5 accent-slate-900 dark:accent-white cursor-pointer"
              />
              <span
                className={`flex-1 text-xs ${
                  step.done ? 'line-through text-slate-400' : 'text-slate-700 dark:text-slate-300'
                }`}
              >
                {step.title}
              </span>
              <button
                type="button"
                onClick={() => onChange({ ...task, subtasks: subtasks.filter((s) => s.id !== step.id) })}
                aria-label={`Supprimer l'étape ${step.title}`}
                className="p-0.5 text-slate-400 hover:text-rose-600 opacity-60 group-hover:opacity-100 cursor-pointer"
              >
                <X className="w-3 h-3" />
              </button>
            </li>
          ))}
        </ul>
        <form onSubmit={addStep} className="flex items-center gap-2">
          <input
            type="text"
            value={newStep}
            onChange={(e) => setNewStep(e.target.value)}
            placeholder="Ajouter une étape…"
            aria-label="Nouvelle étape"
            maxLength={120}
            className={input}
          />
          <button type="submit" aria-label="Ajouter l'étape" className={iconButton}>
            <Plus className="w-4 h-4" />
          </button>
        </form>
      </div>

      <div className="space-y-3">
        <label className="block">
          <span className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Projet</span>
          <select
            value={task.projectId || ''}
            onChange={(e) => onChange({ ...task, projectId: e.target.value || null })}
            className={`${input} cursor-pointer`}
          >
            <option value="">Sans projet</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Notes</span>
          <textarea
            value={task.notes || ''}
            onChange={(e) => onChange({ ...task, notes: e.target.value.slice(0, 4000) })}
            rows={4}
            placeholder="Contexte, liens, idées…"
            className={`${input} resize-y`}
          />
        </label>
      </div>
    </div>
  );
};

/* ---------- Planification de la journée (timeboxing) ---------- */

interface DayPlannerProps {
  tasks: PomodoroTask[];
  projects: Project[];
  dayPlan: string[];
  settings: TimerSettings;
  activeTaskId: string | null;
  onReorder: (ids: string[]) => void;
  onFocusTask: (id: string) => void;
}

export const DayPlanner: React.FC<DayPlannerProps> = ({
  tasks,
  projects,
  dayPlan,
  settings,
  activeTaskId,
  onReorder,
  onFocusTask,
}) => {
  const [startTime, setStartTime] = useState<string>('');
  const ordered = useMemo(() => orderedPlanTasks(tasks, dayPlan), [tasks, dayPlan]);

  const start = useMemo(() => {
    const now = new Date();
    if (!startTime) return now;
    const [h, m] = startTime.split(':').map(Number);
    const custom = new Date(now);
    custom.setHours(h, m, 0, 0);
    return custom;
  }, [startTime, ordered]);

  const { slots, end } = useMemo(() => buildDaySchedule(ordered, settings, start), [ordered, settings, start]);
  const projectById = new Map(projects.map((p) => [p.id, p]));

  const move = (index: number, delta: number) => {
    const ids = ordered.map((t) => t.id);
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    onReorder(ids);
  };

  return (
    <div className={card}>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <CalendarClock className="w-4 h-4 text-slate-500 dark:text-slate-400" />
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Planning de la journée</h2>
        </div>
        <label className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          <span>Début</span>
          <input
            type="time"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            className="px-2 py-1 font-mono-tabular text-xs bg-neutral-50 dark:bg-slate-900 border border-neutral-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-white"
          />
          {startTime && (
            <button type="button" onClick={() => setStartTime('')} className="underline cursor-pointer">
              maintenant
            </button>
          )}
        </label>
      </div>

      {slots.length === 0 ? (
        <p className="text-xs text-slate-500 dark:text-slate-400">Aucune tâche en cours à planifier.</p>
      ) : (
        <>
          <ol className="space-y-1.5">
            {slots.map((slot, index) => {
              const project = slot.task.projectId ? projectById.get(slot.task.projectId) : null;
              const isActive = slot.task.id === activeTaskId;
              return (
                <li
                  key={slot.task.id}
                  className={`flex items-center gap-3 px-3 py-2 rounded-xl border ${
                    isActive
                      ? 'border-slate-900 dark:border-white'
                      : 'border-neutral-200 dark:border-slate-800'
                  }`}
                >
                  <span className="font-mono-tabular text-xs text-slate-500 dark:text-slate-400 w-24 shrink-0">
                    {formatClock(slot.start)}–{formatClock(slot.end)}
                  </span>
                  <ProjectDot project={project} />
                  <span className="flex-1 min-w-0 truncate text-xs font-medium text-slate-900 dark:text-white">
                    {slot.task.title}
                  </span>
                  <span className="font-mono-tabular text-xs text-slate-500 dark:text-slate-400 shrink-0">
                    {slot.pomodoros}×
                  </span>
                  <div className="flex items-center shrink-0">
                    <button
                      type="button"
                      onClick={() => move(index, -1)}
                      disabled={index === 0}
                      aria-label={`Monter ${slot.task.title}`}
                      className={iconButton}
                    >
                      <ArrowUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => move(index, 1)}
                      disabled={index === slots.length - 1}
                      aria-label={`Descendre ${slot.task.title}`}
                      className={iconButton}
                    >
                      <ArrowDown className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onFocusTask(slot.task.id)}
                      aria-label={`Travailler sur ${slot.task.title}`}
                      className={iconButton}
                    >
                      <Play className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ol>
          <p className="mt-4 text-sm text-slate-900 dark:text-white">
            Fin prévue des tâches à <span className="font-mono-tabular font-semibold">{formatClock(end)}</span>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {' '}
              · pauses comprises ({settings.focusMinutes}/{settings.shortBreakMinutes}/{settings.longBreakMinutes} min)
            </span>
          </p>
        </>
      )}
    </div>
  );
};

/* ---------- Modèles de routines ---------- */

interface RoutinesPanelProps {
  routines: RoutineTemplate[];
  activeTasks: PomodoroTask[];
  onSave: (routine: RoutineTemplate) => void;
  onLoad: (routine: RoutineTemplate) => void;
  onDelete: (id: string) => void;
}

export const RoutinesPanel: React.FC<RoutinesPanelProps> = ({ routines, activeTasks, onSave, onLoad, onDelete }) => {
  const [name, setName] = useState('');
  const [loadedId, setLoadedId] = useState<string | null>(null);

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = name.trim();
    if (!clean || activeTasks.length === 0) return;
    onSave({
      id: newId('routine'),
      name: clean,
      tasks: activeTasks.map((t) => ({
        title: t.title,
        category: t.category,
        estimatedPomodoros: t.estimatedPomodoros,
        projectId: t.projectId ?? null,
        subtasks: (t.subtasks || []).map((s) => s.title),
      })),
    });
    setName('');
  };

  return (
    <div className={card}>
      <div className="flex items-center gap-2 mb-3">
        <Repeat className="w-4 h-4 text-slate-500 dark:text-slate-400" />
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Routines</h2>
      </div>
      {routines.length === 0 ? (
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
          Enregistrez vos tâches en cours comme modèle (ex. « Routine du matin ») pour les recharger en un clic.
        </p>
      ) : (
        <ul className="space-y-1.5 mb-3">
          {routines.map((routine) => (
            <li
              key={routine.id}
              className="flex items-center gap-2 px-3 py-2 rounded-xl border border-neutral-200 dark:border-slate-800"
            >
              <span className="flex-1 min-w-0 truncate text-xs font-medium text-slate-900 dark:text-white">
                {routine.name}
              </span>
              <span className="text-xs text-slate-500 dark:text-slate-400 font-mono-tabular">
                {routine.tasks.length} tâche{routine.tasks.length > 1 ? 's' : ''}
              </span>
              <button
                type="button"
                onClick={() => {
                  onLoad(routine);
                  setLoadedId(routine.id);
                  window.setTimeout(() => setLoadedId(null), 1500);
                }}
                className="px-2.5 py-1 rounded-lg text-xs font-medium border border-neutral-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-neutral-100 dark:hover:bg-slate-800 flex items-center gap-1 cursor-pointer"
              >
                {loadedId === routine.id ? <Check className="w-3 h-3" /> : <Plus className="w-3 h-3" />}
                <span>{loadedId === routine.id ? 'Ajoutée' : 'Charger'}</span>
              </button>
              <button
                type="button"
                onClick={() => onDelete(routine.id)}
                aria-label={`Supprimer la routine ${routine.name}`}
                className={iconButton}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={save} className="flex items-center gap-2">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={
            activeTasks.length > 0
              ? `Enregistrer les ${activeTasks.length} tâches en cours…`
              : 'Aucune tâche en cours à enregistrer'
          }
          aria-label="Nom de la routine"
          maxLength={60}
          disabled={activeTasks.length === 0}
          className={input}
        />
        <button
          type="submit"
          disabled={!name.trim() || activeTasks.length === 0}
          aria-label="Enregistrer la routine"
          className={iconButton}
        >
          <Plus className="w-4 h-4" />
        </button>
      </form>
    </div>
  );
};
