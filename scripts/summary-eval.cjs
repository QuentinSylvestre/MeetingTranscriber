/**
 * One-off end-to-end evaluation of the municipal summary pipeline against the
 * reference transcript. Runs under Electron so the stored API key can be decrypted
 * by safeStorage; the key is read straight into the request and never printed.
 *
 *   npx electron scripts/summary-eval.cjs <model> [<model> ...]
 *
 * Each model gets exactly one paid request. Outputs land in scripts/.eval-output/.
 */
const { app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '.eval-output');
const models = process.argv.slice(2).filter(a => !a.startsWith('-') && !a.endsWith('.cjs'));

// safeStorage derives its key from the Local State file inside userData, so the whole
// userData path must match the app's or nothing it wrote can be decrypted. This must
// happen before the app is ready.
app.setPath('userData', path.join(app.getPath('appData'), 'meeting-transcriber'));

function readKey() {
  const file = path.join(app.getPath('userData'), 'secrets.json');
  if (!fs.existsSync(file)) throw new Error(`no secrets file at ${file}`);
  const store = JSON.parse(fs.readFileSync(file, 'utf8'));
  const raw = store['api_key_openai'];
  if (!raw) throw new Error('no OpenAI key configured in Settings');
  // store.ts writes safeStorage.encryptString(...).toString('hex').
  return safeStorage.decryptString(Buffer.from(raw, 'hex'));
}

app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  // tsx/ts-node are not available under Electron here, so use the compiled sources
  // the build produces. Fall back to a clear message if they are missing.
  let generate, schema, render;
  try {
    generate = require('../dist-eval/main/summary/generate.js');
    schema = require('../dist-eval/main/summary/schema.js');
    render = require('../dist-eval/main/summary/render-docx.js');
  } catch (error) {
    console.error('COMPILE_MISSING', error.message);
    app.exit(2);
    return;
  }

  const transcript = fs.readFileSync(
    path.join(__dirname, '..', 'tests', 'fixtures', 'municipal-summary', 'golden-transcript.txt'), 'utf8');
  let key;
  try { key = readKey(); } catch (error) { console.error('KEY_ERROR', error.message); app.exit(3); return; }

  const report = [];
  for (const model of models) {
    const started = Date.now();
    const degradations = [];
    let usage = null;
    const entry = { model, transcriptChars: transcript.length };
    try {
      const summary = await generate.generateSummary(transcript, key, undefined, {
        model,
        onDegrade: reason => degradations.push(reason),
        onUsage: value => { usage = value; },
      });
      entry.ok = true;
      entry.seconds = Math.round((Date.now() - started) / 1000);
      entry.usage = usage;
      entry.degradations = degradations;
      entry.topics = summary.topics.map(t => ({
        title: t.title, category: t.category, renderHint: t.renderHint,
        decision: t.decision && { type: t.decision.type, voteResult: t.decision.voteResult },
        actions: t.actions.map(a => ({ type: a.type, responsible: a.responsible, condition: a.condition, deadline: a.deadline })),
        objections: t.objections.length, alternatives: t.alternatives.length,
        openPoints: t.openPoints.length,
        notes: t.verificationNotes.map(n => n.timestamp && `${n.timestamp.start}${n.timestamp.end ? '–' + n.timestamp.end : ''}`),
      }));
      entry.meetingInfo = summary.meetingInfo;
      entry.summaryJsonChars = JSON.stringify(summary).length;
      fs.writeFileSync(path.join(OUT, `${model}.json`), JSON.stringify(summary, null, 2));
      const buffer = await render.renderSummaryDocx(summary, transcript);
      fs.writeFileSync(path.join(OUT, `${model}.docx`), buffer);
      entry.docxBytes = buffer.length;
    } catch (error) {
      entry.ok = false;
      entry.seconds = Math.round((Date.now() - started) / 1000);
      entry.error = error && error.code ? error.code : String(error && error.message);
      entry.degradations = degradations;
    }
    report.push(entry);
    console.log('RESULT ' + JSON.stringify(entry));
  }
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log('DONE');
  app.exit(0);
});
