import React from 'react';

type View = 'record' | 'upload' | 'progress' | 'transcript' | 'history' | 'settings';

const NAV_ITEMS: { id: View; label: string }[] = [
  { id: 'record', label: '● Record' },
  { id: 'upload', label: '↑ Upload' },
  { id: 'history', label: '⧔ History' },
  { id: 'settings', label: '⚙ Settings' },
];

interface SidebarProps {
  currentView: View;
  onNavigate: (view: View) => void;
  isJobActive: boolean;
}

export default function Sidebar({ currentView, onNavigate, isJobActive }: SidebarProps): React.ReactElement {
  return (
    <nav style={{
      width: 180, background: '#1e1e2e', color: '#cdd6f4',
      display: 'flex', flexDirection: 'column', padding: '16px 0', gap: 4,
      flexShrink: 0,
    }}>
      <div style={{ padding: '0 16px 16px', fontWeight: 'bold', fontSize: 14, display: 'flex', gap: 8, alignItems: 'center' }}>
        Meeting Transcriber
        {isJobActive && <span style={{ fontSize: 12 }}>⏳</span>}
      </div>
      {NAV_ITEMS.map(item => (
        <button
          key={item.id}
          onClick={() => onNavigate(item.id)}
          style={{
            background: currentView === item.id ? '#313244' : 'transparent',
            border: 'none', color: '#cdd6f4', textAlign: 'left',
            padding: '10px 16px', cursor: 'pointer', fontSize: 14,
          }}
          aria-current={currentView === item.id ? 'page' : undefined}
        >
          {item.label}
        </button>
      ))}
    </nav>
  );
}
