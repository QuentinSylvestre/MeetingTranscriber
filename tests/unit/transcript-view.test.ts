import { describe, it, expect } from 'vitest';
import { formatLine } from '../../src/main/ipc/format-line';

// Test the formatTime helper from export.ts inline (pure function, no side-effects).
function formatTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `[${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}]`;
}

describe('transcript export format', () => {
  it('formats 0ms as [00:00:00]', () => {
    expect(formatTime(0)).toBe('[00:00:00]');
  });

  it('formats 65000ms as [00:01:05]', () => {
    expect(formatTime(65000)).toBe('[00:01:05]');
  });

  it('formats 3661000ms as [01:01:01]', () => {
    expect(formatTime(3661000)).toBe('[01:01:01]');
  });

  it('formats sub-second ms correctly (floors to seconds)', () => {
    expect(formatTime(999)).toBe('[00:00:00]');
    expect(formatTime(1999)).toBe('[00:00:01]');
  });

  it('pads single-digit hours and minutes', () => {
    // 1h 2m 3s = 3600000 + 120000 + 3000 = 3723000ms
    expect(formatTime(3723000)).toBe('[01:02:03]');
  });

  it('handles large durations correctly', () => {
    // 10h 30m 45s
    const ms = (10 * 3600 + 30 * 60 + 45) * 1000;
    expect(formatTime(ms)).toBe('[10:30:45]');
  });
});

describe('app:// URL construction', () => {
  it('converts Windows backslash path to app:// URL', () => {
    const audioPath = 'C:\\Users\\test\\Documents\\MeetingTranscriber\\recording.mp3';
    const audioUrl = `app://${audioPath.replace(/\\/g, '/')}`;
    expect(audioUrl).toBe('app://C:/Users/test/Documents/MeetingTranscriber/recording.mp3');
  });

  it('preserves forward-slash paths unchanged', () => {
    const audioPath = 'C:/Users/test/Documents/recording.mp3';
    const audioUrl = `app://${audioPath.replace(/\\/g, '/')}`;
    expect(audioUrl).toBe('app://C:/Users/test/Documents/recording.mp3');
  });

  it('handles paths with spaces', () => {
    const audioPath = 'C:\\Users\\test\\My Documents\\recording.mp3';
    const audioUrl = `app://${audioPath.replace(/\\/g, '/')}`;
    expect(audioUrl).toBe('app://C:/Users/test/My Documents/recording.mp3');
  });
});

describe('transcript text formatting', () => {
  it('formats a turn with timestamp when includeTimestamps is true', () => {
    expect(formatLine('Alice', 65000, 'Hello world', true)).toBe('[00:01:05] Alice: Hello world');
  });
  it('formats a turn without timestamp when includeTimestamps is false', () => {
    expect(formatLine('Alice', 65000, 'Hello world', false)).toBe('Alice: Hello world');
  });
});
