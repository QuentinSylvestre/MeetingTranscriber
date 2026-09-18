import React, { useCallback, useEffect, useRef, useState } from 'react';
import AudioPlayer, { type AudioPlayerRef } from '../components/AudioPlayer';
import Modal from '../components/Modal';
import SpeakerTurnItem from '../components/SpeakerTurnItem';
import { useTranscript } from '../hooks/useTranscript';
import { useI18n } from '../hooks/useI18n';
import { SUMMARY_MODEL, type Job, type TranscriptTurn } from '../../shared/ipc-types';
import type { SummaryState } from '../hooks/useSummary';

interface Props {
  jobId: string; audioPath: string; summaryState: SummaryState; generatingJobId: string | null;
  onGenerateSummary: () => void; onOpenSummary: () => void;
  onRerenderSummary: () => void; onRefreshSummary: () => void;
}

export default function TranscriptView({ jobId, audioPath, summaryState, generatingJobId, onGenerateSummary, onOpenSummary, onRerenderSummary, onRefreshSummary }: Props): React.ReactElement {
  const { t } = useI18n();
  const { turns, loading, error, renameSpeaker, getDisplayName, updateTurnText, resetTranscript } = useTranscript(jobId);
  const audioPlayerRef = useRef<AudioPlayerRef>(null);
  const summarizing = generatingJobId === jobId;
  const { error: summaryError, filePath: summaryPath, hasStoredSummary } = summaryState;

  // Recover a document main may already hold for this job, so a renderer reload
  // during a paid generation does not orphan the result.
  useEffect(() => { onRefreshSummary(); }, [jobId]);

  // The request is paid and cannot be cancelled, so it gets the same explicit
  // confirmation the destructive Reset action already uses.
  const confirmAndGenerate = () => {
    if (window.confirm(t('summary_confirm'))) onGenerateSummary();
  };

  // Job title state and inline editing
  const [jobTitle, setJobTitle] = useState<string>('');
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const titleInputRef = useRef<HTMLInputElement>(null);

  // Load job title on mount
  useEffect(() => {
    if (!jobId) return;
    let alive = true;
    (window.electronAPI.invoke('db:get-job', { id: jobId }) as Promise<Job | null>)
      .then(job => { if (alive && job) setJobTitle(job.title); })
      .catch(console.error);
    return () => { alive = false; };
  }, [jobId]);

  const startTitleEdit = () => {
    setTitleDraft(jobTitle);
    setEditingTitle(true);
    setTimeout(() => titleInputRef.current?.focus(), 0);
  };
  const commitTitleEdit = async () => {
    if (!editingTitle) return; // guard against double-fire (Enter → blur)
    setEditingTitle(false);
    const trimmed = titleDraft.trim();
    if (trimmed && trimmed !== jobTitle) {
      try {
        await window.electronAPI.invoke('db:update-job-title', { id: jobId, title: trimmed });
        setJobTitle(trimmed);
      } catch {
        console.error('Failed to save title');
      }
    }
  };
  // Build the app:// URL for the audio file.
  // Registered as a 'standard' scheme, Chromium normalises app:///C:/path to
  // app://c/path (drive letter becomes the host, lowercased). Embrace this by
  // always using app://<drive>/<rest> on Windows so round-trip reconstruction
  // in the protocol handler is unambiguous.
  const buildAudioUrl = (p: string): string => {
    const forward = p.replace(/\\/g, '/');
    const winDrive = forward.match(/^([A-Za-z]):\/(.*)/);
    if (winDrive) return `app://${winDrive[1].toLowerCase()}/${winDrive[2]}`;
    return `app://${forward}`; // Unix: leading slash already present
  };
  const audioUrl = buildAudioUrl(audioPath);

  const onSeek = useCallback((ms: number) => audioPlayerRef.current?.seekTo(ms), []);

  const hasEdits = turns.length > 0 && turns.some(t => t.text !== t.original_text);

  if (loading) return <div style={{ color: 'var(--overlay1)', padding: 'var(--space-4)' }}>{t('transcript_loading')}</div>;

  const groups = new Map<number, TranscriptTurn[]>();
  for (const turn of turns) {
    if (!groups.has(turn.chunk_index)) groups.set(turn.chunk_index, []);
    groups.get(turn.chunk_index)!.push(turn);
  }
  const isChunked = groups.size > 1;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)', paddingBottom: 'var(--space-4)', borderBottom: '1px solid var(--surface0)' }}>
        <div>
          {editingTitle ? (
            <input
              ref={titleInputRef}
              className="form-input"
              value={titleDraft}
              onChange={e => setTitleDraft(e.target.value)}
              onBlur={() => void commitTitleEdit()}
              onKeyDown={e => {
                if (e.key === 'Enter') void commitTitleEdit();
                if (e.key === 'Escape') setEditingTitle(false);
              }}
              aria-label="Edit transcript title"
              style={{ fontSize: 'var(--text-lg)', fontWeight: 600, maxWidth: 400 }}
            />
          ) : (
            <div
              className="page-title"
              onDoubleClick={startTitleEdit}
              title={t('transcript_title_edit_hint')}
              style={{ cursor: 'text' }}
              role="button"
              tabIndex={0}
              onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && startTitleEdit()}
              aria-label={`${jobTitle || t('transcript_title_fallback')} — ${t('transcript_title_edit_hint')}`}
            >
              {jobTitle || t('transcript_title_fallback')}
            </div>
          )}
          <div className="page-subtitle">
            {turns.length} {turns.length !== 1 ? t('transcript_subtitle_turns_plural') : t('transcript_subtitle_turns')}
            {isChunked ? ` · ${groups.size} ${t('transcript_subtitle_chunks')}` : ''}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <button className="btn btn-primary btn-sm" disabled={generatingJobId !== null || turns.length === 0}
            onClick={confirmAndGenerate} title={`${t('summary_hint')} — ${SUMMARY_MODEL}`}>
            {summarizing ? t('summary_generating') : t('summary_generate')}
          </button>
          <button className="btn btn-success btn-sm" onClick={() => void window.electronAPI.invoke('export:to-file', { jobId })}>
            {t('transcript_btn_export')}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => void window.electronAPI.invoke('export:to-clipboard', { jobId })}>
            {t('transcript_btn_copy')}
          </button>
        </div>
      </div>

      {error && <p className="text-error text-sm mb-4">{error}</p>}
      {summaryError && <p role="alert" className="text-error text-sm mb-4">
        {t(`summary_error_${summaryError}`)}
      </p>}
      {summarizing && (
        <Modal title={t('summary_generating')}>
          <div className="page-subtitle">{t('summary_working')}</div>
        </Modal>
      )}
      {summaryPath && <div role="status" className="text-sm mb-4">
        {t('summary_saved')} <span className="selectable" style={{ overflowWrap: 'anywhere' }}>{summaryPath}</span>{' '}
        <button className="btn btn-ghost btn-sm" onClick={onOpenSummary}>{t('summary_open')}</button>
      </div>}
      {/* Visible any time a stored record exists, independent of summaryError/summaryPath —
          this is what lets a regeneration happen after a restart with no new LLM call.
          Rendered behind the same Modal backdrop as every other action button above
          during `summarizing`, not exempted from it (closes SC-6's stated gap). */}
      {hasStoredSummary && <div className="text-sm mb-4">
        <button className="btn btn-ghost btn-sm" disabled={generatingJobId !== null}
          onClick={onRerenderSummary}>{t('summary_btn_rerender')}</button>
      </div>}

      {/* Audio player */}
      <AudioPlayer ref={audioPlayerRef} src={audioUrl} />
      {process.env.NODE_ENV === 'development' && (
        <div style={{ fontSize: 10, color: 'var(--overlay0)', marginBottom: 4, wordBreak: 'break-all' }}>
          audio src: {audioUrl}
        </div>
      )}

      {/* Reset toolbar — sits directly above the turns list rather than the header,
          since it acts on the list immediately below it. */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 'var(--space-2)' }}>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => {
            if (!window.confirm(t('transcript_reset_confirm'))) return;
            void resetTranscript();
          }}
          disabled={!hasEdits}
          aria-label={t('transcript_reset_confirm_label')}
          title={t('transcript_reset_title')}
        >
          {t('transcript_btn_reset')}
        </button>
      </div>

      {/* Turns */}
      <div className="transcript-turns">
        {Array.from(groups.entries()).map(([chunkIdx, chunkTurns]) => (
          <React.Fragment key={chunkIdx}>
            {isChunked && (
              <div className="chunk-separator">{t('transcript_chunk_label')} {chunkIdx + 1}</div>
            )}
            {chunkTurns.map(turn => (
              <SpeakerTurnItem
                key={turn.id}
                turn={turn}
                displayName={getDisplayName(turn.chunk_index, turn.speaker_label)}
                onRename={name => void renameSpeaker(turn.chunk_index, turn.speaker_label, name)}
                onSeek={onSeek}
                onEditText={(id, text) => void updateTurnText(id, text)}
              />
            ))}
          </React.Fragment>
        ))}

        {turns.length === 0 && (
          <div style={{ textAlign: 'center', padding: '40px 24px', color: 'var(--overlay0)', fontSize: 13 }}>
            {t('transcript_empty')}
          </div>
        )}
      </div>
    </div>
  );
}
