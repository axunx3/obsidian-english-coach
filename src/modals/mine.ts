import { App, Modal, Notice, Setting } from "obsidian";
import { appendToTodaySection } from "../daily";
import type EnglishPracticePlugin from "../main";

/**
 * Sentence-mining modal. The user pastes/passes a sentence, picks one or more
 * target words by clicking them, and saves a cloze card to the deck.
 */
export class MineSentenceModal extends Modal {
  plugin: EnglishPracticePlugin;
  sentence: string;
  source = "";
  notes = "";
  targets = new Set<number>(); // token indexes
  tokens: string[]; // word boundary tokens (preserves spaces/punct)

  constructor(app: App, plugin: EnglishPracticePlugin, initialSentence: string) {
    super(app);
    this.plugin = plugin;
    this.sentence = initialSentence;
    this.tokens = tokenize(initialSentence);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass("epc-modal");
    contentEl.addClass("epc-mine");
    contentEl.createEl("h2", { text: "Mine sentence" });
    contentEl.createEl("p", {
      cls: "epc-why",
      text: "Click any word in the sentence below to mark it as the cloze answer (click again to unmark). The preview at the bottom shows what the front of the card will look like.",
    });

    const sentenceEl = contentEl.createDiv({ cls: "epc-sentence" });
    this.renderTokens(sentenceEl);

    new Setting(contentEl)
      .setName("Source (paper, podcast, conversation…)")
      .addText((t) => t.onChange((v) => (this.source = v)));

    new Setting(contentEl)
      .setName("Notes (optional)")
      .addTextArea((t) => t.onChange((v) => (this.notes = v)));

    contentEl.createEl("h3", { text: "Card preview" });
    const preview = contentEl.createDiv({ cls: "epc-text epc-corrected" });
    const updatePreview = () => {
      preview.setText(this.frontText());
    };
    updatePreview();

    contentEl.querySelectorAll<HTMLElement>(".epc-token-word").forEach((el) => {
      el.addEventListener("click", updatePreview);
    });

    const buttons = contentEl.createDiv({ cls: "epc-buttons" });
    new Setting(buttons)
      .addButton((b) =>
        b
          .setButtonText("Save card")
          .setCta()
          .onClick(async () => {
            if (this.targets.size === 0) {
              new Notice("Click at least one word in the sentence above to mark it as cloze.");
              return;
            }
            try {
              await this.plugin.cards.ensureLoaded();
              const front = this.frontText();
              const back = this.tokens.join("");
              this.plugin.cards.add({
                type: "cloze",
                front,
                back,
                source: this.source,
                context: back,
              });
              await this.plugin.cards.save();

              const minedLine = `- "${back}" — ${this.source || "(no source)"}${
                this.notes ? `\n  - ${this.notes}` : ""
              }`;
              await appendToTodaySection(this.plugin, "Mined sentences", minedLine);

              new Notice(
                `Mined: ${this.targetsAsString()} (${this.plugin.cards.counts().total} total)`
              );
              this.close();
            } catch (err) {
              console.error("[english-practice-coach] mine sentence failed", err);
              new Notice(`Mine failed: ${(err as Error).message}`, 10000);
            }
          })
      )
      .addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()));
  }

  private renderTokens(parent: HTMLElement): void {
    parent.empty();
    this.tokens.forEach((tok, i) => {
      if (/\w/.test(tok)) {
        const span = parent.createSpan({ cls: "epc-token-word", text: tok });
        if (this.targets.has(i)) span.addClass("epc-target");
        span.addEventListener("click", () => {
          if (this.targets.has(i)) this.targets.delete(i);
          else this.targets.add(i);
          this.renderTokens(parent);
          // re-bind preview update — simplest is to rerender the sentence area
          parent.dispatchEvent(new Event("epc-rerender"));
          // also trigger preview update via global selector
          const previews = this.contentEl.querySelectorAll<HTMLElement>(".epc-corrected");
          previews.forEach((p) => p.setText(this.frontText()));
        });
      } else {
        parent.createSpan({ cls: "epc-token-punct", text: tok });
      }
    });
  }

  private frontText(): string {
    if (this.targets.size === 0) return this.tokens.join("");
    return this.tokens
      .map((tok, i) =>
        this.targets.has(i) ? "____" : tok
      )
      .join("");
  }

  private targetsAsString(): string {
    return [...this.targets]
      .sort((a, b) => a - b)
      .map((i) => this.tokens[i])
      .join(", ");
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

export function tokenize(s: string): string[] {
  // Split into runs of word chars and runs of non-word chars, preserving order.
  return s.match(/(\w[\w'-]*|\W+)/g) ?? [s];
}
