// Behavioral Graphics & Framebuffer Device Commands for Earendel
import { Command } from '../types';
import { globalFramebufferEngine } from '../framebufferEngine';

export const graphicsCommands: Command[] = [
  {
    name: 'display',
    aliases: ['fbrender', 'feh', 'eog'],
    description: 'render images or位图 files onto /dev/fb0 framebuffer display',
    category: 'sys',
    execute: async (ctx) => {
      const fileArg = ctx.args[0];
      if (!fileArg) {
        // Render default colorful Linux Framebuffer test pattern
        const defaultTestPattern = `data:image/svg+xml;utf8,${encodeURIComponent(
          `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480">
            <rect width="640" height="480" fill="#090d16"/>
            <rect x="20" y="20" width="600" height="440" rx="10" fill="#0d1117" stroke="#1e293b" stroke-width="2"/>
            <text x="320" y="140" font-family="monospace" font-size="28" font-weight="bold" fill="#38bdf8" text-anchor="middle">Earendel Web OS (/dev/fb0)</text>
            <text x="320" y="180" font-family="monospace" font-size="14" fill="#94a3b8" text-anchor="middle">Virtual Framebuffer 640x480 32bpp RGBA</text>
            <g transform="translate(120, 230)">
              <rect x="0" y="0" width="50" height="80" fill="#ef4444"/>
              <rect x="50" y="0" width="50" height="80" fill="#f97316"/>
              <rect x="100" y="0" width="50" height="80" fill="#eab308"/>
              <rect x="150" y="0" width="50" height="80" fill="#22c55e"/>
              <rect x="200" y="0" width="50" height="80" fill="#06b6d4"/>
              <rect x="250" y="0" width="50" height="80" fill="#3b82f6"/>
              <rect x="300" y="0" width="50" height="80" fill="#a855f7"/>
              <rect x="350" y="0" width="50" height="80" fill="#ec4899"/>
            </g>
            <text x="320" y="380" font-family="monospace" font-size="14" fill="#22d3ee" text-anchor="middle">Ready for pixel array &amp; image rendering</text>
          </svg>`
        )}`;
        await globalFramebufferEngine.drawImageSrc(defaultTestPattern);
        return { stdout: '[Framebuffer] Opened /dev/fb0 graphic display window (640x480 32bpp).\n', stderr: '', exitCode: 0 };
      }

      const absPath = ctx.vfs.resolvePath(fileArg);
      const content = ctx.vfs.readFile(absPath);

      if (content === null) {
        return { stdout: '', stderr: `display: cannot open '${fileArg}': No such file\n`, exitCode: 1 };
      }

      // If content is data URL or image path/base64
      let imgSrc = content.trim();
      if (!imgSrc.startsWith('data:image') && !imgSrc.startsWith('http') && !imgSrc.startsWith('blob:')) {
        imgSrc = `data:image/svg+xml;utf8,${encodeURIComponent(
          `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="100%" height="100%" fill="#0d1117"/><text x="50%" y="40%" font-size="24" fill="#58a6ff" text-anchor="middle">Earendel Framebuffer</text><text x="50%" y="55%" font-size="16" fill="#8b949e" text-anchor="middle">${absPath}</text></svg>`
        )}`;
      }

      const ok = await globalFramebufferEngine.drawImageSrc(imgSrc);
      if (ok) {
        return { stdout: `[Framebuffer] Rendered '${absPath}' onto /dev/fb0 (640x480 32bpp).\n`, stderr: '', exitCode: 0 };
      }
      return { stdout: '', stderr: `display: failed to render image onto /dev/fb0\n`, exitCode: 1 };
    },
  },
  {
    name: 'fbset',
    description: 'show or modify framebuffer device settings',
    category: 'sys',
    execute: (ctx) => {
      const out = [
        `mode "640x480-60"`,
        `    # D: 25.175 MHz, H: 31.469 kHz, V: 59.94 Hz`,
        `    geometry 640 480 640 480 32`,
        `    timings 39722 48 16 33 10 96 2`,
        `    accel false`,
        `    rgba 8/16,8/8,8/0,8/24`,
        `endmode`,
        ``,
        `Frame buffer device: /dev/fb0`,
      ].join('\n') + '\n';
      return { stdout: out, stderr: '', exitCode: 0 };
    },
  },
  {
    name: 'fbclear',
    description: 'clear /dev/fb0 framebuffer display screen',
    category: 'sys',
    execute: () => {
      globalFramebufferEngine.clearScreen('#0d1117');
      return { stdout: '[Framebuffer] Cleared /dev/fb0 screen.\n', stderr: '', exitCode: 0 };
    },
  },
];
