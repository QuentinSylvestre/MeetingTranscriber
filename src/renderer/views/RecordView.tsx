import React, { useState, useEffect } from 'react';
import { useRecorder } from '../hooks/useRecorder';
import { useSettings } from '../hooks/useSettings';
import { useI18n } from '../hooks/useI18n';
import { PROVIDER_NAMES, PROVIDER_LABELS, SECRET_KEY_NAMES } from '../../shared/ipc-types';
import type { ProviderName } from '../../shared/ipc-types';

interface RecordViewProps {
  onJobStarted?: (jobId: string, audioPath: string) => void;
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
}

export default function RecordView({ onJobStarted }: RecordViewProps): React.ReactElement {
  const { t } = useI18n();
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDevice, setSelectedDevice] = useState('');
  const [selectedProvider, setSelectedProvider] = useState<ProviderName>('assemblyai');
  const [selectedLanguage, setSelectedLanguage] = useState<'fr'|'en'|'auto'>('fr');
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const [providerKeyMissing, setProviderKeyMissing] = useState(false);
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);

  const { getPreference, hasSecret } = useSettings();
  const { status, durationMs, error: recorderError, start, pause, resume, stop } = useRecorder((_jobId) => {});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const enumerate = () =>
      navigator.mediaDevices.enumerateDevices()
        .then(all => setDevices(all.filter(d => d.kind === 'audioinput')))
        .catch(() => {});
    enumerate();
    navigator.mediaDevices.addEventListener('devicechange', enumerate);
    return () => navigator.mediaDevices.removeEventListener('devicechange', enumerate);
  }, []);

  useEffect(() => {
    Promise.all([
      getPreference('defaultLanguage'),
      getPreference('defaultProvider'),
    ]).then(async ([lang, prov]) => {
      const langVal = (lang === 'fr' || lang === 'en') ? lang as 'fr' | 'en' : 'fr';
      const provVal = (PROVIDER_NAMES.includes(prov as ProviderName)) ? prov as ProviderName : 'assemblyai';
      setSelectedLanguage(langVal);
      setSelectedProvider(provVal);
      const keyPresent = await hasSecret(SECRET_KEY_NAMES[provVal]);
      setProviderKeyMissing(!keyPresent);
      setPrefsLoaded(true);
    }).catch((err) => {
      console.error(err);
      setPrefsLoaded(true); // allow user to proceed even if prefs couldn't be loaded
    });
  }, []); // mount-only — getPreference/hasSecret are stable useCallbacks

  const handleStart = async () => {
    if (!prefsLoaded) return;
    if (providerKeyMissing) {
      setError(`No API key configured for ${PROVIDER_LABELS[selectedProvider]}. Go to Settings → API Keys.`);
      return;
    }
    const jobId = `job-${Date.now()}`;
    setCurrentJobId(jobId);
    await start(jobId, selectedDevice || undefined);
  };

  const handleStop = async () => {
    if (providerKeyMissing) {
      setError(`No API key configured for ${PROVIDER_LABELS[selectedProvider]}. Go to Settings → API Keys.`);
      return;
    }
    const { audioPath } = await stop();
    const jobId = currentJobId;
    setCurrentJobId(null);
    if (!jobId || !audioPath) return;
    try {
      await window.electronAPI.invoke('transcription:start-job', {
        jobId,
        title: `Recording ${new Date().toLocaleString()}`,
        audioPath,
        provider: selectedProvider,
        model: 'universal',
        language: selectedLanguage,
      });
      onJobStarted?.(jobId, audioPath);
    } catch (err) {
      console.error('Failed to start transcription job:', err);
    }
  };

  const isIdle = status === 'idle';
  const displayError = recorderError || error;

  return (
    <div>
      <div className="page-header">
        <div className="page-title">{t('record_title')}</div>
        <div className="page-subtitle">{t('record_subtitle')}</div>
      </div>

      {/* Timer */}
      <div className="record-timer">
        {formatDuration(durationMs)}
        {status === 'recording' && <div className="record-timer-dot" />}
        {status === 'paused' && (
          <span style={{ fontSize: 16, fontFamily: 'var(--font-sans)', color: 'var(--warning)', letterSpacing: 1 }}>
            PAUSED
          </span>
        )}
      </div>

      {/* Controls */}
      <div className="record-controls mb-6">
        {status === 'idle' && (
          <>
            {providerKeyMissing && (
              <p className="text-error text-sm mb-4" role="alert">
                No API key for {PROVIDER_LABELS[selectedProvider]}. Go to Settings → API Keys.
              </p>
            )}
            <button
              className="btn btn-primary btn-lg"
              onClick={handleStart}
              disabled={!isIdle || !prefsLoaded}
            >
              {t('record_btn_start')}
            </button>
          </>
        )}
        {status === 'recording' && <>
          <button className="btn btn-warning" onClick={pause}>{t('record_btn_pause')}</button>
          <button className="btn btn-danger" onClick={handleStop}>{t('record_btn_stop')}</button>
        </>}
        {status === 'paused' && <>
          <button className="btn btn-success" onClick={resume}>{t('record_btn_resume')}</button>
          <button className="btn btn-danger" onClick={handleStop}>{t('record_btn_stop')}</button>
        </>}
        {status === 'stopping' && (
          <span style={{ color: 'var(--warning)', fontSize: 13 }}>{t('record_finalizing')}</span>
        )}
      </div>

      {displayError && <p className="text-error text-sm mb-4">{displayError}</p>}

      {/* Config */}
      <div className="card" style={{ maxWidth: 520 }}>
        <div className="card-body">
          <h3 style={{ marginBottom: 'var(--space-4)' }}>{t('record_settings_heading')}</h3>

          <div className="form-group">
            <label className="form-label">{t('record_microphone_label')}</label>
            <select
              className="form-select"
              value={selectedDevice}
              onChange={e => setSelectedDevice(e.target.value)}
              disabled={!isIdle}
            >
              <option value="">{t('record_microphone_default')}</option>
              {devices.map(d => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || `Device ${d.deviceId.substring(0,8)}`}
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">{t('record_language_label')}</label>
            <select
              className="form-select"
              value={selectedLanguage}
              onChange={e => setSelectedLanguage(e.target.value as 'fr'|'en'|'auto')}
              disabled={!isIdle}
            >
              <option value="fr">{t('lang_option_fr')}</option>
              <option value="en">{t('lang_option_en')}</option>
            </select>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: 'var(--crust)', borderRadius: 'var(--radius-sm)', fontSize: 12, color: 'var(--overlay0)' }}>
            <span>🔇</span>
            System audio capture unavailable (naudiodon not available for Electron 36)
          </div>
        </div>
      </div>
    </div>
  );
}
