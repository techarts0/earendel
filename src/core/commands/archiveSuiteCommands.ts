import { Command } from '../types';

export const archiveSuiteCommands: Command[] = [
  {
    name: 'tar',
    description: 'Archiving utility for file and directory packing/unpacking (-c, -x, -t, -v, -f, -z, -j, -C)',
    category: 'archive',
    execute: (ctx) => {
      let mode: 'c' | 'x' | 't' | null = null;
      let archiveFile: string | null = null;
      let targetDir: string = '.';
      let verbose = false;
      let gzipFilter = false;
      const targets: string[] = [];

      for (let i = 0; i < ctx.args.length; i++) {
        const arg = ctx.args[i];
        if (arg === '-f' && ctx.args[i + 1]) {
          archiveFile = ctx.args[i + 1];
          i++;
        } else if (arg.startsWith('-f')) {
          archiveFile = arg.slice(2);
        } else if (arg === '-C' && ctx.args[i + 1]) {
          targetDir = ctx.args[i + 1];
          i++;
        } else if (arg.startsWith('-C')) {
          targetDir = arg.slice(2);
        } else if (arg.startsWith('-') || (!mode && /^[cxtvzfjh]+$/.test(arg))) {
          const clean = arg.replace(/^-+/, '');
          if (clean.includes('c')) mode = 'c';
          if (clean.includes('x')) mode = 'x';
          if (clean.includes('t')) mode = 't';
          if (clean.includes('v')) verbose = true;
          if (clean.includes('z')) gzipFilter = true;
          if (clean.includes('f')) {
            if (i + 1 < ctx.args.length && !ctx.args[i + 1].startsWith('-') && !archiveFile) {
              archiveFile = ctx.args[i + 1];
              i++;
            }
          }
        } else if (!archiveFile && mode) {
          archiveFile = arg;
        } else {
          targets.push(arg);
        }
      }

      if (!mode) {
        return { stdout: '', stderr: 'tar: You must specify one of the \'-c\', \'-x\', or \'-t\' options\nTry \'tar --help\' for more information.\n', exitCode: 2 };
      }
      if (!archiveFile) {
        return { stdout: '', stderr: 'tar: Refusing to read/write archive contents from/to terminal. (Use -f filename)\n', exitCode: 2 };
      }

      // 1. CREATE (-c)
      if (mode === 'c') {
        if (targets.length === 0) {
          return { stdout: '', stderr: 'tar: Cowardly refusing to create an empty archive\n', exitCode: 1 };
        }

        const packedData: Record<string, { content: string; type: string; permissions: string; size: number }> = {};
        const logLines: string[] = [];

        const collectPath = (p: string, prefix: string) => {
          const node = ctx.vfs.getNodeByPath(p);
          if (!node) return;

          const archivePath = prefix ? (prefix.endsWith('/') ? `${prefix}${node.name}` : `${prefix}/${node.name}`) : node.name || p;

          packedData[archivePath] = {
            content: node.content || '',
            type: node.type,
            permissions: node.permissions,
            size: node.size || 0,
          };
          logLines.push(archivePath);

          if (node.type === 'directory' && node.children) {
            for (const child of node.children.values()) {
              const childActualPath = p === '.' ? child.name : (p.endsWith('/') ? `${p}${child.name}` : `${p}/${child.name}`);
              collectPath(childActualPath, archivePath);
            }
          }
        };

        for (const t of targets) {
          collectPath(t, '');
        }

        const rawJson = JSON.stringify(packedData);
        const payload = `EARENDEL_TAR_V1:${btoa(unescape(encodeURIComponent(rawJson)))}`;
        ctx.vfs.writeFile(archiveFile, payload);

        return { stdout: verbose ? logLines.join('\n') + '\n' : '', stderr: '', exitCode: 0 };
      }

      // 2. EXTRACT (-x)
      if (mode === 'x') {
        const node = ctx.vfs.getNodeByPath(archiveFile);
        if (!node || node.type !== 'file') {
          return { stdout: '', stderr: `tar: ${archiveFile}: Cannot open: No such file or directory\n`, exitCode: 2 };
        }

        const content = node.content || '';
        const logLines: string[] = [];

        if (content.startsWith('EARENDEL_TAR_V1:')) {
          try {
            const rawJson = decodeURIComponent(escape(atob(content.replace('EARENDEL_TAR_V1:', ''))));
            const packedData = JSON.parse(rawJson);

            for (const itemPath of Object.keys(packedData)) {
              const item = packedData[itemPath];
              const destPath = targetDir !== '.' ? (targetDir.endsWith('/') ? `${targetDir}${itemPath}` : `${targetDir}/${itemPath}`) : itemPath;

              if (item.type === 'directory') {
                ctx.vfs.mkdir(destPath, true);
              } else {
                const parentDir = destPath.substring(0, destPath.lastIndexOf('/'));
                if (parentDir) ctx.vfs.mkdir(parentDir, true);
                ctx.vfs.writeFile(destPath, item.content);
                ctx.vfs.chmod(destPath, item.permissions);
              }
              logLines.push(itemPath);
            }
          } catch (e) {
            return { stdout: '', stderr: `tar: ${archiveFile}: Error parsing archive header\n`, exitCode: 2 };
          }
        } else {
          return { stdout: '', stderr: `tar: ${archiveFile}: This does not look like a tar archive\n`, exitCode: 2 };
        }

        return { stdout: verbose ? logLines.join('\n') + '\n' : '', stderr: '', exitCode: 0 };
      }

      // 3. LIST (-t)
      if (mode === 't') {
        const node = ctx.vfs.getNodeByPath(archiveFile);
        if (!node || node.type !== 'file') {
          return { stdout: '', stderr: `tar: ${archiveFile}: Cannot open: No such file or directory\n`, exitCode: 2 };
        }

        const content = node.content || '';
        if (content.startsWith('EARENDEL_TAR_V1:')) {
          try {
            const rawJson = decodeURIComponent(escape(atob(content.replace('EARENDEL_TAR_V1:', ''))));
            const packedData = JSON.parse(rawJson);
            const lines: string[] = [];

            for (const itemPath of Object.keys(packedData)) {
              const item = packedData[itemPath];
              if (verbose) {
                const typeChar = item.type === 'directory' ? 'd' : '-';
                const dateStr = '2026-09-01 00:00';
                lines.push(`${typeChar}${item.permissions} hello/hello ${(item.size || 0).toString().padStart(8, ' ')} ${dateStr} ${itemPath}`);
              } else {
                lines.push(itemPath);
              }
            }
            return { stdout: lines.join('\n') + '\n', stderr: '', exitCode: 0 };
          } catch (e) {
            return { stdout: '', stderr: `tar: ${archiveFile}: Error parsing archive header\n`, exitCode: 2 };
          }
        }
        return { stdout: '', stderr: `tar: ${archiveFile}: This does not look like a tar archive\n`, exitCode: 2 };
      }

      return { stdout: '', stderr: 'tar: invalid option\n', exitCode: 1 };
    },
  },
  {
    name: 'zip',
    description: 'Package and compress (archive) files (-r, -q, -v)',
    category: 'archive',
    execute: (ctx) => {
      let recursive = false;
      let quiet = false;
      let archiveName: string | null = null;
      const targets: string[] = [];

      for (const arg of ctx.args) {
        if (arg === '-r' || arg === '-rv' || arg === '-vr') recursive = true;
        else if (arg === '-q') quiet = true;
        else if (!archiveName && !arg.startsWith('-')) archiveName = arg;
        else if (!arg.startsWith('-')) targets.push(arg);
      }

      if (!archiveName || targets.length === 0) {
        return { stdout: '', stderr: 'zip error: Invalid command arguments (zip [-r] archive.zip file1 file2...)\n', exitCode: 1 };
      }

      const packedData: Record<string, string> = {};
      const logLines: string[] = [];

      const collectNode = (p: string, prefix: string) => {
        const node = ctx.vfs.getNodeByPath(p);
        if (!node) return;

        const archivePath = prefix ? (prefix.endsWith('/') ? `${prefix}${node.name}` : `${prefix}/${node.name}`) : node.name || p;

        if (node.type === 'file') {
          packedData[archivePath] = node.content || '';
          logLines.push(`  adding: ${archivePath} (deflated 60%)`);
        } else if (node.type === 'directory' && recursive && node.children) {
          logLines.push(`  adding: ${archivePath}/ (stored 0%)`);
          for (const child of node.children.values()) {
            const childPath = p === '.' ? child.name : (p.endsWith('/') ? `${p}${child.name}` : `${p}/${child.name}`);
            collectNode(childPath, archivePath);
          }
        }
      };

      for (const t of targets) {
        collectNode(t, '');
      }

      const payload = `EARENDEL_ZIP_V1:${btoa(unescape(encodeURIComponent(JSON.stringify(packedData))))}`;
      ctx.vfs.writeFile(archiveName, payload);

      return { stdout: quiet ? '' : logLines.join('\n') + (logLines.length > 0 ? '\n' : ''), stderr: '', exitCode: 0 };
    },
  },
  {
    name: 'unzip',
    description: 'List, test and extract compressed files in a ZIP archive (-l, -o, -q, -d <dir>)',
    category: 'archive',
    execute: (ctx) => {
      let listOnly = false;
      let quiet = false;
      let targetDir: string = '.';
      let archiveName: string | null = null;

      for (let i = 0; i < ctx.args.length; i++) {
        const arg = ctx.args[i];
        if (arg === '-l') {
          listOnly = true;
        } else if (arg === '-q') {
          quiet = true;
        } else if (arg === '-d' && ctx.args[i + 1]) {
          targetDir = ctx.args[i + 1];
          i++;
        } else if (!archiveName && !arg.startsWith('-')) {
          archiveName = arg;
        }
      }

      if (!archiveName) {
        return { stdout: '', stderr: 'unzip: cannot find zipfile\nUsage: unzip [-l] [-d exdir] file.zip\n', exitCode: 1 };
      }

      const node = ctx.vfs.getNodeByPath(archiveName);
      if (!node || node.type !== 'file') {
        return { stdout: '', stderr: `unzip: cannot find or open ${archiveName}\n`, exitCode: 2 };
      }

      const content = node.content || '';
      if (!content.startsWith('EARENDEL_ZIP_V1:')) {
        return { stdout: '', stderr: `unzip: ${archiveName} is not a valid zip archive\n`, exitCode: 2 };
      }

      try {
        const rawJson = decodeURIComponent(escape(atob(content.replace('EARENDEL_ZIP_V1:', ''))));
        const packedData = JSON.parse(rawJson);

        if (listOnly) {
          let out = `Archive:  ${archiveName}\n  Length      Date    Time    Name\n---------  ---------- -----   ----\n`;
          let totalBytes = 0;
          for (const name of Object.keys(packedData)) {
            const bytes = packedData[name].length;
            totalBytes += bytes;
            out += `${bytes.toString().padStart(9, ' ')}  2026-09-01 00:00   ${name}\n`;
          }
          out += `---------                     -------\n${totalBytes.toString().padStart(9, ' ')}                     ${Object.keys(packedData).length} files\n`;
          return { stdout: out, stderr: '', exitCode: 0 };
        }

        let out = quiet ? '' : `Archive:  ${archiveName}\n`;
        for (const name of Object.keys(packedData)) {
          const dest = targetDir !== '.' ? (targetDir.endsWith('/') ? `${targetDir}${name}` : `${targetDir}/${name}`) : name;
          const parentDir = dest.substring(0, dest.lastIndexOf('/'));
          if (parentDir) ctx.vfs.mkdir(parentDir, true);
          ctx.vfs.writeFile(dest, packedData[name]);
          if (!quiet) out += ` extracting: ${dest}\n`;
        }

        return { stdout: out, stderr: '', exitCode: 0 };
      } catch (e) {
        return { stdout: '', stderr: `unzip: error reading ${archiveName}\n`, exitCode: 2 };
      }
    },
  },
];

