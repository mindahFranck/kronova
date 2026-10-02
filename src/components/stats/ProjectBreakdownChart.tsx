import { useMemo, useState, type CSSProperties } from 'react';
import type { PomodoroTask, Project, SessionRecord } from '../../types';
import {
  NO_PROJECT_LABEL,
  aggregateByGroup,
  focusSessionsInRange,
  formatMinutes,
  periodRange,
  type GroupStat,
} from '../../utils/stats';

interface ProjectBreakdownChartProps {
  sessions: SessionRecord[];
  tasks: PomodoroTask[];
  projects: Project[];
}

type Period = 'week' | 'month';

const MAX_ROWS = 6;

// Palette catégorielle validée (clair / sombre), attribuée dans un ordre fixe.
// Utilisée uniquement pour les catégories : un projet garde toujours sa propre couleur.
const CATEGORY_COLORS: Array<[string, string]> = [
  ['#2a78d6', '#3987e5'],
  ['#eb6834', '#d95926'],
  ['#1baf7a', '#199e70'],
  ['#eda100', '#c98500'],
  ['#e87ba4', '#d55181'],
  ['#008300', '#008300'],
];
const NEUTRAL: [string, string] = ['#94a3b8', '#475569'];

interface Row extends GroupStat {
  colors: [string, string];
  share: number;
}

const colorStyle = ([light, dark]: [string, string]) =>
  ({ '--c': light, '--cd': dark }) as CSSProperties;

export default function ProjectBreakdownChart({ sessions, tasks, projects }: ProjectBreakdownChartProps) {
  const [period, setPeriod] = useState<Period>('week');

  // La couleur suit l'entité : rang alphabétique parmi toutes les catégories connues,
  // indépendant de la période affichée (un filtre ne repeint jamais une catégorie).
  const categoryColorIndex = useMemo(() => {
    const labels = new Set(
      aggregateByGroup(sessions, tasks, projects)
        .filter((g) => g.kind === 'category' && g.label !== NO_PROJECT_LABEL)
        .map((g) => g.label)
    );
    return new Map([...labels].sort((a, b) => a.localeCompare(b, 'fr')).map((l, i) => [l, i]));
  }, [sessions, tasks, projects]);

  const { rows, total, sessionCount, onlyCategories } = useMemo(() => {
    const range = periodRange(period);
    const groups = aggregateByGroup(sessions, tasks, projects, range);
    const total = groups.reduce((a, g) => a + g.minutes, 0);
    const colorsFor = (g: GroupStat): [string, string] => {
      if (g.color) return [g.color, g.color];
      const idx = categoryColorIndex.get(g.label);
      return idx !== undefined && idx < CATEGORY_COLORS.length ? CATEGORY_COLORS[idx] : NEUTRAL;
    };

    // Au-delà de MAX_ROWS, la traîne est regroupée en « Autres » (jamais de couleur générée)
    const head = groups.slice(0, groups.length > MAX_ROWS ? MAX_ROWS - 1 : MAX_ROWS);
    const tail = groups.slice(head.length);
    const rows: Row[] = head.map((g) => ({ ...g, colors: colorsFor(g), share: total ? g.minutes / total : 0 }));
    if (tail.length) {
      const minutes = tail.reduce((a, g) => a + g.minutes, 0);
      rows.push({
        key: 'others',
        kind: 'category',
        label: `Autres (${tail.length})`,
        color: null,
        minutes,
        sessions: tail.reduce((a, g) => a + g.sessions, 0),
        colors: NEUTRAL,
        share: total ? minutes / total : 0,
      });
    }
    return {
      rows,
      total,
      sessionCount: focusSessionsInRange(sessions, range).length,
      onlyCategories: groups.every((g) => g.kind === 'category'),
    };
  }, [period, sessions, tasks, projects, categoryColorIndex]);

  const maxMinutes = Math.max(1, ...rows.map((r) => r.minutes));
  const periodLabel = period === 'week' ? '7 derniers jours' : '30 derniers jours';

  return (
    <div className="bg-white dark:bg-[#111827] border border-neutral-200 dark:border-slate-800 rounded-2xl p-5">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">
            Répartition par {onlyCategories && rows.length ? 'catégorie' : 'projet'}
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {periodLabel} ·{' '}
            <strong className="font-semibold text-slate-900 dark:text-white font-mono-tabular">
              {formatMinutes(total)}
            </strong>{' '}
            · {sessionCount} {sessionCount > 1 ? 'sessions' : 'session'}
          </p>
        </div>
        <div
          role="group"
          aria-label="Période"
          className="inline-flex rounded-lg border border-neutral-200 dark:border-slate-700 p-0.5 text-xs"
        >
          {(['week', 'month'] as const).map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={period === p}
              onClick={() => setPeriod(p)}
              className={`px-2.5 py-1 rounded-md transition-colors ${
                period === p
                  ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                  : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
              }`}
            >
              {p === 'week' ? 'Semaine' : 'Mois'}
            </button>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400 py-8 text-center">
          Aucune session de concentration sur cette période.
        </p>
      ) : (
        <>
          {/* Vue d'ensemble : barre 100 % empilée, 2 px d'espace entre segments */}
          <div className="flex h-2.5 gap-[2px] rounded-full overflow-hidden mb-5" aria-hidden="true">
            {rows.map((r) => (
              <span
                key={r.key}
                className="h-full bg-[var(--c)] dark:bg-[var(--cd)]"
                style={{ ...colorStyle(r.colors), width: `${r.share * 100}%` }}
              />
            ))}
          </div>

          <ul className="space-y-3">
            {rows.map((r) => {
              const pct = Math.round(r.share * 100);
              return (
                <li
                  key={r.key}
                  title={`${r.label} : ${formatMinutes(r.minutes)} · ${r.sessions} ${r.sessions > 1 ? 'sessions' : 'session'} · ${pct} %`}
                >
                  <div className="flex items-baseline justify-between gap-3 text-xs mb-1">
                    <span className="flex items-center gap-2 min-w-0 text-slate-700 dark:text-slate-200">
                      <span
                        className="w-2 h-2 rounded-full shrink-0 bg-[var(--c)] dark:bg-[var(--cd)]"
                        style={colorStyle(r.colors)}
                        aria-hidden="true"
                      />
                      <span className="truncate">{r.label}</span>
                    </span>
                    <span className="font-mono-tabular text-slate-500 dark:text-slate-400 shrink-0">
                      <strong className="font-semibold text-slate-900 dark:text-white">{formatMinutes(r.minutes)}</strong>{' '}
                      · {pct} %
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-slate-100 dark:bg-slate-800">
                    <div
                      className="h-full rounded-full bg-[var(--c)] dark:bg-[var(--cd)]"
                      style={{ ...colorStyle(r.colors), width: `${(r.minutes / maxMinutes) * 100}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
