import React, { useState, useEffect } from 'react';
import { Network, CheckCircle2, AlertCircle, RefreshCw, Cpu, X, Play, Code, ArrowRight } from 'lucide-react';
import { globalHarnessEngine, HarnessState } from '../core/harnessEngine';

interface HarnessDagModalProps {
  isOpen: boolean;
  onClose: () => void;
  skillFilePath?: string;
}

export const HarnessDagModal: React.FC<HarnessDagModalProps> = ({ isOpen, onClose, skillFilePath = '/skills/demo.md' }) => {
  const [currentState, setCurrentState] = useState<HarnessState>(HarnessState.IDLE);
  const [logs, setLogs] = useState<string[]>([]);
  const [isExecuting, setIsExecuting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setCurrentState(HarnessState.IDLE);
      setLogs([]);
    }
  }, [isOpen, skillFilePath]);

  if (!isOpen) return null;

  const handleRunDag = async () => {
    setIsExecuting(true);
    setLogs([`[DAG Engine] Loading Target Skill File: ${skillFilePath}...`]);

    const vfs = (window as any).globalVFS;
    const fileContent = vfs ? (vfs.readFile(skillFilePath, 'hello') ?? '') : '';

    if (!fileContent.trim()) {
      setCurrentState(HarnessState.ERROR);
      setLogs((prev) => [
        ...prev,
        `[PARSE ERROR] ${skillFilePath}: File is empty or does not exist. Execution aborted at PARSE step.`,
      ]);
      setIsExecuting(false);
      return;
    }

    try {
      await globalHarnessEngine.executeSkill(
        fileContent,
        {
          vfs: (window as any).globalVFS,
          env: {},
          lang: 'zh',
          args: [],
          pipeInput: '',
          processManager: (window as any).globalProcessManager,
        },
        (state, log) => {
          setCurrentState(state);
          if (log) setLogs((prev) => [...prev, `[FSM:${state}] ${log.replace(/\x1b\[[0-9;]*m/g, '')}`]);
        }
      );
    } catch (err: any) {
      setCurrentState(HarnessState.ERROR);
      setLogs((prev) => [...prev, `[DAG Error] ${err.message}`]);
    } finally {
      setIsExecuting(false);
    }
  };

  const dagNodes = [
    { state: HarnessState.PARSE, title: '0-Token Shebang Parse', desc: 'Validates #!/dev/skill & parses YAML frontmatter' },
    { state: HarnessState.INFER, title: 'AI Goal Inference', desc: 'Queries driverd (/dev/ai) to generate execution plan' },
    { state: HarnessState.ACT, title: 'Sub-Shell Command Act', desc: 'Executes POSIX shell pipelines in sandboxed sub-shell' },
    { state: HarnessState.REFLEXION, title: 'Reflexion Self-Correction', desc: 'Catches non-zero exit codes & retries with AI fix' },
    { state: HarnessState.SUCCESS, title: 'Execution Complete', desc: 'Skill execution finished with status 0' },
  ];

  const getStepStyle = (nodeState: HarnessState) => {
    if (currentState === HarnessState.ERROR && nodeState === HarnessState.PARSE) {
      return {
        border: '1px solid #ef4444',
        backgroundColor: 'rgba(127, 29, 29, 0.6)',
        color: '#fca5a5',
        boxShadow: '0 10px 15px -3px rgba(239, 68, 68, 0.3)',
      };
    }

    if (currentState === nodeState) {
      return {
        border: '1px solid #22d3ee',
        backgroundColor: 'rgba(8, 47, 73, 0.7)',
        color: '#bae6fd',
        boxShadow: '0 10px 15px -3px rgba(6, 182, 212, 0.3)',
      };
    }

    if (
      (currentState === HarnessState.SUCCESS && nodeState !== HarnessState.ERROR) ||
      (currentState === HarnessState.ACT && nodeState === HarnessState.PARSE)
    ) {
      return {
        border: '1px solid rgba(16, 185, 129, 0.6)',
        backgroundColor: 'rgba(6, 78, 59, 0.4)',
        color: '#6ee7b7',
      };
    }

    return {
      border: '1px solid rgba(31, 41, 55, 0.8)',
      backgroundColor: 'rgba(17, 24, 39, 0.6)',
      color: '#9ca3af',
    };
  };

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
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        userSelect: 'none',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '896px',
          maxHeight: '85vh',
          backgroundColor: 'rgba(15, 23, 42, 0.95)',
          border: currentState === HarnessState.ERROR ? '1px solid rgba(239, 68, 68, 0.6)' : '1px solid rgba(168, 85, 247, 0.4)',
          borderRadius: '16px',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.8)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          fontFamily: "'Fira Code', 'Courier New', monospace",
          color: '#e2e8f0',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '16px 24px',
            borderBottom: '1px solid #1e293b',
            backgroundColor: 'rgba(2, 6, 23, 0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <Network style={{ width: '24px', height: '24px', color: '#c084fc' }} />
            <div>
              <h2 style={{ fontSize: '18px', fontWeight: 'bold', color: '#f3f4f6', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                Harness-Skill Visual DAG Flow Canvas
              </h2>
              <p style={{ fontSize: '12px', color: '#9ca3af', margin: 0 }}>FSM Topology Engine • Target: {skillFilePath}</p>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              onClick={handleRunDag}
              disabled={isExecuting}
              style={{
                padding: '6px 16px',
                backgroundColor: '#9333ea',
                color: '#ffffff',
                borderRadius: '8px',
                fontSize: '12px',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                border: 'none',
                cursor: isExecuting ? 'not-allowed' : 'pointer',
                opacity: isExecuting ? 0.7 : 1,
                boxShadow: '0 4px 6px -1px rgba(147, 51, 234, 0.4)',
              }}
            >
              {isExecuting ? <RefreshCw style={{ width: '14px', height: '14px' }} /> : <Play style={{ width: '14px', height: '14px' }} />}
              Run DAG
            </button>
            <button
              onClick={onClose}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#9ca3af',
                cursor: 'pointer',
                padding: '6px',
                borderRadius: '8px',
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <X style={{ width: '20px', height: '20px' }} />
            </button>
          </div>
        </div>

        {/* Visual DAG Node Pipeline */}
        <div
          style={{
            padding: '24px',
            backgroundColor: 'rgba(2, 6, 23, 0.4)',
            borderBottom: '1px solid #1e293b',
            overflowX: 'auto',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', minWidth: '700px' }}>
            {dagNodes.map((n, idx) => (
              <React.Fragment key={n.state}>
                <div
                  style={{
                    flex: 1,
                    padding: '16px',
                    borderRadius: '12px',
                    transition: 'all 0.2s',
                    ...getStepStyle(n.state),
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                    <span style={{ fontSize: '12px', fontWeight: 'bold', letterSpacing: '0.05em', color: '#c084fc', textTransform: 'uppercase' }}>
                      Step 0{idx + 1}
                    </span>
                    {currentState === n.state && <RefreshCw style={{ width: '14px', height: '14px', color: '#22d3ee' }} />}
                    {currentState === HarnessState.ERROR && n.state === HarnessState.PARSE && <AlertCircle style={{ width: '14px', height: '14px', color: '#f87171' }} />}
                    {currentState === HarnessState.SUCCESS && <CheckCircle2 style={{ width: '14px', height: '14px', color: '#34d399' }} />}
                  </div>
                  <h4 style={{ fontSize: '14px', fontWeight: 600, color: '#f3f4f6', margin: '0 0 4px 0' }}>{n.title}</h4>
                  <p style={{ fontSize: '11px', color: '#9ca3af', lineHeight: 1.3, margin: 0 }}>{n.desc}</p>
                </div>
                {idx < dagNodes.length - 1 && <ArrowRight style={{ width: '20px', height: '20px', color: '#4b5563', flexShrink: 0 }} />}
              </React.Fragment>
            ))}
          </div>
        </div>

        {/* Live Execution Console */}
        <div
          style={{
            padding: '16px',
            flex: 1,
            backgroundColor: 'rgba(0, 0, 0, 0.6)',
            overflowY: 'auto',
            fontFamily: "'Fira Code', 'Courier New', monospace",
            fontSize: '12px',
            color: '#d1d5db',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
            minHeight: '200px',
          }}
        >
          {logs.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '48px 0', color: '#6b7280', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
              <Code style={{ width: '32px', height: '32px', color: '#4b5563' }} />
              <span>Click "Run DAG" to execute Harness FSM Topology Live for {skillFilePath}</span>
            </div>
          ) : (
            logs.map((l, i) => (
              <div
                key={i}
                style={{
                  lineHeight: 1.5,
                  color: l.includes('ERROR') || l.includes('Missing Shebang') ? '#fca5a5' : '#e9d5ff',
                  borderLeft: `2px solid ${l.includes('ERROR') ? '#ef4444' : 'rgba(168, 85, 247, 0.4)'}`,
                  paddingLeft: '8px',
                }}
              >
                {l}
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '10px 24px',
            backgroundColor: 'rgba(2, 6, 23, 0.9)',
            borderTop: '1px solid #1e293b',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: '12px',
            color: '#9ca3af',
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Cpu style={{ width: '16px', height: '16px', color: '#c084fc' }} /> FSM State: <strong style={{ color: currentState === HarnessState.ERROR ? '#ef4444' : '#67e8f9', fontFamily: 'inherit' }}>{currentState}</strong>
          </span>
          <span>Earendel-Wayland Surface Compositor</span>
        </div>
      </div>
    </div>
  );
};
