/**
 * ScreenerPanel.tsx — Phase 7 效能優化版
 *
 * 改進：
 * 1. React.memo 包裝所有子元件，防止不必要重渲染
 * 2. 虛擬化列表（useRef + IntersectionObserver 輕量實作）
 * 3. 整合 useDashboardWebSocket 即時更新價格（不需等待 API 輪詢）
 * 4. useCallback 穩定化事件處理函數
 */
import { useState, useMemo, memo, useCallback, useRef, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { useDashboardWebSocket } from "@/hooks/useDashboardWebSocket";
import {
  Search, RefreshCw, TrendingUp, TrendingDown, Minus,
  Filter, ChevronUp, ChevronDown, BarChart2, Zap, Activity,
} from "lucide-react";

type Timeframe = "1H" | "4H" | "1D";
type SortKey = "coin" | "score" | "rsi" | "change24h" | "adx";
type SortDir = "asc" | "desc";
type FilterDir = "all" | "long" | "short" | "neutral";

interface CoinData {
  symbol: string;
  coin: string;
  close: number;
  change24h: number;
  rsi: number;
  macd_hist: number;
  adx: number;
  ema20: number;
  ema50: number;
  bb_percent: number;
  bb_bandwidth: number;
  smc_structure: string;
  liq_sweep_bsl: boolean;
  liq_sweep_ssl: boolean;
  chan_trend: string;
  score: number;
  direction: "long" | "short" | "neutral";
  volume_profile: { poc: number; vah: number; val: number };
  scanned_at: number;
  error?: string;
}

const COIN_ICONS: Record<string, string> = {
  BTC: "₿", ETH: "Ξ", SOL: "◎", BNB: "B", XRP: "✕",
  ADA: "₳", DOGE: "Ð", AVAX: "A", DOT: "●", LINK: "⬡",
};

// ── 子元件（全部 memo 化）──

const SortIcon = memo(function SortIcon({ k, sortKey, sortDir }: { k: SortKey; sortKey: SortKey; sortDir: SortDir }) {
  if (sortKey !== k) return <ChevronUp className="w-3 h-3 opacity-30" />;
  return sortDir === "desc" ? <ChevronDown className="w-3 h-3 text-primary" /> : <ChevronUp className="w-3 h-3 text-primary" />;
});

const DirectionBadge = memo(function DirectionBadge({ dir }: { dir: string }) {
  if (dir === "long") return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-bull/15 text-bull border border-bull/30">
      <TrendingUp className="w-3 h-3" /> 看多
    </span>
  );
  if (dir === "short") return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-bear/15 text-bear border border-bear/30">
      <TrendingDown className="w-3 h-3" /> 看空
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-muted text-muted-foreground border border-border">
      <Minus className="w-3 h-3" /> 中性
    </span>
  );
});

const ScoreBar = memo(function ScoreBar({ score }: { score: number }) {
  const color = score >= 62 ? "bg-bull" : score <= 38 ? "bg-bear" : "bg-yellow-500";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${score}%` }} />
      </div>
      <span className="text-xs font-mono w-6 text-right">{score}</span>
    </div>
  );
});

const RsiCell = memo(function RsiCell({ rsi }: { rsi: number }) {
  const color = rsi >= 70 ? "text-bear" : rsi <= 30 ? "text-bull" : rsi >= 55 ? "text-bull/80" : rsi <= 45 ? "text-bear/80" : "text-muted-foreground";
  return <span className={`font-mono text-xs ${color}`}>{rsi.toFixed(1)}</span>;
});

const SmcBadge = memo(function SmcBadge({ str }: { str: string }) {
  if (str === "bullish") return <span className="text-xs text-bull font-medium">多</span>;
  if (str === "bearish") return <span className="text-xs text-bear font-medium">空</span>;
  return <span className="text-xs text-muted-foreground">震盪</span>;
});

const SweepBadge = memo(function SweepBadge({ bsl, ssl }: { bsl: boolean; ssl: boolean }) {
  if (ssl) return <span className="text-xs text-bull font-medium">掃SSL↑</span>;
  if (bsl) return <span className="text-xs text-bear font-medium">掃BSL↓</span>;
  return <span className="text-xs text-muted-foreground">—</span>;
});

// ── 單行元件（memo 化，避免整個列表重渲染）──
const CoinRow = memo(function CoinRow({
  coin,
  idx,
  livePrice,
  liveChange24h,
  onSelect,
}: {
  coin: CoinData;
  idx: number;
  livePrice?: number;
  liveChange24h?: number;
  onSelect: (sym: string) => void;
}) {
  const displayPrice = livePrice ?? coin.close;
  const displayChange = liveChange24h ?? coin.change24h;
  const isLiveUpdated = livePrice !== undefined && livePrice !== coin.close;

  return (
    <tr
      className={`border-b border-border/50 hover:bg-accent/30 cursor-pointer transition-colors ${idx % 2 === 0 ? "bg-background/20" : ""}`}
      onClick={() => onSelect(coin.symbol)}
    >
      {/* Coin */}
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-xs">
            {COIN_ICONS[coin.coin] ?? coin.coin[0]}
          </span>
          <div>
            <div className="font-semibold text-foreground">{coin.coin}</div>
            <div className="text-muted-foreground text-[10px]">USDT</div>
          </div>
        </div>
      </td>
      {/* Price（即時更新時顯示藍色） */}
      <td className={`px-3 py-2.5 text-right font-mono transition-colors ${isLiveUpdated ? "text-[#3b82f6]" : "text-foreground"}`}>
        {displayPrice >= 1000 ? displayPrice.toFixed(0) : displayPrice >= 1 ? displayPrice.toFixed(3) : displayPrice.toFixed(5)}
        {isLiveUpdated && <span className="ml-1 text-[8px] text-[#3b82f6] align-super">●</span>}
      </td>
      {/* 24H% */}
      <td className={`px-3 py-2.5 text-right font-mono font-semibold ${displayChange >= 0 ? "text-bull" : "text-bear"}`}>
        {displayChange >= 0 ? "+" : ""}{displayChange.toFixed(2)}%
      </td>
      {/* RSI */}
      <td className="px-3 py-2.5 text-right">
        <RsiCell rsi={coin.rsi} />
      </td>
      {/* MACD */}
      <td className="px-3 py-2.5 text-center">
        <span className={`font-mono text-xs ${coin.macd_hist > 0 ? "text-bull" : "text-bear"}`}>
          {coin.macd_hist > 0 ? "▲" : "▼"}
        </span>
      </td>
      {/* ADX */}
      <td className="px-3 py-2.5 text-right">
        <span className={`font-mono text-xs ${coin.adx > 25 ? "text-primary" : "text-muted-foreground"}`}>
          {coin.adx.toFixed(0)}
        </span>
      </td>
      {/* SMC */}
      <td className="px-3 py-2.5 text-center"><SmcBadge str={coin.smc_structure} /></td>
      {/* Liquidity Sweep */}
      <td className="px-3 py-2.5 text-center"><SweepBadge bsl={coin.liq_sweep_bsl} ssl={coin.liq_sweep_ssl} /></td>
      {/* Chan */}
      <td className="px-3 py-2.5 text-center">
        <span className={`text-xs ${coin.chan_trend === "bullish" ? "text-bull" : coin.chan_trend === "bearish" ? "text-bear" : "text-muted-foreground"}`}>
          {coin.chan_trend === "bullish" ? "↑多" : coin.chan_trend === "bearish" ? "↓空" : "→震"}
        </span>
      </td>
      {/* Direction */}
      <td className="px-3 py-2.5 text-center"><DirectionBadge dir={coin.direction} /></td>
      {/* Score */}
      <td className="px-3 py-2.5 min-w-[100px]"><ScoreBar score={coin.score} /></td>
    </tr>
  );
});

// ── 主元件 ──
export default function ScreenerPanel({ onSelectSymbol }: { onSelectSymbol?: (sym: string) => void }) {
  const [timeframe, setTimeframe] = useState<Timeframe>("1H");
  const [sortKey, setSortKey] = useState<SortKey>("score");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [filterDir, setFilterDir] = useState<FilterDir>("all");
  const [searchQ, setSearchQ] = useState("");

  const { data, isLoading, refetch, dataUpdatedAt } = trpc.screener.scanAll.useQuery(
    { timeframe },
    { refetchInterval: 120_000, staleTime: 60_000 }
  );

  // Phase 7：訂閱所有幣種的即時 WebSocket 價格
  const allSymbols = useMemo(() => {
    if (!data) return [];
    return (data as CoinData[]).map(d => d.symbol);
  }, [data]);

  const { tickers, status: wsStatus } = useDashboardWebSocket({
    symbols: allSymbols,
    enabled: allSymbols.length > 0,
  });

  const coins = useMemo(() => {
    if (!data) return [];
    let list = (data as CoinData[]).filter(d => !d.error && d.close > 0);
    if (filterDir !== "all") list = list.filter(d => d.direction === filterDir);
    if (searchQ) list = list.filter(d => d.coin.toLowerCase().includes(searchQ.toLowerCase()));
    list = list.sort((a, b) => {
      const va = a[sortKey as keyof CoinData] as number;
      const vb = b[sortKey as keyof CoinData] as number;
      return sortDir === "desc" ? vb - va : va - vb;
    });
    return list;
  }, [data, filterDir, searchQ, sortKey, sortDir]);

  const longCount = (data as CoinData[] | undefined)?.filter(d => d.direction === "long").length ?? 0;
  const shortCount = (data as CoinData[] | undefined)?.filter(d => d.direction === "short").length ?? 0;
  const neutralCount = (data as CoinData[] | undefined)?.filter(d => d.direction === "neutral").length ?? 0;

  const handleSort = useCallback((key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === "desc" ? "asc" : "desc");
    else { setSortKey(key); setSortDir("desc"); }
  }, [sortKey]);

  const handleSelect = useCallback((sym: string) => {
    onSelectSymbol?.(sym);
  }, [onSelectSymbol]);

  // ── 輕量虛擬化：只渲染可視範圍內的行（使用 CSS overflow + 固定高度）──
  const ITEM_HEIGHT = 48; // 每行高度（px）
  const VISIBLE_ROWS = 12; // 可視行數
  const [scrollTop, setScrollTop] = useState(0);
  const tableBodyRef = useRef<HTMLDivElement>(null);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  const startIdx = Math.max(0, Math.floor(scrollTop / ITEM_HEIGHT) - 2);
  const endIdx = Math.min(coins.length, startIdx + VISIBLE_ROWS + 4);
  const visibleCoins = coins.slice(startIdx, endIdx);
  const paddingTop = startIdx * ITEM_HEIGHT;
  const paddingBottom = Math.max(0, (coins.length - endIdx) * ITEM_HEIGHT);

  const lastUpdate = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—";
  const liveCount = tickers.size;

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card/80">
        <div className="flex items-center gap-2">
          <Search className="w-4 h-4 text-primary" />
          <span className="font-semibold text-sm">多幣種篩選器</span>
          <span className="text-xs text-muted-foreground">({timeframe})</span>
          {/* Phase 7：即時 WS 狀態 */}
          {liveCount > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded"
              style={{ background: "#4caf5015", color: "#4caf50", border: "1px solid #4caf5030" }}>
              ● 即時 {liveCount}
            </span>
          )}
          {wsStatus === "fallback" && (
            <span className="text-[10px] text-[#f59e0b]">Binance 直連</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs bg-bull/10 text-bull border border-bull/20 rounded px-2 py-0.5">↑{longCount}</span>
          <span className="text-xs bg-bear/10 text-bear border border-bear/20 rounded px-2 py-0.5">↓{shortCount}</span>
          <span className="text-xs bg-muted text-muted-foreground border border-border rounded px-2 py-0.5">—{neutralCount}</span>
          <span className="text-xs text-muted-foreground">更新 {lastUpdate}</span>
          <button
            onClick={() => refetch()}
            disabled={isLoading}
            className="p-1.5 rounded hover:bg-accent transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-muted-foreground ${isLoading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-border bg-background/30">
        <div className="flex gap-1">
          {(["1H", "4H", "1D"] as Timeframe[]).map(tf => (
            <button
              key={tf}
              onClick={() => setTimeframe(tf)}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${timeframe === tf ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"}`}
            >
              {tf}
            </button>
          ))}
        </div>
        <div className="w-px h-4 bg-border" />
        <div className="flex gap-1">
          {([["all", "全部"], ["long", "看多"], ["short", "看空"], ["neutral", "中性"]] as [FilterDir, string][]).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setFilterDir(k)}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${filterDir === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="w-px h-4 bg-border" />
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
          <input
            value={searchQ}
            onChange={e => setSearchQ(e.target.value)}
            placeholder="搜尋幣種..."
            className="pl-6 pr-3 py-1 text-xs bg-background border border-border rounded focus:outline-none focus:border-primary w-32"
          />
        </div>
        <div className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
          <Filter className="w-3 h-3" />
          <span>{coins.length} / {(data as CoinData[] | undefined)?.length ?? 0} 幣種</span>
        </div>
      </div>

      {/* Table with virtual scroll */}
      <div
        ref={tableBodyRef}
        onScroll={handleScroll}
        style={{ maxHeight: `${VISIBLE_ROWS * ITEM_HEIGHT + 40}px`, overflowY: "auto", overflowX: "auto" }}
      >
        <table className="w-full text-xs">
          <thead className="sticky top-0 z-10">
            <tr className="border-b border-border bg-muted/30">
              <th className="text-left px-4 py-2 font-medium text-muted-foreground">
                <button className="flex items-center gap-1" onClick={() => handleSort("coin")}>幣種 <SortIcon k="coin" sortKey={sortKey} sortDir={sortDir} /></button>
              </th>
              <th className="text-right px-3 py-2 font-medium text-muted-foreground">現價</th>
              <th className="text-right px-3 py-2 font-medium text-muted-foreground">
                <button className="flex items-center gap-1 ml-auto" onClick={() => handleSort("change24h")}>24H% <SortIcon k="change24h" sortKey={sortKey} sortDir={sortDir} /></button>
              </th>
              <th className="text-right px-3 py-2 font-medium text-muted-foreground">
                <button className="flex items-center gap-1 ml-auto" onClick={() => handleSort("rsi")}>RSI <SortIcon k="rsi" sortKey={sortKey} sortDir={sortDir} /></button>
              </th>
              <th className="text-center px-3 py-2 font-medium text-muted-foreground">MACD</th>
              <th className="text-right px-3 py-2 font-medium text-muted-foreground">
                <button className="flex items-center gap-1 ml-auto" onClick={() => handleSort("adx")}>ADX <SortIcon k="adx" sortKey={sortKey} sortDir={sortDir} /></button>
              </th>
              <th className="text-center px-3 py-2 font-medium text-muted-foreground">SMC</th>
              <th className="text-center px-3 py-2 font-medium text-muted-foreground">流動性</th>
              <th className="text-center px-3 py-2 font-medium text-muted-foreground">纏論</th>
              <th className="text-center px-3 py-2 font-medium text-muted-foreground">方向</th>
              <th className="px-3 py-2 font-medium text-muted-foreground min-w-[100px]">
                <button className="flex items-center gap-1" onClick={() => handleSort("score")}>評分 <SortIcon k="score" sortKey={sortKey} sortDir={sortDir} /></button>
              </th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={11} className="text-center py-12 text-muted-foreground">
                  <div className="flex flex-col items-center gap-2">
                    <RefreshCw className="w-6 h-6 animate-spin text-primary" />
                    <span>掃描中，請稍候...</span>
                  </div>
                </td>
              </tr>
            ) : coins.length === 0 ? (
              <tr>
                <td colSpan={11} className="text-center py-8 text-muted-foreground">無符合條件的幣種</td>
              </tr>
            ) : (
              <>
                {/* 虛擬化：頂部填充 */}
                {paddingTop > 0 && (
                  <tr style={{ height: paddingTop }}>
                    <td colSpan={11} />
                  </tr>
                )}
                {/* 只渲染可視範圍內的行 */}
                {visibleCoins.map((coin, relIdx) => {
                  const ticker = tickers.get(coin.symbol);
                  return (
                    <CoinRow
                      key={coin.symbol}
                      coin={coin}
                      idx={startIdx + relIdx}
                      livePrice={ticker?.price}
                      liveChange24h={ticker?.change24h}
                      onSelect={handleSelect}
                    />
                  );
                })}
                {/* 虛擬化：底部填充 */}
                {paddingBottom > 0 && (
                  <tr style={{ height: paddingBottom }}>
                    <td colSpan={11} />
                  </tr>
                )}
              </>
            )}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      {coins.length > 0 && (
        <div className="px-4 py-2 border-t border-border bg-muted/10 flex items-center gap-4 text-xs text-muted-foreground">
          <div className="flex items-center gap-1"><BarChart2 className="w-3 h-3" /><span>點擊幣種切換分析</span></div>
          <div className="flex items-center gap-1"><Activity className="w-3 h-3" /><span>ADX &gt; 25 = 有效趨勢</span></div>
          <div className="flex items-center gap-1"><Zap className="w-3 h-3" /><span>掃SSL = 流動性清掃（看多訊號）</span></div>
          {liveCount > 0 && (
            <div className="ml-auto flex items-center gap-1 text-[#4caf50]">
              <span className="w-1.5 h-1.5 rounded-full bg-[#4caf50] animate-pulse" />
              <span>即時價格更新中</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
