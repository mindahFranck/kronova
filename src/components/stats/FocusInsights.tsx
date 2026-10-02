import { useMemo } from 'react';
import type { SessionRecord } from '../../types';
import { focusScore, formatMinutes, hourlyHistogram, lastDaysRange, peakHours } from '../../utils/stats';

interface FocusInsightsProps {
  sessions: SessionRecord[];
}

const SCORE_DAYS = 14;
const HISTOGRAM_DAYS = 30;

function scoreVerdict(score: number): string {
  if (score >= 80) return 'Excellente concentration';
  if (score >= 60) return 'Bonne concentration';
  if (score >= 40) return 'Concentration irrégulière';
  return 'Concentration fragile';
}

export default function FocusInsights({ sessions }: FocusInsightsProps) {
  const { score, hours, peak } = useMemo(() => {
    const hours = hourlyHistogram(sessions, lastDaysRange(HISTOGRAM_DAYS));
    return { score: focusScore(sessions, SCORE_DAYS), hours, peak: peakHours(hours) };
  }, [sessions]);

  const maxMinutes = Math.max(1, ...hours.map((h) => h.minutes));
  const inPeak = (hour: number) => !!peak && (hour - peak.start + 24) % 24 < 2;

  return (
    <div className="bg-white dark:bg-[#111827] border border-neutral-200 dark:border-slate-800 rounded-2xl p-5">
      <h2 className="text-base font-semibold text-slate-900 dark:text-white">Qualité de concentration</h2>
      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 mb-5">
        Score sur {SCORE_DAYS} jours · heures sur {HISTOGRAM_DAYS} jours
      </p>

      <div className="grid gap-6 sm:grid-cols-2">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">Score</div>
          {score ? (
            <>
              <div className="flex items-baseline gap-1 mt-1">
                <span className="text-5xl font-semibold text-slate-900 dark:text-white leading-none">{score.score}</span>
                <span className="text-sm text-slate-400 dark:text-slate-500">/100</span>
              </div>
              <div className="text-sm font-medium text-slate-700 dark:text-slate-200 mt-2">
                {scoreVerdict(score.score)}
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                {Math.round(score.cleanRatio * 100)} % de sessions sans interruption (70 % du score) et{' '}
                {score.activeDays} {score.activeDays > 1 ? 'jours actifs' : 'jour actif'} sur {score.days} pour la
                régularité (30 %).
              </p>
            </>
          ) : (
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">
              Terminez une session de concentration pour obtenir un score.
            </p>
          )}
        </div>

        <div>
          <div className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">Heures de pointe</div>
          {peak ? (
            <>
              <div className="text-2xl font-semibold text-slate-900 dark:text-white mt-1 font-mono-tabular">
                {peak.label}
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                {formatMinutes(peak.minutes)} de concentration sur ce créneau
              </p>
            </>
          ) : (
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">Pas encore assez de données.</p>
          )}

          {/* Mini-histogramme 0–23 h : le créneau de pointe ressort, le reste en gris */}
          <div
            className="flex items-end gap-[2px] h-16 mt-4"
            role="img"
            aria-label={
              peak
                ? `Répartition horaire des minutes de concentration, pointe ${peak.label}`
                : 'Répartition horaire des minutes de concentration'
            }
          >
            {hours.map((h) => (
              <div
                key={h.hour}
                title={`${String(h.hour).padStart(2, '0')}h : ${h.minutes} min`}
                className="flex-1 h-full flex items-end"
              >
                <div
                  className={`w-full rounded-t-[2px] ${
                    h.minutes === 0
                      ? 'bg-slate-100 dark:bg-slate-800'
                      : inPeak(h.hour)
                      ? 'bg-slate-900 dark:bg-rose-500'
                      : 'bg-slate-300 dark:bg-slate-600'
                  }`}
                  style={{ height: h.minutes ? `${Math.max(6, (h.minutes / maxMinutes) * 100)}%` : '2px' }}
                />
              </div>
            ))}
          </div>
          <div className="flex justify-between text-[10px] text-slate-400 dark:text-slate-500 font-mono-tabular mt-1">
            <span>0h</span>
            <span>6h</span>
            <span>12h</span>
            <span>18h</span>
            <span>23h</span>
          </div>
        </div>
      </div>
    </div>
  );
}
