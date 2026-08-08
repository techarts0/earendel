import React, { useState } from 'react';
import { Terminal } from './components/Terminal';
import { NanoEditorModal } from './components/NanoEditorModal';
import { ViEditorModal } from './components/ViEditorModal';
import { CheatSheetModal } from './components/CheatSheetModal';

export function App() {
  const [nanoModal, setNanoModal] = useState<{ path: string; content: string } | null>(null);
  const [viModal, setViModal] = useState<{ path: string; content: string } | null>(null);
  const [showCheatModal, setShowCheatModal] = useState(false);
  const [tmuxSplit, setTmuxSplit] = useState<'none' | 'v' | 'h'>('none');

  const handleSplitTmux = (type: 'v' | 'h' | 'exit') => {
    if (type === 'exit') {
      setTmuxSplit('none');
    } else {
      setTmuxSplit(type);
    }
  };

  return (
    <div className="w-screen h-screen m-0 p-0 overflow-hidden bg-[#000000] select-none">
      {/* Tmux Window Multiplexer Container */}
      <div
        style={{
          width: '100vw',
          height: '100vh',
          display: 'flex',
          flexDirection: tmuxSplit === 'v' ? 'column' : 'row',
        }}
      >
        {/* Main Terminal Window */}
        <div style={{ flex: 1, width: '100%', height: '100%', overflow: 'hidden' }}>
          <Terminal
            onOpenNano={(data) => setNanoModal(data)}
            onOpenVi={(data) => setViModal(data)}
            onOpenCheat={() => setShowCheatModal(true)}
            onSplitTmux={handleSplitTmux}
          />
        </div>

        {/* Tmux Sub Terminal Window */}
        {tmuxSplit !== 'none' && (
          <div
            style={{
              flex: 1,
              width: '100%',
              height: '100%',
              overflow: 'hidden',
              borderTop: tmuxSplit === 'v' ? '2px solid #38bdf8' : 'none',
              borderLeft: tmuxSplit === 'h' ? '2px solid #38bdf8' : 'none',
            }}
          >
            <Terminal
              skipBootScreen={true}
              onOpenNano={(data) => setNanoModal(data)}
              onOpenVi={(data) => setViModal(data)}
              onOpenCheat={() => setShowCheatModal(true)}
              onSplitTmux={handleSplitTmux}
            />
          </div>
        )}
      </div>

      {/* Nano Editor Trigger */}
      {nanoModal && (
        <NanoEditorModal
          filePath={nanoModal.path}
          initialContent={nanoModal.content}
          onClose={() => setNanoModal(null)}
        />
      )}

      {/* Vi / Vim Editor Trigger */}
      {viModal && (
        <ViEditorModal
          filePath={viModal.path}
          initialContent={viModal.content}
          onClose={() => setViModal(null)}
        />
      )}

      {/* CLI Triggered Telemetry & Cheat Sheet Modal */}
      {showCheatModal && (
        <CheatSheetModal onClose={() => setShowCheatModal(false)} />
      )}
    </div>
  );
}

export default App;
