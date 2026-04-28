import { App, normalizePath, TFile } from "obsidian";
import {
  Card as FsrsCard,
  createEmptyCard,
  fsrs,
  generatorParameters,
  Grade,
  Rating,
  State as FsrsState,
} from "ts-fsrs";
import { v4 as uuid } from "uuid";

export interface DeckCard {
  id: string;
  type: "vocab" | "cloze";
  front: string;
  back: string;
  source: string;
  context?: string; // for cloze: the original full sentence (with cloze markup)
  created: number;
  fsrs: FsrsCard;
}

export interface DeckCounts {
  total: number;
  due: number;
  newCards: number;
  learning: number;
  review: number;
}

export class CardStore {
  private cards: DeckCard[] = [];
  private loaded = false;
  private path: string;
  private scheduler = fsrs(generatorParameters({ enable_fuzz: true }));

  constructor(private app: App, private rootFolder: string) {
    this.path = normalizePath(`${rootFolder}/.epc-cards.json`);
  }

  setRoot(root: string) {
    this.rootFolder = root;
    this.path = normalizePath(`${root}/.epc-cards.json`);
    this.loaded = false;
  }

  async load(): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(this.path);
    if (!(file instanceof TFile)) {
      this.cards = [];
      this.loaded = true;
      return;
    }
    try {
      const text = await this.app.vault.read(file);
      const parsed = JSON.parse(text);
      this.cards = (Array.isArray(parsed) ? parsed : []).map(rehydrate);
    } catch {
      this.cards = [];
    }
    this.loaded = true;
  }

  async save(): Promise<void> {
    if (!this.loaded) return;
    const data = JSON.stringify(this.cards, null, 2);
    let file = this.app.vault.getAbstractFileByPath(this.path);
    if (file instanceof TFile) {
      await this.app.vault.modify(file, data);
    } else {
      // Make sure root folder exists
      if (!this.app.vault.getAbstractFileByPath(this.rootFolder)) {
        await this.app.vault.createFolder(this.rootFolder);
      }
      await this.app.vault.create(this.path, data);
    }
  }

  async ensureLoaded(): Promise<void> {
    if (!this.loaded) await this.load();
  }

  all(): DeckCard[] {
    return this.cards.slice();
  }

  counts(): DeckCounts {
    const now = new Date();
    let due = 0,
      newCards = 0,
      learning = 0,
      review = 0;
    for (const c of this.cards) {
      const dueDate = new Date(c.fsrs.due);
      if (dueDate <= now) due++;
      switch (c.fsrs.state) {
        case FsrsState.New:
          newCards++;
          break;
        case FsrsState.Learning:
        case FsrsState.Relearning:
          learning++;
          break;
        case FsrsState.Review:
          review++;
          break;
      }
    }
    return { total: this.cards.length, due, newCards, learning, review };
  }

  getDue(limit = 50): DeckCard[] {
    const now = new Date();
    return this.cards
      .filter((c) => new Date(c.fsrs.due) <= now)
      .sort((a, b) => +new Date(a.fsrs.due) - +new Date(b.fsrs.due))
      .slice(0, limit);
  }

  add(card: Omit<DeckCard, "id" | "created" | "fsrs">): DeckCard {
    const c: DeckCard = {
      id: uuid(),
      created: Date.now(),
      fsrs: createEmptyCard(new Date()),
      ...card,
    };
    this.cards.push(c);
    return c;
  }

  /** Apply a rating to a card. Returns the updated card. */
  rate(cardId: string, rating: Grade): DeckCard | null {
    const card = this.cards.find((c) => c.id === cardId);
    if (!card) return null;
    const now = new Date();
    const result = this.scheduler.repeat(card.fsrs, now);
    const next = result[rating];
    card.fsrs = next.card;
    return card;
  }

  remove(cardId: string): boolean {
    const i = this.cards.findIndex((c) => c.id === cardId);
    if (i === -1) return false;
    this.cards.splice(i, 1);
    return true;
  }
}

/**
 * After JSON.parse, `due` and `last_review` come back as strings — rehydrate to Date.
 */
function rehydrate(raw: any): DeckCard {
  const fsrsCard: FsrsCard = {
    ...raw.fsrs,
    due: new Date(raw.fsrs.due),
    last_review: raw.fsrs.last_review ? new Date(raw.fsrs.last_review) : undefined,
  };
  return {
    id: String(raw.id),
    type: raw.type === "cloze" ? "cloze" : "vocab",
    front: String(raw.front ?? ""),
    back: String(raw.back ?? ""),
    source: String(raw.source ?? ""),
    context: raw.context ? String(raw.context) : undefined,
    created: Number(raw.created) || Date.now(),
    fsrs: fsrsCard,
  };
}

export { Rating } from "ts-fsrs";
