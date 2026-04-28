# Obsidian English Practice Coach

A small Obsidian plugin for non-native English learners — especially Chinese PhDs and researchers whose English education was input-heavy and test-oriented. The plugin biases your daily practice toward **active output**: speaking, shadowing, vocab-in-context capture, and LLM-corrected writing.

## Why

Most of us reading this can read papers and write Slack messages in English. What we cannot do is speak fluently in meetings, riff casually, or produce writing that doesn't feel translated. That is a *training distribution* problem, not a vocabulary problem. This plugin is scaffolding for the missing reps.

## Features

### Daily structure
- **Today's practice note** — one command opens (or creates) `English Learning/Daily/YYYY-MM-DD.md` with a structured template.
- **Weekly review** — opens `English Learning/Weekly/YYYY-Www.md` with reflective prompts.
- **Status bar** — shows live progress: `🗣 12/15m · 🎧 8/15m · 📖 3/5`.
- **YAML counters** — every log action updates `done.speaking_minutes`, `done.shadowing_minutes`, `done.vocab`, and a composite `score` (0–100). Compatible with [Heatmap Calendar](https://github.com/Richardo2016/obsidian-heatmap-calendar) for GitHub-style streak visualization.

### Capture
- **Quick-add vocabulary** — modal: word + sentence + source → today's vocab table, optionally also added to your SRS file.
- **Log shadowing** — modal: source + minutes + what you noticed.
- **Log speaking** — modal: partner (LLM voice / language exchange / self-talk) + minutes + topic + stuck-points.

### LLM coach (optional, bring your own key)
- **Correct selected English** — select any sentence in any note, run the command, get a side-by-side diff with explanations. Apply or cancel.
- **Polish today's Output Journal** — corrects the whole journal section in one pass.
- **Generate today's speaking prompt** — LLM produces a focused 5-minute monologue prompt tailored to your themes and inserts it into today's note.

Three provider modes:

| Provider | Auth | Cost | Notes |
|---|---|---|---|
| **Anthropic API** | API key from console.anthropic.com | Pay-as-you-go (~$3/mo for typical use) | Default model `claude-sonnet-4-5` |
| **OpenAI API** | OpenAI API key | Pay-as-you-go | Default `gpt-4o-mini` |
| **Claude Code CLI** | Existing claude.ai Pro/Max subscription | Free with subscription | Desktop only — uses local `claude` binary, no API key needed |

The CLI mode shells out to `claude -p --output-format json --model claude-sonnet-4-5 --append-system-prompt "..." "..."` and uses your subscription quota.

### Spaced repetition
- **Auto-export to SRS file** — new vocab entries are appended to `English Learning/SRS/Vocab.md` in the [Spaced Repetition](https://github.com/st3v3nmw/obsidian-spaced-repetition) plugin's `::` card format. Install that plugin to get full SRS review on top.
- **Sync today's vocab to SRS** — manual command to backfill.

### Audio
- **Read selection aloud (TTS)** — uses browser SpeechSynthesis. No external dependency.
- **Read today's Output Journal aloud** — hear what you wrote in a native voice.
- Configure voice + rate in settings.

## Inspirations

This plugin doesn't reinvent SRS or heatmaps — it produces data the established plugins consume:

- [Spaced Repetition](https://github.com/st3v3nmw/obsidian-spaced-repetition) — SRS reviews on the vocab file we generate.
- [Heatmap Calendar](https://github.com/Richardo2016/obsidian-heatmap-calendar) — visualize the `score` field across days.
- [Templater](https://github.com/SilentVoid13/Templater) — extend the daily/weekly templates.
- [Dataview](https://github.com/blacksmithgu/obsidian-dataview) — query progress with `TABLE done.speaking_minutes FROM "English Learning/Daily"`.

## Install

### Manual

1. Clone or download this repo.
2. Run `npm install && npm run build`.
3. Copy `manifest.json`, `main.js`, `styles.css` into `<your-vault>/.obsidian/plugins/english-practice-coach/`.
4. Obsidian → Settings → Community plugins → turn off Restricted mode → enable "English Practice Coach".

### Via BRAT (once published to GitHub)

1. Install the [BRAT](https://github.com/TfTHacker/obsidian42-brat) community plugin.
2. BRAT → "Add Beta plugin" → paste this repo's URL.
3. Enable under Community plugins.

## Suggested setup with Heatmap Calendar

Install the Heatmap Calendar plugin, then add this code block to any note:

````markdown
```dataviewjs
const calendarData = {
    year: 2026,
    entries: [],
}
for (let page of dv.pages('"English Learning/Daily"').where(p => p.score > 0)) {
    calendarData.entries.push({
        date: page.date,
        intensity: page.score,
        content: `${page.score}`,
    })
}
renderHeatmapCalendar(this.container, calendarData)
```
````

## Philosophy

- Output > input. Reading more papers will not fix fluency.
- Plain markdown > custom databases. Your notes outlive the plugin.
- Friction kills habits. Every command is one keystroke (Cmd+P) away.
- Reflection beats metrics. Use the weekly review honestly.

## License

MIT
