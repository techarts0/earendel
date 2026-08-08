import { Command } from '../types';
import { manDatabase } from '../manDatabase';

export const manCommands: Command[] = [
  {
    name: 'man',
    description: 'an interface to the system reference manuals',
    category: 'sys',
    execute: (ctx) => {
      const targetCmd = ctx.args[0];
      if (!targetCmd) {
        return { stdout: '', stderr: 'What manual page do you want?\nFor example, try \'man ls\' or \'man vi\'.\n', exitCode: 1 };
      }

      const page = manDatabase[targetCmd];
      if (!page) {
        return { stdout: '', stderr: `No manual entry for ${targetCmd}\n`, exitCode: 1 };
      }

      const isZh = ctx.lang === 'zh';
      const desc = isZh ? page.descriptionZh : page.descriptionEn;
      const opts = isZh ? page.optionsZh : page.optionsEn;
      const examples = isZh ? page.examplesZh : page.examplesEn;

      const header = `\x1b[1m${page.name.toUpperCase()}(${page.section})             System General Commands Manual             ${page.name.toUpperCase()}(${page.section})\x1b[0m\n\n`;

      let body = `\x1b[1;36mNAME\x1b[0m\n       ${page.name} - ${desc}\n\n`;
      body += `\x1b[1;36mSYNOPSIS\x1b[0m\n       \x1b[1m${page.synopsis}\x1b[0m\n\n`;

      body += `\x1b[1;36mDESCRIPTION\x1b[0m\n       ${desc}\n\n`;

      if (opts && opts.length > 0) {
        body += `\x1b[1;36mOPTIONS\x1b[0m\n`;
        opts.forEach((o) => {
          body += `       \x1b[1;33m${o.opt.padEnd(20)}\x1b[0m\n              ${o.desc}\n`;
        });
        body += '\n';
      }

      if (examples && examples.length > 0) {
        body += `\x1b[1;36mEXAMPLES\x1b[0m\n`;
        examples.forEach((ex) => {
          body += `       $ \x1b[32m${ex}\x1b[0m\n`;
        });
        body += '\n';
      }

      const footer = `\x1b[90mEarendel Manual Page v1.0 (${isZh ? '中文说明' : 'English Manual'})              ${new Date().toLocaleDateString()}\x1b[0m\n`;

      return { stdout: header + body + footer, stderr: '', exitCode: 0 };
    },
  },
];
