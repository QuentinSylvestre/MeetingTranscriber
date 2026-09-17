import { describe, expect, it } from 'vitest';
import { summaryJsonSchema, validateSummary, type MeetingSummary } from '../../src/main/summary/schema';

const source = '[00:00:05] Alice: On est d’accord ?\n[00:00:09] Bob: Oui.\n' +
  '[00:00:12] Alice: Il faudrait appeler Enedis.\n' +
  '[00:00:20] Bob: Si le CDG valide, on représentera le dossier.\n' +
  '[00:00:30] Alice: Les tarifs sont à vérifier.';

export function exampleSummary(): MeetingSummary {
  return {
    meetingInfo: { date: null, dateEvidence: null, startTime: null, startTimeEvidence: null,
      endTime: null, endTimeEvidence: null, secretary: null, secretaryEvidence: null,
      present: [], absentOrExcused: [] },
    topics: [{ title: 'Projet', category: 'agenda_item', renderHint: 'standard', previousMinutes: null,
      context: null, discussion: [], objections: [], alternatives: [], conclusion: null,
      decision: { type: 'apparent_agreement', text: 'Un accord apparent se dégage.',
        evidence: 'On est d’accord ?\n[00:00:09] Bob: Oui.', voteResult: null, voteEvidence: null },
      actions: [{ type: 'proposed', text: 'Appeler Enedis.', evidence: 'Il faudrait appeler Enedis.',
        responsible: null, responsibleEvidence: null, condition: null, conditionEvidence: null,
        deadline: null, deadlineEvidence: null },
      { type: 'conditional', text: 'Représenter le dossier si le CDG valide.', evidence: 'Si le CDG valide, on représentera le dossier.',
        responsible: null, responsibleEvidence: null,
        condition: 'Si le CDG valide', conditionEvidence: 'Si le CDG valide, on représentera le dossier.',
        deadline: null, deadlineEvidence: null }],
      openPoints: [], verificationNotes: [{ text: 'Tarifs à vérifier.', timestamp: { start: '00:00:30', end: null } }],
    }],
  };
}

describe('municipal summary contract', () => {
  it('preserves uncertain decisions, proposed/conditional actions and absent fields', () => {
    expect(validateSummary(exampleSummary(), source)).toEqual(exampleSummary());
  });
  // Unsupported claims are stripped rather than discarding the whole summary. Spec §6
  // keeps missing information missing, and a single imperfect quote must not void a
  // paid response. Each test pins both the surviving data and the reported reason.
  const degrade = (mutate: (topic: MeetingSummary['topics'][number]) => void, durationMs?: number) => {
    const summary = exampleSummary();
    mutate(summary.topics[0]);
    const reasons: string[] = [];
    const topic = validateSummary(summary, source, durationMs, reason => reasons.push(reason)).topics[0];
    return { topic, reasons };
  };

  it('drops a decision whose evidence is absent from the transcript', () => {
    const { topic, reasons } = degrade(t => { t.decision!.evidence = 'Le conseil adopte la proposition.'; });
    expect(topic.decision).toBeNull();
    expect(topic.actions).toHaveLength(2); // the rest of the topic survives
    expect(reasons).toEqual([expect.stringContaining('decision dropped')]);
  });

  it('drops an action whose evidence is absent, keeping the supported one', () => {
    const { topic, reasons } = degrade(t => { t.actions[0].evidence = 'Je vais appeler Enedis.'; });
    expect(topic.actions.map(action => action.text)).toEqual(['Représenter le dossier si le CDG valide.']);
    expect(reasons).toEqual([expect.stringContaining('action dropped')]);
  });

  it('leaves an unsupported owner unspecified without losing the action', () => {
    const { topic, reasons } = degrade(t => {
      t.actions[0].responsible = 'Le maire';
      t.actions[0].responsibleEvidence = 'Il faudrait appeler Enedis.';
    });
    expect(topic.actions).toHaveLength(2);
    expect(topic.actions[0].responsible).toBeNull();
    expect(topic.actions[0].responsibleEvidence).toBeNull();
    expect(reasons).toEqual([expect.stringContaining('owner not quoted')]);
  });

  it('leaves an unsupported deadline unspecified without losing the action', () => {
    const { topic, reasons } = degrade(t => {
      t.actions[0].deadline = 'Demain';
      t.actions[0].deadlineEvidence = 'Il faudrait appeler Enedis.';
    });
    expect(topic.actions).toHaveLength(2);
    expect(topic.actions[0].deadline).toBeNull();
    expect(topic.actions[0].deadlineEvidence).toBeNull();
    expect(reasons).toEqual([expect.stringContaining('deadline not quoted')]);
  });

  it.each([
    ['reusing the whole decision passage', (t: MeetingSummary['topics'][number]) => {
      t.decision!.voteResult = 'à l’unanimité';
      t.decision!.voteEvidence = t.decision!.evidence;
    }],
    ['carving the result out of that same passage', (t: MeetingSummary['topics'][number]) => {
      t.decision!.voteResult = 'Oui.';
      t.decision!.voteEvidence = 'Oui.';
    }],
  ])('refuses to build a formal vote by %s', (_case, mutate) => {
    const { topic, reasons } = degrade(t => { t.decision!.type = 'formal_vote'; mutate(t); });
    expect(topic.decision!.voteResult).toBeNull();
    expect(topic.decision!.voteEvidence).toBeNull();
    expect(topic.decision!.type).toBe('apparent_agreement');
    expect(reasons).toEqual([expect.stringContaining('vote result not independently quoted')]);
  });

  it('marks an affirmative minutes outcome unclear when only an apparent agreement backs it', () => {
    const { topic, reasons } = degrade(t => {
      t.renderHint = 'previous_minutes_approval';
      t.previousMinutes = { date: null, outcome: 'approved' };
    });
    expect(topic.previousMinutes!.outcome).toBe('unclear');
    expect(reasons).toEqual([expect.stringContaining('marked unclear')]);
  });

  it.each([{ start: '00:01:00', end: null }, { start: '00:00:20', end: '00:00:10' }])(
    'removes an out-of-range verification timestamp %o but keeps the note', range => {
      const { topic, reasons } = degrade(t => { t.verificationNotes[0].timestamp = range; });
      expect(topic.verificationNotes[0].timestamp).toBeNull();
      expect(topic.verificationNotes[0].text).toBe('Tarifs à vérifier.');
      expect(reasons).toEqual([expect.stringContaining('timestamp outside the recording')]);
    });

  // A malformed shape cannot be rendered at all, so it stays the one hard failure.
  it('rejects extra keys, missing keys, empty output and malformed times instead of coercing', () => {
    expect(() => validateSummary({ ...exampleSummary(), recaps: [] }, source)).toThrow('invalid_summary');
    expect(() => validateSummary({ topics: [] }, source)).toThrow('invalid_summary');
    const badTime = exampleSummary();
    badTime.topics[0].verificationNotes[0].timestamp = { start: '00:00:10', end: '00:70:00' };
    expect(() => validateSummary(badTime, source)).toThrow('invalid_summary');
    expect(summaryJsonSchema.additionalProperties).toBe(false);
  });

  it('accepts verification inside the final turn, bounded by its actual end', () => {
    const summary = exampleSummary();
    summary.topics[0].verificationNotes[0].timestamp = { start: '00:00:35', end: '00:00:45' };
    expect(validateSummary(summary, source, 45_000)).toEqual(summary);
    // One second short and the range falls outside the recording, so it is removed.
    const reasons: string[] = [];
    const topic = validateSummary(summary, source, 44_000, reason => reasons.push(reason)).topics[0];
    expect(topic.verificationNotes[0].timestamp).toBeNull();
    expect(reasons).toEqual([expect.stringContaining('outside the recording')]);
  });
});
