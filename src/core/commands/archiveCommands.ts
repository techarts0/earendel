// Behavioral Archive & Compression Commands for Earendel
import { Command } from '../types';

export const archiveCommands: Command[] = [
  {
    name: 'tar',
    description: 'Archiving utility (supports -cvf, -xvf, -tvf)',
    category: 'archive',
    execute: (ctx) => {
      const mode = ctx.args[0] || '';
      const archiveName = ctx.args[1];

      if (!archiveName) return { stdout: '', stderr: 'tar: missing archive file name\n', exitCode: 1 };

      // Create archive (-cvf archive.tar file1 file2...)
      if (mode.includes('c')) {
        const targetFiles = ctx.args.slice(2);
        let archiveContent = `# Earendel Virtual Tarball Archive: ${archiveName}\n`;
        for (const file of targetFiles) {
          const content = ctx.vfs.readFile(file);
          if (content !== null) {
            archiveContent += `===FILE:${file}===\n${content}\n===ENDFILE===\n`;
          }
        }
        ctx.vfs.writeFile(archiveName, archiveContent);
        return { stdout: mode.includes('v') ? targetFiles.join('\n') + '\n' : '', stderr: '', exitCode: 0 };
      }

      // Extract archive (-xvf archive.tar)
      if (mode.includes('x')) {
        const content = ctx.vfs.readFile(archiveName);
        if (content === null) {
          return { stdout: '', stderr: `tar: ${archiveName}: Cannot open: No such file or directory\n`, exitCode: 2 };
        }

        const fileBlocks = content.split('===FILE:');
        let extractedNames: string[] = [];
        for (let i = 1; i < fileBlocks.length; i++) {
          const block = fileBlocks[i];
          const firstLineEnd = block.indexOf('===\n');
          if (firstLineEnd !== -1) {
            const fileName = block.substring(0, firstLineEnd);
            const fileContent = block.substring(firstLineEnd + 4, block.indexOf('\n===ENDFILE==='));
            ctx.vfs.writeFile(fileName, fileContent);
            extractedNames.push(fileName);
          }
        }
        return { stdout: mode.includes('v') ? extractedNames.join('\n') + '\n' : '', stderr: '', exitCode: 0 };
      }

      // List archive (-tvf archive.tar)
      if (mode.includes('t')) {
        const content = ctx.vfs.readFile(archiveName);
        if (!content) return { stdout: '', stderr: `tar: ${archiveName}: Cannot open\n`, exitCode: 2 };
        const matches = Array.from(content.matchAll(/===FILE:(.*?)===/g)).map((m) => m[1]);
        return { stdout: matches.join('\n') + '\n', stderr: '', exitCode: 0 };
      }

      return { stdout: '', stderr: 'tar: specify -c, -x or -t\n', exitCode: 1 };
    },
  },
  {
    name: 'gzip',
    description: 'Compress files',
    category: 'archive',
    execute: (ctx) => {
      const fileName = ctx.args[0];
      if (!fileName) return { stdout: '', stderr: 'gzip: missing file name\n', exitCode: 1 };
      const content = ctx.vfs.readFile(fileName);
      if (content === null) return { stdout: '', stderr: `gzip: ${fileName}: No such file or directory\n`, exitCode: 1 };

      const gzName = `${fileName}.gz`;
      ctx.vfs.writeFile(gzName, `[GZIP_COMPRESSED_DATA]\n${content}`);
      ctx.vfs.remove(fileName);
      return { stdout: '', stderr: '', exitCode: 0 };
    },
  },
  {
    name: 'gunzip',
    description: 'Decompress .gz files',
    category: 'archive',
    execute: (ctx) => {
      const gzName = ctx.args[0];
      if (!gzName) return { stdout: '', stderr: 'gunzip: missing file name\n', exitCode: 1 };
      const content = ctx.vfs.readFile(gzName);
      if (!content || !content.startsWith('[GZIP_COMPRESSED_DATA]\n')) {
        return { stdout: '', stderr: `gunzip: ${gzName}: unknown format\n`, exitCode: 1 };
      }

      const originalName = gzName.replace(/\.gz$/, '');
      ctx.vfs.writeFile(originalName, content.replace('[GZIP_COMPRESSED_DATA]\n', ''));
      ctx.vfs.remove(gzName);
      return { stdout: '', stderr: '', exitCode: 0 };
    },
  },
];
