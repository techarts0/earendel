// Kernel Debugger (kdb), ipcs, and vmap Commands
import { Command } from '../types';
import { globalVMPageTable } from '../../kernel/vmPageTable';
import { globalIPCSharedMem } from '../../kernel/ipcSharedMem';
import { globalTaskScheduler } from '../../kernel/taskScheduler';
import { globalMicrokernel } from '../../kernel/microkernel';

export const kdbCommands: Command[] = [
  {
    name: 'vmap',
    description: 'display 4KB virtual memory page table mappings & frame allocator stats',
    category: 'sys',
    execute: (ctx) => {
      const metrics = globalVMPageTable.getMemoryMetrics();
      const entries = globalVMPageTable.getPageMapEntries();
      let out = `Earendel Microkernel Virtual Memory 4KB Paging System:\n`;
      out += `Total RAM: ${metrics.totalMemoryKB} KB | Used: ${metrics.usedMemoryKB} KB | Page Faults: ${globalVMPageTable.getPageFaultCount()}\n\n`;
      out += `VIRT_PAGE  PHYS_FRAME  PRESENT  WRITABLE  FLAGS  TYPE\n`;
      out += `----------------------------------------------------\n`;

      for (const e of entries.slice(0, 30)) {
        const flags = `${e.accessed ? 'A' : '-'}${e.dirty ? 'D' : '-'}${e.userAccessible ? 'U' : 'K'}`;
        const typeStr = e.userAccessible ? 'User Process Page' : 'Kernel Identity Page';
        out += `0x${e.virtualPageNo.toString(16).padStart(4, '0')}    0x${e.physicalFrameNo.toString(16).padStart(4, '0')}    ${e.present ? '1' : '0'}        ${e.writable ? '1' : '0'}         ${flags}    ${typeStr}\n`;
      }

      if (entries.length > 30) {
        out += `... (${entries.length - 30} additional active page entries truncated)\n`;
      }
      return { stdout: out, stderr: '', exitCode: 0 };
    },
  },
  {
    name: 'ipcs',
    description: 'show status of System V IPC Shared Memory segments and Semaphores',
    category: 'sys',
    execute: () => {
      const shms = globalIPCSharedMem.getSegments();
      const sems = globalIPCSharedMem.getSemaphores();

      let out = `------ Shared Memory Segments ------\n`;
      out += `key        shmid      owner      bytes      nattch\n`;
      for (const s of shms) {
        out += `0x${s.key.toString(16).padStart(8, '0')} ${s.shmId}        PID:${s.ownerPid}      ${s.sizeBytes.toString().padStart(6, ' ')}     ${s.attachedPids.size}\n`;
      }

      out += `\n------ Semaphore Arrays --------\n`;
      out += `key        semid      owner      perms      nsems\n`;
      for (const sm of sems) {
        out += `0x${sm.key.toString(16).padStart(8, '0')} ${sm.semId}        root       666        ${sm.value}\n`;
      }
      return { stdout: out, stderr: '', exitCode: 0 };
    },
  },
  {
    name: 'kdb',
    description: 'Earendel Microkernel Interactive Debugger',
    category: 'sys',
    execute: (ctx) => {
      const sub = ctx.args[0] || 'info';

      if (sub === 'panic') {
        globalMicrokernel.triggerKernelPanic('Manual test panic via kdb command');
        return { stdout: `\x1b[1;31m[KERNEL PANIC] Triggered kernel panic test! Check 'dmesg' for crash dump.\x1b[0m\n`, stderr: '', exitCode: 1 };
      }

      if (sub === 'fault') {
        const page = globalVMPageTable.handlePageFault(0x7fff0000);
        return { stdout: `[kdb] Triggered Page Fault at 0x7fff0000 -> Mapped to Physical Frame 0x${page.physicalFrameNo.toString(16)}.\n`, stderr: '', exitCode: 0 };
      }

      const pcbList = globalTaskScheduler.getAllProcesses();
      let out = `\x1b[1;36mEarendel Microkernel Debugger (kdb v1.0.0)\x1b[0m\n`;
      out += `Kernel Mode: Active | IPC Router: Online | Worker Isolation: Active\n\n`;
      out += `Task Control Block Chain (${pcbList.length} Tasks):\n`;
      for (const p of pcbList) {
        out += `  PID:${p.pid.toString().padEnd(4, ' ')} PPID:${p.ppid.toString().padEnd(4, ' ')} STATE:${p.state.padEnd(7, ' ')} USER:${p.user.padEnd(6, ' ')} NAME:${p.name}\n`;
      }
      out += `\nSubcommands: kdb panic (test panic), kdb fault (test page fault)\n`;
      return { stdout: out, stderr: '', exitCode: 0 };
    },
  },
];
