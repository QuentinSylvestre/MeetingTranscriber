import React, { useState } from 'react';
import SettingsView from './views/SettingsView';
import RecordView from './views/RecordView';
import UploadView from './views/UploadView';
import JobProgressView from './views/JobProgressView';
import TranscriptView from './views/TranscriptView';
import HistoryView from './views/HistoryView';
import ErrorBoundary from './components/ErrorBoundary';
import Sidebar from './components/Sidebar';
import type { Job } from '../shared/ipc-types';

type View = 'record' | 'upload' | 'progress' | 'transcript' | 'history' | 'settings';

export default function App(): React.ReactElement {
  const [currentView, setCurrentView] = useState<View>('record');
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [activeJobAudioPath, setActiveJobAudioPath] = useState<string | null>(null);

  // Called by RecordView when recording has been stopped and MP3 flushed to disk.
  const handleJobStopped = (jobId: string): void => {
    setActiveJobId(jobId);
    // Phase 9 will navigate to progress view and supply the real audio path.
  };

  const handleOpenJob = (job: Job): void => {
    setActiveJobId(job.id);
    setActiveJobAudioPath(job.audio_path);
    setCurrentView('transcript');
  };

  return (
    <ErrorBoundary>
      <div style={{ display: 'flex', height: '100vh', fontFamily: 'sans-serif' }}>
        <Sidebar
          currentView={currentView}
          onNavigate={setCurrentView}
          isJobActive={!!activeJobId}
        />
        <main style={{ flex: 1, padding: 24, background: '#1e1e2e', color: '#cdd6f4', overflowY: 'auto' }}>
          {currentView === 'progress' && activeJobId ? (
            <JobProgressView
              jobId={activeJobId}
              onComplete={() => setCurrentView('transcript')}
              onCancel={() => setCurrentView('record')}
            />
          ) : currentView === 'transcript' && activeJobId && activeJobAudioPath ? (
            <TranscriptView jobId={activeJobId} audioPath={activeJobAudioPath} />
          ) : currentView === 'settings' ? (
            <SettingsView />
          ) : currentView === 'upload' ? (
            <UploadView onJobQueued={(jobId) => {
              setActiveJobId(jobId);
              setCurrentView('progress');
            }} />
          ) : currentView === 'record' ? (
            <RecordView onJobStopped={handleJobStopped} />
          ) : currentView === 'history' ? (
            <HistoryView onOpenJob={handleOpenJob} />
          ) : (
            <>
              <h2 style={{ marginTop: 0 }}>{currentView.charAt(0).toUpperCase() + currentView.slice(1)}</h2>
              <p style={{ color: '#585b70' }}>
                Phase 1 scaffold — content coming in phases 2–9.
              </p>
            </>
          )}
        </main>
      </div>
    </ErrorBoundary>
  );
}
