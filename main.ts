import {
  App,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  normalizePath,
  moment,
} from "obsidian";

interface EnglishPracticeSettings {
  rootFolder: string;
  speakingGoalMinutes: number;
  shadowingGoalMinutes: number;
  vocabGoalPerDay: number;
  preferredPodcast: string;
}

const DEFAULT_SETTINGS: EnglishPracticeSettings = {
  rootFolder: "English Learning",
  speakingGoalMinutes: 15,
  shadowingGoalMinutes: 15,
  vocabGoalPerDay: 5,
  preferredPodcast: "",
};

export default class EnglishPracticePlugin extends Plugin {
  settings: EnglishPracticeSettings;
  statusBarEl: HTMLElement;

  async onload() {
    await this.loadSettings();

    this.addRibbonIcon("languages", "Open today's English practice", () => {
      this.openDailyNote();
    });

    this.statusBarEl = this.addStatusBarItem();
    this.statusBarEl.addClass("epc-status");
    await this.refreshStatusBar();

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

    this.addSettingTab(new EnglishPracticeSettingTab(this.app, this));

    this.registerInterval(
      window.setInterval(() => this.refreshStatusBar(), 60_000)
    );
  }

  onunload() {}

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  // ---------------- folder + path helpers ----------------

  dailyPath(date: string): string {
    return normalizePath(`${this.settings.rootFolder}/Daily/${date}.md`);
  }

  weeklyPath(week: string): string {
    return normalizePath(`${this.settings.rootFolder}/Weekly/${week}.md`);
  }

  async ensureFolder(path: string): Promise<void> {
    const folder = this.app.vault.getAbstractFileByPath(path);
    if (!folder) {
      await this.app.vault.createFolder(path);
    }
  }

  // ---------------- daily note ----------------

  async openDailyNote(): Promise<void> {
    const date = moment().format("YYYY-MM-DD");
    const path = this.dailyPath(date);
    let file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      await this.ensureFolder(`${this.settings.rootFolder}/Daily`);
      await this.app.vault.create(path, this.dailyTemplate(date));
      file = this.app.vault.getAbstractFileByPath(path);
    }
    if (file instanceof TFile) {
      await this.app.workspace.getLeaf().openFile(file);
    }
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
---

# English Practice — ${date}

> Output > input. Aim to *produce* English today, not just consume it.

## Speaking (LLM voice / self-talk)
<!-- Use the "Log speaking session" command to add entries here. -->

## Shadowing
<!-- Use the "Log shadowing session" command to add entries here. -->

## Vocab encountered
<!-- Use the "Quick-add vocabulary" command to add entries here. -->

| Word | Sentence | Source |
|---|---|---|

## Output journal
<!-- Write 3–5 sentences in English about anything: research, today, frustrations. No editing. -->

## Reflection (中文 ok)


`;
  }

  // ---------------- weekly review ----------------

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
<!-- Where did I freeze? Which structures felt automatic? -->


## Hardest moment


## Best win


## Next week's focus


`;
  }

  // ---------------- append-to-section ----------------

  async appendToTodaySection(
    sectionHeading: string,
    content: string
  ): Promise<void> {
    const date = moment().format("YYYY-MM-DD");
    const path = this.dailyPath(date);
    let file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      await this.openDailyNote();
      file = this.app.vault.getAbstractFileByPath(path);
    }
    if (!(file instanceof TFile)) return;

    const text = await this.app.vault.read(file);
    const lines = text.split("\n");
    const headingIdx = lines.findIndex(
      (l) => l.trim() === `## ${sectionHeading}`
    );
    if (headingIdx === -1) {
      // Section not found → append at end as a new section
      const updated = `${text.trimEnd()}\n\n## ${sectionHeading}\n${content}\n`;
      await this.app.vault.modify(file, updated);
      return;
    }
    // Find the next ## heading or end-of-file → insert just before it
    let insertIdx = lines.length;
    for (let i = headingIdx + 1; i < lines.length; i++) {
      if (lines[i].startsWith("## ")) {
        insertIdx = i;
        break;
      }
    }
    // Trim trailing blank lines in the section before inserting
    while (insertIdx > headingIdx + 1 && lines[insertIdx - 1].trim() === "") {
      insertIdx--;
    }
    lines.splice(insertIdx, 0, content, "");
    await this.app.vault.modify(file, lines.join("\n"));
  }

  // ---------------- status bar ----------------

  async refreshStatusBar(): Promise<void> {
    const date = moment().format("YYYY-MM-DD");
    const path = this.dailyPath(date);
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      this.statusBarEl.setText("🗣 No practice today");
      return;
    }
    const text = await this.app.vault.cachedRead(file);
    const speakingMatches =
      text.match(/^- \*\*(\d+) min\*\* — speaking/gim) ?? [];
    const shadowingMatches =
      text.match(/^- \*\*(\d+) min\*\* — shadowing/gim) ?? [];
    const vocabMatches = text.match(/^\| [^|]+ \| [^|]+ \| [^|]+ \|$/gm) ?? [];
    const speakingMin = sumMinutes(speakingMatches);
    const shadowingMin = sumMinutes(shadowingMatches);
    const vocabCount = Math.max(0, vocabMatches.length - 1); // subtract header row
    const s = this.settings;
    this.statusBarEl.setText(
      `🗣 ${speakingMin}/${s.speakingGoalMinutes}m · ` +
        `🎧 ${shadowingMin}/${s.shadowingGoalMinutes}m · ` +
        `📖 ${vocabCount}/${s.vocabGoalPerDay}`
    );
  }
}

function sumMinutes(matches: string[]): number {
  let total = 0;
  for (const m of matches) {
    const num = m.match(/(\d+)/);
    if (num) total += parseInt(num[1], 10);
  }
  return total;
}

// ---------------- modals ----------------

class VocabModal extends Modal {
  plugin: EnglishPracticePlugin;
  word = "";
  sentence = "";
  source = "";

  constructor(app: App, plugin: EnglishPracticePlugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass("epc-modal");
    contentEl.createEl("h2", { text: "Quick-add vocabulary" });

    new Setting(contentEl).setName("Word / phrase").addText((t) =>
      t.onChange((v) => (this.word = v))
    );
    new Setting(contentEl)
      .setName("Sentence in context")
      .addTextArea((t) => t.onChange((v) => (this.sentence = v)));
    new Setting(contentEl)
      .setName("Source (paper, podcast, conversation…)")
      .addText((t) => t.onChange((v) => (this.source = v)));

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
          await this.plugin.refreshStatusBar();
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
  minutes = "15";
  notes = "";

  constructor(app: App, plugin: EnglishPracticePlugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass("epc-modal");
    contentEl.createEl("h2", { text: "Log shadowing session" });

    new Setting(contentEl)
      .setName("Source (URL or title)")
      .addText((t) => {
        if (this.plugin.settings.preferredPodcast) {
          t.setPlaceholder(this.plugin.settings.preferredPodcast);
        }
        t.onChange((v) => (this.source = v));
      });
    new Setting(contentEl)
      .setName("Minutes")
      .addText((t) =>
        t
          .setValue(String(this.plugin.settings.shadowingGoalMinutes))
          .onChange((v) => (this.minutes = v))
      );
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
          const noteLine = this.notes.trim()
            ? `\n  - ${this.notes.trim()}`
            : "";
          const entry = `- **${min} min** — shadowing — ${src}${noteLine}`;
          await this.plugin.appendToTodaySection("Shadowing", entry);
          await this.plugin.refreshStatusBar();
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
  minutes = "15";
  topic = "";
  notes = "";

  constructor(app: App, plugin: EnglishPracticePlugin) {
    super(app);
    this.plugin = plugin;
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
      .addText((t) =>
        t
          .setValue(String(this.plugin.settings.speakingGoalMinutes))
          .onChange((v) => (this.minutes = v))
      );
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
          await this.plugin.appendToTodaySection("Speaking (LLM voice / self-talk)", entry);
          await this.plugin.refreshStatusBar();
          new Notice(`Logged ${min} min of speaking`);
          this.close();
        })
    );
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

function escapePipes(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\n+/g, " ");
}

// ---------------- settings ----------------

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

    new Setting(containerEl)
      .setName("Root folder")
      .setDesc("Where practice notes live in your vault.")
      .addText((t) =>
        t
          .setValue(this.plugin.settings.rootFolder)
          .onChange(async (v) => {
            this.plugin.settings.rootFolder = v.trim() || "English Learning";
            await this.plugin.saveSettings();
            await this.plugin.refreshStatusBar();
          })
      );

    new Setting(containerEl)
      .setName("Daily speaking goal (minutes)")
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
      .setName("Daily shadowing goal (minutes)")
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
      .setDesc("Used as a placeholder in the shadowing log.")
      .addText((t) =>
        t
          .setValue(this.plugin.settings.preferredPodcast)
          .onChange(async (v) => {
            this.plugin.settings.preferredPodcast = v;
            await this.plugin.saveSettings();
          })
      );
  }
}
