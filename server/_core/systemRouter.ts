import { z } from "zod";
import { notifyOwner } from "./notification";
import { adminProcedure, publicProcedure, router } from "./trpc";
import { resolveModel } from "./llm";

export const systemRouter = router({
  health: publicProcedure
    .input(
      z.object({
        timestamp: z.number().min(0, "timestamp cannot be negative"),
      })
    )
    .query(() => ({
      ok: true,
    })),

  /** 修復 C：返回實際模型配置，供設定頁面動態顯示 */
  config: publicProcedure.query(() => ({
    model_balanced: resolveModel("balanced"),
    model_fast:     resolveModel("fast"),
    model_deep:     resolveModel("deep"),
    forge_url:      process.env.BUILT_IN_FORGE_API_URL ?? process.env.OPENAI_BASE_URL ?? "(未設定)",
    node_env:       process.env.NODE_ENV ?? "development",
  })),

  notifyOwner: adminProcedure
    .input(
      z.object({
        title: z.string().min(1, "title is required"),
        content: z.string().min(1, "content is required"),
      })
    )
    .mutation(async ({ input }) => {
      const delivered = await notifyOwner(input);
      return {
        success: delivered,
      } as const;
    }),
});
