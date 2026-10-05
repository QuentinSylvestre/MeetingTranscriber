/**
 * messages.ts — user-facing text produced by the main process.
 *
 * The renderer has its own catalog (src/renderer/i18n.ts) and follows the `appLanguage`
 * preference. The main process puts text in front of the user too (native dialogs, the
 * title and message of a recovered recording in History, errors shown on the Record view)
 * and used to do so in English only, so a French user got a French app with English
 * dialogs. This catalog covers the text the recording and shutdown paths produce.
 *
 * Anything here may be shown to non-technical users: say what happened and what to do,
 * not how it works.
 */

import { getPreference } from './settings/store';

const en = {
  close_recording_message: 'Recording in progress',
  close_recording_detail:
    'Stop and save the recording, or discard it? A saved recording appears in History. ' +
    'A discarded recording is not added to History, but its audio file stays in the recordings folder.',
  close_recording_buttons: ['Stop & Save', 'Discard', 'Cancel'],
  close_transcription_message: 'Transcription in progress',
  close_transcription_detail: 'Cancel the transcription and quit, or wait for it to finish?',
  close_transcription_buttons: ['Cancel & Quit', 'Wait'],
  recovered_title: 'Recovered recording {{date}}',
  recovered_error:
    'This recording was interrupted before it could be transcribed. The audio was saved: ' +
    'use Transcribe (Upload) to transcribe it.',
  folder_unusable: 'The recordings folder cannot be used ({{dir}}): {{reason}}',
};

const fr: Record<keyof typeof en, string | string[]> = {
  close_recording_message: 'Enregistrement en cours',
  close_recording_detail:
    'Arrêter et sauvegarder l\'enregistrement, ou l\'abandonner ? Un enregistrement sauvegardé apparaît dans l\'historique. ' +
    'Un enregistrement abandonné n\'y est pas ajouté, mais son fichier audio reste dans le dossier des enregistrements.',
  close_recording_buttons: ['Arrêter et sauvegarder', 'Abandonner', 'Annuler'],
  close_transcription_message: 'Transcription en cours',
  close_transcription_detail: 'Annuler la transcription et quitter, ou attendre qu\'elle se termine ?',
  close_transcription_buttons: ['Annuler et quitter', 'Attendre'],
  recovered_title: 'Enregistrement récupéré {{date}}',
  recovered_error:
    'Cet enregistrement a été interrompu avant d\'avoir pu être transcrit. L\'audio a été sauvegardé : ' +
    'utilisez Transcrire pour le transcrire.',
  folder_unusable: 'Le dossier des enregistrements est inutilisable ({{dir}}) : {{reason}}',
};

export type MessageKey = keyof typeof en;

function catalog(): Record<MessageKey, string | string[]> {
  let lang: unknown;
  try { lang = getPreference('appLanguage'); } catch { /* preferences unreadable: fall back */ }
  return lang === 'fr' ? fr : en;
}

/** A text message with {{name}} placeholders filled from `vars`. */
export function msg(key: MessageKey, vars: Record<string, string> = {}): string {
  const value = catalog()[key];
  const text = Array.isArray(value) ? value.join(' ') : value;
  return text.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => vars[name] ?? '');
}

/** A list of button labels, in dialog order. */
export function msgList(key: MessageKey): string[] {
  const value = catalog()[key];
  return Array.isArray(value) ? [...value] : [value];
}
