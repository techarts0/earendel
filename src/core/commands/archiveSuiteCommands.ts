import { Command } from '../types';

export const archiveSuiteCommands: Command[] = [
  {
    name: 'tar',
    description: 'An archiving utility for file packing and unpacking',
    category: 'archive',
    execute: (ctx) => {
      const flags = ctx.args[0] || '';
      const archiveName = ctx.args[1];

      if (!flags || !archiveName) {
        return {
          stdout: `tar: missing operation mode or archive filename\nUsage: tar -czvf archive.tar.gz file1 file2...\n       tar -xzvf archive.tar.gz\n`,
          stderr: '',
          exitCode: 1,
        };
      }

      // 1. Create Archive (-c)
      if (flags.includes('c')) {
        const targets = ctx.args.slice(2);
        if (targets.length === 0) {
          return { stdout: '', stderr: 'tar: Cowardly refusing to create an empty archive\n', exitCode: 1 };
        }

        const packedData: Record<string, { content: string; type: string; permissions: string }> = {};
        let log = '';

        for (const t of targets) {
          const node = ctx.vfs.getNodeByPath(t);
          if (node) {
            packedData[node.name || t] = {
              content: node.content || '',
              type: node.type,
              permissions: node.permissions,
            };
            log += `${node.name || t}\n`;
          }
        }

        const payload = `EARENDEL_TAR_V1:${btoa(unescape(encodeURIComponent(JSON.stringify(packedData))))}`;
        ctx.vfs.writeFile(archiveName, payload);

        return { stdout: flags.includes('v') ? log : '', stderr: '', exitCode: 0 };
      }

      // 2. Extract Archive (-x)
      if (flags.includes('x')) {
        const node = ctx.vfs.getNodeByPath(archiveName);
        if (!node || node.type !== 'file') {
          return { stdout: '', stderr: `tar: ${archiveName}: Cannot open: No such file\n`, exitCode: 2 };
        }

        let content = node.content || '';
        let log = '';

        if (content.startsWith('EARENDEL_TAR_V1:')) {
          try {
            const rawJson = decodeURIComponent(escape(atob(content.replace('EARENDEL_TAR_V1:', ''))));
            const packedData = JSON.parse(rawJson);

            for (const name of Object.keys(packedData)) {
              const item = packedData[name];
              ctx.vfs.writeFile(name, item.content);
              ctx.vfs.chmod(name, item.permissions);
              log += `${name}\n`;
            }
          } catch (e) {
            return { stdout: '', stderr: `tar: ${archiveName}: Error parsing archive header\n`, exitCode: 2 };
          }
        }

        return { stdout: flags.includes('v') ? log : '', stderr: '', exitCode: 0 };
      }

      return { stdout: '', stderr: 'tar: You must specify one of the \'-c\', \'-x\', or \'-t\' options\n', exitCode: 1 };
    },
  },
  {
    name: 'zip',
    description: 'Package and compress (archive) files',
    category: 'archive',
    execute: (ctx) => {
      const archiveName = ctx.args[0];
      const targets = ctx.args.slice(1);

      if (!archiveName || targets.length === 0) {
        return { stdout: '', stderr: 'zip error: Invalid command arguments (zip archive.zip file1 file2...)\n', exitCode: 1 };
      }

      const packedData: Record<string, string> = {};
      let out = `  adding: ${archiveName} (deflated 0%)\n`;

      for (const t of targets) {
        const node = ctx.vfs.getNodeByPath(t);
        if (node) {
          packedData[node.name || t] = node.content || '';
          out += `  adding: ${node.name || t} (stored 0%)\n`;
        }
      }

      const payload = `EARENDEL_ZIP_V1:${btoa(unescape(encodeURIComponent(JSON.stringify(packedData))))}`;
      ctx.vfs.writeFile(archiveName, payload);

      return { stdout: out, stderr: '', exitCode: 0 };
    },
  },
  {
    name: 'unzip',
    description: 'List, test and extract compressed files in a ZIP archive',
    category: 'archive',
    execute: (ctx) => {
      const archiveName = ctx.args[0];
      if (!archiveName) {
        return { stdout: '', stderr: 'unzip: cannot find or open zipfile\nUsage: unzip archive.zip\n', exitCode: 1 };
      }

      const node = ctx.vfs.getNodeByPath(archiveName);
      if (!node || node.type !== 'file') {
        return { stdout: '', stderr: `unzip: cannot find or open ${archiveName}\n`, exitCode: 2 };
      }

      const content = node.content || '';
      let out = `Archive:  ${archiveName}\n`;

      if (content.startsWith('EARENDEL_ZIP_V1:')) {
        try {
          const rawJson = decodeURIComponent(escape(atob(content.replace('EARENDEL_ZIP_V1:', ''))));
          const packedData = JSON.parse(rawJson);

          for (const name of Object.keys(packedData)) {
            ctx.vfs.writeFile(name, packedData[name]);
            out += ` extracting: ${name}\n`;
          }
        } catch (e) {
          return { stdout: '', stderr: `unzip: ${archiveName} is not a valid zip archive\n`, exitCode: 2 };
        }
      }

      return { stdout: out, stderr: '', exitCode: 0 };
    },
  },
];
