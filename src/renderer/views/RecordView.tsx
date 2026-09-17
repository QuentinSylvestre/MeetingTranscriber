import React, { useState, useEffect } from 'react';
import { useRecorder } from '../hooks/useRecorder';
import { useSettings } from '../hooks/useSettings';
import { useI18n } from '../hooks/useI18n';
import { useSpeakerCountHint } from '../hooks/useSpeakerCountHint';
import type { SpeakerCountMode } from '../hooks/useSpeakerCountHint';
import type { RecorderErrorCode } from '../hooks/useRecorder';
import type { I18nKey } from '../i18n';
import { PROVIDER_NAMES, PROVIDER_LABELS, SECRET_KEY_NAMES } from '../../shared/ipc-types';
import type { ProviderName } from '../../shared/ipc-types';

interface RecordViewProps {
  onJobStarted?: (jobId: string, audioPath: string) => void;
}

/** Explicit map rather than a built key, so a missing translation fails the build. */
const RECORDER_ERROR_KEY: Record<RecorderErrorCode, I18nKey> = {
  mic_not_found: 'record_error_mic_not_found',
  mic_denied: 'record_error_mic_denied',
  mic_busy: 'record_error_mic_busy',
  audio_engine: 'record_error_audio_engine',
  unknown: 'record_error_unknown',
};

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
  // Distinguishes "no microphones" from "not enumerated yet" — both are an empty list.
  const [devicesEnumerated, setDevicesEnumerated] = useState(false);
  const [selectedDevice, setSelectedDevice] = useState('');
  const [selectedProvider, setSelectedProvider] = useState<ProviderName>('assemblyai');
  const [selectedLanguage, setSelectedLanguage] = useState<'fr'|'en'|'auto'>('fr');
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const [providerKeyMissing, setProviderKeyMissing] = useState(false);
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);

  const { getPreference, hasSecret } = useSettings();
  const {
    status, durationMs, error: recorderError, inputLevel, inputSilent,
    start, pause, resume, stop,
  } = useRecorder((_jobId) => {});
  const [error, setError] = useState<string | null>(null);
  const {
    speakerMode, setSpeakerMode,
    speakerExact, setSpeakerExact,
    speakerMin, setSpeakerMin,
    speakerMax, setSpeakerMax,
    speakerError,
    buildSpeakerCountHint,
  } = useSpeakerCountHint();

  useEffect(() => {
    const enumerate = () =>
      navigator.mediaDevices.enumerateDevices()
        .then(all => setDevices(all.filter(d => d.kind === 'audioinput')))
        .catch(() => setDevices([]))
        // Either way the list is now as good as it gets, so the view may act on it.
        .finally(() => setDevicesEnumerated(true));
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
      setError(t('provider_key_missing_error').replace('{{provider}}', PROVIDER_LABELS[selectedProvider]));
      return;
    }
    const jobId = `job-${Date.now()}`;
    setCurrentJobId(jobId);
    await start(jobId, selectedDevice || undefined);
  };

  const handleStop = async () => {
    if (providerKeyMissing) {
      setError(t('provider_key_missing_error').replace('{{provider}}', PROVIDER_LABELS[selectedProvider]));
      return;
    }
    const { hint, error: hintError } = buildSpeakerCountHint();
    if (hintError) { setError(hintError); return; }
    setError(null);
    const { audioPath } = await stop();
    const jobId = currentJobId;
    setCurrentJobId(null);
    if (!jobId || !audioPath) return;
    try {
      await window.electronAPI.invoke('transcription:start-job', {
        jobId,
        title: t('record_default_title').replace('{{date}}', new Date().toLocaleString()),
        audioPath,
        provider: selectedProvider,
        model: 'universal',
        language: selectedLanguage,
        speakerCountHint: hint,
      });
      onJobStarted?.(jobId, audioPath);
    } catch (err) {
      console.error('Failed to start transcription job:', err);
      setError(t('transcription_start_error'));
    }
  };

  const isIdle = status === 'idle';
  // Chromium reports one audioinput entry per device even before labels are unlocked,
  // so an empty list means there is genuinely no microphone — not merely a hidden one.
  const noMicrophone = devicesEnumerated && devices.length === 0;
  const displayError = recorderError ? t(RECORDER_ERROR_KEY[recorderError]) : error;
  const isCapturing = status === 'recording' || status === 'paused';
  // Speech peaks around 0.1-0.3, so a linear bar would barely leave the left edge.
  // The square root spreads the quiet end out enough to see the meter move at all.
  const levelPercent = Math.min(100, Math.round(Math.sqrt(inputLevel) * 100));
  // Only mark the speaker-count fields invalid while #form-error is actually
  // showing THEIR error — otherwise a later, unrelated error (or a cleared
  // error) leaves a stale aria-describedby pointing at the wrong content.
  const speakerFieldInvalid = speakerError !== null && displayError === speakerError;

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

      {/* Input level — the only signal that a recording in progress is actually
          capturing sound. A dead input is otherwise indistinguishable from a live one
          until the meeting is over and the file turns out to be silent. */}
      {isCapturing && (
        <div className="record-level">
          <span className="record-level-label">{t('record_input_level_label')}</span>
          <div
            className="record-level-track"
            role="meter"
            aria-label={t('record_input_level_label')}
            aria-valuenow={levelPercent}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className={`record-level-fill${inputSilent ? ' is-silent' : ''}${levelPercent > 94 ? ' is-loud' : ''}`}
              style={{ width: `${levelPercent}%` }}
            />
          </div>
        </div>
      )}

      {isCapturing && inputSilent && (
        <p className="text-error text-sm mb-4" role="alert">{t('record_input_silent')}</p>
      )}

      {/* Controls */}
      <div className="record-controls mb-6">
        {status === 'idle' && (
          <>
            {providerKeyMissing && (
              <p className="text-error text-sm mb-4" role="alert">
                {t('provider_key_missing_banner').replace('{{provider}}', PROVIDER_LABELS[selectedProvider])}
              </p>
            )}
            {noMicrophone && (
              <p className="text-error text-sm mb-4" role="alert">
                {t('record_no_microphone_banner')}
              </p>
            )}
            <button
              className="btn btn-primary btn-lg"
              onClick={handleStart}
              disabled={!isIdle || !prefsLoaded || noMicrophone}
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

      {displayError && <p className="text-error text-sm mb-4" role="alert" id="form-error">{displayError}</p>}

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
              disabled={!isIdle || noMicrophone}
            >
              <option value="">
                {noMicrophone ? t('record_microphone_none') : t('record_microphone_default')}
              </option>
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

          {prefsLoaded && selectedProvider === 'assemblyai' && (
            <div className="form-group">
              <label className="form-label">{t('speaker_count_label')}</label>
              <select
                className="form-select"
                value={speakerMode}
                onChange={e => setSpeakerMode(e.target.value as SpeakerCountMode)}
                disabled={!isIdle}
              >
                <option value="none">{t('speaker_count_mode_none')}</option>
                <option value="exact">{t('speaker_count_mode_exact')}</option>
                <option value="range">{t('speaker_count_mode_range')}</option>
              </select>
              {speakerMode === 'exact' && (
                <input
                  className="form-input" type="number" min={1} max={20}
                  value={speakerExact} onChange={e => setSpeakerExact(e.target.value)}
                  placeholder={t('speaker_count_exact_placeholder')}
                  aria-label={t('speaker_count_label')}
                  aria-invalid={speakerFieldInvalid}
                  aria-describedby={speakerFieldInvalid ? 'form-error' : undefined}
                />
              )}
              {speakerMode === 'range' && (
                <div style={{ display: 'flex', gap: 8 }}>
                  <input className="form-input" type="number" min={1} max={20} value={speakerMin} onChange={e => setSpeakerMin(e.target.value)} placeholder={t('speaker_count_min_placeholder')} aria-label={t('speaker_count_min_placeholder')} aria-invalid={speakerFieldInvalid} aria-describedby={speakerFieldInvalid ? 'form-error' : undefined} />
                  <input className="form-input" type="number" min={1} max={20} value={speakerMax} onChange={e => setSpeakerMax(e.target.value)} placeholder={t('speaker_count_max_placeholder')} aria-label={t('speaker_count_max_placeholder')} aria-invalid={speakerFieldInvalid} aria-describedby={speakerFieldInvalid ? 'form-error' : undefined} />
                </div>
              )}
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: 'var(--crust)', borderRadius: 'var(--radius-sm)', fontSize: 12, color: 'var(--overlay0)' }}>
            <span>🔇</span>
            System audio capture unavailable (naudiodon not available for Electron 36)
          </div>
        </div>
      </div>
    </div>
  );
}
