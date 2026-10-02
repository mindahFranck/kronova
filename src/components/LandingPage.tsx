import React from 'react';
import Galaxy from './galaxy/Galaxy';
import {
  Timer,
  Shield,
  ListChecks,
  BarChart3,
  Mic,
  Headphones,
  Moon,
  Sun,
  ArrowRight,
  Download,
} from 'lucide-react';

interface LandingPageProps {
  darkMode: boolean;
  onToggleDarkMode: () => void;
  onLogin: () => void;
  onRegister: () => void;
}

const FEATURES = [
  {
    icon: Timer,
    title: 'Minuteur Pomodoro',
    text: 'Cycles personnalisables, mini-minuteur flottant au-dessus de vos applications, objectif du jour et séries de jours réussis.',
  },
  {
    icon: Shield,
    title: 'Bouclier anti-distraction',
    text: 'Avec l’extension navigateur, les sites qui vous happent sont bloqués dans tous les onglets pendant la concentration.',
  },
  {
    icon: ListChecks,
    title: 'Tâches & projets',
    text: 'Sous-tâches, notes, projets en couleur, routines réutilisables et planning de la journée avec heure de fin estimée.',
  },
  {
    icon: BarChart3,
    title: 'Journal & bilans',
    text: 'Carte de régularité, répartition par projet, heures de pointe, score de concentration et bilan PDF de la semaine.',
  },
  {
    icon: Mic,
    title: 'Assistant vocal IA',
    text: 'Discutez librement à la voix — d’une œuvre, d’une idée — ou dites « lance un Pomodoro de 25 minutes ».',
  },
  {
    icon: Headphones,
    title: 'Ambiances sonores',
    text: 'Votre playlist YouTube tirée au hasard, mêlée à la pluie, au bruit brun, à la cheminée ou au café.',
  },
];

const STEPS = [
  { title: 'Créez votre espace', text: 'Un compte personnel : vos tâches, votre journal et vos réglages vous suivent sur tous vos appareils.' },
  { title: 'Lancez une session', text: 'Choisissez une tâche, démarrez le minuteur ; Kronova verrouille les distractions et lance l’ambiance.' },
  { title: 'Faites le point', text: 'Le journal mesure vos progrès jour après jour et révèle vos meilleurs créneaux.' },
];

const prefersReducedMotion =
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const LandingPage: React.FC<LandingPageProps> = ({
  darkMode,
  onToggleDarkMode,
  onLogin,
  onRegister,
}) => (
  <div className="flex-1 flex flex-col">
    <header className="border-b border-neutral-200/80 dark:border-slate-800/80">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
        <span className="font-display text-2xl tracking-tight text-slate-900 dark:text-white">Kronova</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onToggleDarkMode}
            aria-label={darkMode ? 'Passer au mode clair' : 'Passer au mode sombre'}
            className="min-h-10 min-w-10 p-2 rounded-lg border border-neutral-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-neutral-100 dark:hover:bg-slate-800/70 flex items-center justify-center cursor-pointer"
          >
            {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
          <button
            type="button"
            onClick={onLogin}
            className="min-h-10 px-4 py-2 rounded-lg text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-neutral-100 dark:hover:bg-slate-800/70 cursor-pointer"
          >
            Se connecter
          </button>
        </div>
      </div>
    </header>

    <main className="flex-1">
      {/* Hero sur fond étoilé (nova) */}
      <div className="relative overflow-hidden">
        <div
          aria-hidden="true"
          className={`absolute inset-0 [mask-image:radial-gradient(ellipse_at_center,black_45%,transparent_85%)] ${
            darkMode ? '' : 'opacity-70'
          }`}
        >
          <Galaxy
            key={darkMode ? 'dark' : 'light'}
            lightMode={!darkMode}
            density={darkMode ? 1.2 : 0.9}
            glowIntensity={darkMode ? 0.35 : 0.14}
            saturation={0.35}
            hueShift={220}
            twinkleIntensity={0.4}
            rotationSpeed={0.05}
            starSpeed={0.4}
            repulsionStrength={1.5}
            disableAnimation={prefersReducedMotion}
          />
        </div>
      <section className="relative max-w-6xl mx-auto px-4 sm:px-6 pt-16 sm:pt-24 pb-16 text-center">
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
          Chronos · le temps — Nova · un nouvel élan
        </p>
        <h1 className="font-display text-5xl sm:text-7xl tracking-tight text-slate-900 dark:text-white mt-5 leading-[1.05]">
          Le temps,
          <br />
          un nouvel élan.
        </h1>
        <p className="max-w-2xl mx-auto mt-6 text-base sm:text-lg text-slate-600 dark:text-slate-300">
          Kronova est votre espace de concentration personnel : un minuteur Pomodoro sobre, un bouclier
          contre les distractions, vos tâches et un assistant vocal IA — au même endroit.
        </p>
        <div className="mt-9 flex flex-col sm:flex-row items-center justify-center gap-3">
          <button
            type="button"
            onClick={onRegister}
            className="w-full sm:w-auto min-h-12 px-6 py-3 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-sm font-medium hover:bg-slate-800 dark:hover:bg-slate-200 flex items-center justify-center gap-2 cursor-pointer"
          >
            <span>Créer mon espace gratuitement</span>
            <ArrowRight className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onLogin}
            className="w-full sm:w-auto min-h-12 px-6 py-3 rounded-xl border border-neutral-200 dark:border-slate-800 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-neutral-100 dark:hover:bg-slate-800/70 cursor-pointer"
          >
            J’ai déjà un compte
          </button>
        </div>
      </section>
      </div>

      {/* Fonctionnalités */}
      <section aria-labelledby="landing-features" className="max-w-6xl mx-auto px-4 sm:px-6 pb-20">
        <h2 id="landing-features" className="sr-only">
          Fonctionnalités
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {FEATURES.map(({ icon: Icon, title, text }) => (
            <article
              key={title}
              className="bg-white dark:bg-[#111827] border border-neutral-200 dark:border-slate-800 rounded-2xl p-6"
            >
              <Icon className="w-5 h-5 text-slate-900 dark:text-white" aria-hidden="true" />
              <h3 className="mt-4 text-sm font-semibold text-slate-900 dark:text-white">{title}</h3>
              <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400 leading-relaxed">{text}</p>
            </article>
          ))}
        </div>
      </section>

      {/* Comment ça marche */}
      <section
        aria-labelledby="landing-steps"
        className="border-t border-neutral-200/80 dark:border-slate-800/80 bg-white/60 dark:bg-[#0F1420]"
      >
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16">
          <h2
            id="landing-steps"
            className="font-display text-3xl sm:text-4xl tracking-tight text-slate-900 dark:text-white text-center"
          >
            Comment ça marche
          </h2>
          <ol className="mt-10 grid grid-cols-1 md:grid-cols-3 gap-8">
            {STEPS.map((step, index) => (
              <li key={step.title} className="flex gap-4">
                <span className="font-mono-tabular text-sm font-semibold w-8 h-8 shrink-0 rounded-full border border-neutral-300 dark:border-slate-700 text-slate-900 dark:text-white flex items-center justify-center">
                  {index + 1}
                </span>
                <div>
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{step.title}</h3>
                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400 leading-relaxed">{step.text}</p>
                </div>
              </li>
            ))}
          </ol>
          <div className="mt-12 flex flex-col sm:flex-row items-center justify-center gap-3 text-sm">
            <button
              type="button"
              onClick={onRegister}
              className="w-full sm:w-auto min-h-11 px-6 py-2.5 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-medium hover:bg-slate-800 dark:hover:bg-slate-200 cursor-pointer"
            >
              Commencer maintenant
            </button>
            <a
              href="/downloads/kronova-extension.zip"
              download
              className="w-full sm:w-auto min-h-11 px-6 py-2.5 rounded-xl border border-neutral-200 dark:border-slate-800 font-medium text-slate-700 dark:text-slate-300 hover:bg-neutral-100 dark:hover:bg-slate-800/70 flex items-center justify-center gap-2"
            >
              <Download className="w-4 h-4" />
              <span>Extension navigateur</span>
            </a>
          </div>
        </div>
      </section>
    </main>

    <footer className="border-t border-neutral-200/80 dark:border-slate-800/80">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 text-xs text-slate-500 dark:text-slate-400 flex flex-col sm:flex-row items-center justify-between gap-2">
        <span>© {new Date().getFullYear()} Kronova — kro-nova.com</span>
        <span>Vos données restent privées : chaque compte a son propre espace.</span>
      </div>
    </footer>
  </div>
);
