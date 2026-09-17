import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { renderSummaryDocx } from '../../src/main/summary/render-docx';
import type { MeetingSummary, SummaryTopic } from '../../src/main/summary/schema';

function topic(overrides: Partial<SummaryTopic> = {}): SummaryTopic {
  return {
    title: 'Dossier communal', category: 'agenda_item', renderHint: 'standard', previousMinutes: null,
    context: null, discussion: [], objections: [], alternatives: [], conclusion: null,
    decision: null, actions: [], openPoints: [], verificationNotes: [], ...overrides,
  };
}

function summary(topics: SummaryTopic[]): MeetingSummary {
  return {
    meetingInfo: { date: null, dateEvidence: null, startTime: null, startTimeEvidence: null,
      endTime: null, endTimeEvidence: null, secretary: null, secretaryEvidence: null,
      present: [], absentOrExcused: [] },
    topics,
  };
}

function xmlText(xml: string): string[] {
  return [...xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map(match => match[1]
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, '&'));
}

async function render(input: MeetingSummary) {
  const buffer = await renderSummaryDocx(input);
  const zip = await JSZip.loadAsync(buffer);
  const document = await zip.file('word/document.xml')!.async('string');
  const styles = await zip.file('word/styles.xml')!.async('string');
  const footer = await zip.file('word/footer1.xml')!.async('string');
  const tables = [...document.matchAll(/<w:tbl\b[^>]*>[\s\S]*?<\/w:tbl>/g)].map(match => match[0]);
  return { document, styles, footer, tables, text: xmlText(document).join('\n') };
}

describe('municipal summary DOCX', () => {
  it('renders exactly six metadata rows and leaves unavailable values blank', async () => {
    const input = summary([topic()]);
    input.meetingInfo.date = '21 mai 2026';
    input.meetingInfo.present = ['Alice', 'Bernard'];
    const result = await render(input);
    const rows = [...result.tables[0].matchAll(/<w:tr\b[^>]*>[\s\S]*?<\/w:tr>/g)].map(match => match[0]);
    expect(rows).toHaveLength(6);
    expect(rows.map(row => {
      const cells = [...row.matchAll(/<w:tc\b[^>]*>[\s\S]*?<\/w:tc>/g)];
      return cells.map(cell => xmlText(cell[0]).join(''));
    })).toEqual([
      ['Date', '21 mai 2026'], ['Heure de début', ''], ['Heure de fin', ''],
      ['Secrétaire de séance', ''], ['Présents', 'Alice, Bernard'], ['Absents / excusés', ''],
    ]);
    expect(result.tables).toHaveLength(1);
    expect(result.text).not.toMatch(/Commune|Lieu|Présidence|Non précisé/);
    expect(result.text).not.toMatch(/Contexte|Discussion|Objections|Alternatives|Conclusion|Point à vérifier|Points ouverts|Récapitulatif|Questions diverses/);
  });

  it('keeps reasoning and verification notes inline and groups the follow-up topics', async () => {
    const result = await render(summary([
      topic({ title: 'Suivi du bâtiment', category: 'follow_up', openPoints: ['Attendre le retour du notaire.'] }),
      topic({
        title: 'Cour de l’école', context: 'La cour doit être agrandie.',
        discussion: [{ title: 'Accès piéton', body: 'Un passage est envisagé.\nSon emplacement reste ouvert.' }],
        objections: ['Le passage pourrait être trop étroit.'], alternatives: ['Prévoir une entrée différente.'],
        conclusion: 'Les accès restent à étudier.',
        verificationNotes: [{ text: 'Deux montants contradictoires sont cités.', timestamp: { start: '00:11:14', end: '00:12:54' } }],
      }),
      topic({ title: 'Effectifs', category: 'miscellaneous', verificationNotes: [{ text: 'Le total est à vérifier.', timestamp: { start: '00:57:48', end: null } }] }),
    ]));
    for (const text of ['La cour doit être agrandie.', 'Accès piéton', 'Son emplacement reste ouvert.',
      'Le passage pourrait être trop étroit.', 'Prévoir une entrée différente.', 'Les accès restent à étudier.',
      'Deux montants contradictoires sont cités.', '00:11:14–00:12:54', 'Le total est à vérifier.', '00:57:48']) {
      expect(result.text).toContain(text);
    }
    expect(result.text.indexOf('1. Cour de l’école')).toBeLessThan(result.text.indexOf('Questions diverses / suivi de dossiers'));
    expect(result.text.indexOf('Questions diverses / suivi de dossiers')).toBeLessThan(result.text.indexOf('2. Suivi du bâtiment'));
    expect(result.text.indexOf('2. Suivi du bâtiment')).toBeLessThan(result.text.indexOf('3. Effectifs'));
    expect(result.text.match(/Questions diverses \/ suivi de dossiers/g)).toHaveLength(1);
    expect(result.text.indexOf('Deux montants contradictoires')).toBeLessThan(result.text.indexOf('2. Suivi du bâtiment'));
  });

  it('derives recap rows without turning proposals or conditional actions into commitments', async () => {
    const decisionText = 'Envisager une nouvelle convention.';
    const proposedText = 'Appeler le gestionnaire.';
    const conditionalText = 'Représenter le dossier si le CDG valide le projet.';
    const result = await render(summary([topic({
      decision: { type: 'proposal', text: decisionText, evidence: 'SOURCE_DECISION', voteResult: null, voteEvidence: null },
      actions: [
        { type: 'proposed', text: proposedText, evidence: 'SOURCE_ACTION', responsible: null, responsibleEvidence: null, condition: null, conditionEvidence: null, deadline: null, deadlineEvidence: null },
        { type: 'conditional', text: conditionalText, evidence: 'SOURCE_CONDITION', responsible: 'Alice', responsibleEvidence: 'SOURCE_OWNER', condition: 'si le CDG valide', conditionEvidence: 'SOURCE_CONDITION_GATE', deadline: null, deadlineEvidence: null },
      ],
    })]));
    expect(result.tables).toHaveLength(3);
    for (const text of [decisionText, proposedText, conditionalText, 'Proposition — adoption non établie', 'Action proposée', 'Action conditionnelle']) {
      expect(result.text.split(text)).toHaveLength(3);
    }
    expect(xmlText(result.tables[1])).toEqual(['Sujet', 'Décision ou orientation', 'Certitude', 'Dossier communal', decisionText, 'Proposition — adoption non établie']);
    // A condition gates the step rather than dating it, so it reaches the recap's
    // Échéance cell qualified, and never as a bare agreed date.
    expect(result.text).toContain('Condition : \nsi le CDG valide'); // bold label, then value
    expect(xmlText(result.tables[2])).toEqual([
      'Action', 'Responsable', 'Échéance', `Action proposée : ${proposedText}`, 'Non précisé', 'Non précisée',
      `Action conditionnelle : ${conditionalText}`, 'Alice', 'Sous condition : si le CDG valide',
    ]);
    expect(result.text).not.toMatch(/SOURCE_|unanimité|Résultat du vote|Engagement explicite/);
  });

  it('keeps a settled topic in the decisions recap when the model reports no decision', async () => {
    // Observed live on a staff-grading item with two different models: a direction was set
    // and stated in the conclusion, but neither returned a decision object.
    const result = await render(summary([
      topic({ title: 'Avancement de grade', decision: null,
        conclusion: 'Le projet part au CDG puis reviendra au conseil s’il est validé.' }),
      topic({ title: 'Sans suite', decision: null, conclusion: null }),
      // Follow-ups almost always carry a conclusion, so including them would turn the
      // decisions recap into a list of every subject discussed.
      topic({ title: 'Suivi de dossier', category: 'follow_up', decision: null,
        conclusion: 'Le dossier suit son cours chez le notaire.' }),
    ]));
    expect(xmlText(result.tables[1])).toEqual([
      'Sujet', 'Décision ou orientation', 'Certitude',
      'Avancement de grade', 'Le projet part au CDG puis reviendra au conseil s’il est validé.',
      'Pas de décision formelle',
    ]);
  });

  it('applies the bold span, nests list levels, and leaves other syntax literal', async () => {
    const result = await render(summary([topic({
      context: 'Le montant de **4 200 €** est évoqué.\n- premier niveau ;\n  - sous-niveau ;\n    - niveau plus profond.',
      objections: ['Réserve sur le **passage étroit**.'],
      conclusion: 'Aucune syntaxe supplémentaire : # pas un titre, | pas un tableau.',
    })]));
    const paragraphs = [...result.document.matchAll(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g)].map(p => p[0]);
    const boldRuns = paragraphs.flatMap(p => [...p.matchAll(/<w:r>(?:(?!<\/w:r>)[\s\S])*?<w:b\s*\/>[\s\S]*?<\/w:r>/g)]
      .map(r => xmlText(r[0]).join('')));
    // Only the marked spans are bold; the surrounding sentence is not.
    expect(boldRuns).toEqual(expect.arrayContaining(['4 200 €', 'passage étroit']));
    expect(result.text).toContain('Le montant de ');
    expect(result.text).not.toContain('**');
    // Indentation maps to nesting, capped at two levels deep.
    const levels = paragraphs.filter(p => p.includes('w:numPr'))
      .map(p => Number((p.match(/<w:ilvl w:val="(\d+)"/) || [])[1] ?? -1));
    expect(levels).toEqual([0, 1, 2, 0]); // three nested items, then the objection
    // Unsupported syntax is not interpreted, just printed.
    expect(result.text).toContain('# pas un titre, | pas un tableau.');
  });

  it('renders an enumeration as bullets and leaves running prose alone', async () => {
    const result = await render(summary([topic({
      context: 'Trois conventions sont proposées :\n- suppression du transformateur ;\n- passage d’un câble ;\n- pose d’une armoire.',
      discussion: [{ title: null, body: 'Le tracé par le stade est préféré à une ouverture de chaussée.' }],
    })]));
    const bullets = [...result.document.matchAll(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g)]
      .filter(p => p[0].includes('w:numPr'))
      .map(p => xmlText(p[0]).join(''));
    expect(bullets).toEqual([
      'suppression du transformateur ;', 'passage d’un câble ;', 'pose d’une armoire.',
    ]);
    // The lead-in and the discussion paragraph stay as ordinary text.
    expect(result.text).toContain('Trois conventions sont proposées :');
    expect(result.text).not.toMatch(/-\s*suppression/);
  });

  it('renders approved previous minutes with app wording, missing date dots, and all verification notes', async () => {
    const result = await render(summary([topic({
      title: 'Procès-verbal précédent', renderHint: 'previous_minutes_approval',
      previousMinutes: { date: null, outcome: 'approved' },
      decision: { type: 'formal_decision', text: 'Le procès-verbal est approuvé.', evidence: 'SOURCE_APPROVAL', voteResult: null, voteEvidence: null },
      verificationNotes: [
        { text: 'Vérifier la date du procès-verbal.', timestamp: null },
        { text: 'Un nom est incertain.', timestamp: { start: '00:01:00', end: '00:01:30' } },
      ],
    })]));
    expect(result.text).toContain('APPROBATION DU PROCÈS-VERBAL DE LA SÉANCE DU ……………………');
    expect(result.text).toContain('Vu le code général des collectivités territoriales');
    expect(result.text).toContain('Après discussion et délibération, à l’unanimité, les membres du Conseil Municipal approuvent');
    // No result was retranscribed, so the standing mention is flagged for the secretary.
    expect(result.text).toContain('Confirmer la mention « à l’unanimité » avant signature.');
    expect(result.text).toContain('Vérifier la date du procès-verbal.');
    expect(result.text).toContain('Un nom est incertain.');
    expect(result.text).toContain('00:01:00–00:01:30');
    expect(result.text).not.toMatch(/Résultat du vote|SOURCE_APPROVAL/);
  });

  it('renders the standing template for unclear minutes and flags the mention', async () => {
    const result = await render(summary([topic({
      renderHint: 'previous_minutes_approval', previousMinutes: { date: '2 juin 2026', outcome: 'unclear' },
      decision: { type: 'apparent_agreement', text: 'L’issue du vote est incertaine.', evidence: 'SOURCE_VOTE', voteResult: null, voteEvidence: null },
    })]));
    expect(result.text).toContain('2 juin 2026');
    expect(result.text).toContain('Après discussion et délibération, à l’unanimité, les membres du Conseil Municipal approuvent');
    expect(result.text).toContain('Confirmer la mention « à l’unanimité » avant signature.');
  });

  it('still points at the recording when the model reports no decision at all', async () => {
    // Observed with a live model: it found the exchange too ambiguous to classify and
    // returned decision: null, which left the confirmation prompt with nothing to check.
    const result = await render(summary([topic({
      renderHint: 'previous_minutes_approval', previousMinutes: { date: '12 juin', outcome: 'unclear' },
      decision: null,
      verificationNotes: [{ text: 'Approbation ambiguë.', timestamp: { start: '00:03:14', end: '00:03:14' } }],
    })]));
    expect(result.text).toContain('Confirmer la mention « à l’unanimité » avant signature.');
    expect(result.text).toContain('À vérifier dans l’enregistrement — 00:03:14');
  });

  it('replaces the template with an explicit refusal for rejected minutes', async () => {
    const result = await render(summary([topic({
      renderHint: 'previous_minutes_approval', previousMinutes: { date: '2 juin 2026', outcome: 'rejected' },
      decision: { type: 'formal_vote', text: 'Le procès-verbal est rejeté.', evidence: 'SOURCE_VOTE', voteResult: null, voteEvidence: null },
    })]));
    expect(result.text).toContain('Le procès-verbal n’a pas été approuvé.');
    expect(result.text).not.toMatch(/Vu le code général|Après discussion et délibération|les membres du Conseil Municipal approuvent|Fait et délibéré|unanimité/);
  });

  it('prefers an explicitly quoted vote result over the standing mention', async () => {
    const result = await render(summary([topic({
      renderHint: 'previous_minutes_approval', previousMinutes: { date: null, outcome: 'approved' },
      decision: { type: 'formal_vote', text: 'Le procès-verbal est approuvé.', evidence: 'SOURCE_APPROVAL', voteResult: '7 voix pour, 2 abstentions', voteEvidence: 'SOURCE_RESULT' },
    })]));
    expect(result.text).toContain('Après discussion et délibération, 7 voix pour, 2 abstentions, les membres du Conseil Municipal approuvent');
    // Evidence beat the template default, so there is nothing left to confirm.
    expect(result.text).not.toMatch(/unanimité|Confirmer la mention/);
  });

  it('prints a supplied vote result in the topic and recap without fabricating extra details', async () => {
    const result = await render(summary([topic({
      decision: { type: 'formal_vote', text: 'La convention est adoptée.', evidence: 'SOURCE_ADOPTION', voteResult: '7 voix pour, 2 contre', voteEvidence: 'SOURCE_RESULT' },
    })]));
    expect(result.text.split('7 voix pour, 2 contre')).toHaveLength(3);
    expect(result.text).not.toMatch(/unanimité|abstention|SOURCE_/);
  });

  it('uses the approved page geometry, readable styles, repeated headers, intact rows, and page fields', async () => {
    const result = await render(summary([topic({
      decision: { type: 'operational_decision', text: 'Poursuivre l’étude.', evidence: 'SOURCE_DECISION', voteResult: null, voteEvidence: null },
      actions: [{ type: 'explicit_commitment', text: 'Envoyer le dossier.', evidence: 'SOURCE_ACTION', responsible: null, responsibleEvidence: null, condition: null, conditionEvidence: null, deadline: null, deadlineEvidence: null }],
    })]));
    expect(result.document).toMatch(/<w:pgSz[^>]*w:w="12240"[^>]*w:h="15840"/);
    for (const [key, value] of Object.entries({ top: 964, right: 1077, bottom: 907, left: 1077 })) {
      expect(result.document).toMatch(new RegExp(`<w:pgMar[^>]*w:${key}="${value}"`));
    }
    expect(result.styles).toContain('Liberation Sans');
    for (const size of [20, 29, 23, 21]) expect(result.styles).toContain(`<w:sz w:val="${size}"`);
    expect(result.styles).not.toContain('<w:pBdr>');
    expect(result.document.match(/<w:tblHeader\b/g)).toHaveLength(2);
    expect(result.document.match(/<w:cantSplit\b/g)).toHaveLength(10);
    expect(result.footer).toMatch(/PAGE/);
    expect(result.footer).toMatch(/NUMPAGES/);
  });
});
