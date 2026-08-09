// Behavioral Host Mount & Terminal Clipboard Commands for Earendel
import { Command, ExecutionContext, ExecutionResult } from '../types';
import { globalHostMountEngine } from '../hostMountEngine';

export const mountCommands: Command[] = [
  {
    name: 'mount',
    description: 'mount a filesystem or host directory via FileSystem Access API',
    category: 'sys',
    execute: async (ctx) => {
      const isHostMount = ctx.args.includes('-t') && (ctx.args.includes('host') || ctx.args.includes('hostfs'));
      const targetArg = ctx.args.find((a) => a.startsWith('/')) || '/mnt/host';

      if (isHostMount || ctx.args.includes('--host')) {
        ctx.vfs.mkdir(targetArg, true);
        const res = await globalHostMountEngine.mountDirectoryPicker(targetArg);
        if (res.success) {
          return { stdout: `${res.message}\n`, stderr: '', exitCode: 0 };
        } else {
          return { stdout: '', stderr: `mount: ${res.message}\n`, exitCode: 1 };
        }
      }

      // Display active mount points
      const activeMounts = globalHostMountEngine.getMountPoints();
      let output = '/dev/sda1 on / type ext4 (rw,relatime)\n';
      output += 'tmpfs on /run type tmpfs (rw,nosuid,nodev,noexec,relatime,size=800164k,mode=755)\n';
      output += 'proc on /proc type proc (rw,nosuid,nodev,noexec,relatime)\n';
      output += 'sysfs on /sys type sysfs (rw,nosuid,nodev,noexec,relatime)\n';

      for (const m of activeMounts) {
        output += `host on ${m.targetPath} type hostfs (rw,relatime,mounted=${m.mountedAt.toLocaleTimeString()})\n`;
      }

      if (ctx.args.length === 0) {
        output += `\nHint: Run 'mount -t host /mnt/host' to select and mount a real folder from your PC!\n`;
      }

      return { stdout: output, stderr: '', exitCode: 0 };
    },
  },
  {
    name: 'umount',
    aliases: ['unmount'],
    description: 'unmount file systems',
    category: 'sys',
    execute: (ctx) => {
      const target = ctx.args[0];
      if (!target) {
        return { stdout: '', stderr: 'umount: missing target directory\nUsage: umount /mnt/host\n', exitCode: 1 };
      }

      const ok = globalHostMountEngine.unmountDirectory(target);
      if (ok) {
        const absPath = ctx.vfs.resolvePath(target);
        const node = ctx.vfs.getNodeByPath(absPath);
        if (node && node.children) {
          node.children.clear();
        }

        const pwd = ctx.vfs.getPwd();
        if (pwd === absPath || pwd.startsWith(absPath + '/')) {
          ctx.vfs.changeDirectory('/home/hello');
        }

        return { stdout: `Unmounted host filesystem from ${target}\n`, stderr: '', exitCode: 0 };
      }
      return { stdout: '', stderr: `umount: ${target}: not mounted\n`, exitCode: 1 };
    },
  },
  {
    name: 'xclip',
    aliases: ['xsel', 'pbcopy', 'pbpaste'],
    description: 'command line interface to the X selection / host clipboard',
    category: 'sys',
    execute: async (ctx) => {
      const isOut = ctx.args.includes('-o') || ctx.name === 'pbpaste';
      const input = ctx.pipeInput;

      // Reading host clipboard (xclip -o / pbpaste)
      if (isOut) {
        if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.readText) {
          try {
            const clipText = await navigator.clipboard.readText();
            return { stdout: clipText.endsWith('\n') ? clipText : clipText + '\n', stderr: '', exitCode: 0 };
          } catch (e: any) {
            return { stdout: '', stderr: `xclip: clipboard read permission denied (${e.message})\n`, exitCode: 1 };
          }
        }
        return { stdout: '', stderr: 'xclip: clipboard API not supported\n', exitCode: 1 };
      }

      // Writing host clipboard (cat file | xclip / pbcopy)
      const textToCopy = input || ctx.args.filter((a) => !a.startsWith('-')).join(' ');
      if (!textToCopy) {
        return { stdout: '', stderr: 'xclip: missing input text or pipe input\nUsage: cat file.txt | xclip\n', exitCode: 1 };
      }

      if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
        try {
          await navigator.clipboard.writeText(textToCopy);
          return { stdout: `[xclip] Copied ${textToCopy.length} characters to host clipboard.\n`, stderr: '', exitCode: 0 };
        } catch (e: any) {
          return { stdout: '', stderr: `xclip: clipboard write permission denied (${e.message})\n`, exitCode: 1 };
        }
      }

      return { stdout: '', stderr: 'xclip: clipboard API not supported\n', exitCode: 1 };
    },
  },
];
