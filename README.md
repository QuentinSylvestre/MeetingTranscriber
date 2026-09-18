# Meeting Transcriber

A Windows desktop application for transcribing meeting recordings with speaker diarization.

## System Requirements

- Windows 10 or Windows 11 (x64)
- Internet connection (for cloud transcription APIs)

## Installation

Download and run the NSIS installer from the `dist-installer/` directory after building.

```
npm install
npm run build
```

The installer will be created at `dist-installer/Meeting Transcriber Setup <version>.exe`.

> **Note**: This is an unsigned build. Windows SmartScreen may display a warning when running the installer. Click "More info" then "Run anyway" to proceed. Production deployment should use a code-signing certificate.

> **Note**: `npm run build` rebuilds native addons for the Electron target. If native modules fail to load, run `node scripts/rebuild-native.cjs` manually.

## Setting up API Keys

The app supports four transcription providers. You need an API key for at least one.

1. Open the app and navigate to **Settings**.
2. Enter your API key for one or more providers:
   - **AssemblyAI** — Sign up at [assemblyai.com](https://assemblyai.com). Strong French transcription with speaker diarization.
   - **ElevenLabs Scribe v2** — Sign up at [elevenlabs.io](https://elevenlabs.io). Supports long recordings up to 10 hours.
   - **OpenAI gpt-4o-transcribe-diarize** — Sign up at [platform.openai.com](https://platform.openai.com). Requires audio chunking for recordings over 25 minutes.
   - **Google Gemini 3.5 Transcribe** (preview API) — Sign up at [aistudio.google.com](https://aistudio.google.com). 30-minute limit per chunk with diarization.
3. Click **Test** to verify your API key works.
4. API keys are stored encrypted using Windows Credential Manager (DPAPI).

## Recording Folder

By default, recordings are saved to `Documents\MeetingTranscriber\`. You can change this in **Settings**.

## Usage

### Record a meeting

1. Open the **Record** view.
2. Select your microphone from the dropdown.
3. If AssemblyAI is your active provider, optionally set the number of speakers (exact count or a min/max range) to improve diarization accuracy.
4. Click **Record**. Pause/resume as needed.
5. Click **Stop** when done.
6. The app will prompt you to transcribe immediately.

While recording, an input level meter shows what is actually reaching the application. If the input stays silent for fifteen seconds the meter turns red and the view says so, because a dead input is otherwise indistinguishable from a working one until the meeting is over. A muted microphone and a headset connected for output only both produce this. The wait is long enough that an ordinary pause in a quiet room does not trigger it. When Windows reports no microphone at all, **Record** is disabled and the view says why rather than failing at the moment you click it.

### Upload an existing recording

1. Open the **Upload** view.
2. Drop an audio file or click to browse. Supported formats: MP3, MP4, WAV, M4A, OGG.
3. Select your transcription language (defaults to your saved preference) and an optional title.
4. If AssemblyAI is your active provider, optionally set the number of speakers (exact count or a min/max range) to improve diarization accuracy.
5. Click **Transcribe**.

### Assigning speaker names

After transcription, the **Transcript** view shows speaker-labeled turns.

- **Click** a speaker label to seek to that point in the audio.
- **Double-click** a speaker label to rename it. All occurrences of that speaker update.

### Exporting

- **Export transcript to .docx ⇩** saves the transcript as a Word (`.docx`) document.
- **Copy transcript 📋** copies the transcript to the clipboard.

Each line of the generated document (and of the clipboard copy) uses the format: `[HH:MM:SS] Speaker Name: text`

Timestamps can be disabled in **Settings → Export**.

### Municipal council summary

1. Add an **OpenAI API key** in Settings. Your transcription provider can remain AssemblyAI or any other supported provider.
2. Open a completed transcript and finish any text or speaker-name corrections.
3. Click **Compte rendu du conseil (.docx)** (or **Council summary (.docx)** in English) and confirm that you want to send the paid request.
4. Choose where to save the document. Cancelling this dialog sends no API request and costs nothing.
5. Wait for generation, then click **Open document** to open the saved DOCX.

Each generation sends the current saved, timestamped transcript to OpenAI in one paid request using `gpt-5.6-sol` with medium reasoning. The OpenAI API project must have access to this model; a key that works for transcription may lack summary-model access. The API key stays in the existing encrypted store and the request uses `store: false`. No additional hosting, database migration, or Word installation is needed to generate a DOCX. Opening it requires an application associated with `.docx` files. The generated content is always French, independently of the interface language.

The document includes meeting information, thematic discussion, decisions with their stated status, actions, inline verification notes with useful audio timestamps, and recap tables derived from the same topics. Proposed and conditional actions remain labeled. Unknown owners and deadlines remain unspecified. A condition that gates an action is recorded separately from a deadline, so a conditional next step is never reported as though it had an agreed date; the action recap shows it as `Sous condition : …`.

The split between what the model writes and what the application builds runs along a single line: the model supplies claims and prose, the application owns every structural decision. Inside a prose field the model may use two Markdown marks and nothing else — `- ` at the start of a line for a list item, indented two spaces per level and at most two levels deep, and `**bold**` for the decisive words in a passage. Headings, the document hierarchy, the meeting-information block and both recap tables are built in application code, so a `#`, a `|` or a stray asterisk is printed literally rather than interpreted. This keeps formatting flexible without moving any checkable claim out of a validated field.

Previous-minutes administrative wording is application-owned. Section 1 always renders the municipality's standing template. It inserts an explicitly quoted vote result when the transcript contains one, and otherwise falls back to the standing `à l'unanimité` mention. When the transcript does not establish the result, the document asks you to confirm that mention before signature and prints the recording position to re-listen to. This is deliberately confined to section 1: every other topic still refuses to assert a decision or vote result the transcript does not contain.

The provider returns strict structured JSON, which is validated again locally. Source quotations are required for decisions, actions, vote results, owners, conditions and deadlines. A vote result must additionally be quoted from a passage other than the one establishing the decision, so an apparent agreement cannot be presented as a recorded vote.

Claims the transcript does not support are removed individually rather than discarding the whole summary: an unsupported decision or action is dropped, an unsupported owner, condition or deadline is left unspecified, an unverifiable vote result is removed and the decision falls back to an apparent agreement. Every removal is written to the application log. Only malformed output is rejected outright. These checks reduce unsupported output but do not prove that a model interpreted the source correctly. Check important facts and verification notes against the recording before official use. Summaries are not stored in history; the saved DOCX is the result.

V1 accepts up to 120,000 transcript characters, allows three minutes for the provider response, caps output at 24,000 tokens including reasoning, and makes no automatic retries. The character limit is derived from that token budget: the reference meeting is about 68,000 characters and produces roughly 7,800 output tokens, so 120,000 characters leaves around 10,000 tokens for reasoning. Raise the two together, and only after measuring a real run at the new length. Malformed, refused or incomplete output is rejected without saving a document. Errors appear in the Transcript view and say whether the request was charged. A new generation is a new paid request.

The document is written to a temporary file and then moved into place, so a failure part-way through cannot truncate a report already at that path. If the write fails — most often because the file is open in Word — the rendered document is kept in memory and **Save to another location** writes it elsewhere without contacting the provider again. Saved locations are remembered only until the application closes.

## Known Limitations

- **System audio capture (WASAPI loopback) is disabled** in this build. No prebuilt native addon (`naudiodon`) is available for the current Electron version. Microphone recording is fully functional.
- **OpenAI and Google**: Long recordings are automatically split into chunks. Speakers are labeled `Chunk N – Speaker X` across chunks. Manual reconciliation is required to assign the same name to the same person across chunk boundaries.
- **Google Gemini**: Maximum 30 minutes per chunk with diarization (8-speaker cap).
- **Background operation**: The app does not run in the background or system tray. It is a foreground application only.

## Development

```bash
npm install
npm run dev    # Start Electron in development mode
npm test       # Run Vitest unit tests
npm run build  # Build production NSIS installer
```

**Note**: `better-sqlite3` is a native addon and can only be built for one target at a time — Electron for `npm run dev` and packaging, Node for the test runner. Both directions repair themselves: `npm install` and `npm run dev` build for Electron, and `npm test` builds for Node before running. Switching between running the app and running the tests needs no manual step.

Municipal-summary tests cover the schema, provider failures, export workflow and DOCX structure. `tests/fixtures/municipal-summary/` contains the supplied transcript and a hand-curated structured regression fixture; it checks the renderer and contract, not live model quality. The fixture follows the functional spec where the approved DOCX differs: implied follow-up tasks are not automatically commitments.
