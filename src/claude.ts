import { query, type SDKMessage, type SDKAssistantMessage, type SDKResultMessage, type SDKSystemMessage } from "@anthropic-ai/claude-agent-sdk";

import type { EffortLevel } from "./services/session.js";

export interface ClaudeQueryOptions {
  prompt: string;
  sessionId: string | null;
  workingDir: string;
  effort: EffortLevel;
  abortController: AbortController;
  onText: (fullText: string) => Promise<void>;
  onToolUse?: (toolName: string) => Promise<void>;
  onComplete: (result: { sessionId: string; cost: number }) => void;
}

export async function runClaudeAgent(opts: ClaudeQueryOptions): Promise<void> {
  // Remove env vars that prevent nested Claude Code sessions
  const cleanEnv: Record<string, string | undefined> = { ...process.env };
  delete cleanEnv.CLAUDECODE;
  delete cleanEnv.CLAUDE_CODE_ENTRYPOINT;

  const q = query({
    prompt: opts.prompt,
    options: {
      cwd: opts.workingDir,
      abortController: opts.abortController,
      resume: opts.sessionId ?? undefined,
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      env: cleanEnv,
      allowedTools: [
        "Read", "Write", "Edit", "Bash", "Glob", "Grep",
        "WebSearch", "WebFetch", "Task",
      ],
      systemPrompt: `Du bist ein autonomer AI-Agent, gesteuert über Telegram.
Halte Antworten kurz und prägnant, aber gründlich.
Nutze Markdown-Formatierung kompatibel mit Telegram (fett, kursiv, Code-Blöcke).
Wenn du Commands ausführst oder Dateien bearbeitest, erkläre kurz was du getan hast.
Antworte auf Deutsch, es sei denn der User schreibt auf Englisch.`,
      effort: opts.effort,
      maxTurns: 50,
    },
  });

  let accumulatedText = "";
  let capturedSessionId = opts.sessionId || "";

  for await (const message of q) {
    // System init message — capture session ID
    if (message.type === "system" && "subtype" in message && message.subtype === "init") {
      const sysMsg = message as SDKSystemMessage;
      capturedSessionId = sysMsg.session_id;
    }

    // Assistant message — extract text and tool use
    if (message.type === "assistant") {
      const assistantMsg = message as SDKAssistantMessage;
      capturedSessionId = assistantMsg.session_id;

      if (assistantMsg.message?.content) {
        for (const block of assistantMsg.message.content) {
          if ("text" in block && block.text) {
            accumulatedText += block.text;
            await opts.onText(accumulatedText);
          }
          if ("name" in block && opts.onToolUse) {
            await opts.onToolUse(block.name);
          }
        }
      }
    }

    // Result message — complete
    if (message.type === "result") {
      const resultMsg = message as SDKResultMessage;
      opts.onComplete({
        sessionId: resultMsg.session_id || capturedSessionId,
        cost: "total_cost_usd" in resultMsg ? resultMsg.total_cost_usd : 0,
      });
    }
  }
}
