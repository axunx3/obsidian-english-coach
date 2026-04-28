import { App, Modal, Notice, Setting } from "obsidian";
import { appendToSRSFile, appendToTodaySection, escapePipes, incrementDoneCounter } from "../daily";
import { freeDictionaryLookup, type DictResult } from "../llm";
import type EnglishPracticePlugin from "../main";
import { MineSentenceModal } from "./mine";

/**
 * Dictionary lookup popup with three speedups:
 *   1. Persistent cache — same word reopened = instant.
 *   2. Free-dict preview races the LLM and renders within ~1 s; the
 *      richer LLM result swaps in when it arrives (only LLM is cached).
 *   3. The LLMService uses a faster (Haiku) model by default for lookups.
 */
export class LookupModal extends Modal {
  plugin: EnglishPracticePlugin;
  word: string;
  context?: string;
  result?: DictResult;
  loading = true;
  errorMsg?: string;
  badge = ""; // "cached" | "fast preview · loading better answer…" | ""

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

    // 1. Cache hit — instant
    await this.plugin.lookups.ensureLoaded();
    const cached = this.plugin.lookups.get(this.word);
    if (cached) {
      this.result = cached;
      this.loading = false;
      this.badge = "cached";
      this.render();
      return;
    }

    const useLLM =
      this.plugin.settings.dictSource === "llm" && this.plugin.isLLMReady();

    // 2. Always start free-dict in parallel for fast first paint.
    const freeP = freeDictionaryLookup(this.word).catch(() => null);

    // Render free-dict result as soon as it arrives, but only if the LLM
    // hasn't already filled `result`.
    freeP.then((r) => {
      if (this.result || !r) return;
      this.result = r;
      this.badge = useLLM ? "fast preview · loading better answer…" : "";
      this.loading = false;
      this.render();
    });

    // 3. LLM (richer, slower) — only in LLM mode.
    if (useLLM) {
      try {
        const r = await this.plugin.llm.lookupWord(this.word, this.context);
        this.result = r;
        this.errorMsg = undefined;
        this.badge = "";
        this.loading = false;
        // fire-and-forget cache write
        void this.plugin.lookups.set(this.word, r);
        this.render();
      } catch (e) {
        const llmErr = (e as Error).message;
        // If the free-dict preview already rendered, swallow the LLM error
        // (we have something to show); otherwise wait for free-dict to finish.
        if (!this.result) {
          const freeR = await freeP;
          if (freeR) {
            this.result = freeR;
            this.badge = `LLM failed: ${llmErr}`;
            this.loading = false;
            this.render();
          } else {
            this.errorMsg = llmErr;
            this.loading = false;
            this.render();
          }
        }
      }
    } else {
      // free-dict-only mode: just wait for free-dict.
      const r = await freeP;
      if (r) {
        this.result = r;
        this.loading = false;
        void this.plugin.lookups.set(this.word, r);
        this.render();
      } else if (!this.result) {
        this.errorMsg = "Dictionary lookup failed.";
        this.loading = false;
        this.render();
      }
    }
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h2", { text: this.word });

    if (this.badge) {
      contentEl.createEl("p", { cls: "epc-badge", text: this.badge });
    }

    if (this.loading && !this.result) {
      contentEl.createEl("p", { cls: "epc-why", text: "Looking up…" });
      return;
    }
    if (this.errorMsg && !this.result) {
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
