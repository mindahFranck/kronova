import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Flame, ListPlus, NotebookPen, Pause, Play, SkipForward, Target, Trash2, X } from 'lucide-react';
import { BrainNote, SessionRecord } from '../types';
import { computeStreaks } from '../utils/planning';

/* ---------- Objectif quotidien & séries ---------- */

interface DailyGoalCardProps {
  sessions: SessionRecord[];
  dailyGoal: number;
  onChangeGoal: (goal: number) => void;
}

export const DailyGoalCard: React.FC<DailyGoalCardProps> = ({ sessions, dailyGoal, onChangeGoal }) => {
  const { current, best, todayCount } = computeStreaks(sessions, dailyGoal);
  const goal = Math.max(1, dailyGoal);
  const progress = Math.min(1, todayCount / goal);
  const radius = 34;
  const circumference = 2 * Math.PI * radius;
  const reached = todayCount >= goal;

  return (
    <div className="bg-white dark:bg-[#111827] border border-neutral-200 dark:border-slate-800 rounded-2xl p-5 flex items-center gap-5">
      <div className="relative w-20 h-20 shrink-0">
        <svg viewBox="0 0 80 80" className="w-20 h-20 -rotate-90" aria-hidden="true">
          <circle cx="40" cy="40" r={radius} fill="none" strokeWidth="7" className="stroke-neutral-200 dark:stroke-slate-800" />
          <circle
            cx="40"
            cy="40"
            r={radius}
            fill="none"
            strokeWidth="7"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - progress)}
            className={`transition-all duration-500 ${reached ? 'stroke-emerald-500' : 'stroke-slate-900 dark:stroke-white'}`}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-mono-tabular text-lg font-semibold text-slate-900 dark:text-white leading-none">
            {todayCount}
          </span>
          <span className="text-[10px] text-slate-500 dark:text-slate-400">/ {goal}</span>
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-900 dark:text-white">
          <Target className="w-4 h-4" />
          <span>Objectif du jour</span>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5" aria-live="polite">
          {reached
            ? 'Objectif atteint, bravo !'
            : `Encore ${goal - todayCount} Pomodoro${goal - todayCount > 1 ? 's' : ''} aujourd’hui.`}
        </p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-xs">
          <span className="flex items-center gap-1 text-slate-700 dark:text-slate-300">
            <Flame className={`w-3.5 h-3.5 ${current > 0 ? 'text-orange-500' : 'text-slate-400'}`} />
            <span>
              Série : <strong className="font-mono-tabular">{current}</strong> jour{current > 1 ? 's' : ''}
            </span>
          </span>
          <span className="text-slate-500 dark:text-slate-400">
            Record : <span className="font-mono-tabular">{best}</span>
          </span>
          <label className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
            <span>Cible</span>
            <input
              type="number"
              min={1}
              max={24}
              value={goal}
              onChange={(e) => onChangeGoal(Math.max(1, Math.min(24, Number(e.target.value) || 1)))}
              aria-label="Objectif quotidien en Pomodoros"
              className="w-12 px-1.5 py-0.5 text-center font-mono-tabular bg-neutral-50 dark:bg-slate-900 border border-neutral-200 dark:border-slate-800 rounded-md text-slate-900 dark:text-white"
            />
          </label>
        </div>
      </div>
    </div>
  );
};

/* ---------- Notes rapides « Vide-Esprit » ---------- */

interface BrainDumpModalProps {
  isOpen: boolean;
  notes: BrainNote[];
  onClose: () => void;
  onAdd: (text: string) => void;
  onDelete: (id: string) => void;
  onConvertToTask: (note: BrainNote) => void;
}

export const BrainDumpModal: React.FC<BrainDumpModalProps> = ({
  isOpen,
  notes,
  onClose,
  onAdd,
  onDelete,
  onConvertToTask,
}) => {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    textareaRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const submit = () => {
    const clean = text.trim();
    if (!clean) return;
    onAdd(clean.slice(0, 2000));
    setText('');
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="brain-dump-title"
      className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-4 bg-black/40 backdrop-blur-xs"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-lg bg-white dark:bg-[#111827] border border-neutral-200 dark:border-slate-800 rounded-2xl p-5 shadow-xl">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <NotebookPen className="w-4 h-4 text-slate-900 dark:text-white" />
            <h2 id="brain-dump-title" className="text-sm font-semibold text-slate-900 dark:text-white">
              Vide-Esprit
            </h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Fermer" className="p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          rows={3}
          placeholder="Notez l’idée ou la distraction, puis revenez à votre tâche…"
          className="w-full px-3.5 py-2.5 text-sm bg-neutral-50 dark:bg-slate-900 border border-neutral-200 dark:border-slate-800 rounded-xl text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-slate-900 dark:focus:border-slate-400 resize-none"
        />
        <div className="flex items-center justify-between mt-2 text-[11px] text-slate-400">
          <span>Entrée pour enregistrer · Maj+Entrée pour un retour à la ligne · Échap pour fermer</span>
          <button
            type="button"
            onClick={submit}
            className="px-3 py-1.5 rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-medium cursor-pointer"
          >
            Noter
          </button>
        </div>
        {notes.length > 0 && (
          <ul className="mt-4 max-h-64 overflow-y-auto divide-y divide-neutral-100 dark:divide-slate-800 border-t border-neutral-100 dark:border-slate-800">
            {notes.slice(0, 50).map((note) => (
              <li key={note.id} className="py-2 flex items-start gap-2 group">
                <p className="flex-1 text-xs text-slate-700 dark:text-slate-300 whitespace-pre-wrap break-words">{note.text}</p>
                <span className="text-[10px] font-mono-tabular text-slate-400 shrink-0 pt-0.5">
                  {new Date(note.createdAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                </span>
                <button
                  type="button"
                  onClick={() => onConvertToTask(note)}
                  aria-label="Transformer en tâche"
                  title="Transformer en tâche"
                  className="p-0.5 text-slate-400 hover:text-slate-900 dark:hover:text-white cursor-pointer"
                >
                  <ListPlus className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(note.id)}
                  aria-label="Supprimer la note"
                  className="p-0.5 text-slate-400 hover:text-rose-600 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

/* ---------- Mini-minuteur flottant (Document Picture-in-Picture) ---------- */

interface DocumentPictureInPicture {
  requestWindow: (options?: { width?: number; height?: number }) => Promise<Window>;
  window: Window | null;
}

function getPipApi(): DocumentPictureInPicture | null {
  return (window as unknown as { documentPictureInPicture?: DocumentPictureInPicture }).documentPictureInPicture || null;
}

export function usePictureInPicture() {
  const [pipWindow, setPipWindow] = useState<Window | null>(null);
  const supported = typeof window !== 'undefined' && getPipApi() !== null;

  const open = useCallback(async () => {
    const api = getPipApi();
    if (!api) return false;
    if (api.window) {
      api.window.focus();
      return true;
    }
    const win = await api.requestWindow({ width: 280, height: 168 });
    // Recopie les styles (Tailwind, polices) dans la fenêtre flottante
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        const css = Array.from(sheet.cssRules).map((r) => r.cssText).join('\n');
        const style = win.document.createElement('style');
        style.textContent = css;
        win.document.head.appendChild(style);
      } catch {
        if (sheet.href) {
          const link = win.document.createElement('link');
          link.rel = 'stylesheet';
          link.href = sheet.href;
          win.document.head.appendChild(link);
        }
      }
    }
    win.document.title = 'Kronova';
    win.addEventListener('pagehide', () => setPipWindow(null));
    setPipWindow(win);
    return true;
  }, []);

  const close = useCallback(() => {
    pipWindow?.close();
    setPipWindow(null);
  }, [pipWindow]);

  return { pipWindow, supported, open, close };
}

interface PipTimerProps {
  pipWindow: Window;
  darkMode: boolean;
  timeLabel: string;
  phaseLabel: string;
  taskTitle: string | null;
  progress: number;
  isRunning: boolean;
  onToggle: () => void;
  onSkip: () => void;
}

export const PipTimer: React.FC<PipTimerProps> = ({
  pipWindow,
  darkMode,
  timeLabel,
  phaseLabel,
  taskTitle,
  progress,
  isRunning,
  onToggle,
  onSkip,
}) => {
  useEffect(() => {
    pipWindow.document.documentElement.classList.toggle('dark', darkMode);
    pipWindow.document.body.style.margin = '0';
    pipWindow.document.body.style.background = darkMode ? '#0B0F17' : '#FAFAFA';
  }, [pipWindow, darkMode]);

  return createPortal(
    <div className="h-screen flex flex-col justify-center px-4 gap-2 text-slate-900 dark:text-white select-none">
      <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
        <span className="font-medium uppercase tracking-wider">{phaseLabel}</span>
        <span className="font-display text-sm">Kronova</span>
      </div>
      <div className="font-mono-tabular text-5xl font-semibold tracking-tight leading-none">{timeLabel}</div>
      <div className="h-1 rounded-full bg-neutral-200 dark:bg-slate-800 overflow-hidden">
        <div className="h-full bg-slate-900 dark:bg-white transition-all" style={{ width: `${progress * 100}%` }} />
      </div>
      <div className="flex items-center gap-2">
        <span className="flex-1 min-w-0 truncate text-xs text-slate-500 dark:text-slate-400">
          {taskTitle || 'Session libre'}
        </span>
        <button
          type="button"
          onClick={onToggle}
          aria-label={isRunning ? 'Mettre en pause' : 'Démarrer'}
          className="w-8 h-8 rounded-full bg-slate-900 dark:bg-white text-white dark:text-slate-900 flex items-center justify-center cursor-pointer"
        >
          {isRunning ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
        </button>
        <button
          type="button"
          onClick={onSkip}
          aria-label="Phase suivante"
          className="w-8 h-8 rounded-full border border-neutral-300 dark:border-slate-700 flex items-center justify-center cursor-pointer"
        >
          <SkipForward className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>,
    pipWindow.document.body
  );
};
