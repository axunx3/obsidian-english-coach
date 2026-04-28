import { requestUrl } from "obsidian";
import type EnglishPracticePlugin from "./main";
import { DEFAULT_MODELS } from "./settings";

export interface CorrectionResult {
  corrected: string;
  changes: { from: string; to: string; why: string }[];
}

export class LLMService {
  constructor(private plugin: EnglishPracticePlugin) {}

  private get s() {
    return this.plugin.settings;
  }

  private model(): string {
    return this.s.llmModel || DEFAULT_MODELS[this.s.llmProvider];
  }

  // ---------- public APIs

  async correct(text: string): Promise<CorrectionResult> {
    const system =
      "You are a careful English editor for a non-native PhD-level writer. " +
      "Fix only clear errors and unidiomatic phrasing. Preserve voice, technical terminology, and the writer's style. " +
      "Return ONLY valid JSON with no surrounding markdown:\n" +
      `{"corrected": "...", "changes": [{"from": "...", "to": "...", "why": "..."}]}\n` +
      "If the text is already fine, return it unchanged with empty changes array.";
    const user = `Edit:\n\n${text}`;
    const raw = await this.complete(user, system, 2048);
    const cleaned = stripCodeFence(raw);
    try {
      const parsed = JSON.parse(cleaned);
      return {
        corrected: String(parsed.corrected ?? text),
        changes: Array.isArray(parsed.changes) ? parsed.changes : [],
      };
    } catch {
      return { corrected: cleaned.trim() || text, changes: [] };
    }
  }

  async generatePrompt(theme: string): Promise<string> {
    const system =
      "You generate single, focused English speaking-practice prompts for a Chinese AI PhD student. " +
      "Aim for a 5-minute monologue. Be specific, concrete, mildly opinionated. " +
      "Return only the prompt text — no quotes, no preamble.";
    return (await this.complete(`Theme: ${theme}. Generate one prompt now.`, system, 256))
      .trim()
      .replace(/^["']|["']$/g, "");
  }

  async lookupWord(word: string, context?: string): Promise<DictResult> {
    const system =
      "You are a bilingual dictionary for a Chinese English learner. " +
      "Return ONLY valid JSON, no markdown:\n" +
      `{"word": "...", "ipa": "...", "pos": "...", "definition_en": "...", "definition_zh": "...", "examples": ["...", "..."], "related": ["...", "..."]}\n` +
      "Keep definitions under 20 words each. Examples should be natural sentences.";
    const user = context
      ? `Word: "${word}"\nContext sentence: "${context}"\nGive the meaning that fits the context.`
      : `Word: "${word}"`;
    // Lookups are simple — use the faster (Haiku) model unless user overrides.
    const raw = await this.complete(user, system, 512, this.s.lookupModel || "claude-haiku-4-5");
    const cleaned = stripCodeFence(raw);
    try {
      const parsed = JSON.parse(cleaned);
      return {
        word: String(parsed.word ?? word),
        ipa: String(parsed.ipa ?? ""),
        pos: String(parsed.pos ?? ""),
        definition_en: String(parsed.definition_en ?? ""),
        definition_zh: String(parsed.definition_zh ?? ""),
        examples: Array.isArray(parsed.examples) ? parsed.examples.map(String) : [],
        related: Array.isArray(parsed.related) ? parsed.related.map(String) : [],
      };
    } catch {
      return {
        word,
        ipa: "",
        pos: "",
        definition_en: cleaned.trim(),
        definition_zh: "",
        examples: [],
        related: [],
      };
    }
  }

  /** Multi-turn chat. Caller manages history. */
  async chat(
    messages: { role: "user" | "assistant"; content: string }[],
    system: string
  ): Promise<string> {
    return await this.completeMessages(messages, system, 1024);
  }

  async test(): Promise<string> {
    return await this.complete(
      "Reply with the literal word OK and nothing else.",
      "You are a test assistant. Reply with one word.",
      32
    );
  }

  // ---------- private

  private async complete(
    user: string,
    system: string,
    maxTokens: number,
    modelOverride?: string
  ): Promise<string> {
    return await this.completeMessages(
      [{ role: "user", content: user }],
      system,
      maxTokens,
      modelOverride
    );
  }

  private async completeMessages(
    messages: { role: "user" | "assistant"; content: string }[],
    system: string,
    maxTokens: number,
    modelOverride?: string
  ): Promise<string> {
    const model = modelOverride || this.model();
    if (this.s.llmProvider === "claude-cli") {
      // CLI mode doesn't naturally support multi-turn; we serialize the conversation
      // into a single prompt and let the system prompt set context.
      const flat = messages
        .map((m) => (m.role === "user" ? `[user]\n${m.content}` : `[assistant]\n${m.content}`))
        .join("\n\n");
      const lastUser = messages.filter((m) => m.role === "user").pop()?.content ?? flat;
      const sysWithHistory =
        messages.length > 1
          ? `${system}\n\n--- prior turns (most recent last) ---\n${flat
              .split("\n\n")
              .slice(0, -1)
              .join("\n\n")}\n--- end prior ---\nReply to the most recent [user] turn.`
          : system;
      return await this.claudeCli(lastUser, sysWithHistory, model);
    }
    if (this.s.llmProvider === "anthropic") {
      const res = await requestUrl({
        url: "https://api.anthropic.com/v1/messages",
        method: "POST",
        contentType: "application/json",
        headers: {
          "x-api-key": this.s.llmApiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          system,
          messages,
        }),
      });
      return res.json?.content?.[0]?.text ?? "";
    }
    if (this.s.llmProvider === "openai") {
      const res = await requestUrl({
        url: "https://api.openai.com/v1/chat/completions",
        method: "POST",
        contentType: "application/json",
        headers: {
          Authorization: `Bearer ${this.s.llmApiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          messages: [{ role: "system", content: system }, ...messages],
        }),
      });
      return res.json?.choices?.[0]?.message?.content ?? "";
    }
    throw new Error("LLM provider not configured");
  }

  private async claudeCli(user: string, system: string, model?: string): Promise<string> {
    let cp: typeof import("child_process");
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      cp = require("child_process") as typeof import("child_process");
    } catch {
      throw new Error("Claude Code CLI provider needs Node child_process — desktop only.");
    }
    let bin = this.s.claudeBinPath || "claude";
    if (bin === "claude") {
      const detected = findClaudeCli();
      if (detected) bin = detected;
    }
    const args = [
      "-p",
      "--output-format",
      "json",
      "--model",
      model || this.model() || DEFAULT_MODELS["claude-cli"],
      "--append-system-prompt",
      system,
      user,
    ];
    // Spawn in a neutral cwd (system tmp dir) so the child process does NOT
    // try to scan the vault for project context. Without this, macOS prompts
    // for permission to read every vault subfolder claude touches.
    let neutralCwd: string | undefined;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const os = require("os") as typeof import("os");
      neutralCwd = os.tmpdir();
    } catch {
      // ignore — fall back to inherited cwd
    }
    return new Promise<string>((resolve, reject) => {
      cp.execFile(
        bin,
        args,
        {
          cwd: neutralCwd,
          maxBuffer: 16 * 1024 * 1024,
          timeout: 120_000,
          env: {
            ...process.env,
            PATH: enhancedPath(),
            CLAUDE_CODE_NONINTERACTIVE: "1",
          },
        },
        (err, stdout, stderr) => {
          if (err) {
            const msg = (typeof stderr === "string" && stderr.trim()) || err.message;
            reject(new Error(`${msg}\n(bin=${bin})`));
            return;
          }
          const text = String(stdout);
          try {
            const parsed = JSON.parse(text);
            if (parsed.is_error) {
              reject(new Error(parsed.result || "claude returned is_error: true"));
              return;
            }
            const result =
              parsed.result ??
              parsed.text ??
              parsed.output ??
              (Array.isArray(parsed) ? parsed[parsed.length - 1]?.result : null);
            resolve(typeof result === "string" ? result : text.trim());
          } catch {
            resolve(text.trim());
          }
        }
      );
    });
  }
}

export interface DictResult {
  word: string;
  ipa: string;
  pos: string;
  definition_en: string;
  definition_zh: string;
  examples: string[];
  related: string[];
}

// ====================================================================
// Free Dictionary API (no key, English-English only)
// ====================================================================

export async function freeDictionaryLookup(word: string): Promise<DictResult> {
  const url = `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`;
  const res = await requestUrl({ url });
  const data = res.json;
  if (!Array.isArray(data) || data.length === 0)
    throw new Error("No definition found");
  const entry = data[0];
  const phon = entry.phonetics?.find((p: any) => p.text)?.text ?? "";
  const meaning = entry.meanings?.[0];
  const pos = meaning?.partOfSpeech ?? "";
  const def = meaning?.definitions?.[0];
  return {
    word: entry.word ?? word,
    ipa: phon,
    pos,
    definition_en: def?.definition ?? "",
    definition_zh: "",
    examples: def?.example ? [def.example] : [],
    related: meaning?.synonyms ?? [],
  };
}

function stripCodeFence(s: string): string {
  return s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
}

// ====================================================================
// CLI path detection (ported from YishenTu/claudian)
// ====================================================================

function isExistingFile(p: string): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require("fs") as typeof import("fs");
    return fs.existsSync(p) && fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

export function findClaudeCli(): string | null {
  let osMod: typeof import("os");
  let pathMod: typeof import("path");
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    osMod = require("os") as typeof import("os");
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    pathMod = require("path") as typeof import("path");
  } catch {
    return null;
  }
  if (osMod.platform() === "win32") return null;
  const home = osMod.homedir();
  const candidates = [
    pathMod.join(home, ".claude/local/claude"),
    pathMod.join(home, ".local/bin/claude"),
    pathMod.join(home, ".volta/bin/claude"),
    pathMod.join(home, ".asdf/shims/claude"),
    pathMod.join(home, ".asdf/bin/claude"),
    "/usr/local/bin/claude",
    "/opt/homebrew/bin/claude",
    pathMod.join(home, "bin/claude"),
    pathMod.join(home, ".npm-global/bin/claude"),
  ];
  for (const c of candidates) if (isExistingFile(c)) return c;
  const envPath = process.env.PATH || "";
  for (const dir of envPath.split(":")) {
    if (!dir) continue;
    const c = pathMod.join(dir, "claude");
    if (isExistingFile(c)) return c;
  }
  return null;
}

export function enhancedPath(): string {
  let osMod: typeof import("os");
  let pathMod: typeof import("path");
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    osMod = require("os") as typeof import("os");
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    pathMod = require("path") as typeof import("path");
  } catch {
    return process.env.PATH || "";
  }
  const home = osMod.homedir();
  const extras = [
    pathMod.join(home, ".local/bin"),
    pathMod.join(home, ".claude/local"),
    pathMod.join(home, ".volta/bin"),
    pathMod.join(home, ".asdf/shims"),
    "/usr/local/bin",
    "/opt/homebrew/bin",
    pathMod.join(home, "bin"),
    pathMod.join(home, ".npm-global/bin"),
  ];
  const current = (process.env.PATH || "").split(":").filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of [...current, ...extras]) {
    if (!seen.has(p)) {
      seen.add(p);
      out.push(p);
    }
  }
  return out.join(":");
}
