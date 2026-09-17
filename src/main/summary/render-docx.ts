import {
  AlignmentType, BorderStyle, Document, Footer, HeadingLevel, Packer, PageNumber,
  Paragraph, ShadingType, Table, TableCell, TableLayoutType, TableRow, TextRun, WidthType,
} from 'docx';
import type { MeetingSummary, SummaryTopic } from './schema';

const PAGE_WIDTH = 12240;
const CONTENT_WIDTH = PAGE_WIDTH - 1077 * 2;
const FONT = 'Liberation Sans';

const DECISION_LABELS: Record<NonNullable<SummaryTopic['decision']>['type'], string> = {
  formal_vote: 'Vote formel',
  formal_decision: 'Décision explicite',
  operational_decision: 'Décision opérationnelle',
  agreement_in_principle: 'Accord de principe',
  apparent_agreement: 'Accord apparent — à confirmer',
  proposal: 'Proposition — adoption non établie',
};
const ACTION_LABELS: Record<SummaryTopic['actions'][number]['type'], string> = {
  explicit_commitment: 'Engagement explicite',
  proposed: 'Action proposée',
  conditional: 'Action conditionnelle',
};

/**
 * The Markdown the model may use inside a prose field: `**bold**` spans, and lines
 * opening with `- ` for list items, indented two spaces per nesting level. Deliberately
 * small — the renderer owns headings, tables and the document hierarchy, so the model
 * only ever describes emphasis and enumeration. Anything else stays literal text.
 */
const BOLD_SPAN = /\*\*(.+?)\*\*/g;
const LIST_ITEM = /^(\s*)[-–—•*]\s+(.+)$/;
const MAX_LIST_LEVEL = 2;

/** Split one line into runs, turning `**…**` into bold and leaving the rest literal. */
function runs(text: string, bold = false): TextRun[] {
  const parts: TextRun[] = [];
  let at = 0;
  for (const match of text.matchAll(BOLD_SPAN)) {
    if (match.index > at) parts.push(new TextRun({ text: text.slice(at, match.index), bold }));
    parts.push(new TextRun({ text: match[1], bold: true }));
    at = match.index + match[0].length;
  }
  if (at < text.length) parts.push(new TextRun({ text: text.slice(at), bold }));
  return parts.length ? parts : [new TextRun({ text, bold })];
}

function paragraph(text: string, bold = false): Paragraph {
  return new Paragraph({ children: runs(text, bold) });
}

/** Body text, one paragraph per line, with list lines rendered as real bullets. */
function prose(text: string): Paragraph[] {
  return text.split(/\r?\n/).filter(line => line.trim()).map(line => {
    const item = LIST_ITEM.exec(line);
    if (!item) return paragraph(line);
    const level = Math.min(Math.floor(item[1].replace(/\t/g, '  ').length / 2), MAX_LIST_LEVEL);
    return new Paragraph({ children: runs(item[2].trim()), bullet: { level } });
  });
}

function heading(text: string, level: 1 | 2 | 3): Paragraph {
  return new Paragraph({
    text,
    heading: level === 1 ? HeadingLevel.HEADING_1 : level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3,
  });
}

function labeledText(label: string, text: string, keepNext = false): Paragraph {
  return new Paragraph({ keepNext, children: [
    new TextRun({ text: `${label} : `, bold: true }), ...runs(text),
  ] });
}

function table(rows: string[][], widths: number[], hasHeader: boolean): Table {
  return new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: widths,
    layout: TableLayoutType.FIXED,
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' },
      left: { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' },
      right: { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' },
      insideVertical: { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' },
    },
    rows: rows.map((row, rowIndex) => new TableRow({
      cantSplit: true,
      tableHeader: hasHeader && rowIndex === 0 ? true : undefined,
      children: row.map((text, columnIndex) => new TableCell({
        width: { size: widths[columnIndex], type: WidthType.DXA },
        margins: { top: 80, bottom: 80, left: 120, right: 120 },
        shading: rowIndex === 0 && hasHeader
          ? { type: ShadingType.CLEAR, fill: 'E8EEF4' } : undefined,
        children: [new Paragraph({
          spacing: { after: 0, line: 240 },
          // Recap cells carry model prose too, so emphasis is honoured rather than
          // printed as literal asterisks.
          children: runs(text, hasHeader ? rowIndex === 0 : columnIndex === 0),
        })],
      })),
    })),
  });
}

/**
 * Locate a validated evidence quote in the transcript and return the audio marker it
 * falls under. Evidence is already proven to be an exact substring, so this is
 * deterministic and needs no model input and no language-specific vocabulary.
 */
function evidenceStamp(transcript: string | undefined, evidence: string): string | null {
  if (!transcript) return null;
  const at = transcript.indexOf(evidence);
  if (at < 0) return null;
  const marks = [...transcript.slice(0, at + evidence.length).matchAll(/\[(\d{2}:[0-5]\d:[0-5]\d)\]/g)];
  return marks.length ? marks[marks.length - 1][1] : null;
}

function stampParagraph(range: string): Paragraph {
  return new Paragraph({ children: [new TextRun({
    text: `À vérifier dans l’enregistrement — ${range}`, italics: true, color: '52657A', size: 18,
  })] });
}

function renderTopic(topic: SummaryTopic, number: number, followUp: boolean, transcript?: string): Paragraph[] {
  const previous = topic.renderHint === 'previous_minutes_approval' ? topic.previousMinutes : null;
  const previousDate = previous?.date ?? '……………………';
  const title = previous
    ? `APPROBATION DU PROCÈS-VERBAL DE LA SÉANCE DU ${previousDate}` : topic.title;
  const output = [heading(`${number}. ${title}`, followUp ? 2 : 1)];
  const subsectionLevel = followUp ? 3 : 2;
  const section = (title: string, content: string | null) => {
    if (content) output.push(heading(title, subsectionLevel), ...prose(content));
  };
  const list = (title: string, values: string[]) => {
    if (!values.length) return;
    output.push(heading(title, subsectionLevel));
    output.push(...values.map(text => new Paragraph({ children: runs(text), bullet: { level: 0 } })));
  };

  // Section 1 only. The municipality's standing template always carries the unanimity
  // clause, so it is rendered by default; an explicitly quoted vote result replaces it.
  // When approval is not established the mention is flagged for the secretary instead
  // of being softened away. Every other topic keeps the strict no-invention rules.
  if (previous && previous.outcome !== 'rejected') {
    const result = topic.decision?.voteResult ?? 'à l’unanimité';
    output.push(
      paragraph('Vu le code général des collectivités territoriales, notamment les articles L.2121-19 et suivants,'),
      paragraph(`Considérant qu’il est nécessaire de faire approuver le procès-verbal de la séance du Conseil Municipal du ${previousDate},`),
      paragraph(`Après discussion et délibération, ${result}, les membres du Conseil Municipal approuvent le procès-verbal de la séance du Conseil Municipal du ${previousDate},`),
      paragraph('Fait et délibéré en mairie, les jour, mois et an que dessus,'),
      paragraph('Le Maire,'),
    );
    if (previous.outcome !== 'approved' || !topic.decision?.voteResult) {
      output.push(paragraph(`Le résultat du vote n’est pas retranscrit. Confirmer la mention « ${result} » avant signature.`));
      // Prefer the decision's own passage. When the model reported no decision at all
      // — which happens when it finds the exchange too ambiguous — fall back to a
      // verification note it attached here, so the prompt still points somewhere.
      const stamp = (topic.decision && evidenceStamp(transcript, topic.decision.evidence))
        ?? topic.verificationNotes.find(note => note.timestamp)?.timestamp?.start ?? null;
      if (stamp) output.push(stampParagraph(stamp));
    }
  } else if (previous) {
    output.push(paragraph('Le procès-verbal n’a pas été approuvé.'));
  }

  section('Contexte', topic.context);
  if (topic.discussion.length) {
    output.push(heading('Discussion', subsectionLevel));
    for (const discussion of topic.discussion) {
      if (discussion.title) output.push(followUp
        ? new Paragraph({ children: [new TextRun({ text: discussion.title, bold: true })], keepNext: true })
        : heading(discussion.title, 3));
      output.push(...prose(discussion.body));
    }
  }
  list('Objections / réserves', topic.objections);
  list('Alternatives évoquées', topic.alternatives);
  section('Conclusion', topic.conclusion);
  if (topic.decision) {
    output.push(heading(DECISION_LABELS[topic.decision.type], subsectionLevel));
    output.push(...prose(topic.decision.text));
    if (topic.decision.voteResult) output.push(labeledText('Résultat du vote', topic.decision.voteResult));
  }
  if (topic.actions.length) {
    output.push(heading('Actions', subsectionLevel));
    for (const action of topic.actions) {
      output.push(labeledText(ACTION_LABELS[action.type], action.text, true));
      output.push(labeledText('Responsable', action.responsible ?? 'Non précisé', true));
      // A condition is printed on its own line so the wording stays grammatical
      // whatever clause the model produced, and never reads as an agreed date.
      if (action.condition) output.push(labeledText('Condition', action.condition, true));
      output.push(labeledText('Échéance', action.deadline ?? 'Non précisée'));
    }
  }
  list('Points ouverts', topic.openPoints);
  if (topic.verificationNotes.length) {
    output.push(heading('Point à vérifier', subsectionLevel));
    for (const note of topic.verificationNotes) {
      output.push(...prose(note.text));
      if (note.timestamp) {
        output.push(stampParagraph(note.timestamp.end
          ? `${note.timestamp.start}–${note.timestamp.end}` : note.timestamp.start));
      }
    }
  }
  return output;
}

/** Formats only validated topic data; recap rows are derived from that same data. */
export async function renderSummaryDocx(summary: MeetingSummary, transcript?: string): Promise<Buffer> {
  const info = summary.meetingInfo;
  const children: (Paragraph | Table)[] = [
    new Paragraph({ text: 'Conseil municipal — Compte rendu synthétique', heading: HeadingLevel.TITLE }),
    heading('Informations sur la réunion', 1),
    table([
      ['Date', info.date ?? ''], ['Heure de début', info.startTime ?? ''],
      ['Heure de fin', info.endTime ?? ''], ['Secrétaire de séance', info.secretary ?? ''],
      ['Présents', info.present.join(', ')], ['Absents / excusés', info.absentOrExcused.join(', ')],
    ], [2600, CONTENT_WIDTH - 2600], false),
    paragraph(''),
  ];
  const agenda = summary.topics.filter(topic => topic.category === 'agenda_item');
  const followUps = summary.topics.filter(topic => topic.category !== 'agenda_item');
  let number = 0;
  for (const topic of agenda) children.push(...renderTopic(topic, ++number, false, transcript));
  if (followUps.length) {
    children.push(heading('Questions diverses / suivi de dossiers', 1));
    for (const topic of followUps) children.push(...renderTopic(topic, ++number, true, transcript));
  }

  const orderedTopics = [...agenda, ...followUps];
  // A topic can settle a direction without producing anything the model will call a
  // decision — a file sent on for an external opinion, say. Falling back to the
  // conclusion keeps it in the recap: omitting the row reads as "nothing was decided",
  // when the truth is "a direction was set, but not a deliberation".
  const decisions = orderedTopics.flatMap(topic => {
    if (topic.decision) return [[
      topic.title,
      topic.decision.text + (topic.decision.voteResult ? ` Résultat du vote : ${topic.decision.voteResult}` : ''),
      DECISION_LABELS[topic.decision.type],
    ]];
    // Formal agenda business only. Models write a conclusion for almost every topic,
    // so falling back for follow-ups too would turn a decisions recap into a list of
    // every subject discussed; those are already covered by their own sections and by
    // the action recap.
    return topic.category === 'agenda_item' && topic.conclusion
      ? [[topic.title, topic.conclusion, 'Pas de décision formelle']] : [];
  });
  if (decisions.length) children.push(
    heading('Récapitulatif des décisions / accords', 1),
    table([['Sujet', 'Décision ou orientation', 'Certitude'], ...decisions], [2500, 5486, 2100], true),
    paragraph(''),
  );
  // The recap has no Condition column, so a conditional step shows its condition in
  // the Échéance cell rather than disappearing into an unqualified "Non précisée".
  const due = (action: SummaryTopic['actions'][number]) => action.deadline
    ?? (action.condition ? `Sous condition : ${action.condition}` : 'Non précisée');
  const actions = orderedTopics.flatMap(topic => topic.actions.map(action => [
    `${ACTION_LABELS[action.type]} : ${action.text}`, action.responsible ?? 'Non précisé', due(action),
  ]));
  if (actions.length) children.push(
    heading('Récapitulatif des actions', 1),
    table([['Action', 'Responsable', 'Échéance'], ...actions], [5486, 2600, 2000], true),
    paragraph(''),
  );

  const document = new Document({
    creator: 'Meeting Transcriber', title: 'Conseil municipal — Compte rendu synthétique',
    styles: { default: {
      document: { run: { font: FONT, size: 20 }, paragraph: { spacing: { after: 100, line: 259 } } },
      title: { run: { font: FONT, size: 40, bold: true, color: '1F2937' }, paragraph: { spacing: { after: 300 }, keepNext: true } },
      heading1: { run: { font: FONT, size: 29, bold: true, color: '1F4E79' }, paragraph: { spacing: { before: 240, after: 100 }, keepNext: true, keepLines: true } },
      heading2: { run: { font: FONT, size: 23, bold: true, color: '345B78' }, paragraph: { spacing: { before: 160, after: 60 }, keepNext: true, keepLines: true } },
      heading3: { run: { font: FONT, size: 21, bold: true, color: '4B5563' }, paragraph: { spacing: { before: 120, after: 40 }, keepNext: true, keepLines: true } },
    } },
    sections: [{
      properties: { page: {
        size: { width: PAGE_WIDTH, height: 15840 },
        margin: { top: 964, right: 1077, bottom: 907, left: 1077, header: 720, footer: 720 },
      } },
      footers: { default: new Footer({ children: [new Paragraph({
        alignment: AlignmentType.RIGHT,
        children: [new TextRun({ children: ['Page ', PageNumber.CURRENT, ' / ', PageNumber.TOTAL_PAGES], size: 18, color: '64748B' })],
      })] }) },
      children,
    }],
  });
  return Packer.toBuffer(document);
}
