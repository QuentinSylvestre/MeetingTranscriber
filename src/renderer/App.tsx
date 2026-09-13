import React, { useState } from 'react';
import SettingsView from './views/SettingsView';
import RecordView from './views/RecordView';
import UploadView from './views/UploadView';
import JobProgressView from './views/JobProgressView';
import TranscriptView from './views/TranscriptView';

type View = 'record' | 'upload' | 'progress' | 'transcript' | 'history' | 'settings';

const NAV_ITEMS: { id: View; label: string }[] = [
  { id: 'record', label: 'Record' },
  { id: 'upload', label: 'Upload' },
  { id: 'history', label: 'History' },
  { id: 'settings', label: 'Settings' },
];

export default function App(): React.ReactElement {
  const [currentView, setCurrentView] = useState<View>('record');
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [activeJobAudioPath, setActiveJobAudioPath] = useState<string | null>(null);

  // Called by RecordView when recording has been stopped and MP3 flushed to disk.
  // Phase 9 will update RecordView to pass audioPath via onJobStarted; for now
  // onJobStopped gives us the jobId only. Audio path is stored separately when
  // recording starts (see handleStart in RecordView).
  const handleJobStopped = (jobId: string): void => {
    setActiveJobId(jobId);
    // Phase 9 will navigate to progress view and supply the real audio path.
  };

  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: 'sans-serif' }}>
      {/* Sidebar */}
      <nav style={{
        width: 180,
        background: '#1e1e2e',
        color: '#cdd6f4',
        display: 'flex',
        flexDirection: 'column',
        padding: '16px 0',
        gap: 4,
      }}>
        <div style={{ padding: '0 16px 16px', fontWeight: 'bold', fontSize: 14 }}>
          Meeting Transcriber
        </div>
        {NAV_ITEMS.map(item => (
          <button
            key={item.id}
            onClick={() => setCurrentView(item.id)}
            style={{
              background: currentView === item.id ? '#313244' : 'transparent',
              border: 'none',
              color: '#cdd6f4',
              textAlign: 'left',
              padding: '10px 16px',
              cursor: 'pointer',
              fontSize: 14,
            }}
          >
            {item.label}
            {activeJobId && item.id === currentView && (
              <span style={{ marginLeft: 8, fontSize: 10 }}>⏳</span>
            )}
          </button>
        ))}
      </nav>
      {/* Main content */}
      <main style={{ flex: 1, padding: 24, background: '#1e1e2e', color: '#cdd6f4' }}>
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
  );
}
