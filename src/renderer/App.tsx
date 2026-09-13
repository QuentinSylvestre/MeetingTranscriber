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

  // Called by RecordView when a recording has been stopped, flushed, and a
  // transcription job has been queued. Navigate straight to progress.
  const handleJobStarted = (jobId: string, audioPath: string): void => {
    setActiveJobId(jobId);
    setActiveJobAudioPath(audioPath);
    setCurrentView('progress');
  };

  const handleOpenJob = (job: Job): void => {
    setActiveJobId(job.id);
    setActiveJobAudioPath(job.audio_path);
    setCurrentView('transcript');
  };

  return (
    <ErrorBoundary>
      <div style={{ display: 'flex', height: '100vh' }}>
        <Sidebar
          currentView={currentView}
          onNavigate={setCurrentView}
          isJobActive={!!activeJobId}
        />
        <main className="main-content">
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
    </ErrorBoundary>
  );
}
