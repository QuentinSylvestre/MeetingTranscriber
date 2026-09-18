import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';
import type { SpeakerMapping, TranscriptTurn } from '../../shared/ipc-types';
import { formatLine } from '../ipc/format-line';

/**
 * Resolves each turn's display name and formats one line per turn, in transcript
 * order. Shared by the plain-text clipboard export and the .docx file export so
 * both always describe exactly the same content.
 */
export function transcriptLines(turns: TranscriptTurn[], mappings: SpeakerMapping[], includeTimestamps: boolean): string[] {
  const nameMap = new Map<string, string>();
  for (const m of mappings) {
    nameMap.set(`${m.chunk_index}::${m.speaker_label}`, m.display_name || m.speaker_label);
  }
  return turns.map(t => {
    const name = nameMap.get(`${t.chunk_index}::${t.speaker_label}`) || t.speaker_label;
    return formatLine(name, t.start_ms, t.text, includeTimestamps);
  });
}

/**
 * Renders the transcript as a plain .docx: a single title heading (the job's own
 * title) followed by one unstyled paragraph per line (no bold, no bullets, no
 * tables), matching the content the old .txt export produced.
 */
export async function renderTranscriptDocx(title: string, turns: TranscriptTurn[], mappings: SpeakerMapping[], includeTimestamps: boolean): Promise<Buffer> {
  const lines = transcriptLines(turns, mappings, includeTimestamps);
  const document = new Document({
    creator: 'Meeting Transcriber',
    title,
    sections: [{
      children: [
        new Paragraph({ text: title, heading: HeadingLevel.TITLE }),
        ...lines.map(line => new Paragraph({ children: [new TextRun({ text: line })] })),
      ],
    }],
  });
  return Packer.toBuffer(document);
}
