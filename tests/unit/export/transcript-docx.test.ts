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

async function render(title: string, turns: TranscriptTurn[], mappings: SpeakerMapping[], includeTimestamps: boolean) {
  const buffer = await renderTranscriptDocx(title, turns, mappings, includeTimestamps);
  const zip = await JSZip.loadAsync(buffer);
  const file = zip.file('word/document.xml');
  expect(file).not.toBeNull();
  const document = await file!.async('string');
  return { document, text: xmlText(document) };
}

const TITLE = 'Réunion du conseil du 12 mars';

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
    const { document } = await render(TITLE, turns, mappings, true);
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
    const { text } = await render(TITLE, turns, mappings, true);
    expect(text).toEqual([TITLE, ...lines]);
  });

  it('omits timestamps when includeTimestamps is false', async () => {
    const lines = transcriptLines(turns, mappings, false);
    expect(lines).toEqual([
      'Alice: Bonjour tout le monde',
      'spk_1: Salut',
    ]);
    const { text } = await render(TITLE, turns, mappings, false);
    expect(text).toEqual([TITLE, ...lines]);
  });

  it('renders a heading-only document for zero turns', async () => {
    const { text } = await render(TITLE, [], [], true);
    expect(text).toEqual([TITLE]);
  });

  it('uses the job title as the heading text, not a hardcoded literal', async () => {
    const customTitle = 'Conseil municipal du 3 février';
    const { text } = await render(customTitle, turns, mappings, false);
    expect(text[0]).toBe(customTitle);
    expect(text[0]).not.toBe('Transcript');
  });

  it('preserves accented French characters and apostrophes', async () => {
    const accentedTurns: TranscriptTurn[] = [
      turn({ id: 't1', chunk_index: 0, speaker_label: 'spk_0', start_ms: 0, text: "L'échevin a présenté l'école élémentaire" }),
    ];
    const accentedMappings: SpeakerMapping[] = [
      { job_id: 'job1', chunk_index: 0, speaker_label: 'spk_0', display_name: 'Éléonore Bénédict' },
    ];
    const { text } = await render(TITLE, accentedTurns, accentedMappings, false);
    expect(text).toEqual([TITLE, "Éléonore Bénédict: L'échevin a présenté l'école élémentaire"]);
  });

  it('resolves the same speaker_label to different display names across chunks', () => {
    const crossChunkTurns: TranscriptTurn[] = [
      turn({ id: 't1', chunk_index: 0, speaker_label: 'A', start_ms: 0, text: 'First chunk line' }),
      turn({ id: 't2', chunk_index: 1, speaker_label: 'A', start_ms: 0, text: 'Second chunk line' }),
    ];
    const crossChunkMappings: SpeakerMapping[] = [
      { job_id: 'job1', chunk_index: 0, speaker_label: 'A', display_name: 'Alice' },
      { job_id: 'job1', chunk_index: 1, speaker_label: 'A', display_name: 'Bob' },
    ];
    const lines = transcriptLines(crossChunkTurns, crossChunkMappings, false);
    expect(lines).toEqual([
      'Alice: First chunk line',
      'Bob: Second chunk line',
    ]);
  });

  it('escapes XML-special characters in turn text and speaker names', async () => {
    const specialTurns: TranscriptTurn[] = [
      turn({ id: 't1', chunk_index: 0, speaker_label: 'spk_0', start_ms: 0, text: 'Budget & <report> "final" review' }),
    ];
    const specialMappings: SpeakerMapping[] = [
      { job_id: 'job1', chunk_index: 0, speaker_label: 'spk_0', display_name: "O'Brien & Co." },
    ];
    const { document, text } = await render(TITLE, specialTurns, specialMappings, false);
    // Assert against the raw XML too: xmlText() decodes entities, so on its own it
    // would pass even if the ampersand/angle-brackets were written unescaped.
    expect(document).toContain('&amp;');
    expect(document).toContain('&lt;report&gt;');
    expect(document).not.toContain('<report>');
    expect(text).toEqual([TITLE, 'O\'Brien & Co.: Budget & <report> "final" review']);
  });
});
