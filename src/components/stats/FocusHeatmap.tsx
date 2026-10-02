import { useEffect, useMemo, useRef } from 'react';
import type { SessionRecord } from '../../types';
import { addDays, aggregateByDay, formatMinutes, mondayIndex, parseIsoDate, toIsoDate } from '../../utils/stats';

interface FocusHeatmapProps {
  sessions: SessionRecord[];
}

const WEEKS = 26;

// Rampe séquentielle à une seule teinte (rose, accent de l'app), plus foncé = plus de minutes.
// En sombre, l'intensité monte vers le clair pour rester lisible sur le fond.
const LEVEL_CLASSES = [
  'bg-slate-100 dark:bg-slate-800/70',
  'bg-rose-200 dark:bg-rose-950',
  'bg-rose-300 dark:bg-rose-800',
  'bg-rose-500 dark:bg-rose-600',
  'bg-rose-700 dark:bg-rose-400',
];

const DAY_LABELS = ['lun.', '', 'mer.', '', 'ven.', '', ''];

const dateFormatter = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
const monthFormatter = new Intl.DateTimeFormat('fr-FR', { month: 'short' });

/** Niveau 1–4 relatif au meilleur jour de la période (quartiles du maximum). */
function levelFor(minutes: number, max: number): number {
  if (minutes <= 0 || max <= 0) return 0;
  return Math.min(4, Math.max(1, Math.ceil((minutes / max) * 4)));
}

export default function FocusHeatmap({ sessions }: FocusHeatmapProps) {
  const { weeks, monthLabels, totalDays, totalMinutes } = useMemo(() => {
    const today = toIsoDate(new Date());
    const start = addDays(today, -mondayIndex(today) - (WEEKS - 1) * 7);
    const byDay = aggregateByDay(sessions, { from: start, to: today }, today);
    const max = Math.max(0, ...[...byDay.values()].map((d) => d.minutes));

    const weeks = Array.from({ length: WEEKS }, (_, w) =>
      Array.from({ length: 7 }, (_, d) => {
        const date = addDays(start, w * 7 + d);
        const stat = byDay.get(date);
        const minutes = stat?.minutes ?? 0;
        const count = stat?.sessions ?? 0;
        const label = dateFormatter.format(parseIsoDate(date));
        return {
          date,
          future: date > today,
          level: levelFor(minutes, max),
          title: count
            ? `${count} ${count > 1 ? 'sessions' : 'session'} · ${minutes} min — ${label}`
            : `Aucune session — ${label}`,
        };
      })
    );

    // Libellé de mois sur la colonne contenant le 1er du mois ; la première colonne
    // n'est libellée que si le mois suivant ne commence pas juste après (évite le chevauchement).
    const firstOfMonth = (week: (typeof weeks)[number]) => week.find((c) => c.date.endsWith('-01'));
    const monthName = (date: string) => monthFormatter.format(parseIsoDate(date)).replace('.', '');
    const monthLabels = weeks.map((week, i) => {
      const first = firstOfMonth(week);
      if (first) return monthName(first.date);
      if (i === 0 && !weeks.slice(1, 3).some(firstOfMonth)) return monthName(week[0].date);
      return '';
    });

    const totalMinutes = [...byDay.values()].reduce((a, d) => a + d.minutes, 0);
    return { weeks, monthLabels, totalDays: byDay.size, totalMinutes };
  }, [sessions]);

  // Sur mobile, on affiche d'abord les semaines les plus récentes (à droite)
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [weeks]);

  return (
    <div className="bg-white dark:bg-[#111827] border border-neutral-200 dark:border-slate-800 rounded-2xl p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">Régularité sur 6 mois</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Minutes de concentration par jour, 26 dernières semaines
          </p>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400 font-mono-tabular">
          <strong className="font-semibold text-slate-900 dark:text-white">{totalDays}</strong> jours actifs ·{' '}
          <strong className="font-semibold text-slate-900 dark:text-white">{formatMinutes(totalMinutes)}</strong>
        </p>
      </div>

      {/* Défilement horizontal interne : la page ne déborde jamais sur mobile */}
      <div ref={scrollRef} className="overflow-x-auto -mx-1 px-1 pb-1">
        <div
          className="inline-grid gap-[3px] text-[10px] leading-none text-slate-400 dark:text-slate-500"
          style={{ gridTemplateColumns: `auto repeat(${WEEKS}, 12px)`, gridTemplateRows: `auto repeat(7, 12px)` }}
          role="img"
          aria-label={`Carte de chaleur : ${totalDays} jours actifs et ${formatMinutes(totalMinutes)} de concentration sur 26 semaines`}
        >
          <span />
          {monthLabels.map((label, i) => (
            <span key={`m-${i}`} className="whitespace-nowrap pb-1 overflow-visible w-3">
              {label}
            </span>
          ))}
          {DAY_LABELS.map((dayLabel, d) => (
            <div key={`row-${d}`} className="contents">
              <span className="pr-1.5 flex items-center">{dayLabel}</span>
              {weeks.map((week) => {
                const cell = week[d];
                return cell.future ? (
                  <span key={cell.date} />
                ) : (
                  <span
                    key={cell.date}
                    title={cell.title}
                    aria-label={cell.title}
                    className={`w-3 h-3 rounded-[3px] ${LEVEL_CLASSES[cell.level]} hover:ring-1 hover:ring-slate-900 dark:hover:ring-white`}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-end gap-1.5 mt-3 text-[11px] text-slate-500 dark:text-slate-400">
        <span>Moins</span>
        {LEVEL_CLASSES.map((cls, i) => (
          <span key={i} className={`w-3 h-3 rounded-[3px] ${cls}`} aria-hidden="true" />
        ))}
        <span>Plus</span>
      </div>
    </div>
  );
}
