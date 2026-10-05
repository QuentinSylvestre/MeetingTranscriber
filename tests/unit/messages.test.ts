/**
 * messages.test.ts — the main-process message catalog. The French app used to show English
 * dialogs because the main process had no catalog at all.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ lang: 'en' as unknown, throws: false }));
vi.mock('../../src/main/settings/store', () => ({
  getPreference: () => { if (h.throws) throw new Error('unreadable'); return h.lang; },
}));

import { msg, msgList } from '../../src/main/messages';

beforeEach(() => { h.lang = 'en'; h.throws = false; });

describe('main-process messages', () => {
  it('follows the appLanguage preference', () => {
    expect(msg('close_recording_message')).toBe('Recording in progress');
    h.lang = 'fr';
    expect(msg('close_recording_message')).toBe('Enregistrement en cours');
  });

  it('falls back to English for an unknown language or unreadable preferences', () => {
    h.lang = 'de';
    expect(msg('close_recording_message')).toBe('Recording in progress');
    h.throws = true;
    expect(msg('close_recording_message')).toBe('Recording in progress');
  });

  it('fills placeholders and leaves none behind', () => {
    expect(msg('folder_unusable', { dir: 'D:\\rec', reason: 'EACCES' })).toBe('The recordings folder cannot be used (D:\\rec): EACCES');
    h.lang = 'fr';
    expect(msg('folder_unusable', { dir: 'D:\\rec', reason: 'EACCES' })).toBe('Le dossier des enregistrements est inutilisable (D:\\rec) : EACCES');
    expect(msg('recovered_title')).not.toContain('{{');
  });

  it('gives the same number of dialog buttons in both languages', () => {
    for (const key of ['close_recording_buttons', 'close_transcription_buttons'] as const) {
      h.lang = 'en'; const en = msgList(key);
      h.lang = 'fr'; const fr = msgList(key);
      expect(fr.length).toBe(en.length);
      expect(fr.every(label => label.length > 0)).toBe(true);
    }
  });
});
