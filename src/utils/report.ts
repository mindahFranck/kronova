import type { PomodoroTask, Project, SessionRecord } from '../types';
import {
  NO_PROJECT_LABEL,
  aggregateByGroup,
  dailySeries,
  focusScore,
  formatMinutes,
  hourlyHistogram,
  parseIsoDate,
  peakHours,
  periodRange,
  topTasks,
} from './stats';

export interface FocusReportOptions {
  period: 'week' | 'month';
  sessions: SessionRecord[];
  tasks: PomodoroTask[];
  projects: Project[];
  userName: string;
  dailyGoal: number;
}

// Palette catégorielle (version claire, adaptée à l'impression)
const CATEGORY_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300'];
const NEUTRAL = '#94a3b8';

/** Échappe tout texte inséré dans le HTML (titres de tâches, noms de projets, nom d'utilisateur). */
export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** N'accepte qu'une couleur hexadécimale ; sinon couleur neutre (évite l'injection CSS). */
const safeColor = (color: string | null | undefined) =>
  color && /^#[0-9a-f]{3,8}$/i.test(color) ? color : NEUTRAL;

const shortDate = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });
const longDate = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
const dayLabel = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric' });

/** Construit le document HTML du bilan (fonction pure, exportée pour les tests). */
export function buildFocusReportHtml(opts: FocusReportOptions, today?: string): string {
  const range = periodRange(opts.period, today);
  const days = dailySeries(opts.sessions, range, today);
  const totalMinutes = days.reduce((a, d) => a + d.minutes, 0);
  const totalSessions = days.reduce((a, d) => a + d.sessions, 0);
  const activeDays = days.filter((d) => d.sessions > 0).length;
  const goal = Math.max(1, Math.round(opts.dailyGoal || 1));
  const goalDays = days.filter((d) => d.sessions >= goal).length;
  const groups = aggregateByGroup(opts.sessions, opts.tasks, opts.projects, range, today);
  const tasks = topTasks(opts.sessions, range, 5, today);
  const peak = peakHours(hourlyHistogram(opts.sessions, range, today));
  const score = focusScore(opts.sessions, days.length, today);

  const from = parseIsoDate(range.from);
  const to = parseIsoDate(range.to);
  const title =
    opts.period === 'week'
      ? `Bilan Kronova — semaine du ${shortDate.format(from)} au ${longDate.format(to)}`
      : `Bilan Kronova — 30 jours, du ${shortDate.format(from)} au ${longDate.format(to)}`;

  // Couleur stable par catégorie (ordre alphabétique), le projet garde la sienne
  const categories = groups
    .filter((g) => g.kind === 'category' && g.label !== NO_PROJECT_LABEL)
    .map((g) => g.label)
    .sort((a, b) => a.localeCompare(b, 'fr'));
  const colorOf = (g: (typeof groups)[number]) => {
    if (g.color) return safeColor(g.color);
    const idx = categories.indexOf(g.label);
    return idx >= 0 && idx < CATEGORY_COLORS.length ? CATEGORY_COLORS[idx] : NEUTRAL;
  };

  const maxGroup = Math.max(1, ...groups.map((g) => g.minutes));
  const groupRows = groups
    .map((g) => {
      const pct = totalMinutes ? Math.round((g.minutes / totalMinutes) * 100) : 0;
      return `<tr>
        <td><span class="dot" style="background:${colorOf(g)}"></span>${escapeHtml(g.label)}</td>
        <td class="bar-cell"><span class="bar" style="width:${((g.minutes / maxGroup) * 100).toFixed(1)}%;background:${colorOf(g)}"></span></td>
        <td class="num">${escapeHtml(formatMinutes(g.minutes))}</td>
        <td class="num">${g.sessions}</td>
        <td class="num">${pct} %</td>
      </tr>`;
    })
    .join('');

  const taskRows = tasks
    .map(
      (t, i) => `<tr><td class="num muted">${i + 1}</td><td>${escapeHtml(t.title)}</td>
        <td class="num">${escapeHtml(formatMinutes(t.minutes))}</td><td class="num">${t.sessions}</td></tr>`
    )
    .join('');

  const maxDay = Math.max(1, ...days.map((d) => d.minutes));
  const dayBars =
    opts.period === 'week'
      ? `<div class="days">${days
          .map(
            (d) => `<div class="day">
              <div class="day-track"><span class="day-bar${d.sessions >= goal ? ' goal' : ''}" style="height:${d.minutes ? Math.max(4, (d.minutes / maxDay) * 100) : 0}%"></span></div>
              <div class="day-label">${escapeHtml(dayLabel.format(parseIsoDate(d.date)))}</div>
              <div class="day-value">${d.minutes} min</div>
            </div>`
          )
          .join('')}</div>`
      : '';

  const stat = (label: string, value: string, hint = '') =>
    `<div class="stat"><div class="stat-label">${label}</div><div class="stat-value">${value}</div>${
      hint ? `<div class="stat-hint">${hint}</div>` : ''
    }</div>`;

  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>
  @page { size: A4; margin: 16mm 14mm; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #f8fafc; color: #0f172a; font: 13px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
  .page { max-width: 210mm; margin: 24px auto; background: #fff; padding: 32px 36px; border: 1px solid #e2e8f0; border-radius: 12px; }
  header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; border-bottom: 1px solid #e2e8f0; padding-bottom: 16px; margin-bottom: 20px; }
  h1 { font-size: 20px; margin: 0 0 4px; font-weight: 600; }
  h2 { font-size: 14px; margin: 24px 0 10px; font-weight: 600; }
  .muted { color: #64748b; }
  .print-btn { font: inherit; font-size: 12px; border: 0; border-radius: 8px; background: #0f172a; color: #fff; padding: 8px 14px; cursor: pointer; white-space: nowrap; }
  .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
  .stat { border: 1px solid #e2e8f0; border-radius: 10px; padding: 10px 12px; }
  .stat-label { font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: .04em; }
  .stat-value { font-size: 20px; font-weight: 600; margin-top: 2px; font-variant-numeric: tabular-nums; }
  .stat-hint { font-size: 11px; color: #64748b; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #f1f5f9; vertical-align: middle; }
  th { font-size: 11px; font-weight: 500; color: #64748b; }
  .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 8px; }
  .bar-cell { width: 35%; }
  .bar { display: block; height: 6px; border-radius: 3px; min-width: 2px; }
  .days { display: grid; grid-template-columns: repeat(7, 1fr); gap: 6px; }
  .day { text-align: center; }
  .day-track { height: 80px; display: flex; align-items: flex-end; background: #f8fafc; border-radius: 4px; }
  .day-bar { display: block; width: 100%; background: #cbd5e1; border-radius: 4px 4px 0 0; }
  .day-bar.goal { background: #0f172a; }
  .day-label { font-size: 11px; color: #64748b; margin-top: 4px; }
  .day-value { font-size: 11px; font-variant-numeric: tabular-nums; }
  .legend { font-size: 11px; color: #64748b; margin-top: 6px; }
  .legend i { display: inline-block; width: 8px; height: 8px; border-radius: 2px; background: #0f172a; margin-right: 4px; }
  .two-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
  footer { margin-top: 28px; font-size: 11px; color: #94a3b8; }
  .empty { color: #64748b; font-style: italic; }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  @media (max-width: 640px) { .stats, .two-cols { grid-template-columns: 1fr 1fr; } .page { padding: 20px; margin: 0; border-radius: 0; } }
  @media print {
    body { background: #fff; }
    .page { margin: 0; padding: 0; border: 0; max-width: none; }
    .no-print { display: none !important; }
    section, table, .stats, .days { break-inside: avoid; }
  }
</style>
</head>
<body>
<div class="page">
  <header>
    <div>
      <h1>${escapeHtml(title)}</h1>
      <div class="muted">${escapeHtml(opts.userName || 'Utilisateur')} · généré le ${escapeHtml(longDate.format(new Date()))}</div>
    </div>
    <button type="button" class="print-btn no-print" data-print>Enregistrer en PDF</button>
  </header>

  <div class="stats">
    ${stat('Concentration', escapeHtml(formatMinutes(totalMinutes)), `${totalSessions} ${totalSessions > 1 ? 'sessions' : 'session'}`)}
    ${stat('Jours actifs', `${activeDays}/${days.length}`)}
    ${stat('Objectif atteint', `${goalDays}/${days.length}`, `${goal} ${goal > 1 ? 'sessions' : 'session'} par jour`)}
    ${stat('Score', score ? `${score.score}/100` : '—', score ? `${Math.round(score.cleanRatio * 100)} % sans interruption` : '')}
  </div>

  ${dayBars ? `<section><h2>Jour par jour</h2>${dayBars}<div class="legend"><i></i>objectif quotidien atteint</div></section>` : ''}

  <section>
    <h2>Répartition par projet</h2>
    ${
      groups.length
        ? `<table><thead><tr><th>Projet / catégorie</th><th></th><th class="num">Temps</th><th class="num">Sessions</th><th class="num">Part</th></tr></thead><tbody>${groupRows}</tbody></table>`
        : '<p class="empty">Aucune session de concentration sur la période.</p>'
    }
  </section>

  <div class="two-cols">
    <section>
      <h2>Tâches principales</h2>
      ${
        tasks.length
          ? `<table><thead><tr><th class="num">#</th><th>Tâche</th><th class="num">Temps</th><th class="num">Sessions</th></tr></thead><tbody>${taskRows}</tbody></table>`
          : '<p class="empty">Aucune tâche.</p>'
      }
    </section>
    <section>
      <h2>Heures de pointe</h2>
      ${
        peak
          ? `<p><strong style="font-size:18px">${escapeHtml(peak.label)}</strong><br /><span class="muted">${escapeHtml(formatMinutes(peak.minutes))} de concentration sur ce créneau</span></p>`
          : '<p class="empty">Pas encore assez de données.</p>'
      }
      <h2>Score de concentration</h2>
      ${
        score
          ? `<p><strong style="font-size:18px">${score.score}/100</strong><br /><span class="muted">70 % : part des sessions sans interruption (${Math.round(score.cleanRatio * 100)} %) · 30 % : régularité (${score.activeDays}/${score.days} jours actifs)</span></p>`
          : '<p class="empty">Aucune session sur la période.</p>'
      }
    </section>
  </div>

  <footer>Kronova · bilan généré localement à partir de votre historique de sessions.</footer>
</div>
</body>
</html>`;
}

/** Ouvre le bilan imprimable dans une nouvelle fenêtre ; retourne false si la fenêtre est bloquée. */
export function openFocusReport(opts: FocusReportOptions): boolean {
  const win = window.open('', '_blank');
  if (!win) return false;
  win.document.open();
  win.document.write(buildFocusReportHtml(opts));
  win.document.close();
  // Écouteur posé depuis l'appli plutôt qu'un attribut onclick (compatible avec une CSP stricte)
  win.document.querySelector('[data-print]')?.addEventListener('click', () => win.print());
  win.focus();
  return true;
}
