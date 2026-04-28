import { App, normalizePath, TFile } from "obsidian";
import type { DictResult } from "./llm";

/**
 * Persistent cache for dictionary lookups, keyed by lowercased word.
 * Stored at `<rootFolder>/.epc-lookups.json` so it survives reloads and
 * (optionally) syncs across devices via Obsidian Sync.
 */
export class LookupCache {
  private map = new Map<string, DictResult>();
  private loaded = false;
  private path: string;

  constructor(private app: App, private rootFolder: string) {
    this.path = normalizePath(`${rootFolder}/.epc-lookups.json`);
  }

  setRoot(root: string): void {
    this.rootFolder = root;
    this.path = normalizePath(`${root}/.epc-lookups.json`);
    this.loaded = false;
  }

  async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    const file = this.app.vault.getAbstractFileByPath(this.path);
    if (!(file instanceof TFile)) {
      this.map = new Map();
      this.loaded = true;
      return;
    }
    try {
      const text = await this.app.vault.read(file);
      const obj = JSON.parse(text);
      this.map = new Map(Object.entries(obj));
    } catch {
      this.map = new Map();
    }
    this.loaded = true;
  }

  get(word: string): DictResult | undefined {
    return this.map.get(key(word));
  }

  async set(word: string, r: DictResult): Promise<void> {
    if (!this.loaded) await this.ensureLoaded();
    this.map.set(key(word), r);
    await this.save();
  }

  size(): number {
    return this.map.size;
  }

  async clear(): Promise<void> {
    this.map.clear();
    await this.save();
  }

  private async save(): Promise<void> {
    const data = JSON.stringify(Object.fromEntries(this.map.entries()), null, 0);
    let file = this.app.vault.getAbstractFileByPath(this.path);
    if (file instanceof TFile) {
      await this.app.vault.modify(file, data);
    } else {
      if (!this.app.vault.getAbstractFileByPath(this.rootFolder)) {
        await this.app.vault.createFolder(this.rootFolder);
      }
      await this.app.vault.create(this.path, data);
    }
  }
}

function key(word: string): string {
  return word.trim().toLowerCase();
}
