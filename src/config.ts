import "dotenv/config";
import os from "os";

export const config = {
  botToken: process.env.BOT_TOKEN || "YOUR_BOT_TOKEN",
  allowedUsers: (process.env.ALLOWED_USERS || "YOUR_USER_ID")
    .split(",")
    .map(Number)
    .filter(Boolean),
  defaultWorkingDir: process.env.WORKING_DIR || os.homedir(),
  maxBudgetUsd: Number(process.env.MAX_BUDGET_USD) || 5.0,
  groqApiKey: process.env.GROQ_API_KEY || "",
  telegramMaxLength: 4096,
  streamThrottleMs: 1500,
} as const;
