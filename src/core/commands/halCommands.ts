import { Command, ExecutionContext, ExecutionResult } from '../types';
import { globalIPCBus } from '../../kernel/ipcBus';

export const lspciCommand: Command = {
  name: 'lspci',
  description: 'list all PCI devices mapped by Earendel HAL',
  category: 'sys',
  execute: async (): Promise<ExecutionResult> => {
    const res = await globalIPCBus.sendIPC(24, 'driverd', 'DEV_READ_GPU0', {});
    const out = [
      '00:00.0 Host bridge: Intel Corporation 13th Gen Core Processor Host Bridge/DRAM Registers (rev 02)',
      '00:01.0 PCI bridge: Intel Corporation 13th Gen Core Processor PCI Express x16 Controller #1 (rev 02)',
      '00:02.0 VGA compatible controller: ' + (res.vendor || 'Apple M3 Pro / NVIDIA RTX 4090 (Virtual HAL)'),
      '00:14.0 USB controller: Intel Corporation Alder Lake PCH USB 3.2 xHCI Host Controller (rev 01)',
      '00:1d.0 PCI bridge: Intel Corporation Alder Lake Express Root Port #9 (rev 01)',
      '01:00.0 Non-Volatile memory controller: Samsung Electronics Co Ltd NVMe SSD Controller PM9A1/980PRO',
    ].join('\n') + '\n';
    return { stdout: out, stderr: '', exitCode: 0 };
  },
};

export const lsusbCommand: Command = {
  name: 'lsusb',
  description: 'list USB devices enumerated via WebUSB HAL driver',
  category: 'sys',
  execute: async (): Promise<ExecutionResult> => {
    const res = await globalIPCBus.sendIPC(24, 'driverd', 'DEV_READ_USB', {});
    const devs = res.devices || [];
    let out = `Bus 002 Device 001: ID 1d6b:0003 Linux Foundation 3.0 root hub\n`;
    devs.forEach((d: any, idx: number) => {
      out += `Bus 001 Device 00${idx + 2}: ID ${d.idVendor.toString(16).padStart(4, '0')}:${d.idProduct.toString(16).padStart(4, '0')} ${d.name}\n`;
    });
    return { stdout: out, stderr: '', exitCode: 0 };
  },
};

export const lscpuCommand: Command = {
  name: 'lscpu',
  description: 'display information about the CPU architecture',
  category: 'sys',
  execute: async (): Promise<ExecutionResult> => {
    const out = [
      'Architecture:            x86_64 / WebAssembly SIMD128',
      'CPU op-mode(s):          32-bit, 64-bit',
      'Address sizes:           48 bits physical, 48 bits virtual',
      'Byte Order:              Little Endian',
      'CPU(s):                  8 Virtual V8 Cores',
      'On-line CPU(s) list:     0-7',
      'Vendor ID:               EarendelMicrokernel',
      'Model name:              Virtual WebAssembly SIMD Core @ 3.40GHz',
      'L1d cache:               256 KiB',
      'L1i cache:               256 KiB',
      'L2 cache:                4 MiB',
      'L3 cache:                16 MiB',
    ].join('\n') + '\n';
    return { stdout: out, stderr: '', exitCode: 0 };
  },
};

export const lshwCommand: Command = {
  name: 'lshw',
  description: 'list hardware configuration and HAL device mappings',
  category: 'sys',
  execute: async (): Promise<ExecutionResult> => {
    const gpu = await globalIPCBus.sendIPC(24, 'driverd', 'DEV_READ_GPU0', {});
    const gps = await globalIPCBus.sendIPC(24, 'driverd', 'DEV_READ_GPS0', {});
    const nvme = await globalIPCBus.sendIPC(24, 'driverd', 'DEV_READ_NVME0N1', {});

    const out = [
      'earendel-workstation',
      '    description: Computer / WebOS Workstation',
      '    width: 64 bits',
      '    capabilities: smp vsyscall32',
      '  *-core',
      '       description: Motherboard',
      '       physical id: 0',
      '     *-memory',
      '          description: System Memory (V8 Heap & WASM Memory)',
      '          size: 8GiB',
      '     *-cpu',
      '          description: CPU',
      '          product: WebAssembly SIMD Virtual Cores',
      '          capacity: 3400MHz',
      '     *-display (/dev/gpu0)',
      '          description: 3D Graphics Accelerator',
      `          product: ${gpu.adapter || 'WebGPU'}`,
      '     *-storage (/dev/nvme0n1)',
      '          description: NVMe / OPFS Block Storage',
      `          size: ${(nvme.capacityBytes / 1073741824).toFixed(0)}GiB`,
      '     *-location (/dev/gps0)',
      `          description: GPS Receiver (${gps.status})`,
      `          coordinates: ${gps.latitude}, ${gps.longitude}`,
    ].join('\n') + '\n';

    return { stdout: out, stderr: '', exitCode: 0 };
  },
};

export const gpsCommand: Command = {
  name: 'gps',
  description: 'read live GPS coordinates from /dev/gps0 HAL driver',
  category: 'sys',
  execute: async (): Promise<ExecutionResult> => {
    const res = await globalIPCBus.sendIPC(24, 'driverd', 'DEV_READ_GPS0', {});
    const out = [
      `\x1b[36m[Earendel HAL GPS Receiver (/dev/gps0)]\x1b[0m`,
      `Latitude:   ${res.latitude}° N`,
      `Longitude:  ${res.longitude}° W`,
      `Altitude:   ${res.altitude} m`,
      `Fix Status: ${res.status}`,
    ].join('\n') + '\n';
    return { stdout: out, stderr: '', exitCode: 0 };
  },
};

export const halCommands = [lspciCommand, lsusbCommand, lscpuCommand, lshwCommand, gpsCommand];
