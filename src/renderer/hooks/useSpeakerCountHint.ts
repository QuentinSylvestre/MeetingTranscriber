import { useState } from 'react';
import type { SpeakerCountHint } from '../../shared/ipc-types';
import { useI18n } from './useI18n';

export type SpeakerCountMode = 'none' | 'exact' | 'range';

// Shared by RecordView and UploadView — same fields, same 1-20/min<=max validation rule.
export function useSpeakerCountHint() {
  const { t } = useI18n();
  const [speakerMode, setSpeakerModeState] = useState<SpeakerCountMode>('none');
  const [speakerExact, setSpeakerExact] = useState('');
  const [speakerMin, setSpeakerMin] = useState('');
  const [speakerMax, setSpeakerMax] = useState('');
  // Mirrors the error from the last buildSpeakerCountHint() call, so callers can
  // wire aria-invalid/aria-describedby on the offending input(s) without duplicating
  // the validation logic or a second error-display element.
  const [speakerError, setSpeakerError] = useState<string | null>(null);

  // Switching mode swaps which inputs are mounted — a previous mode's error
  // must not carry over onto the new mode's freshly-mounted, unvalidated inputs.
  function setSpeakerMode(mode: SpeakerCountMode): void {
    setSpeakerModeState(mode);
    setSpeakerError(null);
  }

  function buildSpeakerCountHint(): { hint: SpeakerCountHint | undefined; error: string | null } {
    const result = ((): { hint: SpeakerCountHint | undefined; error: string | null } => {
      if (speakerMode === 'none') return { hint: undefined, error: null };
      if (speakerMode === 'exact') {
        const count = Number(speakerExact);
        if (!Number.isInteger(count) || count < 1 || count > 20) {
          return { hint: undefined, error: t('speaker_count_error_exact') };
        }
        return { hint: { mode: 'exact', count }, error: null };
      }
      const min = Number(speakerMin);
      const max = Number(speakerMax);
      if (!Number.isInteger(min) || !Number.isInteger(max) || min < 1 || max > 20 || min > max) {
        return { hint: undefined, error: t('speaker_count_error_range') };
      }
      return { hint: { mode: 'range', min, max }, error: null };
    })();
    setSpeakerError(result.error);
    return result;
  }

  return {
    speakerMode, setSpeakerMode,
    speakerExact, setSpeakerExact,
    speakerMin, setSpeakerMin,
    speakerMax, setSpeakerMax,
    speakerError,
    buildSpeakerCountHint,
  };
}
