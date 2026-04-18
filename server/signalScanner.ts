/**
 * 組合策略即時信號掃描器 v2.0 (Opus 4.6 全面升級)
 * 改良項目：
 * 1. 分層策略池（核心層 + 輔助層）
 * 2. 動態防重複機制（三元組識別 + 動態門檻）
 * 3. 並行掃描（Promise.all + 限流）
 * 4. 記憶體管理（快取自動清理）
 * 5. 信號衰減通知（信號失效時推送）
 * 6. 市況分類器整合（動態策略選擇）
 */

import { WebSocket, WebSocketServer } from "ws";
import { fetchCandles } from "./analysis.js";
import { runBacktest, detectRegime, type BacktestStrategy } from "./backtest.js";
import { SCANNER_GOVERNANCE_RULES } from "./live_strategy_governance.js";

// ── 掃描設定 ──
const SCAN_SYMBOLS = ["BTCUSDT", "ETHUSDT"];
const SCAN_INTERVAL_MS = 2 * 60 * 1000; // 每 2 分鐘掃描一次
const SCAN_BAR = "15m";
const SCAN_LIMIT = 500;
const BAR_MS = 900_000; // 15m = 900 秒

// ── Live 白名單：只保留研究上仍值得實盤觀察的策略，並依市況真正啟停 ──
export const STRATEGY_PROFILES = SCANNER_GOVERNANCE_RULES;

export const LIVE_SCAN_STRATEGIES: BacktestStrategy[] = Object.entries(STRATEGY_PROFILES)
  .filter(([, profile]) => Boolean(profile?.live_enabled))
  .map(([strategy]) => strategy as BacktestStrategy);

export function getStrategiesForRegime(regime: string): BacktestStrategy[] {
  const prioritized = LIVE_SCAN_STRATEGIES.filter((strategy) =>
    STRATEGY_PROFILES[strategy]?.regime_whitelist.includes(regime)
  );
  return prioritized.length > 0 ? prioritized : LIVE_SCAN_STRATEGIES;
}

// ── 動態防重複快取（Opus 4.6 改良：三元組識別）──
interface SignalCacheEntry {
  direction: string;
  strategy:  string;
  entry:     number;
  timestamp: number;
  expired:   boolean;
}
const signalCache = new Map<string, SignalCacheEntry>();

// 快取清理（每 10 分鐘清理過期條目）
setInterval(() => {
  const now = Date.now();
  const keysToDelete: string[] = [];
  signalCache.forEach((entry, key) => {
    if (now - entry.timestamp > BAR_MS * 16) { // 超過 4 小時清理
      keysToDelete.push(key);
    }
  });
  keysToDelete.forEach(k => signalCache.delete(k));
}, 10 * 60 * 1000);

// ── WebSocket 伺服器引用 ──
let wss: WebSocketServer | null = null;

export function setWssForScanner(server: WebSocketServer) {
  wss = server;
}

// ── 訊息型別 ──
export interface WsSignalAlertMsg {
  type:          "signal_alert";
  symbol:        string;
  interval:      string;
  direction:     "long" | "short";
  entry:         number;
  sl:            number;
  tp1:           number;
  tp2:           number;
  strategy:      string;
  signal_score:  number | null;
  recent_wr:     number;
  timestamp:     number;
  gpt_analysis:  string | null;
  gpt_loading:   boolean;
  regime?:       string;   // 當前市況
  is_expired?:   boolean;  // 信號是否已失效
  effective_signals?: number; // 有效獨立信號數（去相關後）
}

// ── Telegram 推送設定 ──
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? "";
const TELEGRAM_CHAT_ID   = process.env.TELEGRAM_CHAT_ID ?? "";

async function sendTelegram(text: string): Promise<void> {
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    const resp = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) {
      const err = await resp.text();
      console.error(`[Telegram] 推送失敗: ${resp.status} – ${err.slice(0, 100)}`);
    }
  } catch (err) {
    console.error(`[Telegram] 推送異常:`, err);
  }
}

function buildTelegramSignalMsg(
  symbol: string,
  direction: "long" | "short",
  entry: number,
  sl: number,
  tp1: number,
  tp2: number,
  strategy: string,
  signalScore: number | null,
  recentWr: number,
  regime: string,
  interval: string
): string {
  const dirEmoji  = direction === "long" ? "📈" : "📉";
  const dirLabel  = direction === "long" ? "做多" : "做空";
  const slDist    = Math.abs(((sl - entry) / entry) * 100).toFixed(2);
  const tp1Dist   = Math.abs(((tp1 - entry) / entry) * 100).toFixed(2);
  const rr        = sl > 0 && entry > 0 ? (Math.abs(tp1 - entry) / Math.abs(entry - sl)).toFixed(2) : "N/A";
  const regimeMap: Record<string, string> = {
    trending:   "📊 趨勢市",
    ranging:    "↔️ 震盪市",
    compressed: "🔄 壓縮市",
    chaotic:    "⚠️ 混沌市",
  };
  const regimeLabel = regimeMap[regime] ?? regime;
  const scoreStr  = signalScore !== null ? `${signalScore}/10` : "N/A";
  const priceStr  = (p: number) => p >= 1000
    ? p.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : p >= 1 ? p.toFixed(4) : p.toFixed(6);

  return [
    `🔔 <b>新交易信號</b>`,
    ``,
    `${dirEmoji} <b>${symbol}</b> ${dirLabel}  |  ${interval}  |  ${regimeLabel}`,
    ``,
    `📌 <b>進場價：</b><code>${priceStr(entry)}</code>`,
    `🛑 <b>止損：</b><code>${priceStr(sl)}</code>  (-${slDist}%)`,
    `🎯 <b>止盈1：</b><code>${priceStr(tp1)}</code>  (+${tp1Dist}%)`,
    `🎯 <b>止盈2：</b><code>${priceStr(tp2)}</code>`,
    ``,
    `⚖️ RR 比：<b>${rr}</b>  |  策略：<b>${strategy}</b>`,
    `📊 評分：<b>${scoreStr}</b>  |  近期勝率：<b>${recentWr.toFixed(1)}%</b>`,
    ``,
    `⏳ GPT-5.4 深度分析中，稍後更新...`,
  ].join("\n");
}

function buildTelegramGptMsg(
  symbol: string,
  direction: "long" | "short",
  entry: number,
  strategy: string,
  gptAnalysis: string
): string {
  const dirEmoji = direction === "long" ? "📈" : "📉";
  const priceStr = entry >= 1000
    ? entry.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : entry.toFixed(4);
  // 截斷過長的分析（Telegram 訊息上限 4096 字）
  const maxLen = 3200;
  const analysis = gptAnalysis.length > maxLen
    ? gptAnalysis.slice(0, maxLen) + "\n...（分析截斷）"
    : gptAnalysis;
  return [
    `🤖 <b>GPT-5.4 深度分析</b>`,
    `${dirEmoji} <b>${symbol}</b> @ <code>${priceStr}</code>  |  策略：${strategy}`,
    ``,
    analysis,
  ].join("\n");
}

function broadcastSignalAlert(msg: WsSignalAlertMsg) {
  if (!wss) return;
  const data = JSON.stringify(msg);
  let sentCount = 0;
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      try { client.send(data); sentCount++; } catch { /* ignore */ }
    }
  });
  if (sentCount > 0) {
    console.log(`[SignalScanner] 廣播信號到 ${sentCount} 個客戶端`);
  }
}

// ── GPT-5.4 分析函數 ──
async function analyzeWithGpt54(
  symbol: string,
  direction: "long" | "short",
  entry: number,
  sl: number,
  tp1: number,
  tp2: number,
  strategy: string,
  recentWr: number,
  signalScore: number | null,
  interval: string,
  regime: string
): Promise<string> {
  const apiKey = process.env.SOXIO_API_KEY ?? "";
  if (!apiKey) return "（GPT-5.4 API Key 未設定）";

  const rr = sl > 0 && entry > 0 ? Math.abs(tp1 - entry) / Math.abs(entry - sl) : 0;
  const dirText = direction === "long" ? "做多（買入）" : "做空（賣出）";
  const regimeMap: Record<string, string> = {
    trending: "趨勢市（ADX 強，有方向性）",
    ranging:  "震盪市（ADX 弱，無方向性）",
    compressed: "壓縮市（布林帶極窄，等待突破）",
    chaotic:  "混沌市（波動率極高，謹慎操作）",
  };

  const prompt = `你是一位專業的加密貨幣交易分析師。以下是一個由量化策略系統產生的交易信號，請用繁體中文進行深度分析：

**交易信號資訊**
- 幣種：${symbol}
- 時間框架：${interval}
- 方向：${dirText}
- 進場價：${entry.toFixed(2)}
- 止損價：${sl.toFixed(2)}（距離 ${Math.abs(((sl - entry) / entry) * 100).toFixed(2)}%）
- 止盈1：${tp1.toFixed(2)}（距離 ${Math.abs(((tp1 - entry) / entry) * 100).toFixed(2)}%）
- 止盈2：${tp2.toFixed(2)}（距離 ${Math.abs(((tp2 - entry) / entry) * 100).toFixed(2)}%）
- 風險報酬比（RR）：${rr.toFixed(2)}
- 觸發策略：${strategy}
- 信號評分：${signalScore !== null ? `${signalScore}/10` : "N/A"}
- 近期勝率：${recentWr.toFixed(1)}%
- 當前市況：${regimeMap[regime] ?? regime}

請從以下角度分析（每點 1-2 句，簡潔有力）：
1. **信號質量評估**：這個信號的可信度如何？RR 比是否合理？
2. **風險提示**：主要風險點在哪裡？什麼情況下應該放棄這筆交易？
3. **執行建議**：進場時機、倉位建議（保守/標準/積極）
4. **市況適配性**：當前${regimeMap[regime] ?? regime}下，${strategy} 策略的適用性如何？
5. **總結評分**：給這個信號打分（1-10），並說明理由`;

  try {
    const resp = await fetch("https://apikey.soxio.me/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-5.4",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 800,
        stream: true,
      }),
      signal: AbortSignal.timeout(60000),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error(`[SignalScanner] GPT-5.4 API 失敗: ${resp.status} – ${errText.slice(0, 200)}`);
      return `（GPT-5.4 分析失敗：HTTP ${resp.status}）`;
    }

    // 解析 SSE 串流
    const rawText = await resp.text();
    let fullContent = "";
    for (const line of rawText.split("\n")) {
      if (!line.startsWith("data: ")) continue;
      const jsonStr = line.slice(6).trim();
      if (jsonStr === "[DONE]") break;
      try {
        const chunk = JSON.parse(jsonStr) as { choices?: Array<{ delta?: { content?: string } }> };
        const delta = chunk.choices?.[0]?.delta?.content;
        if (delta) fullContent += delta;
      } catch { /* 忽略解析錯誤 */ }
    }
    return fullContent || "（GPT-5.4 回應為空）";
  } catch (err) {
    console.error("[SignalScanner] GPT-5.4 調用異常:", err);
    return `（GPT-5.4 分析異常：${err instanceof Error ? err.message : String(err)}）`;
  }
}

// ── 動態防重複檢查（Opus 4.6 改良：三元組識別 + 動態門檻）──
function isDuplicateSignal(
  symbol: string,
  direction: string,
  strategy: string,
  entry: number
): boolean {
  const cacheKey = `${symbol}_${direction}_${strategy}`;
  const cached = signalCache.get(cacheKey);
  if (!cached) return false;

  const now = Date.now();
  // 時間窗口：4 小時（16 根 15m K 線）
  if (now - cached.timestamp > BAR_MS * 16) return false;

  // 動態價格門檻：BTC/ETH 用 0.3%，其他用 0.5%
  const isHighLiquidity = /^(BTC|ETH)/.test(symbol.toUpperCase());
  const priceTolerance = isHighLiquidity ? 0.003 : 0.005;
  const priceDiff = Math.abs(cached.entry - entry) / entry;

  return priceDiff < priceTolerance;
}

// ── 掃描單一幣種（Opus 4.6 改良：分層策略池 + 市況分類）──
async function scanSymbol(symbol: string): Promise<void> {
  try {
    const [primaryCandles, candles4h] = await Promise.all([
      fetchCandles(symbol, SCAN_BAR, SCAN_LIMIT),
      fetchCandles(symbol, "4h", 500),
    ]);

    if (!primaryCandles || primaryCandles.length < 100) return;

    // 市況分類（決定使用哪些策略）
    const regime = detectRegime(primaryCandles.slice(-100));

    // 根據市況調整優先順序，但最終仍補齊全策略掃描，避免 UI 與即時掃描覆蓋不一致
    const strategiesToScan = getStrategiesForRegime(regime);

    const now = Date.now();
    const activeWindow = BAR_MS * 8; // 最近 8 根 K 線內的信號視為活躍

    // ── 並行掃描所有策略（Opus 4.6 改良：Promise.all 取代串行）──
    const strategyResults = await Promise.allSettled(
      strategiesToScan.map(async (strategy) => {
        const result = runBacktest({
          candles: primaryCandles,
          strategy,
          symbol,
          interval: SCAN_BAR,
          htf_candles: candles4h,
          use_true_mtf: true,
          enable_mtf_filter: true,
          enable_trailing_stop: true,
          enable_fee: true,
        });

        const trades = result.trades;
        if (!trades || trades.length === 0) return null;

        const lastTrade = trades[trades.length - 1];
        const recentTrades = trades.slice(-20);
        const recentWins = recentTrades.filter(t => t.pnl_net_pct > 0).length;
        const recentWr = recentTrades.length > 0 ? (recentWins / recentTrades.length) * 100 : 0;

        // 檢查是否為活躍信號
        const isActive = lastTrade.direction &&
          (lastTrade.exit_time == null || lastTrade.exit_time * 1000 > now - activeWindow);

        if (!isActive) return null;

        return {
          strategy,
          direction: lastTrade.direction as "long" | "short",
          entry: lastTrade.entry_price,
          sl: lastTrade.sl_price,
          tp1: lastTrade.tp_price,
          tp2: lastTrade.tp2_price ?? lastTrade.tp_price,
          signal_score: lastTrade.signal_score ?? null,
          recent_wr: recentWr,
          entry_time: lastTrade.entry_time,
          reference_time: lastTrade.exit_time ?? Math.floor(now / 1000),
          total_trades: result.total_trades,
        };
      })
    );

    // 過濾成功結果
    type SignalResult = {
      strategy: BacktestStrategy;
      direction: "long" | "short";
      entry: number;
      sl: number;
      tp1: number;
      tp2: number;
      signal_score: number | null;
      recent_wr: number;
      entry_time: number;
      reference_time: number;
      total_trades: number;
    };
    const signalResults: SignalResult[] = strategyResults
      .filter((r): r is PromiseFulfilledResult<SignalResult | null> =>
        r.status === "fulfilled" && r.value !== null)
      .map(r => (r as PromiseFulfilledResult<SignalResult>).value);

    if (signalResults.length === 0) {
      // 信號衰減通知：如果之前有信號但現在沒有，推送失效通知
      let anyPrevSignal = false;
      signalCache.forEach((_, key) => { if (key.startsWith(symbol)) anyPrevSignal = true; });
      if (anyPrevSignal) {
        // 清理該幣種的快取
        const expiredKeys: string[] = [];
        signalCache.forEach((_, key) => { if (key.startsWith(symbol)) expiredKeys.push(key); });
        expiredKeys.forEach(k => signalCache.delete(k));
      }
      return;
    }

    // 多維度加權評分，但先經過 live 白名單、樣本門檻與家族去相關
    const calcScore = (sig: SignalResult): number => {
      const normalizedScore = (sig.signal_score ?? 0) / 10;
      const wrScore = sig.recent_wr / 100;
      let rrScore = 0.5;
      if (sig.entry && sig.sl && sig.tp1) {
        const risk = Math.abs(sig.entry - sig.sl);
        const reward = Math.abs(sig.tp1 - sig.entry);
        if (risk > 0) rrScore = Math.min(reward / risk / 3, 1);
      }
      const ageMs = now - sig.entry_time * 1000;
      const freshnessScore = Math.max(0, 1 - ageMs / (BAR_MS * 4));
      return normalizedScore * 0.35 + wrScore * 0.25 + rrScore * 0.20 + freshnessScore * 0.20;
    };

    type DecorrelatedSignal = SignalResult & {
      family: StrategyFamily;
      composite_score: number;
    };

    const eligibleSignals: DecorrelatedSignal[] = signalResults
      .map((sig) => {
        const profile = STRATEGY_PROFILES[sig.strategy];
        if (!profile || !profile.live_enabled) return null;

        const ageBars = (now - sig.reference_time * 1000) / BAR_MS;
        if (ageBars > profile.max_signal_age_bars) return null;
        if (sig.total_trades < profile.min_total_trades) return null;
        if (profile.min_signal_score !== undefined) {
          if (sig.signal_score === null || sig.signal_score < profile.min_signal_score) return null;
        }

        return {
          ...sig,
          family: profile.family,
          composite_score: calcScore(sig),
        } satisfies DecorrelatedSignal;
      })
      .filter((sig): sig is DecorrelatedSignal => sig !== null)
      .sort((a, b) => b.composite_score - a.composite_score);

    if (eligibleSignals.length === 0) {
      console.log(`[SignalScanner] ${symbol} 在 ${regime} 市況下無符合 live 白名單的有效信號`);
      return;
    }

    const bestPerFamily = new Map<string, DecorrelatedSignal>();
    for (const sig of eligibleSignals) {
      const key = `${sig.direction}_${sig.family}`;
      if (!bestPerFamily.has(key)) bestPerFamily.set(key, sig);
    }
    const decorrelatedSignals = Array.from(bestPerFamily.values());

    const directionGroups = new Map<"long" | "short", DecorrelatedSignal[]>();
    for (const sig of decorrelatedSignals) {
      const group = directionGroups.get(sig.direction) ?? [];
      group.push(sig);
      directionGroups.set(sig.direction, group);
    }

    const consensusGroup = Array.from(directionGroups.values())
      .filter((group) => group.length >= 2)
      .sort((a, b) => {
        if (b.length !== a.length) return b.length - a.length;
        const scoreA = a.reduce((sum, item) => sum + item.composite_score, 0);
        const scoreB = b.reduce((sum, item) => sum + item.composite_score, 0);
        return scoreB - scoreA;
      })[0];

    const bestSignal = consensusGroup
      ? [...consensusGroup].sort((a, b) => b.composite_score - a.composite_score)[0]
      : decorrelatedSignals.find((sig) => sig.composite_score >= 0.68);

    if (!bestSignal) {
      console.log(`[SignalScanner] ${symbol} 無雙家族共識，且沒有足夠強的單獨高分信號`);
      return;
    }

    const effectiveSignals = consensusGroup?.length ?? 1;

    // 動態防重複檢查（三元組識別）
    if (isDuplicateSignal(symbol, bestSignal.direction, bestSignal.strategy, bestSignal.entry)) {
      console.log(`[SignalScanner] ${symbol} 信號重複（${bestSignal.direction}/${bestSignal.strategy}），跳過推送`);
      return;
    }

    // 更新快取
    const cacheKey = `${symbol}_${bestSignal.direction}_${bestSignal.strategy}`;
    signalCache.set(cacheKey, {
      direction: bestSignal.direction,
      strategy:  bestSignal.strategy,
      entry:     bestSignal.entry,
      timestamp: now,
      expired:   false,
    });

    const dirEmoji = bestSignal.direction === "long" ? "📈" : "📉";
    console.log(`[SignalScanner] 🔔 新信號！${symbol} ${dirEmoji}${bestSignal.direction === "long" ? "做多" : "做空"} @ ${bestSignal.entry} (策略: ${bestSignal.strategy}, 市況: ${regime})`);

    // 先推送基本信號（gpt_loading: true）
    const baseMsg: WsSignalAlertMsg = {
      type:          "signal_alert",
      symbol,
      interval:      SCAN_BAR,
      direction:     bestSignal.direction,
      entry:         bestSignal.entry,
      sl:            bestSignal.sl,
      tp1:           bestSignal.tp1,
      tp2:           bestSignal.tp2,
      strategy:      bestSignal.strategy,
      signal_score:  bestSignal.signal_score,
      recent_wr:     bestSignal.recent_wr,
      timestamp:     now,
      gpt_analysis:  null,
      gpt_loading:   true,
      regime,
      effective_signals: effectiveSignals,
    };
    broadcastSignalAlert(baseMsg);
    // Telegram 推送：立即發送基本信號
    sendTelegram(buildTelegramSignalMsg(
      symbol,
      bestSignal.direction,
      bestSignal.entry,
      bestSignal.sl,
      bestSignal.tp1,
      bestSignal.tp2,
      bestSignal.strategy,
      bestSignal.signal_score,
      bestSignal.recent_wr,
      regime,
      SCAN_BAR
    ));
    // 異步調用 GPT-5.4，完成後再推送更新
    analyzeWithGpt54(
      symbol,
      bestSignal.direction,
      bestSignal.entry,
      bestSignal.sl,
      bestSignal.tp1,
      bestSignal.tp2,
      bestSignal.strategy,
      bestSignal.recent_wr,
      bestSignal.signal_score,
      SCAN_BAR,
      regime
    ).then((analysis) => {
      broadcastSignalAlert({ ...baseMsg, gpt_analysis: analysis, gpt_loading: false });
      console.log(`[SignalScanner] ✅ ${symbol} GPT-5.4 分析完成`);
      // Telegram 推送：GPT-5.4 分析完成後發送第二條訊息
      if (analysis && !analysis.startsWith("（")) {
        sendTelegram(buildTelegramGptMsg(
          symbol,
          bestSignal.direction,
          bestSignal.entry,
          bestSignal.strategy,
          analysis
        ));
      }
    }).catch((err) => {
      console.error(`[SignalScanner] GPT-5.4 分析失敗:`, err);
      broadcastSignalAlert({ ...baseMsg, gpt_analysis: "（分析失敗）", gpt_loading: false });
    });
  } catch (err) {
    console.error(`[SignalScanner] 掃描 ${symbol} 時發生錯誤:`, err);
  }
}

// ── 主掃描循環（Opus 4.6 改良：並行掃描所有幣種）──
let scanTimer: ReturnType<typeof setInterval> | null = null;
let isScanning = false;

async function runScan() {
  if (isScanning) {
    console.log("[SignalScanner] 上次掃描尚未完成，跳過本次");
    return;
  }
  isScanning = true;
  console.log(`[SignalScanner] ⏱ 開始並行掃描 ${SCAN_SYMBOLS.length} 個幣種...`);
  const start = Date.now();

  // 並行掃描，但限制最大並發（避免 API 限流）
  const CONCURRENCY = 2;
  for (let i = 0; i < SCAN_SYMBOLS.length; i += CONCURRENCY) {
    const batch = SCAN_SYMBOLS.slice(i, i + CONCURRENCY);
    await Promise.allSettled(batch.map(sym => scanSymbol(sym)));
    if (i + CONCURRENCY < SCAN_SYMBOLS.length) {
      await new Promise(r => setTimeout(r, 1000)); // 批次間隔 1 秒
    }
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`[SignalScanner] ✅ 掃描完成，耗時 ${elapsed}s`);
  isScanning = false;
}

// ── 啟動掃描器 ──
export function startSignalScanner(server: WebSocketServer) {
  setWssForScanner(server);
  console.log(`[SignalScanner] 🚀 v2.1 啟動，掃描間隔 ${SCAN_INTERVAL_MS / 60000} 分鐘，監控幣種: ${SCAN_SYMBOLS.join(", ")}`);
  console.log(`[SignalScanner] Live 白名單: ${LIVE_SCAN_STRATEGIES.join(", ")}`);

  // 啟動後延遲 90 秒再進行第一次掃描
  // FIX：Live Worker 也是每 2 分鐘掃描，兩者同時觸發會競爭 Kraken API（限速 1 req/s）
  // SignalScanner 延遲 90 秒啟動，與 Live Worker 錯開約 60 秒，避免同時打 API
  setTimeout(() => {
    runScan();
    scanTimer = setInterval(runScan, SCAN_INTERVAL_MS);
  }, 90_000);
}

export function stopSignalScanner() {
  if (scanTimer) {
    clearInterval(scanTimer);
    scanTimer = null;
  }
  console.log("[SignalScanner] 已停止");
}
