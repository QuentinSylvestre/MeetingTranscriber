import React from 'react';
import { useI18n } from '../hooks/useI18n';

type View = 'record' | 'upload' | 'progress' | 'transcript' | 'history' | 'settings';

interface SidebarProps {
  currentView: View;
  onNavigate: (view: View) => void;
  isJobActive: boolean;
}

export default function Sidebar({ currentView, onNavigate, isJobActive }: SidebarProps): React.ReactElement {
  const { t } = useI18n();

  const NAV_ITEMS: { id: View; label: string; icon: string }[] = [
    { id: 'record',   label: t('nav_record'),   icon: '⏺' },
    { id: 'upload',   label: t('nav_upload'),   icon: '⬆' },
    { id: 'history',  label: t('nav_history'),  icon: '📋' },
    { id: 'settings', label: t('nav_settings'), icon: '⚙' },
  ];

  return (
    <nav className="sidebar">
      {/* Brand */}
      <div className="sidebar-brand">
        <div className="sidebar-brand-icon">🎙</div>
        <div>
          <div className="sidebar-brand-name">{t('sidebar_brand')}</div>
          <div className="sidebar-brand-sub">{t('sidebar_tagline')}</div>
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
            {t('sidebar_job_active')}
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--overlay0)' }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--surface2)', flexShrink: 0 }} />
            {t('sidebar_ready')}
          </div>
        )}
      </div>
    </nav>
  );
}
