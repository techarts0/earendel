import { Command } from '../types';

// Simple ASCII Figlet Font Matrix mapping for A-Z
const figletFontMap: Record<string, string[]> = {
  A: ['  /\  ', ' /  \ ', '/ /\ \\', '\/__\/'],
  B: [' ___ ', '|  _\\', '|  _/', '|___/'],
  C: [' ____', '/ ___', '| |__', '\____'],
  D: [' ___ ', '|  _\\', '| | |', '|___/'],
  E: [' ____', '|  _|', '|  _|', '|____'],
  F: [' ____', '|  _|', '| |_ ', '|_|  '],
  G: [' ____', '/ ___', '| |_|', '\____'],
  H: [' _ _ ', '| | |', '|   |', '|_|_|'],
  I: [' ___ ', ' | | ', ' | | ', '|___|'],
  J: ['    _', '   | |', '   | |', ' \_/ |'],
  K: [' _  _', '| |/ ', '|  < ', '|_|\_\\'],
  L: [' _   ', '| |  ', '| |__', '|____'],
  M: [' _  _', '| \/ |', '| |\/|', '|_|  |'],
  N: [' _  _', '| \ |', '| |\|', '|_| |'],
  O: [' ___ ', '/ _ \\', '| (_) |', '\___/'],
  P: [' ___ ', '|  _\\', '|  _/', '|_|  '],
  Q: [' ___ ', '/ _ \\', '| (_) |', '\__\_\\'],
  R: [' ___ ', '|  _\\', '|  _/', '|_|\\_\\'],
  S: [' ____', '/ ___', '\___ \\', '____/'],
  T: [' ___ ', ' | | ', ' | | ', ' |_| '],
  U: [' _ _ ', '| | |', '| |_|', '\___/'],
  V: [' _ _ ', '| | |', '| | |', ' \_/ '],
  W: [' _ _ ', '| | |', '| |\/|', ' \_/\_/'],
  X: [' _ _ ', '\ / ', ' > < ', '/_/\_\\'],
  Y: [' _ _ ', '\ / ', ' | | ', ' |_| '],
  Z: [' ____', ' / / ', '/ /_ ', '/____'],
  ' ': ['    ', '    ', '    ', '    '],
};

export const geekArtCommands: Command[] = [
  {
    name: 'sl',
    description: 'Steam Locomotive runs across your terminal',
    category: 'sys',
    execute: async () => {
      const trainFrames = [
        '                           (  ) (@@) ( )  (  )    \n                     (  )                        \n                 (@@)                            \n             (  )                                \n         (@@)                                    \n     (  )                                        \n  (@@)                                           \n    ====        _D_B_H_M_s_h_i_m_a_z_u_          \n____||_________========_______                   \n(   _  _  _  _  _  _  _  _  _  _)                \n `-(_)(_)(_)(_)(_)(_)(_)(_)(_)-\'                 ',
      ];

      return {
        stdout: `\x1b[33m${trainFrames[0]}\x1b[0m\n\nChuchu~~~~~ The steam train passed by! (sl easter egg)\n`,
        stderr: '',
        exitCode: 0,
      };
    },
  },
  {
    name: 'figlet',
    description: 'Display large ASCII text banner',
    category: 'text',
    execute: (ctx) => {
      const text = (ctx.args.join(' ') || 'Earendel').toUpperCase();
      const rows = ['', '', '', ''];

      for (let i = 0; i < text.length; i++) {
        const char = text[i];
        const glyph = figletFontMap[char] || figletFontMap[' '];
        for (let r = 0; r < 4; r++) {
          rows[r] += (glyph[r] || '    ') + ' ';
        }
      }

      return {
        stdout: `\x1b[1;36m${rows.join('\n')}\x1b[0m\n`,
        stderr: '',
        exitCode: 0,
      };
    },
  },
  {
    name: 'tell',
    description: 'Express love with colorful ASCII fireworks for someone special',
    category: 'sys',
    execute: (ctx) => {
      const name = ctx.args.join(' ') || 'Someone';

      const fireworks = [
        `         \x1b[35m.\x1b[0m  \x1b[33m*\x1b[0m  \x1b[36m.\x1b[0m  \x1b[31m*\x1b[0m  \x1b[32m.\x1b[0m  \x1b[34m*\x1b[0m  \x1b[35m.\x1b[0m`,
        `       \x1b[33m*\x1b[0m   \x1b[36m\\\x1b[0m  \x1b[31m|\x1b[0m  \x1b[32m/\x1b[0m   \x1b[34m*\x1b[0m`,
        `      \x1b[36m.\x1b[0m  \x1b[31m-\x1b[0m \x1b[1;31m💖 I LOVE YOU, ${name}! 💖\x1b[0m \x1b[32m-\x1b[0m  \x1b[34m.\x1b[0m`,
        `       \x1b[31m*\x1b[0m   \x1b[32m/\x1b[0m  \x1b[34m|\x1b[0m  \x1b[35m\\\x1b[0m   \x1b[33m*\x1b[0m`,
        `         \x1b[32m.\x1b[0m  \x1b[34m*\x1b[0m  \x1b[35m.\x1b[0m  \x1b[33m*\x1b[0m  \x1b[36m.\x1b[0m  \x1b[31m*\x1b[0m  \x1b[32m.\x1b[0m`,
        '',
        `  \x1b[1;33m✨  May your world be filled with warmth. ✨\x1b[0m\n`,
      ].join('\n');

      return {
        stdout: fireworks,
        stderr: '',
        exitCode: 0,
      };
    },
  },
];
