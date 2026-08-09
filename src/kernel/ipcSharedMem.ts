// Earendel Microkernel System V IPC Shared Memory & Semaphores
export interface SharedMemorySegment {
  shmId: number;
  key: number;
  sizeBytes: number;
  ownerPid: number;
  attachedPids: Set<number>;
  data: ArrayBuffer;
  createdAt: Date;
}

export interface IPCSemaphore {
  semId: number;
  key: number;
  value: number;
  waitingQueue: number[];
}

export class IPCSharedMem {
  private shmSegments: Map<number, SharedMemorySegment> = new Map();
  private semaphores: Map<number, IPCSemaphore> = new Map();
  private nextShmId = 100;
  private nextSemId = 200;

  constructor() {
    this.initDefaultSharedSegments();
  }

  private initDefaultSharedSegments() {
    // Shared Memory segment for VFS -> TTY Framebuffer zero-copy video buffer
    this.createSegment(0x1234, 65536, 2);
    // IPC Semaphore for POSIX Mutex
    this.createSemaphore(0x5678, 1);
  }

  public createSegment(key: number, sizeBytes: number, ownerPid: number): SharedMemorySegment {
    const shmId = this.nextShmId++;
    const seg: SharedMemorySegment = {
      shmId,
      key,
      sizeBytes,
      ownerPid,
      attachedPids: new Set([ownerPid]),
      data: new ArrayBuffer(sizeBytes),
      createdAt: new Date(),
    };
    this.shmSegments.set(shmId, seg);
    return seg;
  }

  public createSemaphore(key: number, initialValue: number): IPCSemaphore {
    const semId = this.nextSemId++;
    const sem: IPCSemaphore = {
      semId,
      key,
      value: initialValue,
      waitingQueue: [],
    };
    this.semaphores.set(semId, sem);
    return sem;
  }

  public getSegments(): SharedMemorySegment[] {
    return Array.from(this.shmSegments.values());
  }

  public getSemaphores(): IPCSemaphore[] {
    return Array.from(this.semaphores.values());
  }
}

export const globalIPCSharedMem = new IPCSharedMem();
