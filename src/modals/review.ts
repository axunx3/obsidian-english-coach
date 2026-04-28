import { App, Modal, Notice, Setting } from "obsidian";
import { Grade, Rating } from "ts-fsrs";
import type EnglishPracticePlugin from "../main";
import { DeckCard } from "../srs/store";

/**
 * Review session — flips through due cards, lets the user grade each.
 */
export class ReviewModal extends Modal {
  plugin: EnglishPracticePlugin;
  queue: DeckCard[];
  index = 0;
  showingAnswer = false;
  rated = 0;

  constructor(app: App, plugin: EnglishPracticePlugin, queue: DeckCard[]) {
    super(app);
    this.plugin = plugin;
    this.queue = queue;
  }

  onOpen(): void {
    this.contentEl.addClass("epc-modal");
    this.contentEl.addClass("epc-review");
    this.render();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();

    if (this.index >= this.queue.length) {
      contentEl.createEl("h2", { text: "Review complete 🎉" });
      contentEl.createEl("p", {
        text: `You rated ${this.rated} card${this.rated === 1 ? "" : "s"}. Come back tomorrow for the next batch.`,
      });
      const counts = this.plugin.cards.counts();
      contentEl.createEl("p", {
        cls: "epc-why",
        text: `Deck: ${counts.total} total · ${counts.due} due · ${counts.newCards} new · ${counts.review} review`,
      });
      new Setting(contentEl).addButton((b) =>
        b.setButtonText("Close").setCta().onClick(() => this.close())
      );
      return;
    }

    const card = this.queue[this.index];
    contentEl.createEl("h2", {
      text: `Review (${this.index + 1} / ${this.queue.length})`,
    });

    contentEl.createEl("h3", { text: card.type === "cloze" ? "Cloze" : "Vocab" });
    const front = contentEl.createDiv({ cls: "epc-text" });
    front.setText(card.front);

    if (this.showingAnswer) {
      contentEl.createEl("h3", { text: "Answer" });
      contentEl.createDiv({ cls: "epc-text epc-corrected", text: card.back });
      if (card.source) {
        contentEl.createEl("p", { cls: "epc-why", text: `Source: ${card.source}` });
      }

      const buttons = contentEl.createDiv({ cls: "epc-buttons epc-rating" });
      new Setting(buttons)
        .addButton((b) =>
          b.setButtonText("Again").setWarning().onClick(() => this.rate(Rating.Again))
        )
        .addButton((b) => b.setButtonText("Hard").onClick(() => this.rate(Rating.Hard)))
        .addButton((b) =>
          b.setButtonText("Good").setCta().onClick(() => this.rate(Rating.Good))
        )
        .addButton((b) => b.setButtonText("Easy").onClick(() => this.rate(Rating.Easy)));
    } else {
      const buttons = contentEl.createDiv({ cls: "epc-buttons" });
      new Setting(buttons).addButton((b) =>
        b
          .setButtonText("Show answer")
          .setCta()
          .onClick(() => {
            this.showingAnswer = true;
            this.render();
          })
      );
    }

    contentEl.createEl("p", {
      cls: "epc-why epc-deck-line",
      text: deckLine(this.plugin),
    });
  }

  private async rate(rating: Grade): Promise<void> {
    const card = this.queue[this.index];
    this.plugin.cards.rate(card.id, rating);
    await this.plugin.cards.save();
    this.rated++;
    this.index++;
    this.showingAnswer = false;
    this.render();
  }

  onClose(): void {
    if (this.rated > 0) new Notice(`Reviewed ${this.rated} card(s).`);
    this.contentEl.empty();
  }
}

function deckLine(plugin: EnglishPracticePlugin): string {
  const c = plugin.cards.counts();
  return `Deck: ${c.total} total · ${c.due} due · ${c.newCards} new · ${c.learning} learning · ${c.review} review`;
}
