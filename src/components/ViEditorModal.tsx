import React, { useState, useEffect, useRef } from 'react';
import { globalVFS } from '../core/vfs';
import { X, Save, Terminal, Info } from 'lucide-react';

interface ViEditorModalProps {
  filePath: string;
  initialContent: string;
  onClose: () => void;
}

export const ViEditorModal: React.FC<ViEditorModalProps> = ({ filePath, initialContent, onClose }) => {
  const [content, setContent] = useState(initialContent);
  const [originalContent] = useState(initialContent);
  const [mode, setMode] = useState<'COMMAND' | 'INSERT'>('COMMAND');
  const [cmdInput, setCmdInput] = useState('');
  const [showCmdBar, setShowCmdBar] = useState(false);
  const [showLineNumbers, setShowLineNumbers] = useState(true);
  const [statusMsg, setStatusMsg] = useState(`"${filePath}" ${initialContent.split('\n').length}L`);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [mode, showCmdBar]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showCmdBar) return;

    if (mode === 'COMMAND') {
      if (e.key === 'i') {
        e.preventDefault();
        setMode('INSERT');
        setStatusMsg('-- INSERT --');
      } else if (e.key === 'a') {
        e.preventDefault();
        setMode('INSERT');
        setStatusMsg('-- INSERT (APPEND) --');
      } else if (e.key === 'o') {
        e.preventDefault();
        setContent((prev) => prev + '\n');
        setMode('INSERT');
        setStatusMsg('-- INSERT (OPEN) --');
      } else if (e.key === ':') {
        e.preventDefault();
        setShowCmdBar(true);
        setCmdInput(':');
      }
    } else if (mode === 'INSERT') {
      if (e.key === 'Escape') {
        e.preventDefault();
        setMode('COMMAND');
        setStatusMsg('-- COMMAND --');
      }
    }
  };

  const handleCmdSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cmd = cmdInput.trim();

    if (cmd === ':w') {
      globalVFS.writeFile(filePath, content);
      const byteSize = new Blob([content]).size;
      setStatusMsg(`"${filePath}" ${content.split('\n').length}L, ${byteSize}B written`);
      setShowCmdBar(false);
    } else if (cmd === ':q') {
      if (content !== originalContent) {
        setStatusMsg('E37: No write since last change (add ! to override)');
        setShowCmdBar(false);
      } else {
        onClose();
      }
    } else if (cmd === ':q!') {
      onClose();
    } else if (cmd === ':wq' || cmd === ':x') {
      globalVFS.writeFile(filePath, content);
      onClose();
    } else if (cmd === ':set nu') {
      setShowLineNumbers(true);
      setStatusMsg('Line numbers enabled');
      setShowCmdBar(false);
    } else if (cmd === ':set nonu') {
      setShowLineNumbers(false);
      setStatusMsg('Line numbers disabled');
      setShowCmdBar(false);
    } else {
      setStatusMsg(`E492: Not an editor command: ${cmd.replace(':', '')}`);
      setShowCmdBar(false);
    }
  };

  const lines = content.split('\n');

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
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
        backgroundColor: 'rgba(3, 7, 18, 0.85)',
        backdropFilter: 'blur(8px)',
        userSelect: 'none',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          width: '100%',
          maxWidth: '960px',
          height: '85vh',
          backgroundColor: '#0f172a',
          border: '1px solid rgba(99, 102, 241, 0.4)',
          borderRadius: '12px',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.7)',
          overflow: 'hidden',
          fontFamily: "'Fira Code', 'Courier New', monospace",
          color: '#e2e8f0',
        }}
      >
        {/* Top Header Bar */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '10px 16px',
            backgroundColor: '#020617',
            borderBottom: '1px solid #1e293b',
            fontSize: '13px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#818cf8', fontWeight: 600 }}>
            <Terminal size={16} />
            <span>VIM - Vi IMproved ({filePath})</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              onClick={() => {
                globalVFS.writeFile(filePath, content);
                setStatusMsg(`"${filePath}" saved`);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '4px 10px',
                backgroundColor: 'rgba(79, 70, 229, 0.3)',
                color: '#c7d2fe',
                border: '1px solid rgba(99, 102, 241, 0.5)',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '12px',
                fontFamily: 'inherit',
              }}
            >
              <Save size={14} />
              <span>Save (:w)</span>
            </button>
            <button
              onClick={onClose}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#94a3b8',
                cursor: 'pointer',
                padding: '4px',
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Text Area Body */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            overflow: 'hidden',
            position: 'relative',
            backgroundColor: '#0b0f19',
          }}
        >
          {showLineNumbers && (
            <div
              style={{
                width: '48px',
                padding: '12px 10px 12px 0',
                backgroundColor: 'rgba(2, 6, 23, 0.6)',
                color: '#475569',
                textAlign: 'right',
                userSelect: 'none',
                fontSize: '14px',
                borderRight: '1px solid rgba(30, 41, 59, 0.8)',
                lineHeight: '1.5',
              }}
            >
              {lines.map((_, i) => (
                <div key={i}>{i + 1}</div>
              ))}
            </div>
          )}

          <textarea
            ref={textareaRef}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={handleKeyDown}
            readOnly={mode === 'COMMAND' && !showCmdBar}
            style={{
              flex: 1,
              padding: '12px',
              backgroundColor: 'transparent',
              color: '#f8fafc',
              fontFamily: "'Fira Code', 'Courier New', monospace",
              fontSize: '14px',
              lineHeight: '1.5',
              resize: 'none',
              outline: 'none',
              border: 'none',
              overflowY: 'auto',
            }}
            placeholder={mode === 'COMMAND' ? "Vim Command Mode: Press 'i' or 'a' to insert text, ':' for commands..." : ''}
            spellCheck={false}
          />
        </div>

        {/* Bottom Command Status Line */}
        <div
          style={{
            backgroundColor: '#020617',
            padding: '8px 16px',
            borderTop: '1px solid #1e293b',
            fontSize: '12px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            minHeight: '42px',
          }}
        >
          {showCmdBar ? (
            <form onSubmit={handleCmdSubmit} style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
              <input
                type="text"
                autoFocus
                value={cmdInput}
                onChange={(e) => setCmdInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setShowCmdBar(false);
                    textareaRef.current?.focus();
                  }
                }}
                style={{
                  width: '100%',
                  backgroundColor: 'transparent',
                  color: '#fbbf24',
                  fontFamily: 'inherit',
                  fontSize: '14px',
                  outline: 'none',
                  border: 'none',
                }}
              />
            </form>
          ) : (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: '#94a3b8' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span
                  style={{
                    padding: '2px 8px',
                    borderRadius: '4px',
                    fontWeight: 'bold',
                    fontSize: '11px',
                    backgroundColor: mode === 'INSERT' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(99, 102, 241, 0.2)',
                    color: mode === 'INSERT' ? '#34d399' : '#818cf8',
                    border: `1px solid ${mode === 'INSERT' ? 'rgba(16, 185, 129, 0.3)' : 'rgba(99, 102, 241, 0.3)'}`,
                  }}
                >
                  {mode === 'INSERT' ? '-- INSERT --' : '-- COMMAND --'}
                </span>
                <span style={{ color: '#cbd5e1' }}>{statusMsg}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#64748b' }}>
                <Info size={14} />
                <span>
                  Commands: <span style={{ background: '#1e293b', color: '#cbd5e1', padding: '1px 5px', borderRadius: '3px' }}>i</span> insert |{' '}
                  <span style={{ background: '#1e293b', color: '#cbd5e1', padding: '1px 5px', borderRadius: '3px' }}>Esc</span> command mode |{' '}
                  <span style={{ background: '#1e293b', color: '#cbd5e1', padding: '1px 5px', borderRadius: '3px' }}>:wq</span> save & exit
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
