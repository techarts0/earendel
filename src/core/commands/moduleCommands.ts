// Kernel Module Commands (lsmod, modprobe, rmmod)
import { Command } from '../types';
import { globalModuleManager } from '../../kernel/moduleManager';

export const moduleCommands: Command[] = [
  {
    name: 'lsmod',
    description: 'show the status of modules in the Earendel Microkernel',
    category: 'sys',
    execute: () => {
      const mods = globalModuleManager.getLoadedModules();
      let out = 'Module                  Size  Used by\n';
      for (const m of mods) {
        out += `${m.name.padEnd(20, ' ')} ${m.sizeBytes.toString().padStart(6, ' ')}  ${m.useCount} (${m.description})\n`;
      }
      return { stdout: out, stderr: '', exitCode: 0 };
    },
  },
  {
    name: 'modprobe',
    description: 'add and remove modules from the Earendel Microkernel',
    category: 'sys',
    execute: (ctx) => {
      const modName = ctx.args[0];
      if (!modName) {
        return { stdout: '', stderr: 'modprobe: missing module name\nUsage: modprobe <module_name>\n', exitCode: 1 };
      }
      globalModuleManager.loadModule(modName);
      return { stdout: `[Kernel] Module '${modName}' loaded successfully into Microkernel.\n`, stderr: '', exitCode: 0 };
    },
  },
  {
    name: 'rmmod',
    description: 'remove a module from the Earendel Microkernel',
    category: 'sys',
    execute: (ctx) => {
      const modName = ctx.args[0];
      if (!modName) {
        return { stdout: '', stderr: 'rmmod: missing module name\nUsage: rmmod <module_name>\n', exitCode: 1 };
      }
      const ok = globalModuleManager.unloadModule(modName);
      if (ok) {
        return { stdout: `[Kernel] Module '${modName}' unloaded successfully.\n`, stderr: '', exitCode: 0 };
      }
      return { stdout: '', stderr: `rmmod: ERROR: Module ${modName} is not loaded\n`, exitCode: 1 };
    },
  },
];
