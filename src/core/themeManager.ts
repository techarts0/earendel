import { ITheme } from '@xterm/xterm';

export interface ThemeConfig {
  name: string;
  label: string;
  theme: ITheme;
}

export const THEME_PRESETS: Record<string, ThemeConfig> = {
  default: {
    name: 'default',
    label: 'Deep Space Blue',
    theme: {
      background: 'transparent',
      foreground: '#e2e8f0',
      cursor: '#38bdf8',
      selectionBackground: 'rgba(99, 102, 241, 0.45)',
      black: '#0f172a',
      red: '#f43f5e',
      green: '#34d399',
      yellow: '#fbbf24',
      blue: '#38bdf8',
      magenta: '#c084fc',
      cyan: '#22d3ee',
      white: '#f8fafc',
    },
  },
  matrix: {
    name: 'matrix',
    label: 'The Matrix',
    theme: {
      background: 'transparent',
      foreground: '#00ff41',
      cursor: '#00ff41',
      selectionBackground: 'rgba(0, 255, 65, 0.35)',
      black: '#000000',
      red: '#00cc22',
      green: '#00ff41',
      yellow: '#00ff66',
      blue: '#00dd33',
      magenta: '#00bb22',
      cyan: '#00ff88',
      white: '#00ff41',
    },
  },
  dracula: {
    name: 'dracula',
    label: 'Dracula',
    theme: {
      background: 'transparent',
      foreground: '#f8f8f2',
      cursor: '#ff79c6',
      selectionBackground: 'rgba(189, 147, 249, 0.4)',
      black: '#21222c',
      red: '#ff5555',
      green: '#50fa7b',
      yellow: '#f1fa8c',
      blue: '#bd93f9',
      magenta: '#ff79c6',
      cyan: '#8be9fd',
      white: '#f8f8f2',
    },
  },
  cyberpunk: {
    name: 'cyberpunk',
    label: 'Cyberpunk',
    theme: {
      background: 'transparent',
      foreground: '#00f0ff',
      cursor: '#ffe600',
      selectionBackground: 'rgba(255, 0, 85, 0.45)',
      black: '#080811',
      red: '#ff0055',
      green: '#ffe600',
      yellow: '#ff0055',
      blue: '#00f0ff',
      magenta: '#ff00ff',
      cyan: '#00f0ff',
      white: '#ffffff',
    },
  },
  monokai: {
    name: 'monokai',
    label: 'Monokai Pro',
    theme: {
      background: 'transparent',
      foreground: '#f8f8f2',
      cursor: '#f92672',
      selectionBackground: 'rgba(249, 38, 114, 0.4)',
      black: '#272822',
      red: '#f92672',
      green: '#a6e22e',
      yellow: '#e6db74',
      blue: '#66d9ef',
      magenta: '#ae81ff',
      cyan: '#a1efe4',
      white: '#f8f8f2',
    },
  },
};

class ThemeManager {
  private currentThemeName: string = 'default';

  constructor() {
    const saved = localStorage.getItem('earendel_theme');
    if (saved && THEME_PRESETS[saved]) {
      this.currentThemeName = saved;
    }
  }

  public getCurrentThemeName(): string {
    return this.currentThemeName;
  }

  public getCurrentTheme(): ITheme {
    return THEME_PRESETS[this.currentThemeName].theme;
  }

  public setTheme(name: string): boolean {
    if (!THEME_PRESETS[name]) return false;
    this.currentThemeName = name;
    localStorage.setItem('earendel_theme', name);
    window.dispatchEvent(new CustomEvent('earendel:theme-changed', { detail: name }));
    return true;
  }
}

export const globalThemeManager = new ThemeManager();
