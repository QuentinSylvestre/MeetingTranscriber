import { ipcMain } from 'electron';
import * as jobs from '../db/jobs';
import * as transcript from '../db/transcript';
import type { JobStatus } from '../../shared/ipc-types';

export function registerDbHandlers(): void {
  ipcMain.handle('db:create-job', (_event, { job }) => {
    jobs.createJob(job);
  });

  ipcMain.handle('db:update-job-status', (_event, { id, status, error_msg, duration_s }: { id: string; status: JobStatus; error_msg?: string; duration_s?: number }) => {
    jobs.updateJobStatus(id, status, error_msg ?? null, duration_s);
  });

  ipcMain.handle('db:get-job', (_event, { id }: { id: string }) => {
    return jobs.getJob(id);
  });

  ipcMain.handle('db:list-jobs', () => {
    return jobs.listJobs();
  });

  ipcMain.handle('db:delete-job', (_event, { id }: { id: string }) => {
    const job = jobs.getJob(id);
    if (job && (job.status === 'uploading' || job.status === 'transcribing')) {
      throw new Error('Cannot delete an active job');
    }
    jobs.deleteJob(id);
  });

  ipcMain.handle('db:update-job-title', (_event, { id, title }: { id: string; title: string }) => {
    jobs.updateJobTitle(id, title);
  });

  ipcMain.handle('db:save-transcript', (_event, { turns }) => {
    transcript.saveTranscript(turns);
  });

  ipcMain.handle('db:get-transcript', (_event, { job_id }: { job_id: string }) => {
    return transcript.getTranscript(job_id);
  });

  ipcMain.handle('db:update-speaker-mapping', (_event, { job_id, chunk_index, speaker_label, display_name }) => {
    transcript.updateSpeakerMapping(job_id, chunk_index, speaker_label, display_name);
  });

  ipcMain.handle('db:get-speaker-mappings', (_event, { job_id }: { job_id: string }) => {
    return transcript.getSpeakerMappings(job_id);
  });
}
