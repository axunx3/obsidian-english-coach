import { normalizePath, TFile } from "obsidian";
import type EnglishPracticePlugin from "./main";
// @ts-ignore moment is provided by Obsidian
import { moment } from "obsidian";

export function dailyPath(plugin: EnglishPracticePlugin, date: string): string {
  return normalizePath(`${plugin.settings.rootFolder}/Daily/${date}.md`);
}

export function weeklyPath(plugin: EnglishPracticePlugin, week: string): string {
  return normalizePath(`${plugin.settings.rootFolder}/Weekly/${week}.md`);
}

export async function ensureFolder(plugin: EnglishPracticePlugin, path: string): Promise<void> {
  if (!plugin.app.vault.getAbstractFileByPath(path)) {
    await plugin.app.vault.createFolder(path);
  }
}

export async function getOrCreateDaily(plugin: EnglishPracticePlugin): Promise<TFile> {
  const date = moment().format("YYYY-MM-DD");
  const path = dailyPath(plugin, date);
  let file = plugin.app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) {
    await ensureFolder(plugin, `${plugin.settings.rootFolder}/Daily`);
    await plugin.app.vault.create(path, dailyTemplate(plugin, date));
    file = plugin.app.vault.getAbstractFileByPath(path);
  }
  // Migrate older notes — make sure newer template sections exist in the right place.
  if (file instanceof TFile) await migrateDailyNote(plugin, file);
  return file as TFile;
}

/**
 * Idempotent: insert any missing sections that the current template expects,
 * each one positioned right before its expected successor. Older daily notes
 * created before v0.5 lack `## Mined sentences`, which made mining silently
 * land at the bottom of the file (after Reflection).
 */
async function migrateDailyNote(plugin: EnglishPracticePlugin, file: TFile): Promise<void> {
  const expected: { section: string; before: string }[] = [
    { section: "Mined sentences", before: "Output journal" },
    { section: "Today's prompt", before: "Speaking (LLM voice / self-talk)" },
  ];
  let text = await plugin.app.vault.read(file);
  let dirty = false;
  for (const { section, before } of expected) {
    if (text.includes(`## ${section}`)) continue;
    const lines = text.split("\n");
    const beforeIdx = lines.findIndex((l) => l.trim() === `## ${before}`);
    if (beforeIdx === -1) continue; // no anchor — leave as-is
    lines.splice(beforeIdx, 0, `## ${section}`, "", "");
    text = lines.join("\n");
    dirty = true;
  }
  if (dirty) await plugin.app.vault.modify(file, text);
}

export function dailyTemplate(plugin: EnglishPracticePlugin, date: string): string {
  const s = plugin.settings;
  return `---
date: ${date}
type: english-practice-daily
goals:
  speaking_minutes: ${s.speakingGoalMinutes}
  shadowing_minutes: ${s.shadowingGoalMinutes}
  vocab: ${s.vocabGoalPerDay}
done:
  speaking_minutes: 0
  shadowing_minutes: 0
  vocab: 0
score: 0
---

# English Practice — ${date}

> Output > input. Aim to *produce* English today, not just consume it.

## Today's prompt
<!-- Run "Generate today's speaking prompt" (LLM) to fill this. -->

## Speaking (LLM voice / self-talk)

## Shadowing

## Vocab encountered

| Word | Sentence | Source |
|---|---|---|

## Mined sentences

## Output journal
<!-- Write 3–5 sentences in English. No editing while you write. -->


## Reflection (中文 ok)


`;
}

export async function openDailyNote(plugin: EnglishPracticePlugin): Promise<void> {
  const file = await getOrCreateDaily(plugin);
  await plugin.app.workspace.getLeaf().openFile(file);
}

export async function openWeeklyReview(plugin: EnglishPracticePlugin): Promise<void> {
  const week = moment().format("GGGG-[W]WW");
  const path = weeklyPath(plugin, week);
  let file = plugin.app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) {
    await ensureFolder(plugin, `${plugin.settings.rootFolder}/Weekly`);
    await plugin.app.vault.create(path, weeklyTemplate(week));
    file = plugin.app.vault.getAbstractFileByPath(path);
  }
  if (file instanceof TFile) {
    await plugin.app.workspace.getLeaf().openFile(file);
  }
}

function weeklyTemplate(week: string): string {
  return `---
week: ${week}
type: english-practice-weekly
---

# Weekly Review — ${week}

## What I practiced this week


## What I noticed about my output


## Hardest moment


## Best win


## Next week's focus

`;
}

// ---------------- section ops

export interface SectionRange {
  body: string;
  startLine: number;
  endLine: number;
}

export function extractSection(text: string, heading: string): SectionRange {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l.trim() === `## ${heading}`);
  if (start === -1) return { body: "", startLine: -1, endLine: -1 };
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith("## ")) {
      end = i;
      break;
    }
  }
  const body = lines
    .slice(start + 1, end)
    .filter((l) => !l.trim().startsWith("<!--"))
    .join("\n")
    .trim();
  return { body, startLine: start, endLine: end };
}

export function replaceSection(text: string, heading: string, newBody: string): string {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l.trim() === `## ${heading}`);
  if (start === -1) {
    return `${text.trimEnd()}\n\n## ${heading}\n${newBody}\n`;
  }
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith("## ")) {
      end = i;
      break;
    }
  }
  const before = lines.slice(0, start + 1);
  const after = lines.slice(end);
  return [...before, "", newBody.trim(), "", ...after].join("\n");
}

export async function appendToTodaySection(
  plugin: EnglishPracticePlugin,
  sectionHeading: string,
  content: string
): Promise<void> {
  const file = await getOrCreateDaily(plugin);
  const text = await plugin.app.vault.read(file);
  const lines = text.split("\n");
  const headingIdx = lines.findIndex((l) => l.trim() === `## ${sectionHeading}`);
  if (headingIdx === -1) {
    const updated = `${text.trimEnd()}\n\n## ${sectionHeading}\n${content}\n`;
    await plugin.app.vault.modify(file, updated);
    return;
  }
  let insertIdx = lines.length;
  for (let i = headingIdx + 1; i < lines.length; i++) {
    if (lines[i].startsWith("## ")) {
      insertIdx = i;
      break;
    }
  }
  while (insertIdx > headingIdx + 1 && lines[insertIdx - 1].trim() === "") {
    insertIdx--;
  }
  lines.splice(insertIdx, 0, content, "");
  await plugin.app.vault.modify(file, lines.join("\n"));
}

export async function incrementDoneCounter(
  plugin: EnglishPracticePlugin,
  field: "speaking_minutes" | "shadowing_minutes" | "vocab",
  delta: number
): Promise<void> {
  const file = await getOrCreateDaily(plugin);
  await plugin.app.fileManager.processFrontMatter(file, (fm: any) => {
    if (!fm.done) fm.done = {};
    fm.done[field] = (Number(fm.done[field]) || 0) + delta;
    const s = plugin.settings;
    const sM = Number(fm.done.speaking_minutes) || 0;
    const shM = Number(fm.done.shadowing_minutes) || 0;
    const v = Number(fm.done.vocab) || 0;
    const score =
      (Math.min(sM / Math.max(s.speakingGoalMinutes, 1), 1) +
        Math.min(shM / Math.max(s.shadowingGoalMinutes, 1), 1) +
        Math.min(v / Math.max(s.vocabGoalPerDay, 1), 1)) /
      3;
    fm.score = Math.round(score * 100);
  });
  await plugin.refreshStatusBar();
}

export interface VocabRow {
  word: string;
  sentence: string;
  source: string;
}

export function parseVocabTable(text: string): VocabRow[] {
  const section = extractSection(text, "Vocab encountered");
  if (!section.body) return [];
  const rows: VocabRow[] = [];
  for (const line of section.body.split("\n")) {
    if (!line.startsWith("|")) continue;
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length < 3) continue;
    if (cells[0].toLowerCase() === "word" || /^[-:\s]+$/.test(cells.join(""))) continue;
    if (!cells[0]) continue;
    rows.push({ word: cells[0], sentence: cells[1] ?? "", source: cells[2] ?? "" });
  }
  return rows;
}

export function escapePipes(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\n+/g, " ");
}

export async function appendToSRSFile(
  plugin: EnglishPracticePlugin,
  rows: VocabRow[]
): Promise<number> {
  const path = normalizePath(plugin.settings.srsFile);
  const folder = path.substring(0, path.lastIndexOf("/"));
  if (folder && !plugin.app.vault.getAbstractFileByPath(folder)) {
    await plugin.app.vault.createFolder(folder);
  }
  let file = plugin.app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) {
    const header = `---\ntags: [${plugin.settings.srsTag}]\ntype: english-practice-srs\n---\n\n# Vocab Flashcards\n\n#${plugin.settings.srsTag}\n\n`;
    await plugin.app.vault.create(path, header);
    file = plugin.app.vault.getAbstractFileByPath(path);
  }
  if (!(file instanceof TFile)) return 0;
  const existing = await plugin.app.vault.read(file);
  let added = 0;
  let updated = existing;
  for (const r of rows) {
    const card = `${r.word.trim()} :: ${r.sentence.trim()}${
      r.source.trim() ? ` [${r.source.trim()}]` : ""
    }`;
    if (!existing.includes(card)) {
      updated = updated.trimEnd() + "\n" + card + "\n";
      added++;
    }
  }
  if (added > 0) await plugin.app.vault.modify(file, updated);
  return added;
}
