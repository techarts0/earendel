import React, { useState, useEffect } from 'react';
import { globalHarnessEngine, HarnessState } from '../core/harnessEngine';
import { globalVFS } from '../core/vfs';
import { globalProcessManager } from '../core/processManager';

interface HarnessTuiModalProps {
  filePath: string;
  initialContent: string;
  onClose: () => void;
}

export const HarnessTuiModal: React.FC<HarnessTuiModalProps> = ({
  filePath,
  initialContent,
  onClose,
}) => {
  const [content] = useState(initialContent);
  const [currentState, setCurrentState] = useState<HarnessState>(HarnessState.PARSE);
  const [logs, setLogs] = useState<string[]>([
    `[HarnessTuiModal] Opened Cockpit Window for ${filePath}`,
  ]);
  const [isRunning, setIsRunning] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  const addLog = (msg: string) => {
    setLogs((prev) => [...prev, msg]);
  };

  const handleStartAutoRun = async () => {
    if (isRunning) return;
    setIsRunning(true);
    setCurrentState(HarnessState.PARSE);
    addLog(`[Action] Starting Auto Execution...`);

    const ctx = {
      vfs: globalVFS,
      env: { USER: 'hello', HOME: '/home/hello', PWD: '/home/hello' },
      lang: 'en' as const,
      args: [],
      processManager: globalProcessManager,
    };

    try {
      const res = await globalHarnessEngine.executeSkill(content, ctx);
      if (res.stdout) {
        res.stdout.split('\n').forEach((line) => line.trim() && addLog(line));
      }
      if (res.exitCode === 0) {
        setCurrentState(HarnessState.SUCCESS);
        addLog(`[Success] Skill execution finished successfully!`);
      } else {
        setCurrentState(HarnessState.ERROR);
        addLog(`[Error] Execution failed: ${res.stderr}`);
      }
    } catch (err: any) {
      setCurrentState(HarnessState.ERROR);
      addLog(`[Crash] Harness Engine crash: ${err.message}`);
    } finally {
      setIsRunning(false);
    }
  };

  const states = [
    HarnessState.PARSE,
    HarnessState.INFER,
    HarnessState.ACT,
    HarnessState.REFLEXION,
    HarnessState.SUCCESS,
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
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        backgroundColor: 'rgba(0, 0, 0, 0.85)',
        backdropFilter: 'blur(12px)',
        userSelect: 'none',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          width: '100%',
          maxWidth: '1000px',
          height: '85vh',
          backgroundColor: '#090d16',
          border: '1px solid #1e293b',
          borderRadius: '12px',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.9), 0 0 30px rgba(56, 189, 248, 0.1)',
          fontFamily: "'Fira Code', 'Courier New', monospace",
          fontSize: '13px',
          overflow: 'hidden',
        }}
      >
        {/* Top Header Bar */}
        <div
          style={{
            backgroundColor: '#0f172a',
            borderBottom: '1px solid #1e293b',
            color: '#38bdf8',
            padding: '10px 20px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontWeight: 'bold',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ backgroundColor: '#38bdf8', color: '#090d16', padding: '2px 8px', borderRadius: '4px', fontSize: '11px' }}>
              HARNESS TUI COCKPIT
            </span>
            <span style={{ color: '#f8fafc' }}>{filePath}</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <button
              onClick={onClose}
              style={{
                background: '#e11d48',
                border: 'none',
                color: '#ffffff',
                padding: '4px 12px',
                borderRadius: '4px',
                cursor: 'pointer',
                fontWeight: 'bold',
                fontSize: '12px',
              }}
            >
              ✕
            </button>
          </div>
        </div>

        {/* FSM Pipeline State Banner */}
        <div
          style={{
            backgroundColor: '#020617',
            borderBottom: '1px solid #1e293b',
            padding: '12px 20px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-around',
          }}
        >
          {states.map((st, idx) => {
            const isActive = currentState === st;
            const isError = currentState === HarnessState.ERROR && st === HarnessState.REFLEXION;
            return (
              <React.Fragment key={st}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '6px 14px',
                    borderRadius: '6px',
                    backgroundColor: isActive ? '#1e293b' : 'transparent',
                    border: isActive ? '1px solid #38bdf8' : '1px solid transparent',
                    color: isError ? '#f43f5e' : isActive ? '#38bdf8' : '#64748b',
                    fontWeight: isActive ? 'bold' : 'normal',
                    transition: 'all 0.2s',
                  }}
                >
                  <span
                    style={{
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      backgroundColor: isError ? '#f43f5e' : isActive ? '#38bdf8' : '#334155',
                      boxShadow: isActive ? '0 0 8px #38bdf8' : 'none',
                    }}
                  />
                  <span>{st}</span>
                </div>
                {idx < states.length - 1 && <span style={{ color: '#334155' }}>➔</span>}
              </React.Fragment>
            );
          })}
        </div>

        {/* Main Body Split Panel */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          {/* Left Panel: Skill Content & Inspector */}
          <div
            style={{
              width: '45%',
              borderRight: '1px solid #1e293b',
              backgroundColor: '#050811',
              display: 'flex',
              flexDirection: 'column',
              padding: '16px',
            }}
          >
            <div style={{ fontSize: '11px', color: '#94a3b8', marginBottom: '8px', fontWeight: 'bold' }}>
              📄 SKILL SOURCE & PROMPT INSPECTOR
            </div>
            <div
              style={{
                flex: 1,
                backgroundColor: '#090d16',
                border: '1px solid #1e293b',
                borderRadius: '6px',
                padding: '12px',
                color: '#cbd5e1',
                overflowY: 'auto',
                whiteSpace: 'pre-wrap',
                lineHeight: '1.5',
                fontSize: '12px',
              }}
            >
              {content}
            </div>
          </div>

          {/* Right Panel: Live Execution Log Output */}
          <div
            style={{
              flex: 1,
              backgroundColor: '#020617',
              display: 'flex',
              flexDirection: 'column',
              padding: '16px',
            }}
          >
            <div style={{ fontSize: '11px', color: '#94a3b8', marginBottom: '8px', fontWeight: 'bold' }}>
              💻 LIVE HARNESS EXECUTION STREAM & LOGS
            </div>
            <div
              style={{
                flex: 1,
                backgroundColor: '#090d16',
                border: '1px solid #1e293b',
                borderRadius: '6px',
                padding: '12px',
                color: '#4ade80',
                overflowY: 'auto',
                lineHeight: '1.6',
                fontSize: '12px',
              }}
            >
              {logs.map((log, i) => (
                <div key={i} style={{ marginBottom: '4px' }}>
                  {log}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Bottom Control Bar */}
        <div
          style={{
            backgroundColor: '#0f172a',
            borderTop: '1px solid #1e293b',
            padding: '12px 20px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <button
              onClick={handleStartAutoRun}
              disabled={isRunning}
              style={{
                backgroundColor: isRunning ? '#334155' : '#0284c7',
                color: '#ffffff',
                border: 'none',
                padding: '8px 16px',
                borderRadius: '6px',
                cursor: isRunning ? 'not-allowed' : 'pointer',
                fontWeight: 'bold',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              {isRunning ? '⏳ Running...' : '▶ Start Skill Execution'}
            </button>

            <span style={{ color: '#64748b', fontSize: '12px' }}>
              Reflexion Retries: <strong style={{ color: '#f59e0b' }}>{retryCount} / 3</strong>
            </span>
          </div>

          <div style={{ color: '#64748b', fontSize: '11px' }}>
            Press <kbd style={{ background: '#1e293b', color: '#f8fafc', padding: '2px 6px', borderRadius: '3px' }}>Esc</kbd> or click Exit to return to Shell
          </div>
        </div>
      </div>
    </div>
  );
};
