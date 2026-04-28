import {
  App,
  Editor,
  MarkdownView,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  normalizePath,
  moment,
  requestUrl,
} from "obsidian";

// ====================================================================
// Settings
// ====================================================================

type LlmProvider = "anthropic" | "openai" | "claude-cli" | "none";

interface EnglishPracticeSettings {
  rootFolder: string;
  speakingGoalMinutes: number;
  shadowingGoalMinutes: number;
  vocabGoalPerDay: number;
  preferredPodcast: string;

  // LLM
  llmProvider: LlmProvider;
  llmApiKey: string;
  llmModel: string;
  promptTheme: string;

  // SRS
  srsExportEnabled: boolean;
  srsFile: string;
  srsTag: string;

  // TTS
  ttsVoice: string;
  ttsRate: number;

  // Claude Code CLI
  claudeBinPath: string;
}

const DEFAULT_SETTINGS: EnglishPracticeSettings = {
  rootFolder: "English Learning",
  speakingGoalMinutes: 15,
  shadowingGoalMinutes: 15,
  vocabGoalPerDay: 5,
  preferredPodcast: "",
  llmProvider: "none",
  llmApiKey: "",
  llmModel: "",
  promptTheme: "research, daily life, casual conversation",
  srsExportEnabled: true,
  srsFile: "English Learning/SRS/Vocab.md",
  srsTag: "flashcards",
  ttsVoice: "",
  ttsRate: 1.0,
  claudeBinPath: "claude",
};

const DEFAULT_MODELS: Record<LlmProvider, string> = {
  anthropic: "claude-sonnet-4-5",
  openai: "gpt-4o-mini",
  "claude-cli": "claude-sonnet-4-5",
  none: "",
};

// ====================================================================
// Plugin
// ====================================================================

export default class EnglishPracticePlugin extends Plugin {
  settings: EnglishPracticeSettings;
  statusBarEl: HTMLElement;
  llm: LLMService;

  async onload() {
    await this.loadSettings();
    this.llm = new LLMService(this);

    this.addRibbonIcon("languages", "Open today's English practice", () => {
      this.openDailyNote();
    });

    this.statusBarEl = this.addStatusBarItem();
    this.statusBarEl.addClass("epc-status");
    await this.refreshStatusBar();

    // -- core commands
    this.addCommand({
      id: "open-daily",
      name: "Open today's practice note",
      callback: () => this.openDailyNote(),
    });

    this.addCommand({
      id: "open-weekly",
      name: "Open this week's review",
      callback: () => this.openWeeklyReview(),
    });

    this.addCommand({
      id: "quick-add-vocab",
      name: "Quick-add vocabulary",
      callback: () => new VocabModal(this.app, this).open(),
    });

    this.addCommand({
      id: "log-shadowing",
      name: "Log shadowing session",
      callback: () => new ShadowingModal(this.app, this).open(),
    });

    this.addCommand({
      id: "log-speaking",
      name: "Log speaking session",
      callback: () => new SpeakingModal(this.app, this).open(),
    });

    // -- LLM commands
    this.addCommand({
      id: "correct-selection",
      name: "Correct selected English (LLM)",
      editorCallback: (editor: Editor, view: MarkdownView) =>
        this.correctSelection(editor),
    });

    this.addCommand({
      id: "polish-output-journal",
      name: "Polish today's Output Journal (LLM)",
      callback: () => this.polishOutputJournal(),
    });

    this.addCommand({
      id: "generate-speaking-prompt",
      name: "Generate today's speaking prompt (LLM)",
      callback: () => this.generateSpeakingPrompt(),
    });

    // -- TTS
    this.addCommand({
      id: "speak-selection",
      name: "Read selection aloud (TTS)",
      editorCallback: (editor: Editor) => this.speakText(editor.getSelection()),
    });

    this.addCommand({
      id: "speak-output-journal",
      name: "Read today's Output Journal aloud (TTS)",
      callback: () => this.speakOutputJournal(),
    });

    // -- SRS
    this.addCommand({
      id: "sync-vocab-to-srs",
      name: "Sync today's vocab to SRS file",
      callback: () => this.syncTodayVocabToSRS(),
    });

    this.addSettingTab(new EnglishPracticeSettingTab(this.app, this));

    this.registerInterval(
      window.setInterval(() => this.refreshStatusBar(), 60_000)
    );
  }

  onunload() {
    if (window.speechSynthesis) window.speechSynthesis.cancel();
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  // -------------------- folder + path helpers --------------------

  dailyPath(date: string): string {
    return normalizePath(`${this.settings.rootFolder}/Daily/${date}.md`);
  }

  weeklyPath(week: string): string {
    return normalizePath(`${this.settings.rootFolder}/Weekly/${week}.md`);
  }

  async ensureFolder(path: string): Promise<void> {
    const folder = this.app.vault.getAbstractFileByPath(path);
    if (!folder) await this.app.vault.createFolder(path);
  }

  async getOrCreateDaily(): Promise<TFile> {
    const date = moment().format("YYYY-MM-DD");
    const path = this.dailyPath(date);
    let file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      await this.ensureFolder(`${this.settings.rootFolder}/Daily`);
      await this.app.vault.create(path, this.dailyTemplate(date));
      file = this.app.vault.getAbstractFileByPath(path);
    }
    return file as TFile;
  }

  // -------------------- daily / weekly note --------------------

  async openDailyNote(): Promise<void> {
    const file = await this.getOrCreateDaily();
    await this.app.workspace.getLeaf().openFile(file);
  }

  dailyTemplate(date: string): string {
    const s = this.settings;
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
<!-- "Log speaking session" command. -->

## Shadowing
<!-- "Log shadowing session" command. -->

## Vocab encountered

| Word | Sentence | Source |
|---|---|---|

## Output journal
<!-- Write 3–5 sentences in English. No editing while you write. -->


## Reflection (中文 ok)


`;
  }

  async openWeeklyReview(): Promise<void> {
    const week = moment().format("GGGG-[W]WW");
    const path = this.weeklyPath(week);
    let file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      await this.ensureFolder(`${this.settings.rootFolder}/Weekly`);
      await this.app.vault.create(path, this.weeklyTemplate(week));
      file = this.app.vault.getAbstractFileByPath(path);
    }
    if (file instanceof TFile) {
      await this.app.workspace.getLeaf().openFile(file);
    }
  }

  weeklyTemplate(week: string): string {
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

  // -------------------- section append + YAML counter --------------------

  async appendToTodaySection(
    sectionHeading: string,
    content: string
  ): Promise<void> {
    const file = await this.getOrCreateDaily();
    const text = await this.app.vault.read(file);
    const lines = text.split("\n");
    const headingIdx = lines.findIndex(
      (l) => l.trim() === `## ${sectionHeading}`
    );
    if (headingIdx === -1) {
      const updated = `${text.trimEnd()}\n\n## ${sectionHeading}\n${content}\n`;
      await this.app.vault.modify(file, updated);
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
    await this.app.vault.modify(file, lines.join("\n"));
  }

  /**
   * Increment a counter in the `done:` block of today's frontmatter.
   * Heatmap Calendar / Dataview can read these.
   */
  async incrementDoneCounter(
    field: "speaking_minutes" | "shadowing_minutes" | "vocab",
    delta: number
  ): Promise<void> {
    const file = await this.getOrCreateDaily();
    await this.app.fileManager.processFrontMatter(file, (fm: any) => {
      if (!fm.done) fm.done = {};
      fm.done[field] = (Number(fm.done[field]) || 0) + delta;
      // Score: composite progress (0–100)
      const s = this.settings;
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
    await this.refreshStatusBar();
  }

  // -------------------- status bar --------------------

  async refreshStatusBar(): Promise<void> {
    const date = moment().format("YYYY-MM-DD");
    const path = this.dailyPath(date);
    const file = this.app.vault.getAbstractFileByPath(path);
    const s = this.settings;
    if (!(file instanceof TFile)) {
      this.statusBarEl.setText(
        `🗣 0/${s.speakingGoalMinutes}m · 🎧 0/${s.shadowingGoalMinutes}m · 📖 0/${s.vocabGoalPerDay}`
      );
      return;
    }
    const cache = this.app.metadataCache.getFileCache(file);
    const done = (cache?.frontmatter as any)?.done ?? {};
    const sM = Number(done.speaking_minutes) || 0;
    const shM = Number(done.shadowing_minutes) || 0;
    const v = Number(done.vocab) || 0;
    this.statusBarEl.setText(
      `🗣 ${sM}/${s.speakingGoalMinutes}m · 🎧 ${shM}/${s.shadowingGoalMinutes}m · 📖 ${v}/${s.vocabGoalPerDay}`
    );
  }

  // -------------------- LLM features --------------------

  isLLMReady(): boolean {
    const p = this.settings.llmProvider;
    if (p === "none") return false;
    if (p === "claude-cli") return Boolean(this.settings.claudeBinPath);
    return Boolean(this.settings.llmApiKey);
  }

  llmNotReadyMsg(): string {
    if (this.settings.llmProvider === "claude-cli") {
      return "Set the Claude Code binary path in plugin settings.";
    }
    return "Configure an LLM provider + API key in plugin settings first.";
  }

  async correctSelection(editor: Editor): Promise<void> {
    const selection = editor.getSelection();
    if (!selection.trim()) {
      new Notice("Select some English text first.");
      return;
    }
    if (!this.isLLMReady()) {
      new Notice(this.llmNotReadyMsg());
      return;
    }
    const loading = new Notice("Correcting…", 0);
    try {
      const result = await this.llm.correct(selection);
      loading.hide();
      new CorrectionModal(
        this.app,
        selection,
        result,
        (corrected) => editor.replaceSelection(corrected)
      ).open();
    } catch (err) {
      loading.hide();
      new Notice(`LLM error: ${(err as Error).message}`);
    }
  }

  async polishOutputJournal(): Promise<void> {
    if (!this.isLLMReady()) {
      new Notice(this.llmNotReadyMsg());
      return;
    }
    const file = await this.getOrCreateDaily();
    const text = await this.app.vault.read(file);
    const section = extractSection(text, "Output journal");
    if (!section.body.trim()) {
      new Notice("Output journal is empty — write something first.");
      return;
    }
    const loading = new Notice("Polishing…", 0);
    try {
      const result = await this.llm.correct(section.body);
      loading.hide();
      new CorrectionModal(this.app, section.body, result, async (corrected) => {
        const updated = replaceSection(text, "Output journal", corrected);
        await this.app.vault.modify(file, updated);
        new Notice("Output journal polished.");
      }).open();
    } catch (err) {
      loading.hide();
      new Notice(`LLM error: ${(err as Error).message}`);
    }
  }

  async generateSpeakingPrompt(): Promise<void> {
    if (!this.isLLMReady()) {
      new Notice(this.llmNotReadyMsg());
      return;
    }
    const loading = new Notice("Generating prompt…", 0);
    try {
      const prompt = await this.llm.generatePrompt(this.settings.promptTheme);
      loading.hide();
      const file = await this.getOrCreateDaily();
      const text = await this.app.vault.read(file);
      const updated = replaceSection(text, "Today's prompt", prompt);
      await this.app.vault.modify(file, updated);
      new Notice("Prompt added to today's note.");
      await this.app.workspace.getLeaf().openFile(file);
    } catch (err) {
      loading.hide();
      new Notice(`LLM error: ${(err as Error).message}`);
    }
  }

  // -------------------- TTS --------------------

  speakText(text: string): void {
    const trimmed = text.trim();
    if (!trimmed) {
      new Notice("Nothing to read.");
      return;
    }
    if (!window.speechSynthesis) {
      new Notice("Speech synthesis not available.");
      return;
    }
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(trimmed);
    u.lang = "en-US";
    u.rate = this.settings.ttsRate || 1.0;
    if (this.settings.ttsVoice) {
      const voices = window.speechSynthesis.getVoices();
      const v = voices.find((vv) => vv.name === this.settings.ttsVoice);
      if (v) u.voice = v;
    }
    window.speechSynthesis.speak(u);
  }

  async speakOutputJournal(): Promise<void> {
    const file = await this.getOrCreateDaily();
    const text = await this.app.vault.read(file);
    const section = extractSection(text, "Output journal");
    if (!section.body.trim()) {
      new Notice("Output journal is empty.");
      return;
    }
    this.speakText(section.body);
  }

  // -------------------- SRS sync --------------------

  async syncTodayVocabToSRS(): Promise<void> {
    const file = await this.getOrCreateDaily();
    const text = await this.app.vault.read(file);
    const rows = parseVocabTable(text);
    if (rows.length === 0) {
      new Notice("No vocab in today's note.");
      return;
    }
    const added = await this.appendToSRSFile(rows);
    new Notice(`Synced ${added} new card(s) to SRS file.`);
  }

  /**
   * Append vocab rows as Spaced Repetition plugin–compatible cards.
   * Format: `<word> :: <sentence> [<source>]` — one card per line.
   */
  async appendToSRSFile(rows: VocabRow[]): Promise<number> {
    const path = normalizePath(this.settings.srsFile);
    const folder = path.substring(0, path.lastIndexOf("/"));
    if (folder) await this.ensureFolder(folder);
    let file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      const header = `---\ntags: [${this.settings.srsTag}]\ntype: english-practice-srs\n---\n\n# Vocab Flashcards\n\n#${this.settings.srsTag}\n\n`;
      await this.app.vault.create(path, header);
      file = this.app.vault.getAbstractFileByPath(path);
    }
    if (!(file instanceof TFile)) return 0;
    const existing = await this.app.vault.read(file);
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
    if (added > 0) await this.app.vault.modify(file, updated);
    return added;
  }
}

// ====================================================================
// LLM service
// ====================================================================

interface CorrectionResult {
  corrected: string;
  changes: { from: string; to: string; why: string }[];
}

class LLMService {
  constructor(private plugin: EnglishPracticePlugin) {}

  private get s() {
    return this.plugin.settings;
  }

  private model(): string {
    return this.s.llmModel || DEFAULT_MODELS[this.s.llmProvider];
  }

  async correct(text: string): Promise<CorrectionResult> {
    const system =
      "You are a careful English editor for a non-native PhD-level writer. " +
      "Fix only clear errors and unidiomatic phrasing. Preserve voice, technical terminology, and the writer's style. " +
      "Return ONLY valid JSON with no surrounding markdown:\n" +
      `{"corrected": "...", "changes": [{"from": "...", "to": "...", "why": "..."}]}\n` +
      "If the text is already fine, return it unchanged with empty changes array.";
    const user = `Edit:\n\n${text}`;
    const raw = await this.complete(user, system, 2048);
    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
    try {
      const parsed = JSON.parse(cleaned);
      return {
        corrected: String(parsed.corrected ?? text),
        changes: Array.isArray(parsed.changes) ? parsed.changes : [],
      };
    } catch (e) {
      return { corrected: cleaned.trim() || text, changes: [] };
    }
  }

  async generatePrompt(theme: string): Promise<string> {
    const system =
      "You generate single, focused English speaking-practice prompts for a Chinese AI PhD student. " +
      "Aim for a 5-minute monologue. Be specific, concrete, mildly opinionated. " +
      "Return only the prompt text — no quotes, no preamble.";
    const user = `Theme: ${theme}. Generate one prompt now.`;
    const out = await this.complete(user, system, 256);
    return out.trim().replace(/^["']|["']$/g, "");
  }

  private async complete(
    user: string,
    system: string,
    maxTokens: number
  ): Promise<string> {
    if (this.s.llmProvider === "claude-cli") {
      return await this.claudeCli(user, system);
    }
    if (this.s.llmProvider === "anthropic") {
      const res = await requestUrl({
        url: "https://api.anthropic.com/v1/messages",
        method: "POST",
        contentType: "application/json",
        headers: {
          "x-api-key": this.s.llmApiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: this.model(),
          max_tokens: maxTokens,
          system,
          messages: [{ role: "user", content: user }],
        }),
      });
      const j = res.json;
      return j?.content?.[0]?.text ?? "";
    }
    if (this.s.llmProvider === "openai") {
      const res = await requestUrl({
        url: "https://api.openai.com/v1/chat/completions",
        method: "POST",
        contentType: "application/json",
        headers: {
          Authorization: `Bearer ${this.s.llmApiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: this.model(),
          max_tokens: maxTokens,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }),
      });
      const j = res.json;
      return j?.choices?.[0]?.message?.content ?? "";
    }
    throw new Error("LLM provider not configured");
  }

  private async claudeCli(user: string, system: string): Promise<string> {
    let cp: typeof import("child_process");
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      cp = require("child_process") as typeof import("child_process");
    } catch (e) {
      throw new Error(
        "Claude Code CLI provider needs Node child_process — desktop only."
      );
    }
    const bin = this.s.claudeBinPath || "claude";
    const args = [
      "-p",
      "--output-format",
      "json",
      "--model",
      this.model() || DEFAULT_MODELS["claude-cli"],
      "--append-system-prompt",
      system,
      user,
    ];
    return new Promise<string>((resolve, reject) => {
      cp.execFile(
        bin,
        args,
        {
          maxBuffer: 16 * 1024 * 1024,
          timeout: 120_000,
          env: { ...process.env, CLAUDE_CODE_NONINTERACTIVE: "1" },
        },
        (err, stdout, stderr) => {
          if (err) {
            const msg =
              (typeof stderr === "string" && stderr.trim()) ||
              err.message ||
              "claude CLI failed";
            reject(new Error(msg));
            return;
          }
          const text = String(stdout);
          // --output-format json returns: { result: "...", ... } (sometimes wrapped in array)
          try {
            const parsed = JSON.parse(text);
            const result =
              parsed.result ??
              parsed.text ??
              parsed.output ??
              (Array.isArray(parsed) ? parsed[parsed.length - 1]?.result : null);
            resolve(typeof result === "string" ? result : text.trim());
          } catch {
            resolve(text.trim());
          }
        }
      );
    });
  }
}

// ====================================================================
// Section + table helpers
// ====================================================================

interface SectionRange {
  body: string;
  startLine: number;
  endLine: number;
}

function extractSection(text: string, heading: string): SectionRange {
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

function replaceSection(
  text: string,
  heading: string,
  newBody: string
): string {
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

interface VocabRow {
  word: string;
  sentence: string;
  source: string;
}

function parseVocabTable(text: string): VocabRow[] {
  const section = extractSection(text, "Vocab encountered");
  if (!section.body) return [];
  const rows: VocabRow[] = [];
  for (const line of section.body.split("\n")) {
    if (!line.startsWith("|")) continue;
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((c) => c.trim());
    if (cells.length < 3) continue;
    if (
      cells[0].toLowerCase() === "word" ||
      /^[-:\s]+$/.test(cells.join(""))
    )
      continue;
    if (!cells[0]) continue;
    rows.push({
      word: cells[0],
      sentence: cells[1] ?? "",
      source: cells[2] ?? "",
    });
  }
  return rows;
}

function escapePipes(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\n+/g, " ");
}

// ====================================================================
// Modals
// ====================================================================

class VocabModal extends Modal {
  plugin: EnglishPracticePlugin;
  word = "";
  sentence = "";
  source = "";
  alsoSRS: boolean;

  constructor(app: App, plugin: EnglishPracticePlugin) {
    super(app);
    this.plugin = plugin;
    this.alsoSRS = plugin.settings.srsExportEnabled;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass("epc-modal");
    contentEl.createEl("h2", { text: "Quick-add vocabulary" });

    new Setting(contentEl)
      .setName("Word / phrase")
      .addText((t) => t.onChange((v) => (this.word = v)));
    new Setting(contentEl)
      .setName("Sentence in context")
      .addTextArea((t) => t.onChange((v) => (this.sentence = v)));
    new Setting(contentEl)
      .setName("Source")
      .addText((t) => t.onChange((v) => (this.source = v)));
    new Setting(contentEl)
      .setName("Also add to SRS file")
      .addToggle((t) =>
        t.setValue(this.alsoSRS).onChange((v) => (this.alsoSRS = v))
      );

    new Setting(contentEl).addButton((b) =>
      b
        .setButtonText("Add")
        .setCta()
        .onClick(async () => {
          if (!this.word.trim()) {
            new Notice("Word is required");
            return;
          }
          const row = `| ${this.word} | ${escapePipes(
            this.sentence
          )} | ${escapePipes(this.source)} |`;
          await this.plugin.appendToTodaySection("Vocab encountered", row);
          await this.plugin.incrementDoneCounter("vocab", 1);
          if (this.alsoSRS) {
            await this.plugin.appendToSRSFile([
              {
                word: this.word,
                sentence: this.sentence,
                source: this.source,
              },
            ]);
          }
          new Notice(`Added "${this.word}"`);
          this.close();
        })
    );
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

class ShadowingModal extends Modal {
  plugin: EnglishPracticePlugin;
  source = "";
  minutes: string;
  notes = "";

  constructor(app: App, plugin: EnglishPracticePlugin) {
    super(app);
    this.plugin = plugin;
    this.minutes = String(plugin.settings.shadowingGoalMinutes);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass("epc-modal");
    contentEl.createEl("h2", { text: "Log shadowing session" });

    new Setting(contentEl).setName("Source (URL or title)").addText((t) => {
      if (this.plugin.settings.preferredPodcast)
        t.setPlaceholder(this.plugin.settings.preferredPodcast);
      t.onChange((v) => (this.source = v));
    });
    new Setting(contentEl)
      .setName("Minutes")
      .addText((t) => t.setValue(this.minutes).onChange((v) => (this.minutes = v)));
    new Setting(contentEl)
      .setName("What you noticed (rhythm, stress, new chunks)")
      .addTextArea((t) => t.onChange((v) => (this.notes = v)));

    new Setting(contentEl).addButton((b) =>
      b
        .setButtonText("Log")
        .setCta()
        .onClick(async () => {
          const min = parseInt(this.minutes, 10) || 0;
          const src = this.source.trim() || "(unspecified source)";
          const noteLine = this.notes.trim() ? `\n  - ${this.notes.trim()}` : "";
          const entry = `- **${min} min** — shadowing — ${src}${noteLine}`;
          await this.plugin.appendToTodaySection("Shadowing", entry);
          await this.plugin.incrementDoneCounter("shadowing_minutes", min);
          new Notice(`Logged ${min} min of shadowing`);
          this.close();
        })
    );
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

class SpeakingModal extends Modal {
  plugin: EnglishPracticePlugin;
  partner = "LLM voice";
  minutes: string;
  topic = "";
  notes = "";

  constructor(app: App, plugin: EnglishPracticePlugin) {
    super(app);
    this.plugin = plugin;
    this.minutes = String(plugin.settings.speakingGoalMinutes);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass("epc-modal");
    contentEl.createEl("h2", { text: "Log speaking session" });

    new Setting(contentEl)
      .setName("Partner / mode")
      .addText((t) =>
        t.setValue(this.partner).onChange((v) => (this.partner = v))
      );
    new Setting(contentEl)
      .setName("Minutes")
      .addText((t) => t.setValue(this.minutes).onChange((v) => (this.minutes = v)));
    new Setting(contentEl)
      .setName("Topic")
      .addText((t) => t.onChange((v) => (this.topic = v)));
    new Setting(contentEl)
      .setName("Where you got stuck")
      .addTextArea((t) => t.onChange((v) => (this.notes = v)));

    new Setting(contentEl).addButton((b) =>
      b
        .setButtonText("Log")
        .setCta()
        .onClick(async () => {
          const min = parseInt(this.minutes, 10) || 0;
          const topic = this.topic.trim() || "(no topic)";
          const noteLine = this.notes.trim()
            ? `\n  - stuck on: ${this.notes.trim()}`
            : "";
          const entry = `- **${min} min** — speaking with ${this.partner} — ${topic}${noteLine}`;
          await this.plugin.appendToTodaySection(
            "Speaking (LLM voice / self-talk)",
            entry
          );
          await this.plugin.incrementDoneCounter("speaking_minutes", min);
          new Notice(`Logged ${min} min of speaking`);
          this.close();
        })
    );
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

class CorrectionModal extends Modal {
  constructor(
    app: App,
    private original: string,
    private result: CorrectionResult,
    private onApply: (corrected: string) => void
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass("epc-modal");
    contentEl.createEl("h2", { text: "LLM correction" });

    contentEl.createEl("h3", { text: "Original" });
    const orig = contentEl.createEl("div", { cls: "epc-text" });
    orig.setText(this.original);

    contentEl.createEl("h3", { text: "Corrected" });
    const corr = contentEl.createEl("div", { cls: "epc-text epc-corrected" });
    corr.setText(this.result.corrected);

    if (this.result.changes.length > 0) {
      contentEl.createEl("h3", { text: "Changes" });
      const ul = contentEl.createEl("ul");
      for (const c of this.result.changes) {
        const li = ul.createEl("li");
        li.createEl("code", { text: c.from });
        li.createSpan({ text: " → " });
        li.createEl("code", { text: c.to });
        if (c.why) li.createEl("div", { cls: "epc-why", text: c.why });
      }
    } else {
      contentEl.createEl("p", {
        text: "No specific changes flagged.",
        cls: "epc-why",
      });
    }

    const buttons = contentEl.createDiv({ cls: "epc-buttons" });
    new Setting(buttons)
      .addButton((b) =>
        b
          .setButtonText("Apply")
          .setCta()
          .onClick(() => {
            this.onApply(this.result.corrected);
            this.close();
          })
      )
      .addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()));
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

// ====================================================================
// Settings tab
// ====================================================================

class EnglishPracticeSettingTab extends PluginSettingTab {
  plugin: EnglishPracticePlugin;

  constructor(app: App, plugin: EnglishPracticePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "English Practice Coach" });

    // -- general
    containerEl.createEl("h3", { text: "General" });

    new Setting(containerEl)
      .setName("Root folder")
      .setDesc("Where practice notes live in your vault.")
      .addText((t) =>
        t.setValue(this.plugin.settings.rootFolder).onChange(async (v) => {
          this.plugin.settings.rootFolder = v.trim() || "English Learning";
          await this.plugin.saveSettings();
          await this.plugin.refreshStatusBar();
        })
      );

    new Setting(containerEl)
      .setName("Daily speaking goal (min)")
      .addText((t) =>
        t
          .setValue(String(this.plugin.settings.speakingGoalMinutes))
          .onChange(async (v) => {
            this.plugin.settings.speakingGoalMinutes = parseInt(v, 10) || 15;
            await this.plugin.saveSettings();
            await this.plugin.refreshStatusBar();
          })
      );

    new Setting(containerEl)
      .setName("Daily shadowing goal (min)")
      .addText((t) =>
        t
          .setValue(String(this.plugin.settings.shadowingGoalMinutes))
          .onChange(async (v) => {
            this.plugin.settings.shadowingGoalMinutes = parseInt(v, 10) || 15;
            await this.plugin.saveSettings();
            await this.plugin.refreshStatusBar();
          })
      );

    new Setting(containerEl)
      .setName("Daily vocab goal")
      .addText((t) =>
        t
          .setValue(String(this.plugin.settings.vocabGoalPerDay))
          .onChange(async (v) => {
            this.plugin.settings.vocabGoalPerDay = parseInt(v, 10) || 5;
            await this.plugin.saveSettings();
            await this.plugin.refreshStatusBar();
          })
      );

    new Setting(containerEl)
      .setName("Preferred podcast / source")
      .addText((t) =>
        t
          .setValue(this.plugin.settings.preferredPodcast)
          .onChange(async (v) => {
            this.plugin.settings.preferredPodcast = v;
            await this.plugin.saveSettings();
          })
      );

    // -- LLM
    containerEl.createEl("h3", { text: "LLM (correction + prompt generation)" });
    containerEl.createEl("p", {
      text: "API keys are stored in plugin data on this device. Avoid syncing data.json across devices if you don't want to share keys.",
      cls: "epc-why",
    });

    new Setting(containerEl)
      .setName("Provider")
      .setDesc(
        "'Claude Code CLI' uses your existing claude.ai Pro/Max subscription via the local `claude` binary (desktop only, no API key needed)."
      )
      .addDropdown((d) =>
        d
          .addOption("none", "None (disabled)")
          .addOption("anthropic", "Anthropic API (key)")
          .addOption("openai", "OpenAI API (key)")
          .addOption("claude-cli", "Claude Code CLI (subscription)")
          .setValue(this.plugin.settings.llmProvider)
          .onChange(async (v) => {
            this.plugin.settings.llmProvider = v as LlmProvider;
            await this.plugin.saveSettings();
            this.display(); // re-render to show/hide relevant fields
          })
      );

    if (this.plugin.settings.llmProvider === "claude-cli") {
      new Setting(containerEl)
        .setName("Claude binary path")
        .setDesc(
          "Default 'claude' uses your PATH. Use an absolute path if Obsidian can't find it."
        )
        .addText((t) =>
          t
            .setValue(this.plugin.settings.claudeBinPath)
            .onChange(async (v) => {
              this.plugin.settings.claudeBinPath = v.trim() || "claude";
              await this.plugin.saveSettings();
            })
        );
    }

    if (
      this.plugin.settings.llmProvider === "anthropic" ||
      this.plugin.settings.llmProvider === "openai"
    ) {
      new Setting(containerEl).setName("API key").addText((t) => {
        t.inputEl.type = "password";
        t.setValue(this.plugin.settings.llmApiKey).onChange(async (v) => {
          this.plugin.settings.llmApiKey = v;
          await this.plugin.saveSettings();
        });
      });
    }

    new Setting(containerEl)
      .setName("Model (override)")
      .setDesc(
        "Leave blank for provider default (claude-sonnet-4-5 / gpt-4o-mini)."
      )
      .addText((t) =>
        t.setValue(this.plugin.settings.llmModel).onChange(async (v) => {
          this.plugin.settings.llmModel = v.trim();
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Speaking-prompt themes")
      .setDesc("Comma-separated topics the LLM picks from.")
      .addText((t) =>
        t
          .setValue(this.plugin.settings.promptTheme)
          .onChange(async (v) => {
            this.plugin.settings.promptTheme = v;
            await this.plugin.saveSettings();
          })
      );

    // -- SRS
    containerEl.createEl("h3", { text: "Spaced Repetition" });
    containerEl.createEl("p", {
      text: "Compatible with the 'Spaced Repetition' community plugin (uses :: card separator).",
      cls: "epc-why",
    });

    new Setting(containerEl)
      .setName("Auto-add new vocab to SRS file")
      .addToggle((t) =>
        t
          .setValue(this.plugin.settings.srsExportEnabled)
          .onChange(async (v) => {
            this.plugin.settings.srsExportEnabled = v;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("SRS file path")
      .addText((t) =>
        t.setValue(this.plugin.settings.srsFile).onChange(async (v) => {
          this.plugin.settings.srsFile = v.trim() || "English Learning/SRS/Vocab.md";
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("SRS tag")
      .addText((t) =>
        t.setValue(this.plugin.settings.srsTag).onChange(async (v) => {
          this.plugin.settings.srsTag = v.replace(/^#/, "").trim() || "flashcards";
          await this.plugin.saveSettings();
        })
      );

    // -- TTS
    containerEl.createEl("h3", { text: "Text-to-Speech" });

    new Setting(containerEl)
      .setName("Voice")
      .setDesc("Use 'Read selection aloud' once to populate available voices.")
      .addDropdown((d) => {
        d.addOption("", "(system default)");
        const voices =
          typeof window !== "undefined" && window.speechSynthesis
            ? window.speechSynthesis.getVoices()
            : [];
        for (const v of voices) {
          if (v.lang.startsWith("en")) d.addOption(v.name, `${v.name} (${v.lang})`);
        }
        d.setValue(this.plugin.settings.ttsVoice).onChange(async (v) => {
          this.plugin.settings.ttsVoice = v;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("TTS rate")
      .addSlider((s) =>
        s
          .setLimits(0.5, 1.5, 0.05)
          .setValue(this.plugin.settings.ttsRate)
          .setDynamicTooltip()
          .onChange(async (v) => {
            this.plugin.settings.ttsRate = v;
            await this.plugin.saveSettings();
          })
      );
  }
}
