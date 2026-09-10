/**
 * Themes. A theme is a palette, a scene skin, and the words players actually
 * see — that last part is what makes the engine generic. The deck says a card
 * is `lane: 'do'`; the theme decides whether that word is "Trick" or "Dare".
 */

export interface Theme {
  id: string;
  name: string;
  blurb: string;
  /** Which world the campfire canvas draws. */
  scene: 'forest' | 'graveyard';
  palette: {
    night: string;
    ground: string;
    panel: string;
    edge: string;
    text: string;
    muted: string;
    /** Fire core, and the app's primary accent. */
    ember: string;
    /** Outer flame, and the `do` lane. */
    flame: string;
    /** The `say` lane — deliberately cool against the fire's warmth. */
    cool: string;
    alert: string;
  };
  vocab: {
    laneDo: string;
    laneSay: string;
    pass: string;
    points: string;
    stage: string;
  };
  /** Character customisation options, so costumes can be theme-specific. */
  toppers: string[];
  accessories: string[];
}

export const campfire: Theme = {
  id: 'campfire',
  name: 'Campfire',
  blurb: 'A fire in the woods. The year-round default.',
  scene: 'forest',
  palette: {
    night: '#141019',
    ground: '#1E1720',
    panel: '#241C28',
    edge: '#3A2E40',
    text: '#F0E6D8',
    muted: '#A293A6',
    ember: '#F0A83C',
    flame: '#E4653A',
    cool: '#5FBFC7',
    alert: '#C9463C',
  },
  vocab: {
    laneDo: 'Dare',
    laneSay: 'Truth',
    pass: 'Pass',
    points: 'points',
    stage: 'Campfire',
  },
  toppers: ['none', 'beanie', 'curls', 'cap', 'bun', 'bald'],
  accessories: ['none', 'mug', 'blanket', 'glasses', 'marshmallow'],
};

export const halloween: Theme = {
  id: 'halloween',
  name: 'Trick or Truth',
  blurb: 'A cauldron in a graveyard. The Halloween season pack.',
  scene: 'graveyard',
  palette: {
    night: '#14101A',
    ground: '#1C1622',
    panel: '#241C2C',
    edge: '#362B42',
    text: '#EFE6D6',
    muted: '#A295AE',
    ember: '#F0A83C',
    flame: '#B9761F',
    cool: '#5FBFC7',
    alert: '#C9463C',
  },
  vocab: {
    laneDo: 'Trick',
    laneSay: 'Truth',
    pass: "Vampire's Pass",
    points: 'points',
    stage: 'The Séance',
  },
  toppers: ['none', 'witch hat', 'bandages', 'sheet', 'pumpkin', 'horns'],
  accessories: ['none', 'candle', 'cauldron', 'lantern', 'raven'],
};

export const themes: Theme[] = [halloween, campfire];

export const themeById = (id: string): Theme =>
  themes.find((t) => t.id === id) ?? halloween;

/** Write a theme's palette onto the document as CSS custom properties. */
export function applyTheme(theme: Theme, root: HTMLElement = document.documentElement) {
  for (const [name, value] of Object.entries(theme.palette)) {
    root.style.setProperty(`--${name}`, value);
  }
  root.dataset.theme = theme.id;
  root.dataset.scene = theme.scene;
}
