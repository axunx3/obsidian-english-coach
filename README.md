# Obsidian English Practice Coach

A small Obsidian plugin for non-native English learners — especially Chinese PhDs and researchers whose English education was input-heavy and test-oriented. The plugin biases your daily practice toward **active output**: speaking, shadowing, and vocab-in-context capture.

## Why

Most of us reading this can read papers and write Slack messages in English. What we cannot do is speak fluently in meetings, riff casually, or produce writing that doesn't feel translated. That is a *training distribution* problem, not a vocabulary problem. This plugin is scaffolding for the missing reps.

## What it does

- **Today's practice note** — one command opens (or creates) `English Learning/Daily/YYYY-MM-DD.md` with sections for speaking / shadowing / vocab / output journal / reflection.
- **Quick-add vocabulary** — modal captures a word + sentence + source, drops a row into today's vocab table. Use it the moment you encounter a word you wish you'd known.
- **Log shadowing session** — modal logs source, minutes, and what you noticed about rhythm/stress.
- **Log speaking session** — modal logs partner (LLM voice, language exchange, self-talk), minutes, topic, and where you got stuck.
- **Weekly review** — opens `English Learning/Weekly/YYYY-Www.md` with prompts for noticing patterns over the week.
- **Status bar** — shows today's progress at a glance: `🗣 12/15m · 🎧 8/15m · 📖 3/5`.

All data lives in plain markdown in your vault. Nothing is hidden in databases.

## Install

### Manual (current)

1. Clone or download this repo.
2. Run `npm install && npm run build`.
3. Copy `manifest.json`, `main.js`, `styles.css` into `<your-vault>/.obsidian/plugins/english-practice-coach/`.
4. In Obsidian: Settings → Community plugins → turn off Safe mode → enable "English Practice Coach".

### Via BRAT (once published to GitHub)

1. Install the [BRAT](https://github.com/TfTHacker/obsidian42-brat) community plugin.
2. BRAT → "Add Beta plugin" → paste this repo's GitHub URL.
3. Enable it under Community plugins.

## Configuration

Settings tab lets you change:

- Root folder (default `English Learning`)
- Daily goals: speaking minutes, shadowing minutes, vocab count
- Preferred podcast (used as placeholder in shadowing log)

## Philosophy

- Output > input. Reading more papers will not fix fluency.
- Plain markdown > custom databases. Your notes outlive the plugin.
- Friction kills habits. Every command is one keystroke away.
- Reflection beats metrics. Use the weekly review honestly.

## License

MIT
