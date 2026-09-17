import React, { useState, useEffect } from 'react';
import SettingsView from './views/SettingsView';
import RecordView from './views/RecordView';
import UploadView from './views/UploadView';
import JobProgressView from './views/JobProgressView';
import TranscriptView from './views/TranscriptView';
import HistoryView from './views/HistoryView';
import ErrorBoundaryWithI18n from './components/ErrorBoundaryWithI18n';
import Sidebar from './components/Sidebar';
import { useSettings } from './hooks/useSettings';
import { useSummary } from './hooks/useSummary';
import type { Job } from '../shared/ipc-types';

type View = 'record' | 'upload' | 'progress' | 'transcript' | 'history' | 'settings';

export default function App(): React.ReactElement {
  const [currentView, setCurrentView] = useState<View>('record');
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [activeJobAudioPath, setActiveJobAudioPath] = useState<string | null>(null);
  // True only while a transcription job is actively running (progress view).
  // Viewing a completed transcript from history must not trigger the indicator.
  const [isTranscribing, setIsTranscribing] = useState(false);

  const { getPreference } = useSettings();
  const summary = useSummary();

  // Apply stored font-size preference on mount via CSS variables.
  // Two tiers: --font-size-base (content) and --font-size-ui (chrome = base−1px).
  useEffect(() => {
    let alive = true;
    getPreference('fontSize').then((value) => {
      if (!alive) return;
      const size = [14, 16, 18, 20].includes(value as number) ? (value as number) : 14;
      document.documentElement.style.setProperty('--font-size-base', `${size}px`);
      document.documentElement.style.setProperty('--font-size-ui', `${size - 1}px`);
    }).catch(console.error);
    return () => { alive = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Called by RecordView when a recording has been stopped, flushed, and a
  // transcription job has been queued. Navigate straight to progress.
  const handleJobStarted = (jobId: string, audioPath: string): void => {
    setActiveJobId(jobId);
    setActiveJobAudioPath(audioPath);
    setIsTranscribing(true);
    setCurrentView('progress');
  };

  const handleOpenJob = (job: Job): void => {
    setActiveJobId(job.id);
    setActiveJobAudioPath(job.audio_path);
    // Opening a completed job from history is not an active transcription.
    setIsTranscribing(false);
    setCurrentView('transcript');
  };

  return (
    <ErrorBoundaryWithI18n>
      <div style={{ display: 'flex', height: '100vh' }}>
        <Sidebar
          currentView={currentView}
          onNavigate={setCurrentView}
          isJobActive={isTranscribing}
        />
        <main className="main-content">
          {currentView === 'progress' && activeJobId ? (
            <JobProgressView
              jobId={activeJobId}
              onComplete={() => { setIsTranscribing(false); setCurrentView('transcript'); }}
              onCancel={() => { setIsTranscribing(false); setCurrentView('record'); }}
            />
          ) : currentView === 'transcript' && activeJobId && activeJobAudioPath ? (
            <TranscriptView jobId={activeJobId} audioPath={activeJobAudioPath}
              summaryState={summary.getState(activeJobId)} generatingJobId={summary.generatingJobId}
              onGenerateSummary={() => void summary.generate(activeJobId)}
              onOpenSummary={() => void summary.open(activeJobId)}
              onRetrySaveSummary={() => void summary.retrySave(activeJobId)}
              onRefreshSummary={() => void summary.refresh(activeJobId)} />
          ) : currentView === 'settings' ? (
            <SettingsView />
          ) : currentView === 'upload' ? (
            <UploadView onJobQueued={(jobId, audioPath) => {
              setActiveJobId(jobId);
              setActiveJobAudioPath(audioPath);
              setCurrentView('progress');
            }} />
          ) : currentView === 'record' ? (
            <RecordView onJobStarted={handleJobStarted} />
          ) : currentView === 'history' ? (
            <HistoryView onOpenJob={handleOpenJob} />
          ) : null}
        </main>
      </div>
    </ErrorBoundaryWithI18n>
  );
}
