import { App, Modal, Notice, Setting } from "obsidian";
import {
  appendToSRSFile,
  appendToTodaySection,
  escapePipes,
  incrementDoneCounter,
} from "../daily";
import type EnglishPracticePlugin from "../main";
import type { CorrectionResult } from "../llm";

export class VocabModal extends Modal {
  plugin: EnglishPracticePlugin;
  word: string;
  sentence: string;
  source: string;
  alsoSRSFile: boolean;
  alsoDeck = true;

  constructor(
    app: App,
    plugin: EnglishPracticePlugin,
    initial?: { word?: string; sentence?: string; source?: string }
  ) {
    super(app);
    this.plugin = plugin;
    this.alsoSRSFile = plugin.settings.srsExportEnabled;
    this.word = initial?.word ?? "";
    this.sentence = initial?.sentence ?? "";
    this.source = initial?.source ?? "";
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass("epc-modal");
    contentEl.createEl("h2", { text: "Quick-add vocabulary" });

    new Setting(contentEl)
      .setName("Word / phrase")
      .addText((t) => t.setValue(this.word).onChange((v) => (this.word = v)));
    new Setting(contentEl)
      .setName("Sentence in context")
      .addTextArea((t) => t.setValue(this.sentence).onChange((v) => (this.sentence = v)));
    new Setting(contentEl)
      .setName("Source")
      .addText((t) => t.setValue(this.source).onChange((v) => (this.source = v)));
    new Setting(contentEl)
      .setName("Also add to internal SRS deck (FSRS)")
      .addToggle((t) => t.setValue(this.alsoDeck).onChange((v) => (this.alsoDeck = v)));
    new Setting(contentEl)
      .setName("Also export to SR-plugin file")
      .addToggle((t) =>
        t.setValue(this.alsoSRSFile).onChange((v) => (this.alsoSRSFile = v))
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
          try {
            const row = `| ${this.word} | ${escapePipes(this.sentence)} | ${escapePipes(this.source)} |`;
            await appendToTodaySection(this.plugin, "Vocab encountered", row);
            await incrementDoneCounter(this.plugin, "vocab", 1);
            if (this.alsoDeck) {
              await this.plugin.cards.ensureLoaded();
              this.plugin.cards.add({
                type: "vocab",
                front: this.word.trim(),
                back: this.sentence.trim() || this.word.trim(),
                source: this.source.trim(),
                context: this.sentence.trim() || undefined,
              });
              await this.plugin.cards.save();
            }
            if (this.alsoSRSFile) {
              await appendToSRSFile(this.plugin, [
                { word: this.word, sentence: this.sentence, source: this.source },
              ]);
            }
            new Notice(`Added "${this.word}"`);
            this.close();
          } catch (err) {
            console.error("[english-practice-coach] add vocab failed", err);
            new Notice(`Add failed: ${(err as Error).message}`, 10000);
          }
        })
    );
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

export class ShadowingModal extends Modal {
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
          await appendToTodaySection(this.plugin, "Shadowing", entry);
          await incrementDoneCounter(this.plugin, "shadowing_minutes", min);
          new Notice(`Logged ${min} min of shadowing`);
          this.close();
        })
    );
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

export class SpeakingModal extends Modal {
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
      .addText((t) => t.setValue(this.partner).onChange((v) => (this.partner = v)));
    new Setting(contentEl)
      .setName("Minutes")
      .addText((t) => t.setValue(this.minutes).onChange((v) => (this.minutes = v)));
    new Setting(contentEl).setName("Topic").addText((t) => t.onChange((v) => (this.topic = v)));
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
          const noteLine = this.notes.trim() ? `\n  - stuck on: ${this.notes.trim()}` : "";
          const entry = `- **${min} min** — speaking with ${this.partner} — ${topic}${noteLine}`;
          await appendToTodaySection(this.plugin, "Speaking (LLM voice / self-talk)", entry);
          await incrementDoneCounter(this.plugin, "speaking_minutes", min);
          new Notice(`Logged ${min} min of speaking`);
          this.close();
        })
    );
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

export class CorrectionModal extends Modal {
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
    contentEl.createEl("div", { cls: "epc-text", text: this.original });

    contentEl.createEl("h3", { text: "Corrected" });
    contentEl.createEl("div", { cls: "epc-text epc-corrected", text: this.result.corrected });

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
      contentEl.createEl("p", { text: "No specific changes flagged.", cls: "epc-why" });
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
