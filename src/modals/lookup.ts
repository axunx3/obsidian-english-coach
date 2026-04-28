import { App, Modal, Notice, Setting } from "obsidian";
import { appendToSRSFile, appendToTodaySection, escapePipes, incrementDoneCounter } from "../daily";
import { freeDictionaryLookup, type DictResult } from "../llm";
import type EnglishPracticePlugin from "../main";
import { MineSentenceModal } from "./mine";

/**
 * Dictionary lookup popup. Looks up the word (LLM or Free Dictionary API),
 * shows definition + IPA + examples, with one-click "add to vocab" / "mine sentence".
 */
export class LookupModal extends Modal {
  plugin: EnglishPracticePlugin;
  word: string;
  context?: string;
  result?: DictResult;
  loading = true;
  errorMsg?: string;

  constructor(app: App, plugin: EnglishPracticePlugin, word: string, context?: string) {
    super(app);
    this.plugin = plugin;
    this.word = word.trim();
    this.context = context;
  }

  async onOpen(): Promise<void> {
    this.contentEl.addClass("epc-modal");
    this.contentEl.addClass("epc-lookup");
    this.render();
    try {
      if (this.plugin.settings.dictSource === "llm") {
        if (!this.plugin.isLLMReady()) throw new Error(this.plugin.llmNotReadyMsg());
        this.result = await this.plugin.llm.lookupWord(this.word, this.context);
      } else {
        this.result = await freeDictionaryLookup(this.word);
      }
    } catch (e) {
      this.errorMsg = (e as Error).message;
    }
    this.loading = false;
    this.render();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h2", { text: this.word });

    if (this.loading) {
      contentEl.createEl("p", { cls: "epc-why", text: "Looking up…" });
      return;
    }
    if (this.errorMsg) {
      contentEl.createEl("p", { cls: "epc-text", text: `Error: ${this.errorMsg}` });
      new Setting(contentEl).addButton((b) =>
        b.setButtonText("Close").setCta().onClick(() => this.close())
      );
      return;
    }
    if (!this.result) return;
    const r = this.result;

    const meta = contentEl.createDiv({ cls: "epc-meta" });
    if (r.ipa) meta.createEl("span", { cls: "epc-ipa", text: r.ipa });
    if (r.pos) meta.createEl("span", { cls: "epc-pos", text: r.pos });

    if (r.definition_en) {
      contentEl.createEl("h3", { text: "Definition" });
      contentEl.createDiv({ cls: "epc-text", text: r.definition_en });
    }
    if (r.definition_zh) {
      contentEl.createEl("h3", { text: "中文" });
      contentEl.createDiv({ cls: "epc-text", text: r.definition_zh });
    }
    if (r.examples?.length) {
      contentEl.createEl("h3", { text: "Examples" });
      const ul = contentEl.createEl("ul");
      for (const ex of r.examples) ul.createEl("li", { text: ex });
    }
    if (r.related?.length) {
      contentEl.createEl("h3", { text: "Related" });
      contentEl.createEl("p", { cls: "epc-why", text: r.related.join(", ") });
    }

    const buttons = contentEl.createDiv({ cls: "epc-buttons" });
    new Setting(buttons)
      .addButton((b) =>
        b
          .setButtonText("Add to vocab")
          .setCta()
          .onClick(async () => {
            const sentence = this.context || r.examples?.[0] || "";
            const row = `| ${this.word} | ${escapePipes(sentence)} | ${escapePipes("dictionary lookup")} |`;
            await appendToTodaySection(this.plugin, "Vocab encountered", row);
            await incrementDoneCounter(this.plugin, "vocab", 1);
            await this.plugin.cards.ensureLoaded();
            this.plugin.cards.add({
              type: "vocab",
              front: this.word,
              back: r.definition_en || sentence || this.word,
              source: "dictionary lookup",
              context: sentence || undefined,
            });
            await this.plugin.cards.save();
            if (this.plugin.settings.srsExportEnabled) {
              await appendToSRSFile(this.plugin, [
                { word: this.word, sentence, source: "dictionary lookup" },
              ]);
            }
            new Notice(`Added "${this.word}" to deck`);
            this.close();
          })
      )
      .addButton((b) =>
        b.setButtonText("Mine the sentence").onClick(() => {
          const sentence = this.context || r.examples?.[0] || "";
          if (!sentence) {
            new Notice("No sentence to mine.");
            return;
          }
          this.close();
          new MineSentenceModal(this.app, this.plugin, sentence).open();
        })
      )
      .addButton((b) => b.setButtonText("Close").onClick(() => this.close()));
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
