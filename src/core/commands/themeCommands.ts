import { Command } from '../types';
import { globalThemeManager, THEME_PRESETS } from '../themeManager';

export const themeCommands: Command[] = [
  {
    name: 'theme',
    description: 'Switch terminal color scheme (default | matrix | dracula | cyberpunk | monokai)',
    category: 'sys',
    execute: (ctx) => {
      const targetName = ctx.args[0]?.toLowerCase();

      if (!targetName) {
        const current = globalThemeManager.getCurrentThemeName();
        let out = `Current theme: \x1b[1;36m${current}\x1b[0m\n\nAvailable Theme Presets:\n`;
        Object.keys(THEME_PRESETS).forEach((k) => {
          const p = THEME_PRESETS[k];
          const activeStr = k === current ? ' \x1b[32m[Active]\x1b[0m' : '';
          out += `  * \x1b[1m${k.padEnd(12)}\x1b[0m - ${p.label}${activeStr}\n`;
        });
        out += `\nUsage: theme <name>  (e.g., "theme matrix")\n`;
        return { stdout: out, stderr: '', exitCode: 0 };
      }

      const ok = globalThemeManager.setTheme(targetName);
      if (!ok) {
        return { stdout: '', stderr: `theme: unknown theme '${targetName}'. Run 'theme' to list available themes.\n`, exitCode: 1 };
      }

      const preset = THEME_PRESETS[targetName];
      return { stdout: `Terminal color scheme updated to \x1b[1;32m${preset.label}\x1b[0m\n`, stderr: '', exitCode: 0 };
    },
  },
];
