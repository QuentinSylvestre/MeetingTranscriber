import { z } from 'zod';

const text = z.string().trim().min(1);
const optionalText = text.nullable();
const timestamp = z.string().regex(/^\d{2}:[0-5]\d:[0-5]\d$/);

// Required nullable fields keep the local validator and native structured output
// contract identical. Evidence is checked locally and is not printed in the DOCX.
export const summarySchema = z.strictObject({
  meetingInfo: z.strictObject({
    // Every stated value carries its own quote: the information block is the part of
    // the document that reads as established fact, so it needs the same proof as a
    // decision. Attendee names are checked against the transcript directly.
    date: optionalText, dateEvidence: optionalText,
    startTime: optionalText, startTimeEvidence: optionalText,
    endTime: optionalText, endTimeEvidence: optionalText,
    secretary: optionalText, secretaryEvidence: optionalText,
    present: z.array(text), absentOrExcused: z.array(text),
  }),
  topics: z.array(z.strictObject({
    title: text,
    category: z.enum(['agenda_item', 'follow_up', 'miscellaneous']),
    renderHint: z.enum(['standard', 'previous_minutes_approval']),
    previousMinutes: z.strictObject({
      date: optionalText,
      outcome: z.enum(['approved', 'rejected', 'unclear']),
    }).nullable(),
    context: optionalText,
    discussion: z.array(z.strictObject({ title: optionalText, body: text })),
    objections: z.array(text), alternatives: z.array(text), conclusion: optionalText,
    decision: z.strictObject({
      type: z.enum(['formal_vote', 'formal_decision', 'operational_decision',
        'agreement_in_principle', 'apparent_agreement', 'proposal']),
      text, evidence: text,
      voteResult: optionalText, voteEvidence: optionalText,
    }).nullable(),
    actions: z.array(z.strictObject({
      type: z.enum(['explicit_commitment', 'proposed', 'conditional']),
      text, evidence: text,
      responsible: optionalText, responsibleEvidence: optionalText,
      // A condition gates an action; a deadline dates it. Keeping them apart stops a
      // conditional step from being reported as though it had an agreed date.
      condition: optionalText, conditionEvidence: optionalText,
      deadline: optionalText, deadlineEvidence: optionalText,
    })),
    openPoints: z.array(text),
    verificationNotes: z.array(z.strictObject({
      text,
      timestamp: z.strictObject({ start: timestamp, end: timestamp.nullable() }).nullable(),
    })),
  })).min(1),
});

export type MeetingSummary = z.infer<typeof summarySchema>;
export type SummaryTopic = MeetingSummary['topics'][number];
export const summaryJsonSchema = z.toJSONSchema(summarySchema);

export class SummaryValidationError extends Error {
  constructor() { super('invalid_summary'); }
}

/**
 * Fold the typographic variants a model reproduces inconsistently. Quotes are matched
 * by exact substring, so without this a single curly apostrophe in one of ~40 quotes
 * would discard an entire paid response.
 */
const normalize = (value: string) => value.normalize('NFC')
  .replace(/[‘’‛′]/g, "'")
  .replace(/[«»“”‟″]/g, '"')
  .replace(/[‐-―−]/g, '-')
  .replace(/…/g, '...')
  .replace(/\s+/g, ' ')
  .trim();

/**
 * Strip every claim the transcript does not support, rather than rejecting the whole
 * summary. Spec §6 says missing information stays missing: degrading expresses that at
 * runtime, and keeps a paid response usable when one quote is imperfect. Each removal
 * is reported through `onDegrade` so it can be logged. The model keeps ownership of how
 * certain a decision is; the checks here are structural and carry no vocabulary.
 */
export function validateSummary(
  value: unknown,
  transcript: string,
  durationMs?: number,
  onDegrade: (reason: string) => void = () => {},
): MeetingSummary {
  const result = summarySchema.safeParse(value);
  // A malformed shape cannot be rendered at all, so it stays the one hard failure.
  if (!result.success) throw new SummaryValidationError();
  const summary = result.data;
  const source = normalize(transcript);
  const supported = (quote: string | null) => quote !== null && source.includes(normalize(quote));
  const quotes = (evidence: string | null, claim: string) =>
    supported(evidence) && normalize(evidence!).includes(normalize(claim));
  /** Position of a quote within the normalized transcript, for proximity checks. */
  const span = (quote: string | null) => {
    if (quote === null) return null;
    const start = source.indexOf(normalize(quote));
    return start < 0 ? null : { start, end: start + normalize(quote).length };
  };
  // An owner, condition or deadline must be quoted from the part of the meeting where
  // the action was actually discussed. Without this a real name lifted from an
  // unrelated topic passes, because it is genuinely somewhere in the transcript.
  // One turn of slack keeps a legitimate neighbouring quote from being discarded.
  const NEARBY = 400;
  const near = (a: ReturnType<typeof span>, b: ReturnType<typeof span>) =>
    a !== null && b !== null && b.start - a.end <= NEARBY && a.start - b.end <= NEARBY;
  const times = [...transcript.matchAll(/\[(\d{2}:[0-5]\d:[0-5]\d)\]/g)].map(m => m[1]);
  const lastTime = times.sort().at(-1);
  const seconds = (time: string) => time.split(':').reduce((total, part) => total * 60 + Number(part), 0);
  const lastSecond = durationMs !== undefined && Number.isFinite(durationMs) && durationMs >= 0
    ? Math.floor(durationMs / 1000) : lastTime ? seconds(lastTime) : undefined;
  // The information block reads as established fact, so an unquoted value is blanked
  // rather than printed. Spec §12: when information is unavailable, leave it blank.
  const info = summary.meetingInfo;
  for (const field of ['date', 'startTime', 'endTime', 'secretary'] as const) {
    const evidenceField = `${field}Evidence` as const;
    if (info[field] !== null && !quotes(info[evidenceField], info[field]!)) {
      onDegrade(`meeting info: ${field} not supported by its quote, left blank`);
      info[field] = null;
    }
    if (info[field] === null) info[evidenceField] = null;
  }
  for (const list of ['present', 'absentOrExcused'] as const) {
    const kept = info[list].filter(name => supported(name));
    if (kept.length !== info[list].length) {
      onDegrade(`meeting info: ${info[list].length - kept.length} ${list} name(s) absent from the transcript, removed`);
      info[list] = kept;
    }
  }
  for (const topic of summary.topics) {
    const at = `topic "${topic.title}"`;
    if ((topic.renderHint === 'previous_minutes_approval') !== (topic.previousMinutes !== null)) {
      onDegrade(`${at}: inconsistent previous-minutes hint, rendered as a standard topic`);
      topic.renderHint = 'standard';
      topic.previousMinutes = null;
    }
    const decision = topic.decision;
    if (decision) {
      if (!supported(decision.evidence)) {
        onDegrade(`${at}: decision evidence absent from the transcript, decision dropped`);
        topic.decision = null;
      } else if (decision.voteResult !== null) {
        // The result needs a passage of its own. If either quote contains the other,
        // the "result" was carved out of the exchange that merely shows agreement,
        // which is how « On est d'accord ? / Oui. » becomes a recorded vote. Erring
        // toward under-claiming here is deliberate: the reader is pointed at the audio.
        const shown = normalize(decision.voteEvidence ?? '');
        const settled = normalize(decision.evidence);
        const reused = shown !== '' && (settled.includes(shown) || shown.includes(settled));
        if (decision.type !== 'formal_vote' || !quotes(decision.voteEvidence, decision.voteResult) || reused) {
          onDegrade(`${at}: vote result not independently quoted, result removed`);
          decision.voteResult = null;
          decision.voteEvidence = null;
          if (decision.type === 'formal_vote') decision.type = 'apparent_agreement';
        }
      } else if (decision.voteEvidence !== null) {
        decision.voteEvidence = null;
      }
    }
    if (topic.previousMinutes?.outcome === 'approved' && (!topic.decision
      || !['formal_vote', 'formal_decision'].includes(topic.decision.type))) {
      onDegrade(`${at}: previous-minutes approval not formally established, marked unclear`);
      topic.previousMinutes.outcome = 'unclear';
    }
    topic.actions = topic.actions.filter(action => {
      if (!supported(action.evidence)) {
        onDegrade(`${at}: action evidence absent from the transcript, action dropped`);
        return false;
      }
      const where = span(action.evidence);
      if (action.responsible !== null && (!quotes(action.responsibleEvidence, action.responsible)
        || !near(where, span(action.responsibleEvidence)))) {
        onDegrade(`${at}: owner not quoted from this action's own passage, left unspecified`);
        action.responsible = null;
      }
      if (action.condition !== null && (!quotes(action.conditionEvidence, action.condition)
        || !near(where, span(action.conditionEvidence)))) {
        onDegrade(`${at}: condition not quoted from this action's own passage, left unspecified`);
        action.condition = null;
      }
      if (action.deadline !== null && (!quotes(action.deadlineEvidence, action.deadline)
        || !near(where, span(action.deadlineEvidence)))) {
        onDegrade(`${at}: deadline not quoted from this action's own passage, left unspecified`);
        action.deadline = null;
      }
      if (action.responsible === null) action.responsibleEvidence = null;
      if (action.condition === null) action.conditionEvidence = null;
      if (action.deadline === null) action.deadlineEvidence = null;
      return true;
    });
    for (const note of topic.verificationNotes) {
      if (!note.timestamp) continue;
      const { start, end } = note.timestamp;
      if (lastSecond === undefined || seconds(start) > lastSecond
        || (end !== null && (seconds(end) < seconds(start) || seconds(end) > lastSecond))) {
        onDegrade(`${at}: verification timestamp outside the recording, timestamp removed`);
        note.timestamp = null;
      }
    }
  }
  return summary;
}
