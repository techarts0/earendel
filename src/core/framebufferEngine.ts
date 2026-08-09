// Earendel Framebuffer Display Engine (/dev/fb0 & /dev/display)
import { globalVFS } from './vfs';

export interface FramebufferConfig {
  width: number;
  height: number;
  bpp: number; // Bits per pixel (default 32)
}

export class FramebufferEngine {
  public width = 640;
  public height = 480;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private listeners: Array<() => void> = [];
  private isWindowOpen = false;

  constructor() {
    this.initDeviceNodes();
  }

  private initDeviceNodes() {
    try {
      globalVFS.writeFile('/dev/fb0', '[Earendel Framebuffer Character Device Node /dev/fb0]');
      globalVFS.writeFile('/dev/display', '[Earendel Display Window Device Node /dev/display]');
    } catch (e) {}
  }

  public subscribe(listener: () => void) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private notify() {
    this.listeners.forEach((l) => l());
  }

  public setCanvas(canvas: HTMLCanvasElement | null) {
    this.canvas = canvas;
    if (this.canvas) {
      this.ctx = this.canvas.getContext('2d');
    }
  }

  public getIsOpen(): boolean {
    return this.isWindowOpen;
  }

  public openWindow() {
    this.isWindowOpen = true;
    this.notify();
  }

  public closeWindow() {
    this.isWindowOpen = false;
    this.notify();
  }

  /**
   * Clears framebuffer to black or given color
   */
  public clearScreen(color: string = '#000000') {
    this.openWindow();
    if (this.ctx) {
      this.ctx.fillStyle = color;
      this.ctx.fillRect(0, 0, this.width, this.height);
    }
    this.notify();
  }

  /**
   * Draws a pixel array or image onto /dev/fb0 and opens framebuffer window
   */
  public drawImageSrc(imgSrc: string): Promise<boolean> {
    this.openWindow();
    return new Promise((resolve) => {
      if (typeof window === 'undefined') {
        resolve(false);
        return;
      }

      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        if (this.ctx) {
          this.ctx.fillStyle = '#000000';
          this.ctx.fillRect(0, 0, this.width, this.height);
          // Scale to fit framebuffer
          const hRatio = this.width / img.width;
          const vRatio = this.height / img.height;
          const ratio = Math.min(hRatio, vRatio);
          const centerShiftX = (this.width - img.width * ratio) / 2;
          const centerShiftY = (this.height - img.height * ratio) / 2;
          this.ctx.drawImage(img, 0, 0, img.width, img.height, centerShiftX, centerShiftY, img.width * ratio, img.height * ratio);
        }
        this.notify();
        resolve(true);
      };
      img.onerror = () => resolve(false);
      img.src = imgSrc;
    });
  }

  /**
   * Draws pixel data directly to /dev/fb0
   */
  public drawPixelBuffer(pixels: Uint8ClampedArray | number[]) {
    this.openWindow();
    if (this.ctx) {
      const imgData = this.ctx.createImageData(this.width, this.height);
      imgData.data.set(pixels);
      this.ctx.putImageData(imgData, 0, 0);
    }
    this.notify();
  }
}

export const globalFramebufferEngine = new FramebufferEngine();
