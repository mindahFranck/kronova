export interface ProductivityQuote {
  id: string;
  text: string;
  author: string;
  work: string;
}

export const PRODUCTIVITY_QUOTES: ProductivityQuote[] = [
  {
    id: 'q-1',
    text: 'La capacité à se concentrer sans distraction sur une tâche exigeante est la compétence qui distingue l’excellence de la dispersion.',
    author: 'Cal Newport',
    work: 'Deep Work',
  },
  {
    id: 'q-2',
    text: 'Ce que nous choisissons d’ignorer détermine autant la qualité de notre travail que ce à quoi nous consacrons notre attention.',
    author: 'Francesco Cirillo',
    work: 'La Technique Pomodoro',
  },
  {
    id: 'q-3',
    text: 'Concentrez toutes vos pensées sur l’ouvrage en cours. Les rayons du soleil ne brûlent que lorsqu’ils sont focalisés.',
    author: 'Alexander Graham Bell',
    work: 'Carnets de recherche',
  },
  {
    id: 'q-4',
    text: 'La simplicité consiste à soustraire l’évident pour ajouter le significatif.',
    author: 'John Maeda',
    work: 'Les Lois de la Simplicité',
  },
  {
    id: 'q-5',
    text: 'Un esprit calme et discipliné accomplit en vingt-cinq minutes ce qu’un esprit dispersé poursuit en vain toute une journée.',
    author: 'Sénèque',
    work: 'De la brièveté de la vie',
  },
  {
    id: 'q-6',
    text: 'Commencez là où vous êtes, utilisez ce que vous avez, faites une seule chose à la fois jusqu’à son achèvement.',
    author: 'Arthur Ashe',
    work: 'Réflexions sur la maîtrise',
  },
  {
    id: 'q-7',
    text: 'L’attention est la forme la plus rare et la plus pure de la générosité intellectuelle.',
    author: 'Simone Weil',
    work: 'La Pesanteur et la Grâce',
  },
  {
    id: 'q-8',
    text: 'Le secret pour avancer est de diviser vos objectifs complexes en unités de temps mesurables, puis d’entamer la première immédiatement.',
    author: 'Mark Twain',
    work: 'Essais',
  },
  {
    id: 'q-9',
    text: 'Ce n’est pas que nous ayons peu de temps, c’est que nous en perdons beaucoup.',
    author: 'Sénèque',
    work: 'De la brièveté de la vie',
  },
  {
    id: 'q-10',
    text: 'Pendant qu’on la diffère, la vie passe.',
    author: 'Sénèque',
    work: 'Lettres à Lucilius',
  },
  {
    id: 'q-11',
    text: 'Rien ne sert de courir ; il faut partir à point.',
    author: 'Jean de La Fontaine',
    work: 'Le Lièvre et la Tortue',
  },
  {
    id: 'q-12',
    text: 'Patience et longueur de temps font plus que force ni que rage.',
    author: 'Jean de La Fontaine',
    work: 'Le Lion et le Rat',
  },
  {
    id: 'q-13',
    text: 'Hâtez-vous lentement, et sans perdre courage, vingt fois sur le métier remettez votre ouvrage.',
    author: 'Nicolas Boileau',
    work: 'L’Art poétique',
  },
  {
    id: 'q-14',
    text: 'Ce que l’on conçoit bien s’énonce clairement.',
    author: 'Nicolas Boileau',
    work: 'L’Art poétique',
  },
  {
    id: 'q-15',
    text: 'Il faut cultiver notre jardin.',
    author: 'Voltaire',
    work: 'Candide',
  },
  {
    id: 'q-16',
    text: 'Le travail éloigne de nous trois grands maux : l’ennui, le vice et le besoin.',
    author: 'Voltaire',
    work: 'Candide',
  },
  {
    id: 'q-17',
    text: 'La perfection est atteinte, non quand il n’y a plus rien à ajouter, mais quand il n’y a plus rien à retrancher.',
    author: 'Antoine de Saint-Exupéry',
    work: 'Terre des hommes',
  },
  {
    id: 'q-18',
    text: 'L’attention est la forme la plus rare et la plus pure de la générosité.',
    author: 'Simone Weil',
    work: 'Lettre à Joë Bousquet',
  },
  {
    id: 'q-19',
    text: 'Rien de grand ne s’est accompli dans le monde sans passion.',
    author: 'Hegel',
    work: 'La Raison dans l’histoire',
  },
  {
    id: 'q-20',
    text: 'Nous sommes ce que nous faisons de manière répétée. L’excellence n’est donc pas un acte, mais une habitude.',
    author: 'Will Durant',
    work: 'Histoire de la philosophie',
  },
];

export const DEFAULT_BLOCKED_DOMAINS: string[] = [
  'youtube.com',
  'facebook.com',
  'netflix.com',
];

export const PRESET_DISTRACTION_SITES: { domain: string; label: string; category: string }[] = [
  { domain: 'youtube.com', label: 'YouTube', category: 'Vidéo' },
  { domain: 'facebook.com', label: 'Facebook', category: 'Réseau social' },
  { domain: 'netflix.com', label: 'Netflix', category: 'Streaming' },
  { domain: 'instagram.com', label: 'Instagram', category: 'Réseau social' },
  { domain: 'tiktok.com', label: 'TikTok', category: 'Vidéo courte' },
  { domain: 'x.com', label: 'X / Twitter', category: 'Fil d’actualité' },
  { domain: 'reddit.com', label: 'Reddit', category: 'Forum' },
  { domain: 'twitch.tv', label: 'Twitch', category: 'Direct' },
];
