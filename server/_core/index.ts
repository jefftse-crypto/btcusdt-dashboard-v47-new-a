import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import fs from "fs/promises";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { initWebSocketServer, getWsServerStats } from "../wsServer";
import { startSignalScanner } from "../signalScanner.js";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  // OAuth callback under /api/oauth/callback
  registerOAuthRoutes(app);

  // 健康檢查端點（Phase 7 更新：加入 WebSocket 狀態）
  const healthHandler = (_req: express.Request, res: express.Response) => {
    const wsStats = getWsServerStats();
    res.json({
      status: "ok",
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
      version: "7.0",
      model: process.env.OPENAI_MODEL || "claude-opus-4-6",
      ws: {
        clients: wsStats.clientCount,
        market_data_connected: wsStats.marketDataConnected,
        provider: wsStats.provider,
        subscribed_symbols: wsStats.subscribedSymbols,
        last_update_ts: wsStats.lastUpdateTs,
        last_error: wsStats.lastError,
      },
    });
  };
  app.get("/health", healthHandler);
  app.get("/api/health", healthHandler);

  const latestLiveSnapshotPath = process.env.LATEST_LIVE_SNAPSHOT_PATH
    || "/home/ubuntu/work/btcusdt_handover/crypto-dashboard-v5.9/runtime/btcusdt_live_signal_snapshot.json";

  app.get("/api/latest-live-snapshot", async (_req, res) => {
    try {
      const raw = await fs.readFile(latestLiveSnapshotPath, "utf-8");
      const parsed = JSON.parse(raw);
      res.json({
        ok: true,
        source_path: latestLiveSnapshotPath,
        data: parsed,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(404).json({
        ok: false,
        source_path: latestLiveSnapshotPath,
        error: message,
      });
    }
  });

  // 診斷摘要 API：僅回傳家族聚合 + 門檻建議 + 趨勢序列
  app.get("/api/diagnostics-summary", async (_req, res) => {
    try {
      const raw = await fs.readFile(latestLiveSnapshotPath, "utf-8");
      const parsed = JSON.parse(raw);
      const enrichment = parsed?.diagnostics_enrichment ?? null;
      const workerVersion = parsed?.worker_version ?? "unknown";
      const generatedAt = parsed?.generated_at ?? null;
      res.json({
        ok: true,
        worker_version: workerVersion,
        generated_at: generatedAt,
        family_aggregations: enrichment?.family_aggregations ?? [],
        threshold_suggestions: enrichment?.threshold_suggestions ?? [],
        strategy_trends: enrichment?.strategy_trends ?? {},
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(404).json({
        ok: false,
        error: message,
      });
    }
  });

  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );

  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
    // Phase 7：初始化 WebSocket 伺服器（在 HTTP 伺服器啟動後）
    const wssInstance = initWebSocketServer(server);
    console.log(`WebSocket server ready at ws://localhost:${port}/ws`);
    // 啟動組合策略即時信號掃描器
    startSignalScanner(wssInstance);
  });
}

startServer().catch(console.error);
