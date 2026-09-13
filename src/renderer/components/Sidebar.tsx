import React from 'react';

type View = 'record' | 'upload' | 'progress' | 'transcript' | 'history' | 'settings';

const NAV_ITEMS: { id: View; label: string; icon: string }[] = [
  { id: 'record',   label: 'Record',   icon: '⏺' },
  { id: 'upload',   label: 'Upload',   icon: '⬆' },
  { id: 'history',  label: 'History',  icon: '📋' },
  { id: 'settings', label: 'Settings', icon: '⚙' },
];

interface SidebarProps {
  currentView: View;
  onNavigate: (view: View) => void;
  isJobActive: boolean;
}

export default function Sidebar({ currentView, onNavigate, isJobActive }: SidebarProps): React.ReactElement {
  return (
    <nav className="sidebar">
      {/* Brand */}
      <div className="sidebar-brand">
        <div className="sidebar-brand-icon">🎙</div>
        <div>
          <div className="sidebar-brand-name">Transcriber</div>
          <div className="sidebar-brand-sub">Meeting recorder</div>
        </div>
      </div>

      <div style={{ padding: '0 8px 4px', borderBottom: '1px solid var(--surface0)', marginBottom: 8 }} />

      {/* Nav */}
      <div className="sidebar-nav">
        {NAV_ITEMS.map(item => (
          <button
            key={item.id}
            className={`sidebar-item${currentView === item.id ? ' active' : ''}`}
            onClick={() => onNavigate(item.id)}
            aria-current={currentView === item.id ? 'page' : undefined}
          >
            <span className="sidebar-item-icon">{item.icon}</span>
            {item.label}
          </button>
        ))}
      </div>

      {/* Footer */}
      <div className="sidebar-footer">
        {isJobActive ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--warning)' }}>
            <div className="sidebar-status-dot" style={{ background: 'var(--warning)' }} />
            Job in progress
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--overlay0)' }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--surface2)', flexShrink: 0 }} />
            Ready
          </div>
        )}
      </div>
    </nav>
  );
}
