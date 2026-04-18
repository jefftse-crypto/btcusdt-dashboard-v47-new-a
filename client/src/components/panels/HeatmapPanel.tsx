/**
 * HeatmapPanel.tsx
 * 市場情緒熱力圖 — 多幣種 RSI/評分視覺化
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { RefreshCw, TrendingUp, TrendingDown, Minus, BarChart2 } from "lucide-react";

type Timeframe = "1H" | "4H" | "1D";
type ViewMode = "score" | "rsi" | "change24h" | "change7d";

interface CoinHeatData {
  symbol: string;
  coin: string;
  close: number;
  rsi: number;
  ema20: number;
  ema50: number;
  change1h: number;
  change24h: number;
  change7d: number;
  vol_trend: "increasing" | "decreasing" | "neutral";
  score: number;
  sentiment: "strong_bull" | "bull" | "neutral" | "bear" | "strong_bear";
}

const COIN_ICONS: Record<string, string> = {
  BTC: "₿", ETH: "Ξ", SOL: "◎", BNB: "B", XRP: "✕",
  ADA: "₳", DOGE: "Ð", AVAX: "A", DOT: "●", LINK: "⬡",
};

function getSentimentColor(sentiment: string): string {
  switch (sentiment) {
    case "strong_bull": return "bg-bull border-bull/50 text-white";
    case "bull": return "bg-bull/60 border-bull/40 text-white";
    case "neutral": return "bg-muted border-border text-muted-foreground";
    case "bear": return "bg-bear/60 border-bear/40 text-white";
    case "strong_bear": return "bg-bear border-bear/50 text-white";
    default: return "bg-muted border-border text-muted-foreground";
  }
}

function getValueColor(value: number, mode: ViewMode): string {
  if (mode === "score") {
    if (value >= 70) return "bg-bull border-bull/50 text-white";
    if (value >= 60) return "bg-bull/60 border-bull/40 text-white";
    if (value >= 40) return "bg-muted border-border text-muted-foreground";
    if (value >= 30) return "bg-bear/60 border-bear/40 text-white";
    return "bg-bear border-bear/50 text-white";
  }
  if (mode === "rsi") {
    if (value >= 70) return "bg-bear border-bear/50 text-white";
    if (value >= 55) return "bg-bull/60 border-bull/40 text-white";
    if (value >= 45) return "bg-muted border-border text-muted-foreground";
    if (value >= 30) return "bg-bear/60 border-bear/40 text-white";
    return "bg-bull border-bull/50 text-white";
  }
  // change24h / change7d
  if (value >= 5) return "bg-bull border-bull/50 text-white";
  if (value >= 1) return "bg-bull/60 border-bull/40 text-white";
  if (value >= -1) return "bg-muted border-border text-muted-foreground";
  if (value >= -5) return "bg-bear/60 border-bear/40 text-white";
  return "bg-bear border-bear/50 text-white";
}

function formatValue(value: number, mode: ViewMode): string {
  if (mode === "score") return `${value}`;
  if (mode === "rsi") return value.toFixed(1);
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

export default function HeatmapPanel({ onSelectSymbol }: { onSelectSymbol?: (sym: string) => void }) {
  const [timeframe, setTimeframe] = useState<Timeframe>("4H");
  const [viewMode, setViewMode] = useState<ViewMode>("score");

  const { data, isLoading, refetch, dataUpdatedAt } = trpc.heatmap.getMarketOverview.useQuery(
    { timeframe },
    { refetchInterval: 120_000, staleTime: 60_000 }
  );

  const coins = (data?.coins ?? []) as CoinHeatData[];
  const summary = data?.market_summary;
  const lastUpdate = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—";

  const marketSentimentLabel = summary?.market_sentiment === "bull_market" ? "牛市" : summary?.market_sentiment === "bear_market" ? "熊市" : "混合";
  const marketSentimentColor = summary?.market_sentiment === "bull_market" ? "text-bull" : summary?.market_sentiment === "bear_market" ? "text-bear" : "text-yellow-400";

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card/80">
        <div className="flex items-center gap-2">
          <BarChart2 className="w-4 h-4 text-primary" />
          <span className="font-semibold text-sm">市場情緒熱力圖</span>
          {summary && (
            <span className={`text-xs font-medium ${marketSentimentColor}`}>
              — {marketSentimentLabel}（均分 {summary.avg_score}）
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">更新 {lastUpdate}</span>
          <button onClick={() => refetch()} disabled={isLoading} className="p-1.5 rounded hover:bg-accent transition-colors">
            <RefreshCw className={`w-3.5 h-3.5 text-muted-foreground ${isLoading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-border bg-background/30">
        {/* Timeframe */}
        <div className="flex gap-1">
          {(["1H", "4H", "1D"] as Timeframe[]).map(tf => (
            <button key={tf} onClick={() => setTimeframe(tf)}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${timeframe === tf ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"}`}>
              {tf}
            </button>
          ))}
        </div>
        <div className="w-px h-4 bg-border" />
        {/* View mode */}
        <div className="flex gap-1">
          {([["score", "綜合評分"], ["rsi", "RSI"], ["change24h", "24H%"], ["change7d", "7D%"]] as [ViewMode, string][]).map(([k, label]) => (
            <button key={k} onClick={() => setViewMode(k)}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${viewMode === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Market Summary Bar */}
      {summary && (
        <div className="flex items-center gap-4 px-4 py-2 border-b border-border bg-background/20 text-xs">
          <div className="flex items-center gap-1 text-bull">
            <TrendingUp className="w-3 h-3" />
            <span>看多 {summary.bull_count}</span>
          </div>
          <div className="flex items-center gap-1 text-bear">
            <TrendingDown className="w-3 h-3" />
            <span>看空 {summary.bear_count}</span>
          </div>
          <div className="flex items-center gap-1 text-muted-foreground">
            <Minus className="w-3 h-3" />
            <span>中性 {summary.neutral_count}</span>
          </div>
          <div className="w-px h-3 bg-border" />
          <span className="text-muted-foreground">均RSI: <span className="text-foreground font-mono">{summary.avg_rsi}</span></span>
          {/* Sentiment bar */}
          <div className="flex-1 flex gap-0.5 h-2 rounded-full overflow-hidden">
            <div className="bg-bull rounded-l-full" style={{ width: `${(summary.bull_count / 10) * 100}%` }} />
            <div className="bg-muted" style={{ width: `${(summary.neutral_count / 10) * 100}%` }} />
            <div className="bg-bear rounded-r-full" style={{ width: `${(summary.bear_count / 10) * 100}%` }} />
          </div>
        </div>
      )}

      {/* Heatmap Grid */}
      <div className="p-4">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-12 gap-2 text-muted-foreground">
            <RefreshCw className="w-6 h-6 animate-spin text-primary" />
            <span className="text-sm">載入市場數據...</span>
          </div>
        ) : (
          <div className="grid grid-cols-5 gap-2">
            {coins.map(coin => {
              const displayValue = viewMode === "score" ? coin.score
                : viewMode === "rsi" ? coin.rsi
                : viewMode === "change24h" ? coin.change24h
                : coin.change7d;
              const colorClass = viewMode === "score" ? getSentimentColor(coin.sentiment) : getValueColor(displayValue, viewMode);
              return (
                <button
                  key={coin.symbol}
                  onClick={() => onSelectSymbol?.(coin.symbol)}
                  className={`relative p-3 rounded-lg border-2 transition-all hover:scale-105 hover:shadow-lg cursor-pointer text-left ${colorClass}`}
                >
                  <div className="font-bold text-sm">{COIN_ICONS[coin.coin] ?? ""} {coin.coin}</div>
                  <div className="text-lg font-mono font-bold mt-1">{formatValue(displayValue, viewMode)}</div>
                  <div className="text-[10px] opacity-80 mt-0.5">
                    {coin.close >= 1000 ? `$${coin.close.toFixed(0)}` : coin.close >= 1 ? `$${coin.close.toFixed(2)}` : `$${coin.close.toFixed(4)}`}
                  </div>
                  {/* Volume trend indicator */}
                  {coin.vol_trend === "increasing" && (
                    <div className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-yellow-400" title="成交量放大" />
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="px-4 pb-3 flex items-center gap-4 text-xs text-muted-foreground">
        {viewMode === "score" && (
          <>
            <div className="flex items-center gap-1"><div className="w-3 h-3 rounded bg-bull" /><span>強多 ≥70</span></div>
            <div className="flex items-center gap-1"><div className="w-3 h-3 rounded bg-bull/60" /><span>看多 60-70</span></div>
            <div className="flex items-center gap-1"><div className="w-3 h-3 rounded bg-muted border border-border" /><span>中性 40-60</span></div>
            <div className="flex items-center gap-1"><div className="w-3 h-3 rounded bg-bear/60" /><span>看空 30-40</span></div>
            <div className="flex items-center gap-1"><div className="w-3 h-3 rounded bg-bear" /><span>強空 ≤30</span></div>
          </>
        )}
        {viewMode === "rsi" && (
          <>
            <div className="flex items-center gap-1"><div className="w-3 h-3 rounded bg-bear" /><span>超買 ≥70</span></div>
            <div className="flex items-center gap-1"><div className="w-3 h-3 rounded bg-bull/60" /><span>偏多 55-70</span></div>
            <div className="flex items-center gap-1"><div className="w-3 h-3 rounded bg-muted border border-border" /><span>中性 45-55</span></div>
            <div className="flex items-center gap-1"><div className="w-3 h-3 rounded bg-bear/60" /><span>偏空 30-45</span></div>
            <div className="flex items-center gap-1"><div className="w-3 h-3 rounded bg-bull" /><span>超賣 ≤30</span></div>
          </>
        )}
        <div className="ml-auto flex items-center gap-1">
          <div className="w-1.5 h-1.5 rounded-full bg-yellow-400" />
          <span>成交量放大</span>
        </div>
      </div>
    </div>
  );
}
