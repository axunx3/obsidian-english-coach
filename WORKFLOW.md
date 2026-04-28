# Workflow & Design Principle

If you read the README, you have a feature list. This file explains *how the features fit together* and *why* — the daily loop the plugin was designed to support.

## The one-line principle

**Output > input. Make capture frictionless, make production frequent, defer review.**

Every feature is justified against this. Anything that increases input volume (more reading, more vocab drilling) is rejected — most learners already over-input. Anything that lowers friction to *producing* English (chat, journal, sentence mining) is kept.

## Three loops, not one big workflow

```
┌────────────────────────────────────────────────────────────┐
│                  DAILY ENTRY POINT                          │
│         "Open today's English note" (Cmd+P)                 │
│          → status bar: 🗣 12/15m · 🎧 0/15m · 📖 3/5 · 🃏 7   │
└────────────────────────────────────────────────────────────┘
        │                     │                    │
        ▼                     ▼                    ▼
   CAPTURE loop          PRODUCE loop         REVIEW loop
   (passive, all-day)    (~15 min/day)        (~5 min/day)
```

### Loop 1 — Capture (passive, throughout the day)

You're reading a paper, a Slack thread, a blog post. You hit a word you don't know, or a sentence you wish you could write. **Right-click the selection.**

| Selection | Right-click action | What happens |
|---|---|---|
| One word | "Look up" | Dictionary popup; click "Add to vocab" → goes to deck |
| One word | "Add to English vocab" | Modal pre-fills word + surrounding line as sentence |
| Whole sentence | "Mine as cloze" | Click target word(s) → cloze card created |
| Anything | "Correct with LLM" | Inline diff modal (apply or cancel) |
| Anything | "Read aloud" | TTS the selection |

Every capture takes <5 seconds. **All paths funnel into one deck** (`<root>/.epc-cards.json`) regardless of entry point. You never have to think "where does this go".

### Loop 2 — Produce (active, ~15 min/day)

This is the loop that actually fixes fluency. You sit down and **produce English**. Three modes — pick one per session:

| Mode | How | What's logged |
|---|---|---|
| **Spontaneous speech** | Open chat panel → chat 10–15 min in English | Auto-logs minutes when you close the panel |
| **Writing** | Today's note → Output Journal section → write 3–5 sentences → select all → right-click "Correct with LLM" | Logged manually if desired |
| **Topic-driven self-talk** | "Generate today's English speaking prompt" → speak it aloud | Use "Log English speaking" command to record minutes |

The chat panel is a real Obsidian view (right sidebar) because produce-time is the longest activity; it deserves to live where you live, not behind a modal.

### Loop 3 — Review (deferred, ~5 min/day)

You **don't** review at capture time. You review when the FSRS algorithm decides you'll benefit most. Status bar shows `🃏 N due` — click it. Flip-card session, rate Again / Hard / Good / Easy.

This is the loop beginners skip — and the only one that moves vocab from passive recognition to active recall. Without it, capture is a graveyard.

## A real day, by the clock

| Time | Activity | Plugin involvement |
|---|---|---|
| 8:00 AM | Glance at status bar — `🃏 7` | Click status bar → review 7 cards (~3 min) |
| 10:00–12:00 | Reading papers | Right-click 4–8 words/sentences as you go (~30 sec total) |
| 3:00 PM | Coffee break | Open chat panel → 15 min English chat (auto-logged) |
| 9:00 PM | Wind-down | Open today's note → write 4 sentences in Output Journal → right-click Correct (~5 min) |

Total active time: ~25 minutes. Most of it passive capture.

## Why these design choices

- **Right-click menu over slash commands**: capture must take <5 seconds. Cmd+P → typing → Enter is too slow when reading flow matters.
- **One deck for everything**: vocab cards, cloze cards, lookup-driven cards all share storage. No hierarchy, no "which deck does this belong to" decision.
- **Plain markdown for visible content, JSON only for FSRS state**: your notes survive the plugin. If you uninstall tomorrow, nothing important is locked away.
- **Chat-view as a real ItemView**: produce-time deserves a permanent home in the workspace, not a transient modal.
- **Defer review**: SRS only earns its keep when you trust it to schedule. Reviewing at capture time defeats the algorithm.
- **One status bar, four numbers**: `🗣 12/15m · 🎧 0/15m · 📖 3/5 · 🃏 7`. The whole dashboard. No popups, no graphs, no metrics page.

## What to ignore as a beginner

- **Weekly review** — use it on Sundays, not Day 1.
- **Free Dictionary API mode** — LLM mode (default) is better; v0.6.1 makes it feel instant.
- **Shadowing log** — only if you actively shadow podcasts.
- **TTS voice / rate** — defaults are fine.
- **Polish today's Output Journal** — same effect as selecting-all + Correct.

## What "valuable help" means here

The plugin is *not* trying to be Anki, Lingq, or Yomitan. It's trying to be the **smallest possible set of tools that make the daily output loop frictionless**. If you're using it 25 minutes a day for 6 months, the plugin worked. If you're configuring it for an hour and never opening it again, it failed — that's on the design.

## Anti-features (what we deliberately did not build)

- **Gamification, streaks, badges, XP**: motivation should come from feeling more fluent, not from a number.
- **Mobile support**: Obsidian mobile can't shell out to Claude CLI; instead of a half-broken mobile experience, the plugin is desktop-only.
- **AI conversation persona library**: one persona, configurable in settings. Choosing a "tutor" vs "friend" vs "interviewer" each session is friction.
- **Automatic vocab harvesting from your reading**: would create a graveyard. Capture must be a deliberate act, even if the act is one click.

If you're tempted to add a feature that doesn't fit one of the three loops, ask: *does this make output more frequent, capture less frictional, or review better-timed?* If no, drop it.
