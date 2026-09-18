import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { renderTranscriptDocx, transcriptLines } from '../../../src/main/export/transcript-docx';
import type { SpeakerMapping, TranscriptTurn } from '../../../src/shared/ipc-types';

function turn(overrides: Partial<TranscriptTurn> = {}): TranscriptTurn {
  return {
    id: 't1', job_id: 'job1', chunk_index: 0, speaker_label: 'spk_0',
    start_ms: 0, end_ms: 1000, text: 'Hello', original_text: 'Hello',
    ...overrides,
  };
}

function xmlText(xml: string): string[] {
  return [...xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map(match => match[1]
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, '&'));
}

async function render(turns: TranscriptTurn[], mappings: SpeakerMapping[], includeTimestamps: boolean) {
  const buffer = await renderTranscriptDocx(turns, mappings, includeTimestamps);
  const zip = await JSZip.loadAsync(buffer);
  const file = zip.file('word/document.xml');
  expect(file).not.toBeNull();
  const document = await file!.async('string');
  return { document, text: xmlText(document) };
}

const turns: TranscriptTurn[] = [
  turn({ id: 't1', chunk_index: 0, speaker_label: 'spk_0', start_ms: 0, text: 'Bonjour tout le monde' }),
  turn({ id: 't2', chunk_index: 0, speaker_label: 'spk_1', start_ms: 65000, text: 'Salut' }),
];
const mappings: SpeakerMapping[] = [
  { job_id: 'job1', chunk_index: 0, speaker_label: 'spk_0', display_name: 'Alice' },
  { job_id: 'job1', chunk_index: 0, speaker_label: 'spk_1', display_name: '' }, // falls back to raw label
];

describe('transcript docx export', () => {
  it('produces a well-formed docx with word/document.xml and one paragraph per line plus the heading', async () => {
    const { document } = await render(turns, mappings, true);
    // Structural well-formedness: a valid XML prolog, a properly closed root element,
    // and matching open/close paragraph tag counts (no built-in XML parser in Node,
    // so this is the structural proxy called for by the plan's verification note).
    expect(document.startsWith('<?xml')).toBe(true);
    expect(document).toContain('</w:document>');
    const openParagraphs = [...document.matchAll(/<w:p(?:\s[^>]*)?>/g)].length;
    const closeParagraphs = [...document.matchAll(/<\/w:p>/g)].length;
    expect(openParagraphs).toBe(closeParagraphs);
    // One paragraph per transcript line, plus one for the title heading.
    expect(openParagraphs).toBe(turns.length + 1);
  });

  it('matches the plain-text export content exactly, with timestamps enabled', async () => {
    const lines = transcriptLines(turns, mappings, true);
    expect(lines).toEqual([
      '[00:00:00] Alice: Bonjour tout le monde',
      '[00:01:05] spk_1: Salut',
    ]);
    const { text } = await render(turns, mappings, true);
    expect(text).toEqual(['Transcript', ...lines]);
  });

  it('omits timestamps when includeTimestamps is false', async () => {
    const lines = transcriptLines(turns, mappings, false);
    expect(lines).toEqual([
      'Alice: Bonjour tout le monde',
      'spk_1: Salut',
    ]);
    const { text } = await render(turns, mappings, false);
    expect(text).toEqual(['Transcript', ...lines]);
  });

  it('renders a heading-only document for zero turns', async () => {
    const { text } = await render([], [], true);
    expect(text).toEqual(['Transcript']);
  });
});
