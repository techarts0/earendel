// Behavioral Archive & Compression Commands for Earendel
import { Command } from '../types';

export const archiveCommands: Command[] = [
  {
    name: 'gzip',
    description: 'Compress or expand files (-d, -k, -f, -c, -v, -r)',
    category: 'archive',
    execute: (ctx) => {
      const flags = new Set<string>();
      const files: string[] = [];

      for (let i = 0; i < ctx.args.length; i++) {
        const arg = ctx.args[i];
        if (arg.startsWith('--')) {
          flags.add(arg.slice(2));
        } else if (arg.startsWith('-') && arg.length > 1) {
          for (let j = 1; j < arg.length; j++) flags.add(arg[j]);
        } else {
          files.push(arg);
        }
      }

      const decompress = flags.has('d') || flags.has('decompress') || flags.has('uncompress');
      const keep = flags.has('k') || flags.has('keep');
      const toStdout = flags.has('c') || flags.has('stdout') || flags.has('to-stdout');
      const verbose = flags.has('v') || flags.has('verbose');

      if (files.length === 0) {
        if (ctx.pipeInput !== undefined) {
          if (decompress) {
            const raw = ctx.pipeInput.replace(/^\[GZIP_COMPRESSED_DATA\]\n/, '');
            return { stdout: raw, stderr: '', exitCode: 0 };
          } else {
            return { stdout: `[GZIP_COMPRESSED_DATA]\n${ctx.pipeInput}`, stderr: '', exitCode: 0 };
          }
        }
        return { stdout: '', stderr: 'gzip: compressed data not read from a terminal. Use -f to force it.\nFor help, type: gzip -h\n', exitCode: 1 };
      }

      let totalStdout = '';
      let totalStderr = '';
      let exitCode = 0;

      for (const file of files) {
        const content = ctx.vfs.readFile(file, ctx.env['USER'] || 'hello');
        if (content === null) {
          totalStderr += `gzip: ${file}: No such file or directory\n`;
          exitCode = 1;
          continue;
        }

        if (decompress) {
          if (!file.endsWith('.gz') && !content.startsWith('[GZIP_COMPRESSED_DATA]\n')) {
            totalStderr += `gzip: ${file}: unknown suffix -- ignored\n`;
            exitCode = 1;
            continue;
          }
          const raw = content.replace(/^\[GZIP_COMPRESSED_DATA\]\n/, '');
          if (toStdout) {
            totalStdout += raw;
          } else {
            const originalName = file.endsWith('.gz') ? file.slice(0, -3) : file + '.out';
            ctx.vfs.writeFile(originalName, raw);
            if (!keep) ctx.vfs.remove(file);
            if (verbose) totalStdout += `${file}:\t 60.5% -- replaced with ${originalName}\n`;
          }
        } else {
          const compressed = `[GZIP_COMPRESSED_DATA]\n${content}`;
          if (toStdout) {
            totalStdout += compressed;
          } else {
            const gzName = `${file}.gz`;
            ctx.vfs.writeFile(gzName, compressed);
            if (!keep) ctx.vfs.remove(file);
            if (verbose) totalStdout += `${file}:\t 60.5% -- replaced with ${gzName}\n`;
          }
        }
      }

      return { stdout: totalStdout, stderr: totalStderr, exitCode };
    },
  },
  {
    name: 'gunzip',
    description: 'Decompress files (-k, -f, -c, -v)',
    category: 'archive',
    execute: async (ctx) => {
      // Forward to gzip with -d flag
      const { globalCommandRegistry } = await import('../commandRegistry');
      return globalCommandRegistry.execute('gzip', { ...ctx, args: ['-d', ...ctx.args] });
    },
  },
];

