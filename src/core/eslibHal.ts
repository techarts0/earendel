import { globalIPCBus } from '../kernel/ipcBus';

export const eslibHal = {
  async getGps() {
    const res = await globalIPCBus.sendIPC(24, 'driverd', 'DEV_READ_GPS0', {});
    return res;
  },

  async readGpuInfo() {
    const res = await globalIPCBus.sendIPC(24, 'driverd', 'DEV_READ_GPU0', {});
    return res;
  },

  async readSerial(baud: number = 115200) {
    const res = await globalIPCBus.sendIPC(24, 'driverd', 'DEV_READ_TTYUSB', { baud });
    return res;
  },

  async writeSerial(data: string) {
    const res = await globalIPCBus.sendIPC(24, 'driverd', 'DEV_WRITE_TTYUSB', { data });
    return res;
  },

  async playAudio(pcmData: any) {
    const res = await globalIPCBus.sendIPC(24, 'driverd', 'DEV_WRITE_DSP', { data: pcmData });
    return res;
  },

  async connectGateway(wsUrl: string = 'ws://localhost:9001') {
    const res = await globalIPCBus.sendIPC(24, 'driverd', 'DEV_GATEWAY_TUNNEL', { url: wsUrl });
    return res;
  },
};
