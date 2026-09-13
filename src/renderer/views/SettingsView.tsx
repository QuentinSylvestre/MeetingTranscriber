import React, { useState, useEffect } from 'react';
import { useSettings } from '../hooks/useSettings';
import { PROVIDER_NAMES, PROVIDER_LABELS, SECRET_KEY_NAMES } from '../../shared/ipc-types';
import type { ProviderName } from '../../shared/ipc-types';

interface ProviderKeyStatus {
  configured: boolean;
  testing: boolean;
  testResult: 'idle' | 'valid' | 'invalid';
  testError?: string;
}

export default function SettingsView(): React.ReactElement {
  const { hasSecret, setSecret, testSecret } = useSettings();
  const [keyInputs, setKeyInputs] = useState<Record<ProviderName, string>>({
    assemblyai: '', elevenlabs: '', openai: '', google: '',
  });
  const [keyStatus, setKeyStatus] = useState<Record<ProviderName, ProviderKeyStatus>>({
    assemblyai: { configured: false, testing: false, testResult: 'idle' },
    elevenlabs: { configured: false, testing: false, testResult: 'idle' },
    openai: { configured: false, testing: false, testResult: 'idle' },
    google: { configured: false, testing: false, testResult: 'idle' },
  });
  const [showKeys, setShowKeys] = useState<Record<ProviderName, boolean>>({
    assemblyai: false, elevenlabs: false, openai: false, google: false,
  });

  // S3: Use Promise.all to avoid discarding promises from forEach(async...).
  useEffect(() => {
    Promise.all(
      PROVIDER_NAMES.map(async (provider) => {
        const keyName = SECRET_KEY_NAMES[provider];
        const configured = await hasSecret(keyName);
        setKeyStatus(prev => ({
          ...prev,
          [provider]: { ...prev[provider], configured },
        }));
      })
    ).catch((err) => {
      console.error('Failed to load key status:', err);
    });
  }, [hasSecret]);

  // S4: Check setSecret result and surface encryption failures to the user.
  const handleSave = async (provider: ProviderName) => {
    const keyName = SECRET_KEY_NAMES[provider];
    const value = keyInputs[provider].trim();
    if (!value) return;
    const result = await setSecret(keyName, value);
    if (!result.success) {
      setKeyStatus(prev => ({
        ...prev,
        [provider]: {
          ...prev[provider],
          testResult: 'invalid',
          testError: result.error ?? 'Failed to save key',
        },
      }));
      return;
    }
    setKeyInputs(prev => ({ ...prev, [provider]: '' }));
    setKeyStatus(prev => ({
      ...prev,
      [provider]: { ...prev[provider], configured: true, testResult: 'idle' },
    }));
  };

  const handleTest = async (provider: ProviderName) => {
    const keyName = SECRET_KEY_NAMES[provider];
    setKeyStatus(prev => ({ ...prev, [provider]: { ...prev[provider], testing: true } }));
    const result = await testSecret(keyName, provider);
    setKeyStatus(prev => ({
      ...prev,
      [provider]: {
        ...prev[provider],
        testing: false,
        testResult: result.valid ? 'valid' : 'invalid',
        testError: result.error,
      },
    }));
  };

  const containerStyle: React.CSSProperties = {
    padding: '0 0 24px',
    color: '#cdd6f4',
  };

  const cardStyle: React.CSSProperties = {
    background: '#313244',
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
  };

  const inputStyle: React.CSSProperties = {
    background: '#1e1e2e',
    border: '1px solid #45475a',
    color: '#cdd6f4',
    borderRadius: 4,
    padding: '6px 10px',
    fontSize: 13,
    width: '100%',
    boxSizing: 'border-box',
  };

  const btnStyle: React.CSSProperties = {
    background: '#cba6f7',
    color: '#1e1e2e',
    border: 'none',
    borderRadius: 4,
    padding: '6px 14px',
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 'bold',
    marginRight: 8,
  };

  const testBtnStyle: React.CSSProperties = {
    ...btnStyle,
    background: '#a6e3a1',
  };

  return (
    <div style={containerStyle}>
      <h2 style={{ marginTop: 0 }}>Settings</h2>
      <h3 style={{ color: '#89b4fa' }}>API Keys</h3>
      {PROVIDER_NAMES.map(provider => {
        const status = keyStatus[provider];
        const show = showKeys[provider];
        return (
          <div key={provider} style={cardStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <strong>{PROVIDER_LABELS[provider]}</strong>
              <span style={{ fontSize: 12, color: status.configured ? '#a6e3a1' : '#f38ba8' }}>
                {status.configured ? '● Configured' : '○ Not configured'}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <input
                type={show ? 'text' : 'password'}
                placeholder={status.configured ? '●●●●●●●●●●●●' : 'Enter API key'}
                value={keyInputs[provider]}
                onChange={e => setKeyInputs(prev => ({ ...prev, [provider]: e.target.value }))}
                style={inputStyle}
                aria-label={`API key for ${PROVIDER_LABELS[provider]}`}
              />
              <button
                onClick={() => setShowKeys(prev => ({ ...prev, [provider]: !prev[provider] }))}
                style={{ ...btnStyle, background: '#585b70', minWidth: 40 }}
                aria-label={show ? 'Hide key' : 'Show key'}
              >
                {show ? '🙈' : '👁'}
              </button>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button
                onClick={() => handleSave(provider)}
                disabled={!keyInputs[provider].trim()}
                style={{ ...btnStyle, opacity: keyInputs[provider].trim() ? 1 : 0.4 }}
              >
                Save
              </button>
              <button
                onClick={() => handleTest(provider)}
                disabled={!status.configured || status.testing}
                style={{ ...testBtnStyle, opacity: status.configured && !status.testing ? 1 : 0.4 }}
              >
                {status.testing ? 'Testing\u2026' : 'Test'}
              </button>
              {status.testResult === 'valid' && (
                <span style={{ color: '#a6e3a1', fontSize: 12 }}>&#10003; Valid</span>
              )}
              {status.testResult === 'invalid' && (
                <span style={{ color: '#f38ba8', fontSize: 12 }}>&#10007; {status.testError ?? 'Invalid'}</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
