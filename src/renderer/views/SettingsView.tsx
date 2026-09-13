import React, { useState, useEffect } from 'react';
import { useSettings } from '../hooks/useSettings';
import { PROVIDER_NAMES, PROVIDER_LABELS, SECRET_KEY_NAMES } from '../../shared/ipc-types';
import type { ProviderName } from '../../shared/ipc-types';

const PROVIDER_DESCRIPTIONS: Record<ProviderName, string> = {
  assemblyai: 'Strong diarization · French · Up to 10h',
  elevenlabs:  'Scribe v2 · Auto-chunks >8min · Up to 10h',
  openai:      'gpt-4o-transcribe-diarize · Chunks ≤25min',
  google:      'Gemini 3.5 Transcribe · Chunks ≤30min (preview)',
};

interface Status { configured: boolean; testing: boolean; result: 'idle'|'valid'|'invalid'; error?: string; }

export default function SettingsView(): React.ReactElement {
  const { hasSecret, setSecret, testSecret } = useSettings();
  const [inputs, setInputs] = useState<Record<ProviderName, string>>({ assemblyai:'', elevenlabs:'', openai:'', google:'' });
  const [status, setStatus] = useState<Record<ProviderName, Status>>({
    assemblyai: { configured: false, testing: false, result: 'idle' },
    elevenlabs:  { configured: false, testing: false, result: 'idle' },
    openai:      { configured: false, testing: false, result: 'idle' },
    google:      { configured: false, testing: false, result: 'idle' },
  });
  const [show, setShow] = useState<Record<ProviderName, boolean>>({ assemblyai: false, elevenlabs: false, openai: false, google: false });

  useEffect(() => {
    Promise.all(PROVIDER_NAMES.map(async p => {
      const configured = await hasSecret(SECRET_KEY_NAMES[p]);
      setStatus(prev => ({ ...prev, [p]: { ...prev[p], configured } }));
    })).catch(console.error);
  }, [hasSecret]);

  const handleSave = async (p: ProviderName) => {
    const v = inputs[p].trim();
    if (!v) return;
    const r = await setSecret(SECRET_KEY_NAMES[p], v);
    if (!r.success) {
      setStatus(prev => ({ ...prev, [p]: { ...prev[p], result: 'invalid', error: r.error ?? 'Failed to save' } }));
      return;
    }
    setInputs(prev => ({ ...prev, [p]: '' }));
    setStatus(prev => ({ ...prev, [p]: { ...prev[p], configured: true, result: 'idle' } }));
  };

  const handleTest = async (p: ProviderName) => {
    setStatus(prev => ({ ...prev, [p]: { ...prev[p], testing: true } }));
    const r = await testSecret(SECRET_KEY_NAMES[p], p);
    setStatus(prev => ({ ...prev, [p]: { ...prev[p], testing: false, result: r.valid ? 'valid' : 'invalid', error: r.error } }));
  };

  return (
    <div>
      <div className="page-header">
        <div className="page-title">Settings</div>
        <div className="page-subtitle">Configure transcription providers and preferences</div>
      </div>

      <h3 style={{ marginBottom: 'var(--space-3)' }}>API Keys</h3>

      {PROVIDER_NAMES.map(p => {
        const s = status[p];
        return (
          <div key={p} className={`provider-card${s.configured ? ' is-configured' : ''}`}>
            <div className="provider-header">
              <div>
                <div className="provider-name">{PROVIDER_LABELS[p]}</div>
                <div style={{ fontSize: 11, color: 'var(--overlay1)', marginTop: 2 }}>
                  {PROVIDER_DESCRIPTIONS[p]}
                </div>
              </div>
              <div className="provider-actions">
                {s.result === 'valid' && <span className="badge badge-success">✓ Valid</span>}
                {s.result === 'invalid' && <span className="badge badge-error" title={s.error}>✗ {s.error?.slice(0,30) ?? 'Invalid'}</span>}
                <span className={`badge ${s.configured ? 'badge-success' : 'badge-neutral'}`}>
                  {s.configured ? '● Configured' : '○ Not set'}
                </span>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ flex: 1, position: 'relative' }}>
                <input
                  className="form-input"
                  type={show[p] ? 'text' : 'password'}
                  placeholder={s.configured ? '••••••••••••••••••••' : 'Paste API key…'}
                  value={inputs[p]}
                  onChange={e => setInputs(prev => ({ ...prev, [p]: e.target.value }))}
                  onKeyDown={e => e.key === 'Enter' && handleSave(p)}
                  style={{ paddingRight: 40 }}
                  aria-label={`API key for ${PROVIDER_LABELS[p]}`}
                />
                <button
                  onClick={() => setShow(prev => ({ ...prev, [p]: !prev[p] }))}
                  style={{
                    position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: 'var(--overlay1)', fontSize: 14, padding: 2,
                  }}
                  aria-label={show[p] ? 'Hide key' : 'Show key'}
                >
                  {show[p] ? '🙈' : '👁'}
                </button>
              </div>
              <button
                className="btn btn-primary btn-sm"
                onClick={() => handleSave(p)}
                disabled={!inputs[p].trim()}
              >
                Save
              </button>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => handleTest(p)}
                disabled={!s.configured || s.testing}
              >
                {s.testing ? '…' : 'Test'}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
