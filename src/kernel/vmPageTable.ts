// Earendel Microkernel Virtual Memory Page Table & Frame Allocator
export interface PageTableEntry {
  virtualPageNo: number;
  physicalFrameNo: number;
  present: boolean;
  writable: boolean;
  userAccessible: boolean;
  accessed: boolean;
  dirty: boolean;
}

export class VMPageTable {
  public static readonly PAGE_SIZE = 4096; // 4KB Page Size
  private pageMap: Map<number, PageTableEntry> = new Map();
  private totalPhysicalFrames = 256; // 1MB Simulated RAM (256 * 4KB)
  private allocatedFrames: Set<number> = new Set();
  private pageFaultCount = 0;

  constructor() {
    this.initKernelSpacePages();
  }

  private initKernelSpacePages() {
    // Identity map first 64 pages (256KB) for Kernel Space
    for (let i = 0; i < 64; i++) {
      this.pageMap.set(i, {
        virtualPageNo: i,
        physicalFrameNo: i,
        present: true,
        writable: true,
        userAccessible: false,
        accessed: true,
        dirty: false,
      });
      this.allocatedFrames.add(i);
    }
  }

  public allocatePage(virtualPageNo: number, writable: boolean = true): PageTableEntry {
    if (this.pageMap.has(virtualPageNo)) {
      return this.pageMap.get(virtualPageNo)!;
    }

    // Find free physical frame
    let freeFrame = -1;
    for (let f = 64; f < this.totalPhysicalFrames; f++) {
      if (!this.allocatedFrames.has(f)) {
        freeFrame = f;
        break;
      }
    }

    if (freeFrame === -1) {
      throw new Error('[Out of Memory] Kernel physical frame allocator exhausted!');
    }

    const entry: PageTableEntry = {
      virtualPageNo,
      physicalFrameNo: freeFrame,
      present: true,
      writable,
      userAccessible: true,
      accessed: true,
      dirty: false,
    };

    this.allocatedFrames.add(freeFrame);
    this.pageMap.set(virtualPageNo, entry);
    return entry;
  }

  public handlePageFault(virtualAddress: number): PageTableEntry {
    this.pageFaultCount++;
    const vPage = Math.floor(virtualAddress / VMPageTable.PAGE_SIZE);
    return this.allocatePage(vPage, true);
  }

  public getPageMapEntries(): PageTableEntry[] {
    return Array.from(this.pageMap.values());
  }

  public getPageFaultCount(): number {
    return this.pageFaultCount;
  }

  public getMemoryMetrics() {
    return {
      pageSize: VMPageTable.PAGE_SIZE,
      totalFrames: this.totalPhysicalFrames,
      allocatedFrames: this.allocatedFrames.size,
      freeFrames: this.totalPhysicalFrames - this.allocatedFrames.size,
      totalMemoryKB: (this.totalPhysicalFrames * VMPageTable.PAGE_SIZE) / 1024,
      usedMemoryKB: (this.allocatedFrames.size * VMPageTable.PAGE_SIZE) / 1024,
    };
  }
}

export const globalVMPageTable = new VMPageTable();
