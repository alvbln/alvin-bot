import type { Context, NextFunction } from "grammy";
import { config } from "../config.js";

export async function authMiddleware(
  ctx: Context,
  next: NextFunction
): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId || !config.allowedUsers.includes(userId)) {
    await ctx.reply("Zugriff verweigert.");
    return;
  }
  await next();
}
