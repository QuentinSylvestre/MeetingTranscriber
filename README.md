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
3. Click **Record**. Pause/resume as needed.
4. Click **Stop** when done.
5. The app will prompt you to transcribe immediately.

### Upload an existing recording

1. Open the **Upload** view.
2. Drop an audio file or click to browse. Supported formats: MP3, MP4, WAV, M4A, OGG.
3. Select your provider, language, and optional title.
4. Click **Transcribe**.

### Assigning speaker names

After transcription, the **Transcript** view shows speaker-labeled turns.

- **Click** a speaker label to seek to that point in the audio.
- **Double-click** a speaker label to rename it. All occurrences of that speaker update.

### Exporting

- **Export ⇩** saves the transcript to a `.txt` file.
- **Copy 📋** copies the transcript to the clipboard.

Transcript format: `[HH:MM:SS] Speaker Name: text`

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

**Note**: `npm install` rebuilds native addons (`better-sqlite3`) for Electron. Running `npm test` requires rebuilding for the local Node.js version (`npm rebuild better-sqlite3 --prefer-offline` is included in the test script).
