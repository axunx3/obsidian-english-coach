import {
  Editor,
  MarkdownView,
  Notice,
  Plugin,
  TFile,
  WorkspaceLeaf,
  // @ts-ignore obsidian re-exports moment
  moment,
} from "obsidian";
import {
  appendToTodaySection,
  appendToSRSFile,
  escapePipes,
  extractSection,
  incrementDoneCounter,
  openDailyNote,
  openWeeklyReview,
  parseVocabTable,
  replaceSection,
  getOrCreateDaily,
  dailyPath,
} from "./daily";
import { findClaudeCli, LLMService } from "./llm";
import {
  CorrectionModal,
  ShadowingModal,
  SpeakingModal,
  VocabModal,
} from "./modals/basic";
import { LookupModal } from "./modals/lookup";
import { MineSentenceModal } from "./modals/mine";
import { ReviewModal } from "./modals/review";
import {
  DEFAULT_SETTINGS,
  EnglishPracticeSettings,
  EnglishPracticeSettingTab,
  LlmProvider,
} from "./settings";
import { CardStore } from "./srs/store";
import { CHAT_VIEW_TYPE, ChatView } from "./views/chat-view";

export default class EnglishPracticePlugin extends Plugin {
  settings!: EnglishPracticeSettings;
  statusBarEl!: HTMLElement;
  llm!: LLMService;
  cards!: CardStore;

  async onload() {
    await this.loadSettings();
    await this.maybeAutoDetectClaudePath();
    this.llm = new LLMService(this);
    this.cards = new CardStore(this.app, this.settings.rootFolder);

    this.registerView(CHAT_VIEW_TYPE, (leaf: WorkspaceLeaf) => new ChatView(leaf, this));

    this.addRibbonIcon("languages", "Open today's English practice", () => {
      void openDailyNote(this);
    });
    this.addRibbonIcon("message-circle", "Open English chat panel", () => {
      void this.activateChatView();
    });

    this.statusBarEl = this.addStatusBarItem();
    this.statusBarEl.addClass("epc-status");
    await this.refreshStatusBar();
    this.statusBarEl.addEventListener("click", () => void this.openReviewSession());

    // -- core
    this.addCommand({
      id: "open-daily",
      name: "Open today's practice note",
      callback: () => openDailyNote(this),
    });
    this.addCommand({
      id: "open-weekly",
      name: "Open this week's review",
      callback: () => openWeeklyReview(this),
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

    // -- LLM
    this.addCommand({
      id: "correct-selection",
      name: "Correct selected English (LLM)",
      editorCallback: (editor: Editor) => this.correctSelection(editor),
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

    // -- SR-file (legacy)
    this.addCommand({
      id: "sync-vocab-to-srs",
      name: "Sync today's vocab to SR-file",
      callback: () => this.syncTodayVocabToSRS(),
    });

    // -- new in v0.5
    this.addCommand({
      id: "mine-sentence",
      name: "Mine sentence (sentence → cloze card)",
      editorCallback: (editor: Editor) => this.mineSelection(editor),
    });
    this.addCommand({
      id: "lookup-word",
      name: "Look up word at cursor (dictionary)",
      editorCallback: (editor: Editor, view: MarkdownView) => this.lookupAtCursor(editor),
    });
    this.addCommand({
      id: "review-due",
      name: "Review due cards (FSRS)",
      callback: () => this.openReviewSession(),
    });
    this.addCommand({
      id: "open-chat",
      name: "Open English chat panel",
      callback: () => this.activateChatView(),
    });
    this.addCommand({
      id: "deck-stats",
      name: "Show deck stats",
      callback: async () => {
        await this.cards.ensureLoaded();
        const c = this.cards.counts();
        new Notice(
          `Deck: ${c.total} total · ${c.due} due · ${c.newCards} new · ${c.learning} learning · ${c.review} review`,
          8000
        );
      },
    });

    this.addSettingTab(new EnglishPracticeSettingTab(this.app, this));

    this.registerInterval(
      window.setInterval(() => this.refreshStatusBar(), 60_000)
    );
  }

  onunload() {
    if (window.speechSynthesis) window.speechSynthesis.cancel();
  }

  // ------------------------------- settings I/O

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }
  async saveSettings() {
    await this.saveData(this.settings);
    if (this.cards) this.cards.setRoot(this.settings.rootFolder);
  }

  async maybeAutoDetectClaudePath(): Promise<void> {
    if (this.settings.claudeBinPath && this.settings.claudeBinPath !== "claude") return;
    try {
      const detected = findClaudeCli();
      if (detected && detected !== this.settings.claudeBinPath) {
        this.settings.claudeBinPath = detected;
        await this.saveSettings();
      }
    } catch {
      // ignore
    }
  }

  // ------------------------------- chat history persistence

  async loadChatHistory(): Promise<any[] | null> {
    const data = await this.loadData();
    return data?.__chat ?? null;
  }
  async saveChatHistory(messages: any[]): Promise<void> {
    const cap = messages.slice(-200); // cap so plugin data doesn't bloat
    const data = (await this.loadData()) ?? {};
    data.__chat = cap;
    await this.saveData(data);
  }

  // ------------------------------- LLM gates

  isLLMReady(): boolean {
    const p = this.settings.llmProvider;
    if (p === "none") return false;
    if (p === "claude-cli") return Boolean(this.settings.claudeBinPath);
    return Boolean(this.settings.llmApiKey);
  }
  llmNotReadyMsg(): string {
    if (this.settings.llmProvider === "claude-cli")
      return "Set the Claude Code binary path in plugin settings.";
    return "Configure an LLM provider + API key in plugin settings first.";
  }

  // ------------------------------- chat view activation

  async activateChatView(): Promise<void> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(CHAT_VIEW_TYPE)[0];
    if (!leaf) {
      leaf = workspace.getRightLeaf(false) ?? workspace.getLeaf(true);
      await leaf.setViewState({ type: CHAT_VIEW_TYPE, active: true });
    }
    workspace.revealLeaf(leaf);
  }

  // ------------------------------- LLM commands

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
      new CorrectionModal(this.app, selection, result, (corrected) =>
        editor.replaceSelection(corrected)
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
    const file = await getOrCreateDaily(this);
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
      const file = await getOrCreateDaily(this);
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

  // ------------------------------- TTS

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
    const file = await getOrCreateDaily(this);
    const text = await this.app.vault.read(file);
    const section = extractSection(text, "Output journal");
    if (!section.body.trim()) {
      new Notice("Output journal is empty.");
      return;
    }
    this.speakText(section.body);
  }

  // ------------------------------- SR-file (legacy)

  async syncTodayVocabToSRS(): Promise<void> {
    const file = await getOrCreateDaily(this);
    const text = await this.app.vault.read(file);
    const rows = parseVocabTable(text);
    if (rows.length === 0) {
      new Notice("No vocab in today's note.");
      return;
    }
    const added = await appendToSRSFile(this, rows);
    new Notice(`Synced ${added} new card(s) to SR-file.`);
  }

  // ------------------------------- mine + lookup + review

  mineSelection(editor: Editor): void {
    const selection = editor.getSelection().trim();
    if (!selection) {
      new Notice("Select a sentence first.");
      return;
    }
    new MineSentenceModal(this.app, this, selection).open();
  }

  lookupAtCursor(editor: Editor): void {
    const selection = editor.getSelection().trim();
    let word: string;
    let context: string | undefined;
    if (selection) {
      word = selection.split(/\s+/)[0];
      context = selection;
    } else {
      const cursor = editor.getCursor();
      const line = editor.getLine(cursor.line);
      const match = wordAtCol(line, cursor.ch);
      if (!match) {
        new Notice("No word at cursor.");
        return;
      }
      word = match;
      context = line;
    }
    if (!word) {
      new Notice("No word at cursor.");
      return;
    }
    new LookupModal(this.app, this, word, context).open();
  }

  async openReviewSession(): Promise<void> {
    await this.cards.ensureLoaded();
    const queue = this.cards.getDue(this.settings.reviewBatchSize);
    if (queue.length === 0) {
      const c = this.cards.counts();
      new Notice(
        c.total === 0
          ? "Deck is empty. Mine a sentence or add vocab to get started."
          : `No cards due right now. Deck has ${c.total} card(s).`,
        6000
      );
      return;
    }
    new ReviewModal(this.app, this, queue).open();
  }

  // ------------------------------- status bar

  async refreshStatusBar(): Promise<void> {
    const date = moment().format("YYYY-MM-DD");
    const path = dailyPath(this, date);
    const file = this.app.vault.getAbstractFileByPath(path);
    const s = this.settings;

    let sM = 0,
      shM = 0,
      v = 0;
    if (file instanceof TFile) {
      const cache = this.app.metadataCache.getFileCache(file);
      const done = (cache?.frontmatter as any)?.done ?? {};
      sM = Number(done.speaking_minutes) || 0;
      shM = Number(done.shadowing_minutes) || 0;
      v = Number(done.vocab) || 0;
    }

    let due = 0;
    if (this.cards) {
      try {
        await this.cards.ensureLoaded();
        due = this.cards.counts().due;
      } catch {
        // ignore
      }
    }

    this.statusBarEl.setText(
      `🗣 ${sM}/${s.speakingGoalMinutes}m · 🎧 ${shM}/${s.shadowingGoalMinutes}m · 📖 ${v}/${s.vocabGoalPerDay} · 🃏 ${due}`
    );
    this.statusBarEl.title = "Click to start a review session";
  }
}

// ---------------- helpers

function wordAtCol(line: string, col: number): string | null {
  if (col < 0 || col > line.length) return null;
  // Expand left
  let l = col;
  while (l > 0 && /[\w'-]/.test(line[l - 1])) l--;
  // Expand right
  let r = col;
  while (r < line.length && /[\w'-]/.test(line[r])) r++;
  if (l === r) return null;
  return line.slice(l, r);
}

export type { EnglishPracticeSettings, LlmProvider };
