import React from 'react';
import { Terminal, Sparkles, Network, Cpu, Monitor } from 'lucide-react';

interface DesktopDockProps {
  onOpenTerminal?: () => void;
  onOpenSpotlight?: () => void;
  onOpenDagCanvas?: () => void;
  onOpenHalInspector?: () => void;
}

export const DesktopDock: React.FC<DesktopDockProps> = ({
  onOpenTerminal,
  onOpenSpotlight,
  onOpenDagCanvas,
  onOpenHalInspector,
}) => {
  const dockItems = [
    { label: 'Earendel Terminal', icon: Terminal, action: onOpenTerminal, color: '#34d399', border: 'rgba(52, 211, 153, 0.4)' },
    { label: 'Agent Spotlight (Cmd+K)', icon: Sparkles, action: onOpenSpotlight, color: '#22d3ee', border: 'rgba(34, 211, 238, 0.4)' },
    { label: 'Skill Visual DAG Canvas', icon: Network, action: onOpenDagCanvas, color: '#c084fc', border: 'rgba(192, 132, 252, 0.4)' },
    { label: 'Hardware HAL (lshw)', icon: Cpu, action: onOpenHalInspector, color: '#fbbf24', border: 'rgba(251, 191, 36, 0.4)' },
    { label: 'Wayland Compositor Status', icon: Monitor, action: onOpenHalInspector, color: '#60a5fa', border: 'rgba(96, 165, 250, 0.4)' },
  ];

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '16px',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 9990,
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        padding: '10px 16px',
        backgroundColor: 'rgba(3, 7, 18, 0.85)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        border: '1px solid rgba(31, 41, 55, 0.8)',
        borderRadius: '16px',
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.8)',
        userSelect: 'none',
      }}
    >
      {dockItems.map((item, idx) => {
        const IconComponent = item.icon;
        return (
          <button
            key={idx}
            onClick={item.action}
            title={item.label}
            style={{
              position: 'relative',
              padding: '10px',
              borderRadius: '12px',
              backgroundColor: 'rgba(15, 23, 42, 0.6)',
              border: `1px solid ${item.border}`,
              color: item.color,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'transform 0.15s ease, background-color 0.15s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-3px)';
              e.currentTarget.style.backgroundColor = 'rgba(30, 41, 59, 0.9)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0px)';
              e.currentTarget.style.backgroundColor = 'rgba(15, 23, 42, 0.6)';
            }}
          >
            <IconComponent style={{ width: '20px', height: '20px' }} />
          </button>
        );
      })}
    </div>
  );
};
