import { ItemView, Notice, Setting, WorkspaceLeaf } from "obsidian";
import { appendToTodaySection, incrementDoneCounter } from "../daily";
import type EnglishPracticePlugin from "../main";

export const CHAT_VIEW_TYPE = "english-practice-chat";

interface ChatMessage {
  role: "user" | "assistant" | "correction";
  content: string;
  ts: number;
}

export class ChatView extends ItemView {
  plugin: EnglishPracticePlugin;
  messages: ChatMessage[] = [];
  inputEl!: HTMLTextAreaElement;
  messagesEl!: HTMLElement;
  correctionMode: boolean;
  busy = false;
  startedAt = Date.now();
  lastLoggedTotal = 0;
  hasUserInteracted = false;

  constructor(leaf: WorkspaceLeaf, plugin: EnglishPracticePlugin) {
    super(leaf);
    this.plugin = plugin;
    this.correctionMode = plugin.settings.chatCorrectionMode;
  }

  getViewType(): string {
    return CHAT_VIEW_TYPE;
  }
  getDisplayText(): string {
    return "English chat";
  }
  getIcon(): string {
    return "message-circle";
  }

  async onOpen(): Promise<void> {
    this.messages = (await this.plugin.loadChatHistory()) ?? [];
    this.startedAt = Date.now();

    const root = this.contentEl;
    root.empty();
    root.addClass("epc-chat");

    const header = root.createDiv({ cls: "epc-chat-header" });
    header.createEl("h3", { text: "English Chat" });

    const controls = header.createDiv({ cls: "epc-chat-controls" });
    const correctionToggle = controls.createEl("label", { cls: "epc-toggle" });
    const cb = correctionToggle.createEl("input", { type: "checkbox" });
    cb.checked = this.correctionMode;
    correctionToggle.createSpan({ text: " Correction mode" });
    cb.addEventListener("change", () => (this.correctionMode = cb.checked));

    const clearBtn = controls.createEl("button", { text: "Clear", cls: "mod-warning" });
    clearBtn.addEventListener("click", async () => {
      this.messages = [];
      await this.plugin.saveChatHistory(this.messages);
      this.renderMessages();
    });

    this.messagesEl = root.createDiv({ cls: "epc-chat-messages" });
    this.renderMessages();

    const inputWrap = root.createDiv({ cls: "epc-chat-input-wrap" });
    this.inputEl = inputWrap.createEl("textarea", { cls: "epc-chat-input" });
    this.inputEl.placeholder = "Type in English… (Cmd+Enter to send)";
    this.inputEl.rows = 3;
    this.inputEl.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey)) {
        ev.preventDefault();
        void this.send();
      }
    });
    const sendBtn = inputWrap.createEl("button", {
      text: "Send",
      cls: "mod-cta epc-chat-send",
    });
    sendBtn.addEventListener("click", () => void this.send());

  }

  async onClose(): Promise<void> {
    await this.logSessionTime();
  }

  private renderMessages(): void {
    this.messagesEl.empty();
    if (this.messages.length === 0) {
      const empty = this.messagesEl.createDiv({ cls: "epc-chat-empty" });
      empty.createEl("p", {
        text: "Start a conversation in English. The model plays a friendly partner.",
      });
      empty.createEl("p", {
        cls: "epc-why",
        text: "Tip: enable Correction mode to get inline corrections after each reply.",
      });
      return;
    }
    for (const m of this.messages) {
      const wrap = this.messagesEl.createDiv({
        cls: `epc-msg epc-msg-${m.role}`,
      });
      wrap.createDiv({ cls: "epc-msg-role", text: roleLabel(m.role) });
      wrap.createDiv({ cls: "epc-msg-content", text: m.content });
    }
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }

  private async send(): Promise<void> {
    if (this.busy) return;
    const text = this.inputEl.value.trim();
    if (!text) return;
    if (!this.plugin.isLLMReady()) {
      new Notice(this.plugin.llmNotReadyMsg());
      return;
    }
    this.busy = true;
    this.hasUserInteracted = true;
    this.inputEl.value = "";

    this.messages.push({ role: "user", content: text, ts: Date.now() });
    this.renderMessages();
    await this.plugin.saveChatHistory(this.messages);

    // 1. Reply
    const thinking = this.messagesEl.createDiv({ cls: "epc-msg epc-msg-thinking" });
    thinking.setText("…");
    try {
      const reply = await this.plugin.llm.chat(
        this.messages
          .filter((m) => m.role !== "correction")
          .map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
        this.plugin.settings.chatPersona
      );
      thinking.remove();
      this.messages.push({ role: "assistant", content: reply.trim(), ts: Date.now() });
      this.renderMessages();
      await this.plugin.saveChatHistory(this.messages);
    } catch (e) {
      thinking.remove();
      new Notice(`Reply failed: ${(e as Error).message}`);
      this.busy = false;
      return;
    }

    // 2. Correction (if enabled)
    if (this.correctionMode) {
      try {
        const correction = await this.plugin.llm.correct(text);
        const note =
          correction.changes.length > 0
            ? `📝 ${correction.corrected}` +
              "\n" +
              correction.changes
                .map((c) => `  • ${c.from} → ${c.to}${c.why ? ` (${c.why})` : ""}`)
                .join("\n")
            : "📝 No changes — this looked natural.";
        this.messages.push({ role: "correction", content: note, ts: Date.now() });
        this.renderMessages();
        await this.plugin.saveChatHistory(this.messages);
      } catch (e) {
        new Notice(`Correction failed: ${(e as Error).message}`);
      }
    }

    this.busy = false;
    this.inputEl.focus();
  }

  /**
   * Log a single line for this whole session on close. Only fires if the user
   * actually sent at least one message AND the session was ≥1 min, to avoid
   * polluting the daily note with stub entries.
   */
  private async logSessionTime(): Promise<void> {
    if (!this.hasUserInteracted) return;
    const totalMin = Math.floor((Date.now() - this.startedAt) / 60_000);
    const delta = totalMin - this.lastLoggedTotal;
    if (delta <= 0) return;
    this.lastLoggedTotal = totalMin;
    const userMessages = this.messages.filter((m) => m.role === "user").length;
    try {
      await appendToTodaySection(
        this.plugin,
        "Speaking (LLM voice / self-talk)",
        `- **${delta} min** — chat panel — ${userMessages} message(s) sent`
      );
      await incrementDoneCounter(this.plugin, "speaking_minutes", delta);
    } catch {
      // ignore
    }
  }
}

function roleLabel(role: ChatMessage["role"]): string {
  if (role === "user") return "You";
  if (role === "assistant") return "Coach";
  return "Correction";
}
