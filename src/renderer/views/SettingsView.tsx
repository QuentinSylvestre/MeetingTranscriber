import React, { useState, useEffect, useMemo } from 'react';
import { useSettings } from '../hooks/useSettings';
import { useI18n } from '../hooks/useI18n';
import { PROVIDER_NAMES, PROVIDER_LABELS, SECRET_KEY_NAMES } from '../../shared/ipc-types';
import type { ProviderName } from '../../shared/ipc-types';

interface Status { configured: boolean; testing: boolean; result: 'idle'|'valid'|'invalid'; error?: string; }

export default function SettingsView(): React.ReactElement {
  const { t, setLang } = useI18n();
  const { hasSecret, setSecret, testSecret, getPreference, setPreference } = useSettings();
  const [inputs, setInputs] = useState<Record<ProviderName, string>>({ assemblyai:'', elevenlabs:'', openai:'', google:'' });
  const [status, setStatus] = useState<Record<ProviderName, Status>>({
    assemblyai: { configured: false, testing: false, result: 'idle' },
    elevenlabs:  { configured: false, testing: false, result: 'idle' },
    openai:      { configured: false, testing: false, result: 'idle' },
    google:      { configured: false, testing: false, result: 'idle' },
  });
  const [show, setShow] = useState<Record<ProviderName, boolean>>({ assemblyai: false, elevenlabs: false, openai: false, google: false });

  // Preferences state
  const [defaultProvider, setDefaultProvider] = useState<ProviderName>('assemblyai');
  const [defaultLanguage, setDefaultLanguage] = useState<'fr' | 'en'>('fr');
  const [appLanguage, setAppLanguage] = useState<'fr' | 'en'>('fr');
  const [prefsLoaded, setPrefsLoaded] = useState(false);

  // Provider descriptions — re-derive only when language changes
  const PROVIDER_DESCRIPTIONS = useMemo<Record<ProviderName, string>>(() => ({
    assemblyai: t('provider_desc_assemblyai'),
    elevenlabs:  t('provider_desc_elevenlabs'),
    openai:      t('provider_desc_openai'),
    google:      t('provider_desc_google'),
  }), [t]);

  useEffect(() => {
    Promise.all(PROVIDER_NAMES.map(async p => {
      const configured = await hasSecret(SECRET_KEY_NAMES[p]);
      setStatus(prev => ({ ...prev, [p]: { ...prev[p], configured } }));
    })).catch(console.error);
  }, [hasSecret]);

  // Load preferences on mount
  useEffect(() => {
    Promise.all([
      getPreference('defaultProvider'),
      getPreference('defaultLanguage'),
      getPreference('appLanguage'),
    ]).then(([prov, lang, appLang]) => {
      // Cast via ProviderName check
      const provVal = (PROVIDER_NAMES.includes(prov as ProviderName) ? prov : 'assemblyai') as ProviderName;
      // Treat 'auto' as 'fr'
      const langVal = (lang === 'fr' || lang === 'en') ? lang as 'fr' | 'en' : 'fr';
      const appLangVal = (appLang === 'fr' || appLang === 'en') ? appLang as 'fr' | 'en' : 'fr';
      setDefaultProvider(provVal);
      setDefaultLanguage(langVal);
      setAppLanguage(appLangVal);
      setPrefsLoaded(true);
    }).catch(console.error);
  }, []);

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

  const handleProviderChange = async (v: ProviderName) => {
    await setPreference('defaultProvider', v);
    setDefaultProvider(v);
  };
  const handleLanguageChange = async (v: 'fr' | 'en') => {
    await setPreference('defaultLanguage', v);
    setDefaultLanguage(v);
  };
  const handleAppLanguageChange = async (v: 'fr' | 'en') => {
    await setPreference('appLanguage', v);
    setAppLanguage(v);
    setLang(v);
  };

  return (
    <div>
      <div className="page-header">
        <div className="page-title">{t('settings_title')}</div>
        <div className="page-subtitle">{t('settings_subtitle')}</div>
      </div>

      {/* Transcription defaults card */}
      <div className="card" style={{ maxWidth: 520, marginBottom: 'var(--space-4)' }}>
        <div className="card-body">
          <h3 style={{ marginBottom: 'var(--space-4)' }}>{t('settings_transcription_heading')}</h3>
          <div className="grid-2">
            <div className="form-group">
              <label className="form-label">{t('settings_provider_label')}</label>
              <select
                className="form-select"
                value={defaultProvider}
                onChange={e => void handleProviderChange(e.target.value as ProviderName)}
                disabled={!prefsLoaded}
              >
                {PROVIDER_NAMES.map(p => <option key={p} value={p}>{PROVIDER_LABELS[p]}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">{t('settings_language_label')}</label>
              <select
                className="form-select"
                value={defaultLanguage}
                onChange={e => void handleLanguageChange(e.target.value as 'fr' | 'en')}
                disabled={!prefsLoaded}
              >
                <option value="fr">{t('lang_option_fr')}</option>
                <option value="en">{t('lang_option_en')}</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* App language card */}
      <div className="card" style={{ maxWidth: 520, marginBottom: 'var(--space-4)' }}>
        <div className="card-body">
          <h3 style={{ marginBottom: 'var(--space-4)' }}>{t('settings_applang_heading')}</h3>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">{t('settings_applang_label')}</label>
            <select
              className="form-select"
              value={appLanguage}
              onChange={e => void handleAppLanguageChange(e.target.value as 'fr' | 'en')}
              disabled={!prefsLoaded}
              style={{ maxWidth: 200 }}
            >
              <option value="en">English</option>
              <option value="fr">Français</option>
            </select>
          </div>
        </div>
      </div>

      <h3 style={{ marginBottom: 'var(--space-3)' }}>{t('settings_apikeys_heading')}</h3>

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
                {s.result === 'valid' && <span className="badge badge-success">{t('settings_valid')}</span>}
                {s.result === 'invalid' && <span className="badge badge-error" title={s.error}>{t('settings_invalid')} {s.error?.slice(0,30) ?? 'Invalid'}</span>}
                <span className={`badge ${s.configured ? 'badge-success' : 'badge-neutral'}`}>
                  {s.configured ? t('settings_configured') : t('settings_not_set')}
                </span>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ flex: 1, position: 'relative' }}>
                <input
                  className="form-input"
                  type={show[p] ? 'text' : 'password'}
                  placeholder={s.configured ? t('settings_key_placeholder_set') : t('settings_key_placeholder_unset')}
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
                  aria-label={show[p] ? t('settings_hide_key') : t('settings_show_key')}
                >
                  {show[p] ? '🙈' : '👁'}
                </button>
              </div>
              <button
                className="btn btn-primary btn-sm"
                onClick={() => handleSave(p)}
                disabled={!inputs[p].trim()}
              >
                {t('settings_save')}
              </button>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => handleTest(p)}
                disabled={!s.configured || s.testing}
              >
                {s.testing ? '…' : t('settings_test')}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
