import { Command, ExecutionContext, ExecutionResult } from '../types';
import { globalIPCBus } from '../../kernel/ipcBus';

export const waylanddCommand: Command = {
  name: 'waylandd',
  aliases: ['wayland'],
  description: 'query Earendel-Wayland Display Compositor status (PID 7)',
  category: 'sys',
  execute: async (ctx): Promise<ExecutionResult> => {
    const res = await globalIPCBus.sendIPC(7, 'waylandd', 'SYS_WAYLAND_LIST_SURFACES', {});
    const surfaces = res.surfaces || [];

    let out = `\x1b[36m[Earendel-Wayland Display Compositor Server (PID 7)]\x1b[0m\n`;
    out += `Server Version: ${res.compositor || '1.24.0'}\n`;
    out += `Active Surfaces: ${res.activeCount || surfaces.length}\n\n`;

    surfaces.forEach((s: any) => {
      out += `  Surface [${s.id}] Title: "${s.title}" Mode: ${s.mode} Geometry: ${s.width}x${s.height}+${s.x}+${s.y} Z-Index: ${s.zIndex}\n`;
    });

    if (surfaces.length === 0) {
      out += `  (No active GUI window surfaces composited)\n`;
    }

    return { stdout: out + '\n', stderr: '', exitCode: 0 };
  },
};

export const openCommand: Command = {
  name: 'open',
  description: 'open files, directories, or skills in Wayland GUI window surfaces',
  category: 'sys',
  execute: async (ctx): Promise<ExecutionResult> => {
    const pathArg = ctx.args[0] || '/home/hello';

    await globalIPCBus.sendIPC(7, 'waylandd', 'SYS_WAYLAND_CREATE_SURFACE', {
      title: `Earendel Surface: ${pathArg}`,
      width: 800,
      height: 550,
      mode: 'web_native',
    });

    if (pathArg.endsWith('.md')) {
      return {
        stdout: `Opened ${pathArg} in Earendel Harness-Skill Visual Surface Window.\n`,
        stderr: '',
        exitCode: 0,
        openHarnessTui: { path: pathArg, content: '' },
      };
    }

    return {
      stdout: `Opened ${pathArg} in Earendel-Wayland Desktop Window Surface.\n`,
      stderr: '',
      exitCode: 0,
    };
  },
};

export const guiCommands = [waylanddCommand, openCommand];
