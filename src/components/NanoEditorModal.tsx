import React, { useState } from 'react';
import { globalVFS } from '../core/vfs';

interface NanoEditorModalProps {
  filePath: string;
  initialContent: string;
  onClose: () => void;
}

export const NanoEditorModal: React.FC<NanoEditorModalProps> = ({
  filePath,
  initialContent,
  onClose,
}) => {
  const [content, setContent] = useState(initialContent);

  const handleSave = () => {
    globalVFS.writeFile(filePath, content);
  };

  const handleSaveAndExit = () => {
    handleSave();
    onClose();
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
        padding: '16px',
        backgroundColor: 'rgba(0, 0, 0, 0.85)',
        backdropFilter: 'blur(8px)',
        userSelect: 'none',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          width: '100%',
          maxWidth: '900px',
          height: '80vh',
          backgroundColor: '#000000',
          border: '2px solid #334155',
          borderRadius: '8px',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.8)',
          fontFamily: "'Fira Code', 'Courier New', monospace",
          fontSize: '12px',
          overflow: 'hidden',
        }}
      >
        {/* Nano Top Header */}
        <div
          style={{
            backgroundColor: '#e2e8f0',
            color: '#000000',
            padding: '4px 16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontWeight: 'bold',
          }}
        >
          <span>GNU nano 7.2</span>
          <span>File: {filePath}</span>
          <span style={{ fontSize: '10px', opacity: 0.75 }}>Modified</span>
        </div>

        {/* Text Area Body */}
        <div style={{ flex: 1, backgroundColor: '#000000', color: '#f8fafc', padding: '12px' }}>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            style={{
              width: '100%',
              height: '100%',
              backgroundColor: 'transparent',
              color: '#f8fafc',
              fontFamily: "'Fira Code', 'Courier New', monospace",
              fontSize: '14px',
              lineHeight: '1.6',
              outline: 'none',
              border: 'none',
              resize: 'none',
            }}
            autoFocus
            spellCheck={false}
          />
        </div>

        {/* Nano Classic Bottom Key Helps */}
        <div
          style={{
            backgroundColor: '#0f172a',
            borderTop: '1px solid #1e293b',
            color: '#cbd5e1',
            padding: '8px',
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: '8px',
          }}
        >
          <button
            onClick={handleSaveAndExit}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              background: 'transparent',
              border: 'none',
              color: '#34d399',
              cursor: 'pointer',
              fontSize: '12px',
            }}
          >
            <span style={{ background: '#1e293b', color: '#ffffff', padding: '1px 5px', borderRadius: '3px', fontWeight: 'bold' }}>^O</span> WriteOut (保存)
          </button>
          <button
            onClick={onClose}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              background: 'transparent',
              border: 'none',
              color: '#fb7185',
              cursor: 'pointer',
              fontSize: '12px',
            }}
          >
            <span style={{ background: '#1e293b', color: '#ffffff', padding: '1px 5px', borderRadius: '3px', fontWeight: 'bold' }}>^X</span> Exit (退出)
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', opacity: 0.6 }}>
            <span style={{ background: '#1e293b', color: '#ffffff', padding: '1px 5px', borderRadius: '3px', fontWeight: 'bold' }}>^W</span> Where Is
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', opacity: 0.6 }}>
            <span style={{ background: '#1e293b', color: '#ffffff', padding: '1px 5px', borderRadius: '3px', fontWeight: 'bold' }}>^K</span> Cut Text
          </div>
        </div>
      </div>
    </div>
  );
};
