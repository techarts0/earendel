// Behavioral Crontab Commands for Earendel
import { Command } from '../types';
import { globalCronEngine } from '../cronEngine';

export const cronCommands: Command[] = [
  {
    name: 'crontab',
    description: 'maintain crontab files for individual users (-e, -l, -r)',
    category: 'sys',
    execute: async (ctx) => {
      const crontabPath = '/var/spool/cron/crontabs/hello';

      // 1. crontab -l (list)
      if (ctx.args.includes('-l')) {
        const content = ctx.vfs.readFile(crontabPath);
        if (content === null || content.trim() === '') {
          return { stdout: '', stderr: 'no crontab for hello\n', exitCode: 1 };
        }
        return { stdout: content.endsWith('\n') ? content : content + '\n', stderr: '', exitCode: 0 };
      }

      // 2. crontab -r (remove)
      if (ctx.args.includes('-r')) {
        ctx.vfs.writeFile(crontabPath, '# Earendel Crontab for user hello\n');
        globalCronEngine.reloadJobs();
        return { stdout: 'crontab for hello removed\n', stderr: '', exitCode: 0 };
      }

      // 3. crontab -e (edit)
      if (ctx.args.includes('-e') || ctx.args.length === 0) {
        const { globalCommandRegistry } = await import('../commandRegistry');
        const viCmd = globalCommandRegistry.getCommand('vi');
        if (viCmd) {
          const res = await viCmd.execute({ ...ctx, args: [crontabPath] });
          globalCronEngine.reloadJobs();
          return res;
        }
      }

      return { stdout: '', stderr: 'crontab: invalid option\nUsage: crontab [-u user] {-l | -r | -e}\n', exitCode: 1 };
    },
  },
];
