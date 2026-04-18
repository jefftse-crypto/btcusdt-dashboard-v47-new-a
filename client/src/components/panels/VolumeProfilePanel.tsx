/**
 * VolumeProfilePanel.tsx
 * 成交量分佈（Volume Profile / VPVR）視覺化面板
 * 顯示 POC、VAH、VAL 及每個價格區間的成交量分佈
 */
import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { RefreshCw, BarChart2, Info } from "lucide-react";

type Timeframe = "1H" | "4H" | "1D";

interface VpBin {
  price: number;
  volume: number;
  isBull: boolean;
}

interface VolumeProfileData {
  poc: number;
  vah: number;
  val: number;
  bins: VpBin[];
}

interface ScreenerCoin {
  symbol: string;
  coin: string;
  close: number;
  volume_profile: VolumeProfileData;
  score: number;
  direction: "long" | "short" | "neutral";
}

function formatPrice(price: number): string {
  if (price >= 10000) return price.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  if (price >= 100) return price.toFixed(2);
  if (price >= 1) return price.toFixed(4);
  return price.toFixed(6);
}

function VolumeProfileChart({
  vp,
  currentPrice,
  height = 300,
}: {
  vp: VolumeProfileData;
  currentPrice: number;
  height?: number;
}) {
  const bins = vp.bins;
  if (!bins || bins.length === 0) return (
    <div className="flex items-center justify-center h-32 text-muted-foreground text-xs">無成交量分佈數據</div>
  );

  const maxVol = Math.max(...bins.map(b => b.volume));
  const sorted = [...bins].sort((a, b) => b.price - a.price); // high to low

  return (
    <div className="relative" style={{ height }}>
      {/* Price labels on left, bars on right */}
      <div className="flex h-full gap-0">
        {/* Price axis */}
        <div className="flex flex-col justify-between py-0.5 pr-2 text-right" style={{ width: 72 }}>
          {sorted.filter((_, i) => i % Math.ceil(sorted.length / 8) === 0).map((bin, i) => (
            <span key={i} className="text-[9px] text-muted-foreground font-mono leading-none">
              {formatPrice(bin.price)}
            </span>
          ))}
        </div>

        {/* Bars */}
        <div className="flex-1 flex flex-col gap-px py-0.5 relative">
          {sorted.map((bin, i) => {
            const widthPct = maxVol > 0 ? (bin.volume / maxVol) * 100 : 0;
            const isPoc = Math.abs(bin.price - vp.poc) < (sorted[0].price - sorted[sorted.length - 1].price) / bins.length / 2;
            const isVah = Math.abs(bin.price - vp.vah) < (sorted[0].price - sorted[sorted.length - 1].price) / bins.length;
            const isVal = Math.abs(bin.price - vp.val) < (sorted[0].price - sorted[sorted.length - 1].price) / bins.length;
            const isCurrentPrice = currentPrice > 0 && Math.abs(bin.price - currentPrice) < (sorted[0].price - sorted[sorted.length - 1].price) / bins.length;

            return (
              <div key={i} className="flex items-center gap-1 group relative" style={{ flex: 1 }}>
                <div className="flex-1 relative h-full flex items-center">
                  <div
                    className={`h-full rounded-r transition-all ${
                      isPoc ? "opacity-100" : "opacity-70"
                    } ${bin.isBull ? "bg-bull" : "bg-bear"} ${isPoc ? "ring-1 ring-yellow-400/60" : ""}`}
                    style={{ width: `${Math.max(widthPct, 1)}%`, minHeight: 2 }}
                  />
                  {/* POC marker */}
                  {isPoc && (
                    <span className="absolute right-0 text-[8px] text-yellow-400 font-bold ml-1 whitespace-nowrap">POC</span>
                  )}
                  {/* VAH marker */}
                  {isVah && (
                    <span className="absolute right-0 text-[8px] text-primary/80 font-bold ml-1 whitespace-nowrap">VAH</span>
                  )}
                  {/* VAL marker */}
                  {isVal && (
                    <span className="absolute right-0 text-[8px] text-primary/60 font-bold ml-1 whitespace-nowrap">VAL</span>
                  )}
                  {/* Current price marker */}
                  {isCurrentPrice && (
                    <div className="absolute left-0 right-0 h-px bg-white/80 z-10" />
                  )}
                </div>
              </div>
            );
          })}

          {/* Value Area overlay */}
          <div
            className="absolute left-0 right-0 pointer-events-none"
            style={{
              top: `${((sorted[0].price - vp.vah) / (sorted[0].price - sorted[sorted.length - 1].price)) * 100}%`,
              bottom: `${((vp.val - sorted[sorted.length - 1].price) / (sorted[0].price - sorted[sorted.length - 1].price)) * 100}%`,
              background: "rgba(59,130,246,0.04)",
              borderTop: "1px dashed rgba(59,130,246,0.4)",
              borderBottom: "1px dashed rgba(59,130,246,0.4)",
            }}
          />
        </div>
      </div>
    </div>
  );
}

export default function VolumeProfilePanel({ symbol }: { symbol: string }) {
  const [timeframe, setTimeframe] = useState<Timeframe>("4H");

  const { data, isLoading, refetch, dataUpdatedAt } = trpc.screener.scanAll.useQuery(
    { timeframe },
    { refetchInterval: 180_000, staleTime: 120_000 }
  );

  const coinData = useMemo(() => {
    if (!data) return null;
    return (data as ScreenerCoin[]).find(d => d.symbol === symbol) ?? null;
  }, [data, symbol]);

  const vp = coinData?.volume_profile;
  const currentPrice = coinData?.close ?? 0;
  const lastUpdate = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—";

  const priceRelativeToVA = useMemo(() => {
    if (!vp || currentPrice === 0) return null;
    if (currentPrice > vp.vah) return "above_va";
    if (currentPrice < vp.val) return "below_va";
    return "in_va";
  }, [vp, currentPrice]);

  const priceRelativeLabel = priceRelativeToVA === "above_va" ? "價格在 VA 上方（強勢）"
    : priceRelativeToVA === "below_va" ? "價格在 VA 下方（弱勢）"
    : priceRelativeToVA === "in_va" ? "價格在 VA 內（震盪）"
    : null;

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card/80">
        <div className="flex items-center gap-2">
          <BarChart2 className="w-4 h-4 text-primary" />
          <span className="font-semibold text-sm">成交量分佈 (VPVR)</span>
          <span className="text-xs text-muted-foreground">{symbol.replace("USDT", "/USDT")}</span>
        </div>
        <div className="flex items-center gap-2">
          {/* Timeframe */}
          <div className="flex gap-1">
            {(["1H", "4H", "1D"] as Timeframe[]).map(tf => (
              <button
                key={tf}
                onClick={() => setTimeframe(tf)}
                className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${timeframe === tf ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"}`}
              >
                {tf}
              </button>
            ))}
          </div>
          <span className="text-xs text-muted-foreground">更新 {lastUpdate}</span>
          <button onClick={() => refetch()} disabled={isLoading} className="p-1.5 rounded hover:bg-accent transition-colors">
            <RefreshCw className={`w-3.5 h-3.5 text-muted-foreground ${isLoading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Key Levels */}
      {vp && (
        <div className="grid grid-cols-3 gap-px border-b border-border bg-border">
          <div className="bg-card px-4 py-2">
            <div className="text-[10px] text-muted-foreground mb-0.5">POC（最大成交量）</div>
            <div className="text-sm font-mono font-bold text-yellow-400">${formatPrice(vp.poc)}</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">
              {currentPrice > 0 ? `距離 ${((currentPrice - vp.poc) / vp.poc * 100).toFixed(2)}%` : "—"}
            </div>
          </div>
          <div className="bg-card px-4 py-2">
            <div className="text-[10px] text-muted-foreground mb-0.5">VAH（價值區上緣）</div>
            <div className="text-sm font-mono font-bold text-primary">${formatPrice(vp.vah)}</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">
              {currentPrice > 0 ? `距離 ${((currentPrice - vp.vah) / vp.vah * 100).toFixed(2)}%` : "—"}
            </div>
          </div>
          <div className="bg-card px-4 py-2">
            <div className="text-[10px] text-muted-foreground mb-0.5">VAL（價值區下緣）</div>
            <div className="text-sm font-mono font-bold text-primary/70">${formatPrice(vp.val)}</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">
              {currentPrice > 0 ? `距離 ${((currentPrice - vp.val) / vp.val * 100).toFixed(2)}%` : "—"}
            </div>
          </div>
        </div>
      )}

      {/* Price context */}
      {priceRelativeLabel && (
        <div className={`px-4 py-1.5 text-xs border-b border-border flex items-center gap-1.5 ${
          priceRelativeToVA === "above_va" ? "bg-bull/5 text-bull" :
          priceRelativeToVA === "below_va" ? "bg-bear/5 text-bear" :
          "bg-yellow-400/5 text-yellow-400"
        }`}>
          <Info className="w-3 h-3" />
          {priceRelativeLabel}
          {priceRelativeToVA === "above_va" && " — 若回測 VAH 不破，可考慮做多"}
          {priceRelativeToVA === "below_va" && " — 若反彈 VAL 不過，可考慮做空"}
          {priceRelativeToVA === "in_va" && " — 等待突破 VAH 或跌破 VAL 方向確認"}
        </div>
      )}

      {/* Chart */}
      <div className="p-4">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-12 gap-2 text-muted-foreground">
            <RefreshCw className="w-6 h-6 animate-spin text-primary" />
            <span className="text-sm">計算成交量分佈...</span>
          </div>
        ) : vp ? (
          <VolumeProfileChart vp={vp} currentPrice={currentPrice} height={320} />
        ) : (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <BarChart2 className="w-8 h-8 mb-2 opacity-30" />
            <span className="text-sm">無法取得 {symbol} 的成交量分佈數據</span>
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="px-4 pb-3 flex items-center gap-4 text-xs text-muted-foreground border-t border-border pt-2">
        <div className="flex items-center gap-1"><div className="w-3 h-2 rounded bg-bull" /><span>買方主導</span></div>
        <div className="flex items-center gap-1"><div className="w-3 h-2 rounded bg-bear" /><span>賣方主導</span></div>
        <div className="flex items-center gap-1"><div className="w-3 h-1.5 rounded bg-yellow-400" /><span>POC（最大成交量價位）</span></div>
        <div className="flex items-center gap-1"><div className="w-3 h-px border-t border-dashed border-primary" /><span>VA 邊界（70% 成交量區間）</span></div>
      </div>
    </div>
  );
}
