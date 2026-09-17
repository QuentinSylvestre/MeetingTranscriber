import type { SpeakerMapping, TranscriptTurn } from '../../shared/ipc-types';
import { formatLine } from '../ipc/format-line';

/** Always timestamp the current text, independently of plain-text export settings. */
export function summaryTranscript(turns: TranscriptTurn[], mappings: SpeakerMapping[]): string {
  const names = new Map(mappings.map(m => [`${m.chunk_index}::${m.speaker_label}`, m.display_name]));
  return [...turns].sort((a, b) => a.start_ms - b.start_ms)
    .filter(turn => turn.text.trim())
    .map(turn => formatLine(names.get(`${turn.chunk_index}::${turn.speaker_label}`) || turn.speaker_label,
      turn.start_ms, turn.text, true)).join('\n');
}

export function summaryFilename(title: string): string {
  const stem = title.replace(/[\x00-\x1f<>:"/\\|?*]/g, '_').replace(/[.\s]+$/, '').trim().slice(0, 150) || 'conseil-municipal';
  // Prefixing also makes Windows device names such as CON safe.
  return `Compte rendu - ${stem}.docx`;
}
