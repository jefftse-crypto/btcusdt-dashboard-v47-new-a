import type { SmcData } from "@shared/cryptoTypes";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SmcConfirmPanel } from "@/components/panels/SmcConfirmPanel";

interface Props {
  smc: SmcData | undefined;
  isLoading: boolean;
  currentPrice?: number | null;
}

const fmt = (v: number | undefined | null, d = 2) =>
  v == null || isNaN(v) ? "—" : v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });

const pct = (v: number) =>
  `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;

export function SmcPanel({ smc, isLoading, currentPrice }: Props) {
  if (isLoading && !smc) {
    return (
      <div className="crypto-panel">
        <div className="crypto-panel-header">SMC 市場結構</div>
        <div className="p-3 space-y-2">
          {[...Array(6)].map((_, i) => <div key={i} className="h-4 bg-secondary/50 rounded animate-pulse" />)}
        </div>
      </div>
    );
  }

  if (!smc) {
    return (
      <div className="crypto-panel p-6 text-center">
        <div className="text-muted-foreground text-sm">請點擊「分析」按鈕取得 SMC 結構數據</div>
      </div>
    );
  }

  const structureColor = smc.structure === "bullish" ? "text-bull" : smc.structure === "bearish" ? "text-bear" : "text-yellow-400";
  const structureLabel = smc.structure === "bullish" ? "多頭結構" : smc.structure === "bearish" ? "空頭結構" : "震盪結構";

  // Extended SMC fields from new analysis engine
  const ext = smc as SmcData & {
    premium_discount?: { equilibrium: number; current_zone: string; percent_position: number };
    ote_zone?: { direction: string; fib_618: number; fib_705: number; fib_786: number; swing_high: number; swing_low: number; in_zone: boolean } | null;
    liquidity_levels?: Array<{ price: number; type: string; swept: boolean; strength: string }>;
    recent_swing_high?: number;
    recent_swing_low?: number;
  };

  const pd = ext.premium_discount;
  const ote = ext.ote_zone;
  const liqLevels = ext.liquidity_levels ?? [];
  const swingHigh = ext.recent_swing_high ?? 0;
  const swingLow  = ext.recent_swing_low ?? 0;
  const close = smc.liquidity.nearest_sell > 0 ? (smc.liquidity.nearest_sell + smc.liquidity.nearest_buy) / 2 : 0;

  return (
    <div className="space-y-3">
      {/* Header Row */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className={`px-2 py-0.5 rounded text-xs font-bold border ${
          smc.structure === "bullish" ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
          : smc.structure === "bearish" ? "bg-red-500/20 text-red-400 border-red-500/30"
          : "bg-yellow-500/20 text-yellow-400 border-yellow-500/30"
        }`}>{structureLabel}</span>
        {pd && (
          <span className={`px-2 py-0.5 rounded text-xs font-bold border ${
            pd.current_zone === "premium" ? "bg-red-500/20 text-red-400 border-red-500/30"
            : pd.current_zone === "discount" ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
            : "bg-yellow-500/20 text-yellow-400 border-yellow-500/30"
          }`}>
            {pd.current_zone === "premium" ? "Premium 區" : pd.current_zone === "discount" ? "Discount 區" : "均衡區"}
            {" "}({pd.percent_position.toFixed(0)}%)
          </span>
        )}
        {ote?.in_zone && (
          <span className="px-2 py-0.5 rounded text-xs font-bold bg-purple-500/20 text-purple-400 border border-purple-500/30">
            ⚡ OTE 區間
          </span>
        )}
        <span className="text-xs text-muted-foreground ml-auto">
          高 <span className="text-bear font-mono">{fmt(swingHigh)}</span>
          {" · "}
          低 <span className="text-bull font-mono">{fmt(swingLow)}</span>
        </span>
      </div>

      <Tabs defaultValue="overview">
        <TabsList className="bg-secondary/50 h-8">
          {(["confirm","overview","liquidity","fvg","ob","structure","mtf"] as const).map(t => (
            <TabsTrigger key={t} value={t} className="text-xs px-2.5 h-7">
              {{ confirm:"⚡確認模型", overview:"概覽", liquidity:"流動性", fvg:"FVG", ob:"OB", structure:"結構", mtf:"多時段" }[t]}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* ── Confirm Model ── */}
        <TabsContent value="confirm" className="mt-3">
          <SmcConfirmPanel smc={smc} currentPrice={currentPrice ?? null} isLoading={isLoading} />
        </TabsContent>

        {/* ── Overview ── */}
        <TabsContent value="overview" className="mt-3 space-y-3">
          <div className="grid grid-cols-2 gap-3">

            {/* Premium / Discount */}
            {pd && (
              <div className="crypto-panel col-span-2 sm:col-span-1">
                <div className="crypto-panel-header">ICT Premium / Discount 區間</div>
                <div className="p-3 space-y-2">
                  <div className="flex justify-between text-xs text-muted-foreground mb-1">
                    <span>SSL（低位）</span>
                    <span>均衡 {fmt(pd.equilibrium)}</span>
                    <span>BSL（高位）</span>
                  </div>
                  <div className="relative h-3 bg-secondary rounded-full overflow-hidden">
                    <div
                      className={`absolute left-0 top-0 h-full rounded-full transition-all ${
                        pd.current_zone === "premium" ? "bg-red-500" : pd.current_zone === "discount" ? "bg-emerald-500" : "bg-yellow-500"
                      }`}
                      style={{ width: `${Math.min(100, Math.max(0, pd.percent_position))}%` }}
                    />
                    <div className="absolute top-0 left-1/2 h-full w-0.5 bg-yellow-400/80 -translate-x-1/2" />
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-bull">Discount（有利買入）</span>
                    <span className={`font-bold ${pd.current_zone === "premium" ? "text-bear" : pd.current_zone === "discount" ? "text-bull" : "text-yellow-400"}`}>
                      {pd.percent_position.toFixed(1)}%
                    </span>
                    <span className="text-bear">Premium（有利賣出）</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {pd.current_zone === "premium"
                      ? "⚠️ 處於 Premium 區間，ICT 理論不建議追多，等待回調至 Discount"
                      : pd.current_zone === "discount"
                      ? "✅ 處於 Discount 區間，ICT 理論有利於尋找做多機會"
                      : "⚖️ 接近均衡位，等待突破後再入場"}
                  </p>
                </div>
              </div>
            )}

            {/* OTE Zone */}
            <div className="crypto-panel col-span-2 sm:col-span-1">
              <div className="crypto-panel-header">ICT 最佳交易入場（OTE）</div>
              <div className="p-3 space-y-2">
                {ote ? (
                  <>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`px-1.5 py-0.5 rounded text-xs font-bold ${
                        ote.direction === "bullish" ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"
                      }`}>{ote.direction === "bullish" ? "看多 OTE" : "看空 OTE"}</span>
                      {ote.in_zone && (
                        <span className="px-1.5 py-0.5 rounded text-xs font-bold bg-purple-500/20 text-purple-400">
                          ⚡ 當前在 OTE 區間
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-3 gap-1.5 text-xs">
                      {[
                        { label: "0.618", val: ote.fib_618 },
                        { label: "0.705", val: ote.fib_705 },
                        { label: "0.786", val: ote.fib_786 },
                      ].map(({ label, val }) => (
                        <div key={label} className="bg-secondary/50 rounded p-1.5 text-center">
                          <div className="text-muted-foreground text-xs">{label}</div>
                          <div className="font-mono text-foreground text-xs">{fmt(val)}</div>
                        </div>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      擺動範圍：{fmt(ote.swing_low)} – {fmt(ote.swing_high)}
                      {ote.in_zone ? "，當前在 OTE 最佳入場區" : "，等待回調至 61.8%–78.6%"}
                    </p>
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">無法識別有效擺動區間</p>
                )}
              </div>
            </div>
          </div>

          {/* Key Levels Summary */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              { label: "多頭 FVG", val: smc.nearest_bull_fvg ? `${fmt(smc.nearest_bull_fvg.bottom)}–${fmt(smc.nearest_bull_fvg.top)}` : "—", cls: "text-bull" },
              { label: "空頭 FVG", val: smc.nearest_bear_fvg ? `${fmt(smc.nearest_bear_fvg.bottom)}–${fmt(smc.nearest_bear_fvg.top)}` : "—", cls: "text-bear" },
              { label: "多頭 OB",  val: smc.nearest_bull_ob  ? `${fmt(smc.nearest_bull_ob.bottom)}–${fmt(smc.nearest_bull_ob.top)}` : "—", cls: "text-bull" },
              { label: "空頭 OB",  val: smc.nearest_bear_ob  ? `${fmt(smc.nearest_bear_ob.bottom)}–${fmt(smc.nearest_bear_ob.top)}` : "—", cls: "text-bear" },
            ].map(({ label, val, cls }) => (
              <div key={label} className="crypto-panel p-2">
                <div className="text-xs text-muted-foreground mb-1">{label}</div>
                <div className={`text-xs font-mono font-bold ${cls}`}>{val}</div>
              </div>
            ))}
          </div>
        </TabsContent>

        {/* ── Liquidity ── */}
        <TabsContent value="liquidity" className="mt-3 space-y-3">
          <div className="crypto-panel">
            <div className="crypto-panel-header">ICT 流動性層級（BSL / SSL）</div>
            <div className="p-3">
              <p className="text-xs text-muted-foreground mb-3">
                <span className="text-blue-400 font-semibold">BSL（買方流動性）</span>：擺動高點上方，空頭止損聚集，價格常被吸引掃除後反轉。
                <span className="text-orange-400 font-semibold"> SSL（賣方流動性）</span>：擺動低點下方，多頭止損聚集，價格常被吸引掃除後反轉。
              </p>
              <div className="space-y-2">
                {liqLevels.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-3">未識別到流動性層級</p>
                ) : (
                  liqLevels
                    .slice().sort((a, b) => b.price - a.price)
                    .map((level, i) => {
                      const isBsl = level.type === "BSL";
                      const dist = close > 0 ? ((level.price - close) / close * 100) : 0;
                      return (
                        <div key={i} className={`flex items-center justify-between p-2 rounded border text-xs ${
                          isBsl ? "border-blue-500/30 bg-blue-500/5" : "border-orange-500/30 bg-orange-500/5"
                        } ${level.swept ? "opacity-40" : ""}`}>
                          <div className="flex items-center gap-1.5">
                            <span className={`px-1.5 py-0.5 rounded font-bold ${
                              isBsl ? "bg-blue-500/20 text-blue-400" : "bg-orange-500/20 text-orange-400"
                            }`}>{level.type}</span>
                            {level.strength === "strong" && <span className="text-yellow-400">★</span>}
                            {level.swept && <span className="text-muted-foreground text-xs">已掃</span>}
                          </div>
                          <span className="font-mono font-bold text-foreground">{fmt(level.price)}</span>
                          <span className={`font-mono ${dist >= 0 ? "text-blue-400" : "text-orange-400"}`}>
                            {pct(dist)}
                          </span>
                        </div>
                      );
                    })
                )}
              </div>
              <div className="grid grid-cols-2 gap-2 mt-3">
                <div className="bg-secondary/40 rounded p-2">
                  <div className="text-xs text-muted-foreground mb-1">最近 BSL 目標</div>
                  <div className="font-mono text-blue-400 font-bold text-sm">{fmt(smc.liquidity.nearest_sell)}</div>
                </div>
                <div className="bg-secondary/40 rounded p-2">
                  <div className="text-xs text-muted-foreground mb-1">最近 SSL 目標</div>
                  <div className="font-mono text-orange-400 font-bold text-sm">{fmt(smc.liquidity.nearest_buy)}</div>
                </div>
              </div>
            </div>
          </div>
        </TabsContent>

        {/* ── FVG ── */}
        <TabsContent value="fvg" className="mt-3 space-y-3">
          <div className="crypto-panel">
            <div className="crypto-panel-header">公平價值缺口（FVG）— 共 {smc.fvg_count} 個</div>
            <div className="p-3">
              <p className="text-xs text-muted-foreground mb-3">
                三根K線之間的價格缺口，代表快速移動留下的未成交區域。
                <span className="text-bull"> 多頭 FVG</span>（前K高點 &lt; 後K低點）通常作為支撐；
                <span className="text-bear"> 空頭 FVG</span>（前K低點 &gt; 後K高點）通常作為阻力。
              </p>
              {/* FVG with distance % */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <div className="text-xs text-bull font-semibold mb-2">最近多頭 FVG（支撑）</div>
                  {smc.nearest_bull_fvg ? (() => {
                    const distPct = close > 0 ? ((smc.nearest_bull_fvg!.mid - close) / close * 100) : 0;
                    return (
                      <div className="space-y-1.5 bg-emerald-500/5 rounded p-2 border border-emerald-500/20">
                        {[
                          { k: "頂部", v: smc.nearest_bull_fvg!.top },
                          { k: "底部", v: smc.nearest_bull_fvg!.bottom },
                          { k: "中點", v: smc.nearest_bull_fvg!.mid },
                          { k: "大小", v: Math.abs(smc.nearest_bull_fvg!.top - smc.nearest_bull_fvg!.bottom) },
                        ].map(({ k, v }) => (
                          <div key={k} className="flex justify-between text-xs">
                            <span className="text-muted-foreground">{k}</span>
                            <span className="font-mono text-bull">{fmt(v)}</span>
                          </div>
                        ))}
                        <div className="flex justify-between text-xs">
                          <span className="text-muted-foreground">距離</span>
                          <span className={`font-mono font-bold ${distPct >= 0 ? "text-blue-400" : "text-bull"}`}>{pct(distPct)}</span>
                        </div>
                        <div className="text-xs text-bull">{smc.nearest_bull_fvg!.filled ? "已填補" : "✓ 未填補"}</div>
                      </div>
                    );
                  })() : <p className="text-xs text-muted-foreground">無多頭 FVG</p>}
                </div>
                <div>
                  <div className="text-xs text-bear font-semibold mb-2">最近空頭 FVG（阻力）</div>
                  {smc.nearest_bear_fvg ? (() => {
                    const distPct = close > 0 ? ((smc.nearest_bear_fvg!.mid - close) / close * 100) : 0;
                    return (
                      <div className="space-y-1.5 bg-red-500/5 rounded p-2 border border-red-500/20">
                        {[
                          { k: "頂部", v: smc.nearest_bear_fvg!.top },
                          { k: "底部", v: smc.nearest_bear_fvg!.bottom },
                          { k: "中點", v: smc.nearest_bear_fvg!.mid },
                          { k: "大小", v: Math.abs(smc.nearest_bear_fvg!.top - smc.nearest_bear_fvg!.bottom) },
                        ].map(({ k, v }) => (
                          <div key={k} className="flex justify-between text-xs">
                            <span className="text-muted-foreground">{k}</span>
                            <span className="font-mono text-bear">{fmt(v)}</span>
                          </div>
                        ))}
                        <div className="flex justify-between text-xs">
                          <span className="text-muted-foreground">距離</span>
                          <span className={`font-mono font-bold ${distPct <= 0 ? "text-blue-400" : "text-bear"}`}>{pct(distPct)}</span>
                        </div>
                        <div className="text-xs text-bear">{smc.nearest_bear_fvg!.filled ? "已填補" : "✓ 未填補"}</div>
                      </div>
                    );
                  })() : <p className="text-xs text-muted-foreground">無空頭 FVG</p>}
                </div>
              </div>
            </div>
          </div>
        </TabsContent>

        {/* ── OB ── */}
        <TabsContent value="ob" className="mt-3 space-y-3">
          <div className="crypto-panel">
            <div className="crypto-panel-header">訂單區塊（Order Block）— 共 {smc.ob_count} 個</div>
            <div className="p-3">
              <p className="text-xs text-muted-foreground mb-3">
                機構在此區域大量下單後引發強勁衝動走勢的K線。
                <span className="text-bull"> 多頭 OB</span>（大陽線前的最後一根陰線）通常作為支撐；
                <span className="text-bear"> 空頭 OB</span>（大陰線前的最後一根陽線）通常作為阻力。
              </p>
              {/* OB with tested/untested label and distance */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <div className="text-xs text-bull font-semibold mb-2">最近多頭 OB（支撑）</div>
                  {smc.nearest_bull_ob ? (() => {
                    const distPct = close > 0 ? ((smc.nearest_bull_ob!.mid - close) / close * 100) : 0;
                    return (
                      <div className="space-y-1.5 bg-emerald-500/5 rounded p-2 border border-emerald-500/20">
                        {[
                          { k: "頂部", v: smc.nearest_bull_ob!.top },
                          { k: "底部", v: smc.nearest_bull_ob!.bottom },
                          { k: "中點", v: smc.nearest_bull_ob!.mid },
                        ].map(({ k, v }) => (
                          <div key={k} className="flex justify-between text-xs">
                            <span className="text-muted-foreground">{k}</span>
                            <span className="font-mono text-bull">{fmt(v)}</span>
                          </div>
                        ))}
                        <div className="flex justify-between text-xs">
                          <span className="text-muted-foreground">距離</span>
                          <span className={`font-mono font-bold ${distPct >= 0 ? "text-blue-400" : "text-bull"}`}>{pct(distPct)}</span>
                        </div>
                        <div className="flex justify-between text-xs">
                          <span className="text-muted-foreground">強度</span>
                          <span className={smc.nearest_bull_ob!.strength === "strong" ? "text-yellow-400" : "text-muted-foreground"}>
                            {smc.nearest_bull_ob!.strength === "strong" ? "★ 強力" : "一般"}
                          </span>
                        </div>
                        <div className="flex justify-between text-xs">
                          <span className="text-muted-foreground">測試狀態</span>
                          <span className={smc.nearest_bull_ob!.tested ? "text-yellow-400" : "text-emerald-400"}>
                            {smc.nearest_bull_ob!.tested ? "已測試（強度降低）" : "未測試（強度完整）"}
                          </span>
                        </div>
                      </div>
                    );
                  })() : <p className="text-xs text-muted-foreground">無多頭 OB</p>}
                </div>
                <div>
                  <div className="text-xs text-bear font-semibold mb-2">最近空頭 OB（阻力）</div>
                  {smc.nearest_bear_ob ? (() => {
                    const distPct = close > 0 ? ((smc.nearest_bear_ob!.mid - close) / close * 100) : 0;
                    return (
                      <div className="space-y-1.5 bg-red-500/5 rounded p-2 border border-red-500/20">
                        {[
                          { k: "頂部", v: smc.nearest_bear_ob!.top },
                          { k: "底部", v: smc.nearest_bear_ob!.bottom },
                          { k: "中點", v: smc.nearest_bear_ob!.mid },
                        ].map(({ k, v }) => (
                          <div key={k} className="flex justify-between text-xs">
                            <span className="text-muted-foreground">{k}</span>
                            <span className="font-mono text-bear">{fmt(v)}</span>
                          </div>
                        ))}
                        <div className="flex justify-between text-xs">
                          <span className="text-muted-foreground">距離</span>
                          <span className={`font-mono font-bold ${distPct <= 0 ? "text-blue-400" : "text-bear"}`}>{pct(distPct)}</span>
                        </div>
                        <div className="flex justify-between text-xs">
                          <span className="text-muted-foreground">強度</span>
                          <span className={smc.nearest_bear_ob!.strength === "strong" ? "text-yellow-400" : "text-muted-foreground"}>
                            {smc.nearest_bear_ob!.strength === "strong" ? "★ 強力" : "一般"}
                          </span>
                        </div>
                        <div className="flex justify-between text-xs">
                          <span className="text-muted-foreground">測試狀態</span>
                          <span className={smc.nearest_bear_ob!.tested ? "text-yellow-400" : "text-red-400"}>
                            {smc.nearest_bear_ob!.tested ? "已測試（強度降低）" : "未測試（強度完整）"}
                          </span>
                        </div>
                      </div>
                    );
                  })() : <p className="text-xs text-muted-foreground">無空頭 OB</p>}
                </div>
              </div>
            </div>
          </div>
        </TabsContent>

        {/* ── Structure ── */}
        <TabsContent value="structure" className="mt-3 space-y-3">
          <div className="crypto-panel">
            <div className="crypto-panel-header">BOS / CHoCH / MSS 市場結構事件</div>
            <div className="p-3">
              <div className="text-xs text-muted-foreground mb-3 space-y-1">
                <p><span className="text-blue-400 font-semibold">BOS（結構突破）</span>：延續現有趨勢的突破，確認趨勢方向。</p>
                <p><span className="text-orange-400 font-semibold">CHoCH（結構轉換）</span>：反向突破前一個擺動點，暗示趨勢可能反轉。</p>
                <p><span className="text-purple-400 font-semibold">MSS（市場結構轉移）</span>：ICT 術語，趨勢從一個方向轉向另一個方向的關鍵點。</p>
              </div>
              <div className="space-y-2">
                {smc.bos_choch.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-3">暫無結構事件</p>
                ) : (
                  smc.bos_choch.slice().reverse().map((item, i) => {
                    const extItem = item as typeof item & { description?: string; time?: number };
                    const timeStr = extItem.time ? new Date(extItem.time).toLocaleString("zh-HK", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : null;
                    return (
                      <div key={i} className={`p-2.5 rounded border ${
                        item.direction === "bullish" ? "border-emerald-500/30 bg-emerald-500/5" : "border-red-500/30 bg-red-500/5"
                      }`}>
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`px-1.5 py-0.5 rounded text-xs font-bold ${
                            item.type === "BOS"   ? "bg-blue-500/20 text-blue-400"
                            : item.type === "CHoCH" ? "bg-orange-500/20 text-orange-400"
                            : "bg-purple-500/20 text-purple-400"
                          }`}>{item.type}</span>
                          <span className={`text-xs font-bold ${item.direction === "bullish" ? "text-bull" : "text-bear"}`}>
                            {item.direction === "bullish" ? "↑ 看多" : "↓ 看空"}
                          </span>
                          <span className="text-xs font-mono text-muted-foreground ml-auto">{fmt(item.level)}</span>
                          {timeStr && <span className="text-[10px] text-muted-foreground/60">{timeStr}</span>}
                        </div>
                        {extItem.description && (
                          <p className="text-xs text-muted-foreground">{extItem.description}</p>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </TabsContent>
        {/* ── Multi-TF SMC Summary ── */}
        <TabsContent value="mtf" className="mt-3 space-y-3">
          <div className="crypto-panel">
            <div className="crypto-panel-header">多時段 SMC 結構總覽</div>
            <div className="p-3">
              <div className="grid grid-cols-4 gap-2">
                {(["4H","1H","15M","5M"] as const).map(tf => {
                  const struct = smc.structure;
                  const fvgCount = smc.fvg_count;
                  const obCount  = smc.ob_count;
                  return (
                    <div key={tf} className="bg-secondary/30 rounded p-2 space-y-1.5">
                      <div className="text-xs font-bold text-center text-[#ccc]">{tf}</div>
                      <div className={`text-center text-[10px] font-bold px-1 py-0.5 rounded ${
                        struct === "bullish" ? "bg-emerald-500/20 text-emerald-400"
                        : struct === "bearish" ? "bg-red-500/20 text-red-400"
                        : "bg-yellow-500/20 text-yellow-400"
                      }`}>
                        {struct === "bullish" ? "多頭" : struct === "bearish" ? "空頭" : "震盪"}
                      </div>
                      <div className="text-[10px] text-muted-foreground text-center">FVG: {fvgCount}</div>
                      <div className="text-[10px] text-muted-foreground text-center">OB: {obCount}</div>
                      {pd && (
                        <div className={`text-[10px] text-center font-semibold ${
                          pd.current_zone === "premium" ? "text-red-400" : pd.current_zone === "discount" ? "text-emerald-400" : "text-yellow-400"
                        }`}>
                          {pd.current_zone === "premium" ? "Premium" : pd.current_zone === "discount" ? "Discount" : "均衡"}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground mt-3">
                注：目前 SMC 計算基於 4H 時段主圖。多時段 SMC 完整分析將在後續版本加入。
              </p>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
