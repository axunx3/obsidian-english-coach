# Obsidian English Practice Coach

An Obsidian plugin for non-native English learners — especially Chinese PhDs and researchers whose English education was input-heavy and test-oriented. The plugin biases your daily practice toward **active output**: speaking, shadowing, vocab-in-context capture, sentence mining, spaced review, and LLM-corrected writing.

## Why

Most of us reading this can read papers and write Slack messages in English. What we cannot do is speak fluently in meetings, riff casually, or produce writing that doesn't feel translated. That is a *training distribution* problem, not a vocabulary problem. This plugin is scaffolding for the missing reps.

> **Read [WORKFLOW.md](./WORKFLOW.md)** for the design principle, the three daily loops, and how the features fit together. The README below lists features; the workflow doc explains why they exist.

## Features

### Daily structure
- **Today's practice note** — `English Learning/Daily/YYYY-MM-DD.md` with sections for prompt, speaking, shadowing, vocab, mined sentences, output journal, reflection.
- **Weekly review** — reflective prompts for noticing patterns.
- **Status bar** — live progress: `🗣 12/15m · 🎧 8/15m · 📖 3/5 · 🃏 7` (last is due cards). Click it to start a review session.
- **YAML counters** — every log action updates `done.speaking_minutes`, `done.shadowing_minutes`, `done.vocab`, and a composite `score` 0–100. Compatible with [Heatmap Calendar](https://github.com/Richardo2016/obsidian-heatmap-calendar).

### Capture
- **Quick-add vocab** — modal: word + sentence + source → today's table + internal SRS deck + (optional) SR-plugin file.
- **Log shadowing / speaking** — minutes, source, what stuck.
- **Mine sentence** — select a sentence in any note, run the command, click target words to mark as cloze, save as a card. Sentence-level cards beat word-level for retention.
- **Look up word at cursor** — Cmd+P → "Look up word at cursor" → modal with definition, IPA, examples, one-click "add to vocab" or "mine the sentence". Backed by your LLM provider or the free [dictionaryapi.dev](https://dictionaryapi.dev/).

### Spaced repetition (built-in, FSRS)
- Vocab and cloze cards live in `<root>/.epc-cards.json`, scheduled with [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs).
- **Review due cards** command (or click the status bar) → flip-card UI with **Again / Hard / Good / Easy** buttons.
- Real spacing — cards come back in the right interval based on your past ratings, not just appended to a file.
- Optional: **export to SR-plugin file** keeps you compatible with the [Spaced Repetition](https://github.com/st3v3nmw/obsidian-spaced-repetition) plugin if you prefer its review UI.

### Conversation panel (chat view)
- Right-side panel — registers as a real Obsidian view.
- Multi-turn dialogue with the LLM playing your conversation partner. Configurable persona/system prompt.
- Optional **correction mode**: each user message gets an inline correction box after the assistant reply (`📝 You said X → Y, why`).
- Auto-logs minutes spent to today's Speaking section.
- Cmd+Enter to send. Persistent across reloads (capped at last 200 messages).

### LLM coach
Three provider modes:

| Provider | Auth | Cost | Notes |
|---|---|---|---|
| **Anthropic API** | API key | Pay-as-you-go (~$3/mo typical) | Default model `claude-sonnet-4-5` |
| **OpenAI API** | API key | Pay-as-you-go | Default `gpt-4o-mini` |
| **Claude Code CLI** | Existing claude.ai Pro/Max subscription | Free with subscription | Desktop only — uses local `claude` binary, no API key needed; auto-detected |

Used by: correct selected English, polish output journal, generate speaking prompt, dictionary lookup, conversation chat.

The plugin auto-detects the `claude` binary and supplies a [hardened PATH](https://github.com/YishenTu/claudian) so GUI-launched Obsidian on macOS finds the binary correctly.

### Audio
- **Read selection / Output journal aloud** via browser SpeechSynthesis. No external dependency.
- Configurable voice + rate.

## Inspirations

This plugin doesn't reinvent the wheel — it produces data the established plugins consume and borrows hard-won lessons from production-quality plugins:

- **[ankitects/anki](https://github.com/ankitects/anki) + [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs)** — Real spaced-repetition algorithm. We use ts-fsrs as the scheduler.
- **[YishenTu/claudian](https://github.com/YishenTu/claudian)** — CLI path detection + enhanced PATH for GUI-launched Electron apps. We ported the macOS/Linux discovery logic.
- **[Refold roadmap](https://refold.la/) + [Migaku](https://migaku.io/)** — Sentence mining methodology. Capture sentences with target words, build cloze cards. Context > isolation for retention.
- **[themoeway/yomitan](https://github.com/themoeway/yomitan)** — Frictionless dictionary popup → SRS pipeline. Our LookupModal echoes this pattern (command-based for now; hover support is on the roadmap).
- **[Spaced Repetition](https://github.com/st3v3nmw/obsidian-spaced-repetition)** — Optional companion: we still export to its `::` card format for users who prefer its review UI.
- **[Heatmap Calendar](https://github.com/Richardo2016/obsidian-heatmap-calendar)** — We populate YAML `score` so this plugin can render your streak.

## Install

### Manual

1. Clone or download this repo.
2. `npm install && npm run build`.
3. Copy `main.js`, `manifest.json`, `styles.css` into `<vault>/.obsidian/plugins/english-practice-coach/`.
4. Obsidian → Settings → Community plugins → enable.

### Via BRAT

Install [BRAT](https://github.com/TfTHacker/obsidian42-brat) → "Add Beta plugin" → paste this repo's URL → enable.

## Suggested companion plugin setup

Heatmap Calendar — paste this dataviewjs block into any note to visualize your streak:

````markdown
```dataviewjs
const data = { year: 2026, entries: [] };
for (let p of dv.pages('"English Learning/Daily"').where(p => p.score > 0)) {
    data.entries.push({ date: p.date, intensity: p.score, content: `${p.score}` });
}
renderHeatmapCalendar(this.container, data);
```
````

## Architecture

```
src/
├── main.ts                  # Plugin entry, command registration, status bar
├── settings.ts              # Settings interface, defaults, settings tab
├── llm.ts                   # LLMService (Anthropic / OpenAI / Claude CLI) + path detection
├── daily.ts                 # Daily/weekly templates, section ops, YAML counters
├── srs/
│   └── store.ts             # CardStore (FSRS-backed, JSON-persisted)
├── modals/
│   ├── basic.ts             # Vocab / Shadowing / Speaking / Correction modals
│   ├── mine.ts              # Sentence-mining modal (cloze builder)
│   ├── review.ts            # FSRS review session modal
│   └── lookup.ts            # Dictionary lookup modal
└── views/
    └── chat-view.ts         # Conversation panel (ItemView)
```

## License

MIT
