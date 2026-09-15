import React, { useState } from 'react';
import { useHistory } from '../hooks/useHistory';
import { useI18n } from '../hooks/useI18n';
import type { Job } from '../../shared/ipc-types';

interface HistoryViewProps {
  onOpenJob: (job: Job) => void;
}

const STATUS_BADGE: Record<string, string> = {
  done:         'badge-success',
  failed:       'badge-error',
  uploading:    'badge-info',
  transcribing: 'badge-info',
  pending:      'badge-neutral',
};

const PROVIDER_SHORT: Record<string, string> = {
  assemblyai: 'AssemblyAI',
  elevenlabs:  'ElevenLabs',
  openai:      'OpenAI',
  google:      'Google',
};

function formatDate(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function formatDuration(s: number | null): string {
  if (!s) return '';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export default function HistoryView({ onOpenJob }: HistoryViewProps): React.ReactElement {
  const { t } = useI18n();
  const { jobs, loading, error, deleteJob, renameJob } = useHistory();
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState('');
  const [renameError, setRenameError] = useState<{ id: string; message: string } | null>(null);

  const startEdit = (job: Job) => {
    setEditingId(job.id);
    setTitleDraft(job.title);
    setRenameError(null);
  };
  const commitEdit = async () => {
    if (!editingId) return;
    const trimmed = titleDraft.trim();
    if (trimmed) {
      try {
        await renameJob(editingId, trimmed);
      } catch {
        setRenameError({ id: editingId, message: t('rename_job_error') });
      }
    }
    setEditingId(null);
  };

  if (loading) return (
    <div style={{ color: 'var(--overlay1)', fontSize: 13, padding: 'var(--space-4)' }}>
      {t('history_loading')}
    </div>
  );

  return (
    <div>
      <div className="page-header">
        <div className="page-title">{t('history_title')}</div>
        <div className="page-subtitle">
          {jobs.length} {jobs.length !== 1 ? t('history_subtitle_jobs_plural') : t('history_subtitle_jobs')}
        </div>
      </div>

      {error && <p className="text-error text-sm mb-4">{error}</p>}

      {jobs.length === 0 && !error && (
        <div style={{
          textAlign: 'center', padding: '60px 24px',
          color: 'var(--overlay0)', fontSize: 14,
        }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📋</div>
          {t('history_empty')}
          <div style={{ fontSize: 12, marginTop: 4, color: 'var(--surface2)' }}>
            {t('history_empty_hint')}
          </div>
        </div>
      )}

      {jobs.map(job => (
        <div
          key={job.id}
          className="job-card"
          onClick={() => job.status === 'done' && onOpenJob(job)}
          style={{ cursor: job.status === 'done' ? 'pointer' : 'default' }}
        >
          {/* Status stripe */}
          <div style={{
            width: 3, alignSelf: 'stretch', borderRadius: 2, flexShrink: 0,
            background: job.status === 'done' ? 'var(--success)' :
                        job.status === 'failed' ? 'var(--error)' :
                        'var(--warning)',
          }} />

          <div style={{ flex: 1, minWidth: 0 }}>
            {editingId === job.id ? (
              <input
                className="form-input"
                value={titleDraft}
                autoFocus
                onChange={e => setTitleDraft(e.target.value)}
                onBlur={() => void commitEdit()}
                onKeyDown={e => {
                  if (e.key === 'Enter') void commitEdit();
                  if (e.key === 'Escape') setEditingId(null);
                }}
                onClick={e => e.stopPropagation()}
                aria-label="Edit job title"
                style={{ fontSize: 13, fontWeight: 600 }}
              />
            ) : (
              <div
                className="job-title"
                onClick={e => e.stopPropagation()}
                onDoubleClick={e => { e.stopPropagation(); startEdit(job); }}
                title={t('transcript_title_edit_hint')}
                style={{ cursor: 'text' }}
                role="button"
                tabIndex={0}
                onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && startEdit(job)}
                aria-label={`${job.title} — ${t('transcript_title_edit_hint')}`}
              >
                {job.title}
              </div>
            )}
            {renameError?.id === job.id && <p className="text-error text-sm">{renameError.message}</p>}
            <div className="job-meta">
              <span>{formatDate(job.created_at)}</span>
              <span style={{ color: 'var(--surface2)' }}>·</span>
              <span>{PROVIDER_SHORT[job.provider] ?? job.provider}</span>
              {job.duration_s && <>
                <span style={{ color: 'var(--surface2)' }}>·</span>
                <span>{formatDuration(job.duration_s)}</span>
              </>}
              <span className={`badge ${STATUS_BADGE[job.status] ?? 'badge-neutral'}`} style={{ marginLeft: 4 }}>
                {job.status}
              </span>
            </div>
            {job.status === 'failed' && job.error_msg && (
              <div style={{ fontSize: 11, color: 'var(--error)', marginTop: 4 }}>
                {job.error_msg}
              </div>
            )}
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
            {job.status === 'done' && (
              <button className="btn btn-ghost btn-sm" onClick={() => onOpenJob(job)}>
                {t('history_btn_open')}
              </button>
            )}
            {confirmDelete === job.id ? (
              <>
                <button
                  className="btn btn-danger btn-sm"
                  onClick={async () => { await deleteJob(job.id); setConfirmDelete(null); }}
                >
                  {t('history_btn_delete')}
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => setConfirmDelete(null)}>
                  {t('history_btn_cancel')}
                </button>
              </>
            ) : (
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setConfirmDelete(job.id)}
                disabled={job.status === 'uploading' || job.status === 'transcribing'}
                title={(job.status === 'uploading' || job.status === 'transcribing') ? t('history_delete_disabled_title') : undefined}
                style={{ color: 'var(--overlay1)' }}
              >
                ✕
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
