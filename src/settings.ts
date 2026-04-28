import {
  App,
  Notice,
  PluginSettingTab,
  Setting,
} from "obsidian";
import type EnglishPracticePlugin from "./main";
import { findClaudeCli } from "./llm";

export type LlmProvider = "anthropic" | "openai" | "claude-cli" | "none";

export interface EnglishPracticeSettings {
  // -- general
  rootFolder: string;
  speakingGoalMinutes: number;
  shadowingGoalMinutes: number;
  vocabGoalPerDay: number;
  preferredPodcast: string;

  // -- LLM
  llmProvider: LlmProvider;
  llmApiKey: string;
  llmModel: string;
  promptTheme: string;
  claudeBinPath: string;

  // -- legacy SRS-file export (kept for SR plugin users)
  srsExportEnabled: boolean;
  srsFile: string;
  srsTag: string;

  // -- TTS
  ttsVoice: string;
  ttsRate: number;

  // -- dictionary popup
  dictSource: "llm" | "free-dict-api";

  // -- chat view
  chatCorrectionMode: boolean;
  chatPersona: string;

  // -- internal SRS deck (FSRS) — file is at <rootFolder>/.epc-cards.json
  reviewBatchSize: number;
}

export const DEFAULT_SETTINGS: EnglishPracticeSettings = {
  rootFolder: "English Learning",
  speakingGoalMinutes: 15,
  shadowingGoalMinutes: 15,
  vocabGoalPerDay: 5,
  preferredPodcast: "",
  llmProvider: "none",
  llmApiKey: "",
  llmModel: "",
  promptTheme: "research, daily life, casual conversation",
  claudeBinPath: "claude",
  srsExportEnabled: true,
  srsFile: "English Learning/SRS/Vocab.md",
  srsTag: "flashcards",
  ttsVoice: "",
  ttsRate: 1.0,
  dictSource: "llm",
  chatCorrectionMode: false,
  chatPersona:
    "You are a friendly English conversation partner for a Chinese AI PhD student. Keep replies under 4 sentences, ask one follow-up question, use natural casual register.",
  reviewBatchSize: 20,
};

export const DEFAULT_MODELS: Record<LlmProvider, string> = {
  anthropic: "claude-sonnet-4-5",
  openai: "gpt-4o-mini",
  "claude-cli": "claude-sonnet-4-5",
  none: "",
};

export class EnglishPracticeSettingTab extends PluginSettingTab {
  plugin: EnglishPracticePlugin;

  constructor(app: App, plugin: EnglishPracticePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "English Practice Coach" });

    // ---------------- general
    containerEl.createEl("h3", { text: "General" });

    new Setting(containerEl)
      .setName("Root folder")
      .addText((t) =>
        t.setValue(this.plugin.settings.rootFolder).onChange(async (v) => {
          this.plugin.settings.rootFolder = v.trim() || "English Learning";
          await this.plugin.saveSettings();
          await this.plugin.refreshStatusBar();
        })
      );

    new Setting(containerEl)
      .setName("Daily speaking goal (min)")
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
      .setName("Daily shadowing goal (min)")
      .addText((t) =>
        t
          .setValue(String(this.plugin.settings.shadowingGoalMinutes))
          .onChange(async (v) => {
            this.plugin.settings.shadowingGoalMinutes = parseInt(v, 10) || 15;
            await this.plugin.saveSettings();
            await this.plugin.refreshStatusBar();
          })
      );

    new Setting(containerEl).setName("Daily vocab goal").addText((t) =>
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
      .addText((t) =>
        t.setValue(this.plugin.settings.preferredPodcast).onChange(async (v) => {
          this.plugin.settings.preferredPodcast = v;
          await this.plugin.saveSettings();
        })
      );

    // ---------------- LLM
    containerEl.createEl("h3", { text: "LLM (correction, prompts, dictionary, chat)" });
    containerEl.createEl("p", {
      text: "API keys are stored in plugin data on this device. Avoid syncing data.json across devices if you don't want to share keys.",
      cls: "epc-why",
    });

    new Setting(containerEl)
      .setName("Provider")
      .setDesc(
        "'Claude Code CLI' uses your existing claude.ai Pro/Max subscription via the local `claude` binary (desktop only)."
      )
      .addDropdown((d) =>
        d
          .addOption("none", "None (disabled)")
          .addOption("anthropic", "Anthropic API (key)")
          .addOption("openai", "OpenAI API (key)")
          .addOption("claude-cli", "Claude Code CLI (subscription)")
          .setValue(this.plugin.settings.llmProvider)
          .onChange(async (v) => {
            this.plugin.settings.llmProvider = v as LlmProvider;
            await this.plugin.saveSettings();
            this.display();
          })
      );

    if (this.plugin.settings.llmProvider === "claude-cli") {
      new Setting(containerEl)
        .setName("Claude binary path")
        .setDesc(
          "Auto-detected on load. GUI-launched Obsidian doesn't inherit shell PATH on macOS, so absolute paths are most reliable."
        )
        .addText((t) =>
          t.setValue(this.plugin.settings.claudeBinPath).onChange(async (v) => {
            this.plugin.settings.claudeBinPath = v.trim() || "claude";
            await this.plugin.saveSettings();
          })
        )
        .addButton((b) =>
          b.setButtonText("Re-detect").onClick(async () => {
            const detected = findClaudeCli();
            if (detected) {
              this.plugin.settings.claudeBinPath = detected;
              await this.plugin.saveSettings();
              new Notice(`Found: ${detected}`);
              this.display();
            } else {
              new Notice("Claude binary not found in common locations.");
            }
          })
        );
    }

    if (
      this.plugin.settings.llmProvider === "anthropic" ||
      this.plugin.settings.llmProvider === "openai"
    ) {
      new Setting(containerEl).setName("API key").addText((t) => {
        t.inputEl.type = "password";
        t.setValue(this.plugin.settings.llmApiKey).onChange(async (v) => {
          this.plugin.settings.llmApiKey = v;
          await this.plugin.saveSettings();
        });
      });
    }

    new Setting(containerEl)
      .setName("Model (override)")
      .setDesc("Leave blank for provider default.")
      .addText((t) =>
        t.setValue(this.plugin.settings.llmModel).onChange(async (v) => {
          this.plugin.settings.llmModel = v.trim();
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Speaking-prompt themes")
      .addText((t) =>
        t.setValue(this.plugin.settings.promptTheme).onChange(async (v) => {
          this.plugin.settings.promptTheme = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Test LLM connection")
      .addButton((b) =>
        b
          .setButtonText("Run test")
          .setCta()
          .onClick(async () => {
            if (!this.plugin.isLLMReady()) {
              new Notice(this.plugin.llmNotReadyMsg());
              return;
            }
            const loading = new Notice("Testing…", 0);
            const t0 = Date.now();
            try {
              const result = await this.plugin.llm.test();
              loading.hide();
              new Notice(`✓ ${Date.now() - t0} ms — ${result.slice(0, 60)}`, 8000);
            } catch (e) {
              loading.hide();
              new Notice(`✗ ${(e as Error).message}`, 12000);
            }
          })
      );

    // ---------------- Dictionary
    containerEl.createEl("h3", { text: "Dictionary popup" });

    new Setting(containerEl)
      .setName("Lookup source")
      .setDesc(
        "LLM gives best-quality definitions tailored to the sentence. Free dictionary API is offline-fast but generic."
      )
      .addDropdown((d) =>
        d
          .addOption("llm", "LLM (uses configured provider)")
          .addOption("free-dict-api", "Free Dictionary API (no key)")
          .setValue(this.plugin.settings.dictSource)
          .onChange(async (v) => {
            this.plugin.settings.dictSource = v as "llm" | "free-dict-api";
            await this.plugin.saveSettings();
          })
      );

    // ---------------- Chat
    containerEl.createEl("h3", { text: "Conversation panel" });

    new Setting(containerEl)
      .setName("Correction mode by default")
      .setDesc("Each user message gets an inline correction after the assistant reply.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.chatCorrectionMode).onChange(async (v) => {
          this.plugin.settings.chatCorrectionMode = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Conversation persona / system prompt")
      .addTextArea((t) =>
        t.setValue(this.plugin.settings.chatPersona).onChange(async (v) => {
          this.plugin.settings.chatPersona = v;
          await this.plugin.saveSettings();
        })
      );

    // ---------------- SRS
    containerEl.createEl("h3", { text: "Spaced repetition (FSRS, built-in)" });

    new Setting(containerEl)
      .setName("Review batch size")
      .setDesc("Max cards per review session.")
      .addText((t) =>
        t
          .setValue(String(this.plugin.settings.reviewBatchSize))
          .onChange(async (v) => {
            this.plugin.settings.reviewBatchSize = parseInt(v, 10) || 20;
            await this.plugin.saveSettings();
          })
      );

    containerEl.createEl("p", {
      text: "Cards are stored at `<root>/.epc-cards.json`. Powered by ts-fsrs.",
      cls: "epc-why",
    });

    // ---------------- legacy SRS file
    containerEl.createEl("h3", { text: "SRS-file export (Spaced Repetition plugin)" });
    containerEl.createEl("p", {
      text: "Optional: also export new vocab to a markdown file using the `::` card format read by st3v3nmw/obsidian-spaced-repetition.",
      cls: "epc-why",
    });

    new Setting(containerEl)
      .setName("Auto-export new vocab to SR-file")
      .addToggle((t) =>
        t
          .setValue(this.plugin.settings.srsExportEnabled)
          .onChange(async (v) => {
            this.plugin.settings.srsExportEnabled = v;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl).setName("SR-file path").addText((t) =>
      t.setValue(this.plugin.settings.srsFile).onChange(async (v) => {
        this.plugin.settings.srsFile =
          v.trim() || "English Learning/SRS/Vocab.md";
        await this.plugin.saveSettings();
      })
    );

    // ---------------- TTS
    containerEl.createEl("h3", { text: "Text-to-Speech" });

    new Setting(containerEl)
      .setName("Voice")
      .addDropdown((d) => {
        d.addOption("", "(system default)");
        const voices =
          typeof window !== "undefined" && window.speechSynthesis
            ? window.speechSynthesis.getVoices()
            : [];
        for (const v of voices) {
          if (v.lang.startsWith("en"))
            d.addOption(v.name, `${v.name} (${v.lang})`);
        }
        d.setValue(this.plugin.settings.ttsVoice).onChange(async (v) => {
          this.plugin.settings.ttsVoice = v;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl).setName("TTS rate").addSlider((s) =>
      s
        .setLimits(0.5, 1.5, 0.05)
        .setValue(this.plugin.settings.ttsRate)
        .setDynamicTooltip()
        .onChange(async (v) => {
          this.plugin.settings.ttsRate = v;
          await this.plugin.saveSettings();
        })
    );
  }
}
