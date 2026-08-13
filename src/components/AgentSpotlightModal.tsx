import React, { useState, useEffect, useRef } from 'react';
import { Sparkles, Terminal as TerminalIcon, X, Play, Code } from 'lucide-react';
import { globalShellEngine } from '../core/shellEngine';

interface AgentSpotlightModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRunCommand?: (cmd: string) => void;
}

export const AgentSpotlightModal: React.FC<AgentSpotlightModalProps> = ({ isOpen, onClose, onRunCommand }) => {
  const [query, setQuery] = useState('');
  const [logs, setLogs] = useState<string[]>([]);
  const [isExecuting, setIsExecuting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleExecute = async (commandToRun?: string) => {
    const targetCmd = commandToRun || query;
    if (!targetCmd.trim()) return;

    setIsExecuting(true);
    setLogs((prev) => [...prev, `$ ${targetCmd}`]);

    if (onRunCommand) {
      onRunCommand(targetCmd);
    }

    try {
      const res = await globalShellEngine.execute(targetCmd);
      if (res.stdout) {
        const cleanStdout = res.stdout.replace(/\x1b\[[0-9;]*m/g, '');
        setLogs((prev) => [...prev, cleanStdout]);
      }
      if (res.stderr) {
        const cleanStderr = res.stderr.replace(/\x1b\[[0-9;]*m/g, '');
        setLogs((prev) => [...prev, `Error: ${cleanStderr}`]);
      }
    } catch (err: any) {
      setLogs((prev) => [...prev, `Execution Failed: ${err.message}`]);
    } finally {
      setIsExecuting(false);
    }
  };

  const presets = [
    { label: 'Skill DAG Canvas', cmd: 'skill dag /skills/demo.md' },
    { label: 'Wayland Compositor Status', cmd: 'waylandd' },
    { label: 'System Help', cmd: 'help' },
  ];

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: '80px',
        backgroundColor: 'rgba(0, 0, 0, 0.65)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        userSelect: 'none',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '672px',
          backgroundColor: 'rgba(15, 23, 42, 0.95)',
          border: '1px solid rgba(6, 182, 212, 0.4)',
          borderRadius: '12px',
          boxShadow: '0 25px 50px -12px rgba(8, 145, 178, 0.5)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          fontFamily: "'Fira Code', 'Courier New', monospace",
          color: '#e2e8f0',
        }}
      >
        {/* Header Search Input Bar */}
        <div
          style={{
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            padding: '12px 16px',
            borderBottom: '1px solid rgba(31, 41, 55, 0.8)',
            backgroundColor: 'rgba(3, 7, 18, 0.7)',
          }}
        >
          <Sparkles style={{ width: '20px', height: '20px', color: '#22d3ee', marginRight: '12px', flexShrink: 0 }} />
          <input
            ref={inputRef}
            type="text"
            style={{
              width: '100%',
              backgroundColor: 'transparent',
              color: '#f3f4f6',
              fontSize: '16px',
              outline: 'none',
              border: 'none',
              fontFamily: "'Fira Code', 'Courier New', monospace",
            }}
            placeholder="Type a command or natural language instruction... (Cmd+K)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleExecute();
              if (e.key === 'Escape') onClose();
            }}
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#9ca3af',
                cursor: 'pointer',
                padding: '4px',
                marginRight: '8px',
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <X style={{ width: '16px', height: '16px' }} />
            </button>
          )}
          <button
            onClick={() => handleExecute()}
            disabled={isExecuting}
            style={{
              padding: '6px 12px',
              backgroundColor: '#0891b2',
              color: '#ffffff',
              borderRadius: '6px',
              fontSize: '12px',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              border: 'none',
              cursor: isExecuting ? 'not-allowed' : 'pointer',
              opacity: isExecuting ? 0.7 : 1,
              boxShadow: '0 4px 6px -1px rgba(8, 145, 178, 0.4)',
              whiteSpace: 'nowrap',
            }}
          >
            <Play style={{ width: '14px', height: '14px' }} />
            Run
          </button>
        </div>

        {/* Quick Presets */}
        <div
          style={{
            padding: '8px 16px',
            borderBottom: '1px solid rgba(31, 41, 55, 0.5)',
            backgroundColor: 'rgba(17, 24, 39, 0.4)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            overflowX: 'auto',
            fontSize: '12px',
          }}
        >
          <span style={{ color: '#6b7280', display: 'flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap' }}>
            <Code style={{ width: '14px', height: '14px', color: '#22d3ee' }} /> Presets:
          </span>
          {presets.map((p, idx) => (
            <button
              key={idx}
              onClick={() => {
                setQuery(p.cmd);
                handleExecute(p.cmd);
              }}
              style={{
                padding: '4px 10px',
                backgroundColor: 'rgba(31, 41, 55, 0.8)',
                color: '#d1d5db',
                border: '1px solid rgba(55, 65, 81, 0.6)',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '12px',
                whiteSpace: 'nowrap',
              }}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Console Log Stream */}
        <div
          style={{
            padding: '16px',
            maxHeight: '320px',
            minHeight: '160px',
            overflowY: 'auto',
            fontFamily: "'Fira Code', 'Courier New', monospace",
            fontSize: '12px',
            color: '#d1d5db',
            backgroundColor: 'rgba(0, 0, 0, 0.4)',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
          }}
        >
          {logs.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 0', color: '#6b7280', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
              <TerminalIcon style={{ width: '32px', height: '32px', color: '#4b5563' }} />
              <span>Earendel Agent Spotlight Command Palette Ready</span>
              <span style={{ color: '#4b5563', fontSize: '11px' }}>Press Enter or click Run to execute across Microkernel IPC</span>
            </div>
          ) : (
            logs.map((log, idx) => (
              <pre
                key={idx}
                style={{
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                  lineHeight: '1.6',
                  color: '#a5f3fc',
                  borderLeft: '2px solid rgba(6, 182, 212, 0.5)',
                  paddingLeft: '8px',
                  margin: 0,
                }}
              >
                {log}
              </pre>
            ))
          )}
        </div>

        {/* Footer info bar */}
        <div
          style={{
            padding: '8px 16px',
            backgroundColor: 'rgba(3, 7, 18, 0.8)',
            borderTop: '1px solid rgba(31, 41, 55, 0.8)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: '11px',
            color: '#6b7280',
          }}
        >
          <span>Earendel Command Palette</span>
          <span>ESC to close • Cmd+K to toggle</span>
        </div>
      </div>
    </div>
  );
};
