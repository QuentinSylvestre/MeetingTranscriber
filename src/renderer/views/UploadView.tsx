import React, { useState, useEffect } from 'react';
import { useSettings } from '../hooks/useSettings';
import { useI18n } from '../hooks/useI18n';
import { PROVIDER_NAMES, PROVIDER_LABELS, SECRET_KEY_NAMES } from '../../shared/ipc-types';
import type { ProviderName } from '../../shared/ipc-types';

const ACCEPTED_EXTENSIONS = ['.mp3', '.mp4', '.wav', '.m4a', '.ogg'];

interface UploadViewProps {
  onJobQueued?: (jobId: string, audioPath: string) => void;
}

interface SelectedFile {
  name: string;
  sizeMb: number;
  srcPath: string; // absolute path — from drag (.path) or native picker dialog
}

export default function UploadView({ onJobQueued }: UploadViewProps): React.ReactElement {
  const { t } = useI18n();
  const [selected, setSelected] = useState<SelectedFile | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<ProviderName>('assemblyai');
  const [language, setLanguage] = useState<'fr'|'en'|'auto'>('fr');
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const [providerKeyMissing, setProviderKeyMissing] = useState(false);
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const { getPreference, hasSecret } = useSettings();

  useEffect(() => {
    Promise.all([
      getPreference('defaultLanguage'),
      getPreference('defaultProvider'),
    ]).then(async ([lang, prov]) => {
      const langVal = (lang === 'fr' || lang === 'en') ? lang as 'fr' | 'en' : 'fr';
      const provVal = (PROVIDER_NAMES.includes(prov as ProviderName)) ? prov as ProviderName : 'assemblyai';
      setLanguage(langVal);
      setSelectedProvider(provVal);
      const keyPresent = await hasSecret(SECRET_KEY_NAMES[provVal]);
      setProviderKeyMissing(!keyPresent);
      setPrefsLoaded(true);
    }).catch((err) => {
      console.error(err);
      setPrefsLoaded(true); // allow user to proceed even if prefs couldn't be loaded
    });
  }, []); // mount-only — getPreference/hasSecret are stable useCallbacks

  const validateExt = (name: string): boolean => {
    const ext = '.' + (name.split('.').pop() ?? '').toLowerCase();
    return ACCEPTED_EXTENSIONS.includes(ext);
  };

  // Both click and drop open the native OS file picker — File.path is unavailable
  // in sandboxed renderers so we never rely on it.
  const handleClick = async () => {
    const srcPath = await window.electronAPI.invoke('settings:pick-audio-file', {
      extensions: ACCEPTED_EXTENSIONS,
    }) as string | null;
    if (!srcPath) return; // cancelled
    const name = srcPath.split(/[\\/]/).pop() ?? srcPath;
    if (!validateExt(name)) {
      setError(`${t('upload_error_format')} ${ACCEPTED_EXTENSIONS.join(' ')}`);
      return;
    }
    setError(null);
    setSelected({ name, sizeMb: 0, srcPath }); // size not critical for display
  };

  const handleTranscribe = async () => {
    if (!selected) { setError('Please select an audio file.'); return; }
    if (!prefsLoaded) return;
    if (providerKeyMissing) {
      setError(`No API key configured for ${PROVIDER_LABELS[selectedProvider]}. Go to Settings → API Keys.`);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const jobId = `job-${Date.now()}`;
      const destPath = await window.electronAPI.invoke('settings:copy-upload', {
        srcPath: selected.srcPath,
        jobId,
        fileName: selected.name,
      }) as string;

      // Navigate to progress view BEFORE starting the job so JobProgressView
      // is mounted and its transcription:progress listener is registered before
      // the runner fires any events. Yield with setTimeout(0) to let React flush
      // the navigation re-render before the runner sends its first progress event.
      onJobQueued?.(jobId, destPath);
      // Wait for React to flush the navigation re-render and JobProgressView to mount
      // its transcription:progress listener before the runner starts firing events.
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));

      // Fire and forget — errors are surfaced via transcription:progress 'Error:' event
      void window.electronAPI.invoke('transcription:start-job', {
        jobId,
        title: title.trim() || selected.name.replace(/\.[^.]+$/, ''),
        audioPath: destPath,
        provider: selectedProvider,
        model: 'default',
        language,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <div className="page-title">{t('upload_title')}</div>
        <div className="page-subtitle">{t('upload_subtitle')}</div>
      </div>

      {/* Drop zone — click anywhere to open native file picker.
           Drag-and-drop is visually supported but File.path is unavailable
           in sandboxed renderers (sandbox:true), so both paths use the native dialog. */}
      <div
        className={`drop-zone${dragOver ? ' over' : ''}${selected ? ' has-file' : ''}`}
        onClick={handleClick}
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => { e.preventDefault(); setDragOver(false); void handleClick(); }}
        role="button" tabIndex={0}
        aria-label={t('upload_drop_text')}
        onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && void handleClick()}
      >
        {selected ? (
          <>
            <div className="drop-icon">✅</div>
            <div className="drop-text">{selected.name}</div>
            <div className="drop-hint">
              {selected.sizeMb > 0 ? `${selected.sizeMb.toFixed(1)} MB — ` : ''}{t('upload_drop_hint_change')}
            </div>
          </>
        ) : (
          <>
            <div className="drop-icon">🎵</div>
            <div className="drop-text">{t('upload_drop_text')}</div>
            <div className="drop-hint">{ACCEPTED_EXTENSIONS.join('  ')}</div>
          </>
        )}
      </div>

      {error && <p className="text-error text-sm mb-4" role="alert">{error}</p>}

      {/* Options */}
      <div className="card" style={{ maxWidth: 520, marginBottom: 'var(--space-4)' }}>
        <div className="card-body">
          <h3 style={{ marginBottom: 'var(--space-4)' }}>{t('upload_settings_heading')}</h3>

          <div className="form-group">
            <label className="form-label">{t('upload_language_label')}</label>
            <select
              className="form-select"
              value={language}
              onChange={e => setLanguage(e.target.value as 'fr'|'en'|'auto')}
            >
              <option value="fr">{t('lang_option_fr')}</option>
              <option value="en">{t('lang_option_en')}</option>
            </select>
          </div>

          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">{t('upload_title_label')}</label>
            <input
              className="form-input"
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder={t('upload_title_placeholder')}
            />
          </div>
        </div>
      </div>

      {providerKeyMissing && (
        <p className="text-error text-sm mb-4" role="alert">
          No API key for {PROVIDER_LABELS[selectedProvider]}. Go to Settings → API Keys.
        </p>
      )}

      <button
        className={`btn btn-primary btn-lg${(!selected || submitting || !prefsLoaded) ? ' btn-disabled' : ''}`}
        onClick={handleTranscribe}
        disabled={!selected || submitting || !prefsLoaded}
      >
        {submitting ? t('upload_btn_starting') : t('upload_btn_transcribe')}
      </button>
    </div>
  );
}
