import React, { useEffect, useRef, useState } from 'react';
import { globalFramebufferEngine } from '../core/framebufferEngine';
import { Monitor, X, RefreshCw } from 'lucide-react';

export const FramebufferModal: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    // Sync initial state
    setIsOpen(globalFramebufferEngine.getIsOpen());

    const unsub = globalFramebufferEngine.subscribe(() => {
      setIsOpen(globalFramebufferEngine.getIsOpen());
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (isOpen && canvasRef.current) {
      globalFramebufferEngine.setCanvas(canvasRef.current);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: '60px',
        right: '40px',
        zIndex: 999999,
        width: '670px',
        backgroundColor: 'rgba(15, 23, 42, 0.95)',
        border: '1px solid rgba(6, 182, 212, 0.5)',
        borderRadius: '12px',
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.8)',
        backdropFilter: 'blur(12px)',
        color: '#f8fafc',
      }}
    >
      {/* Window Title Bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 16px',
          backgroundColor: 'rgba(2, 6, 23, 0.9)',
          borderBottom: '1px solid #1e293b',
          borderTopLeftRadius: '12px',
          borderTopRightRadius: '12px',
          userSelect: 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Monitor style={{ width: '16px', height: '16px', color: '#22d3ee' }} />
          <span style={{ fontFamily: 'monospace', fontSize: '13px', fontWeight: 600, color: '#a5f3fc' }}>
            Earendel Framebuffer Display (/dev/fb0)
          </span>
          <span style={{ fontSize: '10px', padding: '2px 6px', borderRadius: '4px', backgroundColor: '#083344', border: '1px solid #155e75', color: '#67e8f9', fontFamily: 'monospace' }}>
            640x480 32bpp
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            onClick={() => globalFramebufferEngine.clearScreen('#0d1117')}
            style={{ padding: '4px', background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer' }}
            title="Clear Framebuffer Screen"
          >
            <RefreshCw style={{ width: '14px', height: '14px' }} />
          </button>
          <button
            onClick={() => globalFramebufferEngine.closeWindow()}
            style={{ padding: '4px', background: 'transparent', border: 'none', color: '#f87171', cursor: 'pointer' }}
            title="Close Framebuffer Display"
          >
            <X style={{ width: '16px', height: '16px' }} />
          </button>
        </div>
      </div>

      {/* Framebuffer Canvas View Area */}
      <div style={{ padding: '12px', backgroundColor: '#000000', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
        <canvas
          ref={canvasRef}
          width={640}
          height={480}
          style={{
            border: '1px solid #1e293b',
            borderRadius: '4px',
            maxWidth: '100%',
            backgroundColor: '#0d1117',
          }}
        />
      </div>

      {/* Footer Info */}
      <div
        style={{
          padding: '6px 16px',
          backgroundColor: 'rgba(2, 6, 23, 0.9)',
          fontSize: '11px',
          fontFamily: 'monospace',
          color: '#94a3b8',
          display: 'flex',
          justifyContent: 'space-between',
          borderTop: '1px solid #1e293b',
          borderBottomLeftRadius: '12px',
          borderBottomRightRadius: '12px',
        }}
      >
        <span>Device Node: /dev/fb0</span>
        <span style={{ color: 'rgba(34, 211, 238, 0.8)' }}>Type 'display &lt;image&gt;' or 'fbclear'</span>
      </div>
    </div>
  );
};
