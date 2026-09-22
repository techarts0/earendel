import React, { useState, useEffect, useRef } from 'react';
import { globalVFS } from '../core/vfs';
import { globalTutorEngine } from '../core/tutorEngine';
import { X, Save, Terminal, Info } from 'lucide-react';

interface ViEditorModalProps {
  filePath: string;
  initialContent: string;
  user?: string;
  onClose: () => void;
}

export const ViEditorModal: React.FC<ViEditorModalProps> = ({ filePath, initialContent, user, onClose }) => {
  const [content, setContent] = useState(initialContent);
  const [originalContent] = useState(initialContent);
  const [mode, setMode] = useState<'COMMAND' | 'INSERT'>('COMMAND');
  const [cmdInput, setCmdInput] = useState('');
  const [showCmdBar, setShowCmdBar] = useState(false);
  const [showLineNumbers, setShowLineNumbers] = useState(true);
  const [statusMsg, setStatusMsg] = useState(`"${filePath}" ${initialContent.split('\n').length}L`);
  const [cursorPos, setCursorPos] = useState({ line: 1, col: 1 });

  // History for undo/redo
  const historyRef = useRef<string[]>([initialContent]);
  const historyIndexRef = useRef<number>(0);
  // Clipboard for yy / dd / p
  const clipboardRef = useRef<string>('');
  // Pending key for 2-key sequence like dd, yy, gg
  const pendingKeyRef = useRef<string>('');
  const pendingKeyTimerRef = useRef<any>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const cmdInputRef = useRef<HTMLInputElement>(null);
  const lineNumbersRef = useRef<HTMLDivElement>(null);

  const saveFile = (targetPath: string, textToSave: string): boolean => {
    const effectiveUser = user || (typeof window !== 'undefined' && (window as any).globalShellEngine?.getEnv('USER')) || 'hello';
    const ok = globalVFS.writeFile(targetPath, textToSave, effectiveUser);
    if (ok) {
      setContent(textToSave);
      const byteSize = new Blob([textToSave]).size;
      setStatusMsg(`"${targetPath}" ${textToSave.split('\n').length}L, ${byteSize}B written`);
      return true;
    } else {
      setStatusMsg(`E212: Can't open file for writing: Permission denied`);
      return false;
    }
  };

  // Sync cursor row & col
  const updateCursorInfo = () => {
    if (!textareaRef.current) return;
    const selStart = textareaRef.current.selectionStart;
    const textBefore = content.substring(0, selStart);
    const linesBefore = textBefore.split('\n');
    const line = linesBefore.length;
    const col = linesBefore[linesBefore.length - 1].length + 1;
    setCursorPos({ line, col });
  };

  useEffect(() => {
    updateCursorInfo();
  }, [content]);

  // Focus management
  useEffect(() => {
    if (showCmdBar) {
      cmdInputRef.current?.focus();
    } else {
      textareaRef.current?.focus();
    }
  }, [mode, showCmdBar]);

  // Push history on content change
  const recordHistory = (newContent: string) => {
    if (newContent === content) return;
    const nextHistory = historyRef.current.slice(0, historyIndexRef.current + 1);
    nextHistory.push(newContent);
    // Keep max 50 history steps
    if (nextHistory.length > 50) nextHistory.shift();
    historyRef.current = nextHistory;
    historyIndexRef.current = nextHistory.length - 1;
    setContent(newContent);
  };

  // Synchronize scroll between line numbers and textarea
  const handleScroll = () => {
    if (textareaRef.current && lineNumbersRef.current) {
      lineNumbersRef.current.scrollTop = textareaRef.current.scrollTop;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showCmdBar) {
      e.preventDefault();
      return;
    }

    if (mode === 'COMMAND') {
      // Allow cursor navigation keys in command mode
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key)) {
        setTimeout(updateCursorInfo, 10);
        return;
      }

      // Intercept ALL other keypresses in COMMAND mode to prevent text pollution
      e.preventDefault();

      // Clear any single pending key if timer fired
      const clearPending = () => {
        pendingKeyRef.current = '';
        if (pendingKeyTimerRef.current) {
          clearTimeout(pendingKeyTimerRef.current);
          pendingKeyTimerRef.current = null;
        }
      };

      const key = e.key;

      // 1. Enter Insert mode
      if (key === 'i') {
        clearPending();
        setMode('INSERT');
        setStatusMsg('-- INSERT --');
        return;
      }
      if (key === 'a') {
        clearPending();
        if (textareaRef.current) {
          const currentPos = textareaRef.current.selectionStart;
          const nextPos = Math.min(currentPos + 1, content.length);
          textareaRef.current.setSelectionRange(nextPos, nextPos);
        }
        setMode('INSERT');
        setStatusMsg('-- INSERT (APPEND) --');
        return;
      }
      if (key === 'o') {
        clearPending();
        if (textareaRef.current) {
          const selStart = textareaRef.current.selectionStart;
          const textBefore = content.substring(0, selStart);
          const lineEndIndex = content.indexOf('\n', selStart);
          const insertPos = lineEndIndex === -1 ? content.length : lineEndIndex;
          const newContent = content.substring(0, insertPos) + '\n' + content.substring(insertPos);
          recordHistory(newContent);
          setTimeout(() => {
            if (textareaRef.current) {
              textareaRef.current.setSelectionRange(insertPos + 1, insertPos + 1);
            }
          }, 10);
        }
        setMode('INSERT');
        setStatusMsg('-- INSERT (OPEN) --');
        return;
      }

      // 2. Enter Command-line (ex) mode
      if (key === ':') {
        clearPending();
        setShowCmdBar(true);
        setCmdInput(':');
        return;
      }

      // 3. Search '/' command
      if (key === '/') {
        clearPending();
        setShowCmdBar(true);
        setCmdInput('/');
        return;
      }

      // 4. Two-key sequences: dd (delete line), yy (copy line), gg (top of file), ZZ (save & quit)
      if (pendingKeyRef.current === 'd') {
        if (key === 'd') {
          clearPending();
          // Delete current line
          if (textareaRef.current) {
            const selStart = textareaRef.current.selectionStart;
            const linesList = content.split('\n');
            let charAcc = 0;
            let targetLineIdx = 0;
            for (let i = 0; i < linesList.length; i++) {
              const nextCharAcc = charAcc + linesList[i].length + 1;
              if (selStart <= nextCharAcc || i === linesList.length - 1) {
                targetLineIdx = i;
                break;
              }
              charAcc = nextCharAcc;
            }
            const deletedLine = linesList[targetLineIdx];
            clipboardRef.current = deletedLine;
            linesList.splice(targetLineIdx, 1);
            const newContent = linesList.length === 0 ? '' : linesList.join('\n');
            recordHistory(newContent);
            setStatusMsg(`1 line deleted`);
          }
          return;
        }
        clearPending();
        return;
      }

      if (pendingKeyRef.current === 'y') {
        if (key === 'y') {
          clearPending();
          // Copy current line
          if (textareaRef.current) {
            const selStart = textareaRef.current.selectionStart;
            const linesList = content.split('\n');
            let charAcc = 0;
            let targetLineIdx = 0;
            for (let i = 0; i < linesList.length; i++) {
              const nextCharAcc = charAcc + linesList[i].length + 1;
              if (selStart <= nextCharAcc || i === linesList.length - 1) {
                targetLineIdx = i;
                break;
              }
              charAcc = nextCharAcc;
            }
            clipboardRef.current = linesList[targetLineIdx];
            setStatusMsg(`1 line yanked`);
          }
          return;
        }
        clearPending();
        return;
      }

      if (pendingKeyRef.current === 'g') {
        if (key === 'g') {
          clearPending();
          // Go to beginning of file
          if (textareaRef.current) {
            textareaRef.current.setSelectionRange(0, 0);
            textareaRef.current.scrollTop = 0;
            updateCursorInfo();
          }
          return;
        }
        clearPending();
        return;
      }

      if (key === 'Z' && e.shiftKey) {
        if (pendingKeyRef.current === 'Z') {
          clearPending();
          // ZZ -> :wq
          const textToSave = textareaRef.current ? textareaRef.current.value : content;
          if (saveFile(filePath, textToSave)) {
            onClose();
          }
          return;
        }
        pendingKeyRef.current = 'Z';
        pendingKeyTimerRef.current = setTimeout(clearPending, 1500);
        return;
      }

      // First key of sequence
      if (key === 'd' || key === 'y' || key === 'g') {
        pendingKeyRef.current = key;
        pendingKeyTimerRef.current = setTimeout(clearPending, 1500);
        return;
      }

      // 5. Paste (p / P)
      if (key === 'p' || key === 'P') {
        clearPending();
        if (clipboardRef.current !== null && textareaRef.current) {
          const selStart = textareaRef.current.selectionStart;
          const linesList = content.split('\n');
          let charAcc = 0;
          let targetLineIdx = 0;
          for (let i = 0; i < linesList.length; i++) {
            const nextCharAcc = charAcc + linesList[i].length + 1;
            if (selStart <= nextCharAcc || i === linesList.length - 1) {
              targetLineIdx = i;
              break;
            }
            charAcc = nextCharAcc;
          }
          const insertIdx = key === 'p' ? targetLineIdx + 1 : targetLineIdx;
          linesList.splice(insertIdx, 0, clipboardRef.current);
          const newContent = linesList.join('\n');
          recordHistory(newContent);
          setStatusMsg(`1 line pasted`);
        }
        return;
      }

      // 6. Navigation: G (end of file), 0 (start of line), $ (end of line), h/j/k/l
      if (key === 'G') {
        clearPending();
        if (textareaRef.current) {
          textareaRef.current.setSelectionRange(content.length, content.length);
          textareaRef.current.scrollTop = textareaRef.current.scrollHeight;
          updateCursorInfo();
        }
        return;
      }
      if (key === '0') {
        clearPending();
        if (textareaRef.current) {
          const selStart = textareaRef.current.selectionStart;
          const lineStart = content.lastIndexOf('\n', selStart - 1) + 1;
          textareaRef.current.setSelectionRange(lineStart, lineStart);
          updateCursorInfo();
        }
        return;
      }
      if (key === '$') {
        clearPending();
        if (textareaRef.current) {
          const selStart = textareaRef.current.selectionStart;
          let lineEnd = content.indexOf('\n', selStart);
          if (lineEnd === -1) lineEnd = content.length;
          textareaRef.current.setSelectionRange(lineEnd, lineEnd);
          updateCursorInfo();
        }
        return;
      }

      // Single character deletion: x
      if (key === 'x') {
        clearPending();
        if (textareaRef.current) {
          const selStart = textareaRef.current.selectionStart;
          if (selStart < content.length && content[selStart] !== '\n') {
            const newContent = content.substring(0, selStart) + content.substring(selStart + 1);
            recordHistory(newContent);
            setTimeout(() => {
              textareaRef.current?.setSelectionRange(selStart, selStart);
            }, 10);
          }
        }
        return;
      }

      // 7. Undo (u) and Redo (Ctrl+r)
      if (key === 'u' && !e.ctrlKey) {
        clearPending();
        if (historyIndexRef.current > 0) {
          historyIndexRef.current--;
          setContent(historyRef.current[historyIndexRef.current]);
          setStatusMsg('1 change undone');
        } else {
          setStatusMsg('Already at oldest change');
        }
        return;
      }
      if (key === 'r' && e.ctrlKey) {
        clearPending();
        if (historyIndexRef.current < historyRef.current.length - 1) {
          historyIndexRef.current++;
          setContent(historyRef.current[historyIndexRef.current]);
          setStatusMsg('1 change redone');
        } else {
          setStatusMsg('Already at newest change');
        }
        return;
      }
    } else if (mode === 'INSERT') {
      if (e.key === 'Escape') {
        e.preventDefault();
        setMode('COMMAND');
        setStatusMsg('-- COMMAND --');
        recordHistory(content);
        return;
      }
      // Record history on significant typing (Enter key)
      if (e.key === 'Enter') {
        setTimeout(() => recordHistory(textareaRef.current?.value || ''), 10);
      }
      setTimeout(updateCursorInfo, 10);
    }
  };

  const handleCmdSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const raw = cmdInput.trim();

    // 1. Colon Commands
    if (raw.startsWith(':')) {
      const cmd = raw.slice(1).trim();

      // Normalize :w, :q, :wq, :x, etc.
      if (cmd === 'w' || cmd.startsWith('w ')) {
        const targetPath = cmd.startsWith('w ') ? cmd.slice(2).trim() : filePath;
        const textToSave = textareaRef.current ? textareaRef.current.value : content;
        saveFile(targetPath, textToSave);
        setShowCmdBar(false);
      } else if (cmd === 'q') {
        const textToSave = textareaRef.current ? textareaRef.current.value : content;
        if (textToSave !== originalContent) {
          setStatusMsg('E37: No write since last change (add ! to override)');
          setShowCmdBar(false);
        } else {
          onClose();
        }
      } else if (cmd === 'q!' || cmd === 'qa!' || cmd === 'cq') {
        onClose();
      } else if (cmd === 'wq' || cmd === 'x' || cmd === 'wq!' || cmd === 'x!') {
        const textToSave = textareaRef.current ? textareaRef.current.value : content;
        if (saveFile(filePath, textToSave)) {
          onClose();
        } else {
          setShowCmdBar(false);
        }
      } else if (cmd === 'set nu' || cmd === 'set number') {
        setShowLineNumbers(true);
        setStatusMsg('Line numbers enabled');
        setShowCmdBar(false);
      } else if (cmd === 'set nonu' || cmd === 'set nonumber') {
        setShowLineNumbers(false);
        setStatusMsg('Line numbers disabled');
        setShowCmdBar(false);
      } else if (cmd.startsWith('%s/')) {
        // Global search & replace: :%s/old/new/g or :%s/old/new/
        const parts = cmd.slice(3).split('/');
        if (parts.length >= 2) {
          const oldStr = parts[0];
          const newStr = parts[1];
          const flags = parts[2] || 'g';
          try {
            const regex = new RegExp(oldStr, flags.includes('g') ? 'g' : '');
            let count = 0;
            const newContent = content.replace(regex, () => {
              count++;
              return newStr;
            });
            recordHistory(newContent);
            setStatusMsg(`${count} substitutions on ${count} lines`);
          } catch (err: any) {
            setStatusMsg(`E486: Pattern not found: ${oldStr}`);
          }
        }
        setShowCmdBar(false);
      } else if (/^\d+$/.test(cmd)) {
        // Jump to line number: :<n>
        const targetLine = parseInt(cmd, 10);
        const linesList = content.split('\n');
        const clampedLine = Math.max(1, Math.min(targetLine, linesList.length));
        let charIndex = 0;
        for (let i = 0; i < clampedLine - 1; i++) {
          charIndex += linesList[i].length + 1;
        }
        if (textareaRef.current) {
          textareaRef.current.setSelectionRange(charIndex, charIndex);
          updateCursorInfo();
        }
        setStatusMsg(`Line ${clampedLine}/${linesList.length}`);
        setShowCmdBar(false);
      } else if (cmd === 'gen' || cmd === 'ai' || cmd.startsWith('ai ') || cmd.startsWith('gen ')) {
        const extraPrompt = cmd.startsWith('ai ') ? cmd.slice(3).trim() : cmd.startsWith('gen ') ? cmd.slice(4).trim() : '';
        const promptPayload = extraPrompt ? (content ? `${content}\n# ${extraPrompt}` : `# ${extraPrompt}`) : content;
        const res = globalTutorEngine.generateCodeFromComments(filePath, promptPayload);
        const llm = globalTutorEngine.checkLLMConfig(globalVFS);
        const newContent = content.trim() ? content + '\n\n' + res.code : res.code;
        recordHistory(newContent);
        if (!llm.configured) {
          setStatusMsg(`[AI Copilot] Generated ${res.lineCount} lines via template (/etc/llm.conf unconfigured)`);
        } else {
          setStatusMsg(`[AI Copilot] Generated ${res.lineCount} lines via ${llm.model} (type :w to save)`);
        }
        setShowCmdBar(false);
      } else {
        setStatusMsg(`E492: Not an editor command: ${cmd}`);
        setShowCmdBar(false);
      }
      return;
    }

    // 2. Slash Search Command (/pattern)
    if (raw.startsWith('/')) {
      const searchPattern = raw.slice(1);
      if (searchPattern) {
        const startIndex = textareaRef.current?.selectionEnd || 0;
        let foundIdx = content.indexOf(searchPattern, startIndex);
        if (foundIdx === -1) {
          // Wrap around from beginning
          foundIdx = content.indexOf(searchPattern, 0);
        }
        if (foundIdx !== -1 && textareaRef.current) {
          textareaRef.current.setSelectionRange(foundIdx, foundIdx + searchPattern.length);
          updateCursorInfo();
          setStatusMsg(`/${searchPattern}`);
        } else {
          setStatusMsg(`E486: Pattern not found: ${searchPattern}`);
        }
      }
      setShowCmdBar(false);
      return;
    }

    setShowCmdBar(false);
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
          maxWidth: '980px',
          height: '86vh',
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
                const textToSave = textareaRef.current ? textareaRef.current.value : content;
                saveFile(filePath, textToSave);
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
              ref={lineNumbersRef}
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
                overflow: 'hidden',
              }}
            >
              {lines.map((_, i) => (
                <div key={i} style={{ color: i + 1 === cursorPos.line ? '#a5b4fc' : undefined, fontWeight: i + 1 === cursorPos.line ? 600 : 400 }}>
                  {i + 1}
                </div>
              ))}
            </div>
          )}

          <textarea
            ref={textareaRef}
            value={content}
            onChange={(e) => {
              if (mode === 'INSERT') {
                setContent(e.target.value);
              }
            }}
            onKeyDown={handleKeyDown}
            onClick={updateCursorInfo}
            onKeyUp={updateCursorInfo}
            onScroll={handleScroll}
            readOnly={mode === 'COMMAND' || showCmdBar}
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
              caretColor: mode === 'INSERT' ? '#38bdf8' : 'transparent',
            }}
            placeholder={mode === 'COMMAND' ? "Vim Command Mode: Press 'i' to insert, ':' for commands (:w, :wq, :q!)..." : ''}
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
                ref={cmdInputRef}
                type="text"
                value={cmdInput}
                onChange={(e) => setCmdInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    setShowCmdBar(false);
                    setCmdInput('');
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
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', color: '#64748b' }}>
                <span style={{ color: '#94a3b8' }}>
                  {cursorPos.line},{cursorPos.col}
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Info size={14} />
                  <span>
                    <span style={{ background: '#1e293b', color: '#cbd5e1', padding: '1px 5px', borderRadius: '3px' }}>i</span> insert |{' '}
                    <span style={{ background: '#1e293b', color: '#cbd5e1', padding: '1px 5px', borderRadius: '3px' }}>Esc</span> command |{' '}
                    <span style={{ background: '#1e293b', color: '#cbd5e1', padding: '1px 5px', borderRadius: '3px' }}>:wq</span> save & exit |{' '}
                    <span style={{ background: 'rgba(217, 70, 239, 0.2)', color: '#f472b6', padding: '1px 5px', borderRadius: '3px', fontWeight: 'bold' }}>:gen</span> AI
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
