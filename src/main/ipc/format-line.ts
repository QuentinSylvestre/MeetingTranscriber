/** Format a duration in milliseconds as [HH:MM:SS] */
export function formatTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `[${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}]`;
}

/** Pure helper — exported for testing. */
export function formatLine(name: string, startMs: number, text: string, includeTimestamps: boolean): string {
  return includeTimestamps ? `${formatTime(startMs)} ${name}: ${text}` : `${name}: ${text}`;
}
