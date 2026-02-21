# ChoirMaster

A browser-based simplified DAW for creating choir practice files. Import instrumental and choir audio, record vocals, edit clips non-destructively, and export deterministic WAV practice files according to strict presets.

**No cloud. No tempo. WAV-only exports. Correctness and determinism valued over UI polish.**

## Features

- **Browser-only Web App** - No installation required, runs entirely in your browser
- **IndexedDB Persistence** - Projects and audio stored locally with autosave
- **Non-destructive Editing** - Crop, split, and adjust clips without altering source audio
- **Recording** - Record vocals directly in the browser with punch & split model
- **7 Export Presets** - Specialized exports for choir practice with exact gain/pan specifications
- **Undo/Redo** - Full history that survives page refresh (last 100 actions)
- **Project Portability** - Export/import projects as JSON or ZIP archives

## Quick Start

### Installation

1. Clone or download this repository
2. Install dependencies:
   ```bash
   npm install
   ```

3. Start development server:
   ```bash
   npm run dev
   ```

4. Open browser to `http://localhost:3000`

### Building for Production

```bash
npm run build
npm run preview
```

## Server Hosting Mode (Self-Host / LAN)

ChoirMaster now supports a hosted mode (Postgres + API + WebSocket + shared media storage) in addition to local IndexedDB mode.

### Start Full Hosted Stack (Docker Compose)

```bash
npm run dev:full
```

Services:
- `web` at `http://localhost:3000`
- `api` at `http://localhost:8787`
- `db` Postgres at `localhost:5432`

Default admin credentials (change immediately in `docker-compose.yml` / env):
- Username: `admin`
- Password: `changemechangeme`

### Frontend Env for Direct API (non-proxied dev)

Create `.env` from `.env.example`:

```bash
cp .env.example .env
```

Then run frontend dev server:

```bash
npm run dev
```

### Backend Env (standalone API run)

Create `server/.env` from `server/.env.example`:

```bash
cp server/.env.example server/.env
```

Then run:

```bash
npm run dev:server
```

### Backup / Restore (Docker stack)

```bash
bash server/scripts/backup.sh
bash server/scripts/restore.sh ./backups/<timestamp>
```

## Tech Stack

- **Framework:** React 18 + Vite
- **Styling:** Tailwind CSS
- **Icons:** Lucide React
- **State:** Zustand
- **Waveforms:** wavesurfer.js
- **Audio:** Web Audio API (44.1 kHz, 32-bit float)
- **Storage:** IndexedDB (Dexie.js)

## Project Structure

```
src/
├── components/      # React components
│   ├── Dashboard.jsx    # Project dashboard
│   └── Editor.jsx       # Main editor (Phase 1+)
├── lib/            # Core libraries
│   └── db.js           # IndexedDB wrapper (Dexie)
├── store/          # State management
│   └── useStore.js     # Zustand store
├── types/          # Data models
│   └── project.js      # Project schema & types
├── utils/          # Utility functions
│   └── audio.js        # Audio math (volume/pan/etc)
├── App.jsx         # Root component
├── main.jsx        # Entry point
└── index.css       # Global styles
```

## Usage

### Creating a Project

1. Click "New Project" on dashboard
2. Enter project name
3. Import audio files (WAV, MP3, or FLAC)
4. Assign track roles (instrument, lead, choir parts)
5. Edit, record, and export

### Track Roles

Tracks must be assigned one of these roles:
- `instrument` - Instrumental backing tracks
- `lead` - Lead vocal tracks
- `choir-part-1` through `choir-part-5` - Individual choir parts
- `other` - Miscellaneous tracks

### Volume & Pan Controls

- **Volume:** Slider 0-100 maps to -60dB to 0dB
  - 0 = -60dB (near silence)
  - 100 = 0dB (unity gain)
- **Pan:** Slider -100 to +100 using equal-power panning law

### Keyboard Shortcuts

- `Space` - Play/Pause
- `R` - Record
- `Ctrl/Cmd + Z` - Undo
- `Ctrl/Cmd + Y` - Redo

### Export Presets

1. **Instrumental** - Instrument tracks only
2. **All** - All tracks (leads +3dB)
3. **Lead** - Lead + instrumental
4. **Leads Separate** - One WAV per lead (+6dB target, others -3dB)
5. **Only Whole Choir** - Choir tracks only
6. **Separate Choir Parts (practice)** - Target +6dB/+30 pan, others -6dB/-30 pan
7. **Separate Choir Parts Omitted** - Target muted, others normal

All exports are 44.1kHz, 16-bit PCM WAV files.

## Data Model

Projects are stored as JSON with this structure:

```json
{
  "version": "1.0.0",
  "projectId": "uuid",
  "projectName": "string",
  "sampleRate": 44100,
  "masterVolume": 0,
  "tracks": [
    {
      "id": "uuid",
      "name": "Tenor",
      "role": "choir-part-1",
      "locked": true,
      "volume": 85,
      "pan": 0,
      "muted": false,
      "soloed": false,
      "clips": [...]
    }
  ],
  "loop": { "enabled": false, "startMs": 0, "endMs": 0 },
  "undoStackSize": 100
}
```

**All time values are in milliseconds.**

## Browser Compatibility

Requires modern browser with:
- Web Audio API
- IndexedDB
- MediaDevices API (for recording)
- ES2020+ support

Tested on Chrome 90+, Firefox 88+, Safari 14+, Edge 90+

## Implementation Status

### ✅ **ALL PHASES COMPLETE - MVP READY**

- ✅ **Phase 0 - Setup** (Complete)
  - Project scaffold
  - IndexedDB wrapper
  - Zustand store
  - Basic dashboard
  
- ✅ **Phase 1 - Core Import & Playback** (Complete)
  - File import with drag/drop
  - Audio decoding and resampling
  - Track list with controls
  - Basic playback engine
  - Keyboard shortcuts
  
- ✅ **Phase 2 - Timeline & Editing** (Complete)
  - Timeline visualization with wavesurfer.js
  - Waveform rendering
  - Clip editing (move, crop, gain drag)
  - Copy/paste/duplicate/delete
  - Timeline scrubbing
  - Zoom controls
  - Multi-clip playback
  
- ✅ **Phase 3 - Recording & Export** (Complete)
  - Recording via MediaDevices API
  - All 7 export presets
  - WAV 16-bit PCM output
  - Project portability (JSON + ZIP)
  - Cross-machine compatibility

**ChoirMaster is production-ready for creating choir practice files.**

See `IMPLEMENTATION.md` for technical details and `SPEC_CHANGES.md` for any deviations from spec.

---

## 🤖 Working with LLMs on This Project

**Need to make changes using an LLM?** We've created comprehensive guides:

- **[LLM_CONTEXT.md](docs/LLM_CONTEXT.md)** ⭐ - Paste this at the start of every new chat
- **[PROMPT_TEMPLATES.md](docs/PROMPT_TEMPLATES.md)** - Ready-to-use prompt examples  
- **[WORKING_WITH_LLMS.md](docs/WORKING_WITH_LLMS.md)** - Complete workflow guide

**Quick start:** Start a fresh chat, paste `LLM_CONTEXT.md`, then describe what you need. This is **30-50x cheaper** than continuing long conversations and gives better results.

See the [parent directory README](docs/README_LLM_GUIDE.md) for more details.

## License

MIT

## Acknowledgments

Built according to the ChoirMaster specification v1.0
