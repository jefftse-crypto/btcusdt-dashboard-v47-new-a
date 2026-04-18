import type { PaData, TimeframePaResult } from "@shared/cryptoTypes";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface Props {
  pa: PaData | undefined;
  isLoading: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const fmt = (v: number | undefined | null, d = 2) =>
  v == null || isNaN(v) ? "—" : v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });

const TREND_MAP: Record<string, { label: string; color: string; bg: string; border: string }> = {
  strong_bullish: { label: "強烈看多", color: "#00e676", bg: "#00e67610", border: "#00e67630" },
  bullish:        { label: "看多",     color: "#4caf50", bg: "#4caf5010", border: "#4caf5030" },
  strong_up:      { label: "強勢上升", color: "#00e676", bg: "#00e67610", border: "#00e67630" },
  up:             { label: "上升",     color: "#4caf50", bg: "#4caf5010", border: "#4caf5030" },
  neutral:        { label: "中性",     color: "#ffd740", bg: "#ffd74010", border: "#ffd74030" },
  sideways:       { label: "震盪",     color: "#ffd740", bg: "#ffd74010", border: "#ffd74030" },
  bearish:        { label: "看空",     color: "#ef5350", bg: "#ef535010", border: "#ef535030" },
  down:           { label: "下降",     color: "#ef5350", bg: "#ef535010", border: "#ef535030" },
  strong_bearish: { label: "強烈看空", color: "#f44336", bg: "#f4433610", border: "#f4433630" },
  strong_down:    { label: "強勢下降", color: "#f44336", bg: "#f4433610", border: "#f4433630" },
};

function getTrend(key: string) {
  return TREND_MAP[key] ?? { label: key, color: "#888", bg: "#88888810", border: "#88888830" };
}

function scoreColor(score: number, max = 5) {
  const pct = score / max;
  if (pct >= 0.8) return "#00e676";
  if (pct >= 0.6) return "#4caf50";
  if (pct >= 0.4) return "#ffd740";
  if (pct >= 0.2) return "#ef5350";
  return "#f44336";
}

function TagBadge({ label, color }: { label: string; color: string }) {
  return (
    <span className="inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded"
      style={{ color, background: `${color}18`, border: `1px solid ${color}40` }}>
      {label}
    </span>
  );
}

function ScoreBar({ score, max = 5 }: { score: number; max?: number }) {
  const pct = Math.min(100, Math.max(0, (score / max) * 100));
  const color = scoreColor(score, max);
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: "#1e1e1e" }}>
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="text-[11px] font-mono font-bold w-8 text-right" style={{ color }}>
        {score.toFixed(2)}
      </span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Timeframe Card
// ─────────────────────────────────────────────────────────────────────────────

function TfCard({ tf, data }: { tf: string; data: TimeframePaResult }) {
  const trend = getTrend(data.trend);
  const sc = scoreColor(data.score);
  const aboveEma20 = data.close > data.ema20;
  const aboveEma50 = data.close > data.ema50;
  const macdBull = data.macd_hist > 0;

  // BB position
  const bbPctB = data.bollinger?.percent_b;
  const bbLabel = bbPctB != null
    ? bbPctB > 0.9 ? "超買" : bbPctB > 0.6 ? "上軌" : bbPctB < 0.1 ? "超賣" : bbPctB < 0.4 ? "下軌" : "中軌"
    : "";

  // Extended fields from new analysis engine
  const ext = data as TimeframePaResult & {
    trend_strength?: number;
    sr_levels?: Array<{ price: number; type: string; touches: number; strength: string }>;
    breakout?: { direction: string; score: number; genuine: boolean; volume_confirm: boolean; retest_confirm: boolean; description: string } | null;
    candle_patterns?: Array<{ pattern: string; direction: string; description: string }>;
    swing_high?: number;
    swing_low?: number;
    mag_gap?: number;
    trend_context?: string;
  };

  const srLevels = ext.sr_levels ?? [];
  const breakout = ext.breakout;
  const candlePatterns = ext.candle_patterns ?? [];

  return (
    <div className="rounded-lg overflow-hidden" style={{ background: "#111", border: `1px solid ${trend.border}` }}>
      {/* Header */}
      <div className="px-3 py-2 border-b flex items-center justify-between"
        style={{ borderColor: "#1e1e1e", background: `${trend.bg}` }}>
        <span className="text-xs font-bold text-[#ccc]">{tf}</span>
        <TagBadge label={trend.label} color={trend.color} />
      </div>

      <div className="px-3 py-2 space-y-0">
        {/* Trend Strength Bar */}
        <div className="py-1.5 border-b" style={{ borderColor: "#1e1e1e" }}>
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] text-[#666]">趨勢強度</span>
            <span className="text-[11px] font-mono font-bold" style={{ color: sc }}>{data.score.toFixed(2)}</span>
          </div>
          <ScoreBar score={data.score} />
        </div>

        {/* RSI */}
        <div className="flex items-center justify-between py-1.5 border-b" style={{ borderColor: "#1e1e1e" }}>
          <span className="text-[11px] text-[#888]">RSI</span>
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-mono font-semibold" style={{
              color: data.rsi > 70 ? "#ef5350" : data.rsi < 30 ? "#4caf50" : "#aaa"
            }}>
              {(data.rsi ?? 50).toFixed(1)}
            </span>
            {data.rsi > 70 && <TagBadge label="超買" color="#ef5350" />}
            {data.rsi < 30 && <TagBadge label="超賣" color="#4caf50" />}
          </div>
        </div>

        {/* MACD */}
        <div className="flex items-center justify-between py-1.5 border-b" style={{ borderColor: "#1e1e1e" }}>
          <span className="text-[11px] text-[#888]">MACD 柱</span>
          <span className="text-[11px] font-mono font-semibold" style={{ color: macdBull ? "#4caf50" : "#ef5350" }}>
            {(data.macd_hist ?? 0) > 0 ? "+" : ""}{(data.macd_hist ?? 0).toFixed(4)}
          </span>
        </div>

        {/* EMA */}
        <div className="flex items-center justify-between py-1.5 border-b" style={{ borderColor: "#1e1e1e" }}>
          <span className="text-[11px] text-[#888]">EMA 20</span>
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-mono text-[#888]">{fmt(data.ema20)}</span>
            <TagBadge label={aboveEma20 ? "上方" : "下方"} color={aboveEma20 ? "#4caf50" : "#ef5350"} />
          </div>
        </div>
        <div className="flex items-center justify-between py-1.5 border-b" style={{ borderColor: "#1e1e1e" }}>
          <span className="text-[11px] text-[#888]">EMA 50</span>
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-mono text-[#888]">{fmt(data.ema50)}</span>
            <TagBadge label={aboveEma50 ? "上方" : "下方"} color={aboveEma50 ? "#4caf50" : "#ef5350"} />
          </div>
        </div>

        {/* EMA 200 */}
        <div className="flex items-center justify-between py-1.5 border-b" style={{ borderColor: "#1e1e1e" }}>
          <span className="text-[11px] text-[#888]">EMA 200</span>
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-mono text-[#888]">{fmt(data.ema200)}</span>
            <TagBadge label={data.close > data.ema200 ? "上方" : "下方"} color={data.close > data.ema200 ? "#4caf50" : "#ef5350"} />
          </div>
        </div>

        {/* ADX + DI */}
        {data.adx != null && (
          <div className="py-1.5 border-b" style={{ borderColor: "#1e1e1e" }}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] text-[#888]">ADX</span>
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] font-mono" style={{ color: (typeof data.adx === 'number' ? data.adx : 0) > 25 ? "#ffd740" : "#555" }}>
                  {typeof data.adx === 'number' ? data.adx.toFixed(1) : (typeof (data.adx as any)?.adx === 'number' ? (data.adx as any).adx.toFixed(1) : '—')}
                </span>
                <TagBadge label={data.adx > 35 ? "強势趨勢" : data.adx > 25 ? "趨勢中" : "震盪"} color={data.adx > 35 ? "#ff9800" : data.adx > 25 ? "#ffd740" : "#555"} />
              </div>
            </div>
            {(data.plus_di != null && data.minus_di != null) && (
              <div className="flex gap-3 text-[10px]">
                <span style={{ color: "#4caf50" }}>+DI {data.plus_di?.toFixed(1)}</span>
                <span style={{ color: "#ef5350" }}>-DI {data.minus_di?.toFixed(1)}</span>
                <span style={{ color: (data.plus_di ?? 0) > (data.minus_di ?? 0) ? "#4caf50" : "#ef5350" }}>
                  {(data.plus_di ?? 0) > (data.minus_di ?? 0) ? "多頭佔優" : "空頭佔優"}
                </span>
              </div>
            )}
          </div>
        )}

        {/* BB */}
        {data.bollinger != null && (
          <div className="py-1.5 border-b" style={{ borderColor: "#1e1e1e" }}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] text-[#888]">布林帶</span>
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-[#888]">{bbLabel}</span>
                <span className="text-[10px] font-mono text-[#555]">%B {data.bollinger.percent_b?.toFixed(2)}</span>
                {data.bb_squeeze && <TagBadge label="收口" color="#ce93d8" />}
              </div>
            </div>
            <div className="flex gap-2 text-[10px] text-[#555]">
              <span style={{ color: "#ef5350" }}>上軌 {fmt(data.bollinger.upper)}</span>
              <span>中軌 {fmt(data.bollinger.middle)}</span>
              <span style={{ color: "#4caf50" }}>下軌 {fmt(data.bollinger.lower)}</span>
            </div>
          </div>
        )}

        {/* VWAP */}
        {data.vwap != null && (
          <div className="flex items-center justify-between py-1.5 border-b" style={{ borderColor: "#1e1e1e" }}>
            <span className="text-[11px] text-[#888]">VWAP</span>
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-mono text-[#888]">{fmt(data.vwap)}</span>
              <TagBadge label={data.close > data.vwap ? "價格在上" : "價格在下"} color={data.close > data.vwap ? "#4caf50" : "#ef5350"} />
            </div>
          </div>
        )}

        {/* CMF */}
        {data.cmf != null && (
          <div className="flex items-center justify-between py-1.5 border-b" style={{ borderColor: "#1e1e1e" }}>
            <span className="text-[11px] text-[#888]">CMF 資金流向</span>
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-mono" style={{ color: data.cmf > 0.1 ? "#4caf50" : data.cmf < -0.1 ? "#ef5350" : "#888" }}>
                {data.cmf > 0 ? "+" : ""}{data.cmf.toFixed(3)}
              </span>
              <TagBadge
                label={data.cmf > 0.1 ? "資金流入" : data.cmf < -0.1 ? "資金流出" : "中性"}
                color={data.cmf > 0.1 ? "#4caf50" : data.cmf < -0.1 ? "#ef5350" : "#888"}
              />
            </div>
          </div>
        )}

        {/* ATR */}
        <div className="flex items-center justify-between py-1.5 border-b" style={{ borderColor: "#1e1e1e" }}>
          <span className="text-[11px] text-[#888]">ATR (波動度)</span>
          <span className="text-[11px] font-mono text-[#888]">{fmt(data.atr)}</span>
        </div>

        {/* 假突破分數 */}
        {data.false_break_score != null && data.false_break_score > 30 && (
          <div className="flex items-center justify-between py-1.5 border-b" style={{ borderColor: "#1e1e1e" }}>
            <span className="text-[11px] text-[#888]">假突破風險</span>
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-mono" style={{ color: data.false_break_score > 60 ? "#ef5350" : "#ffd740" }}>
                {data.false_break_score.toFixed(0)}/100
              </span>
              <TagBadge
                label={data.false_break_direction === "bullish" ? "向上假突" : data.false_break_direction === "bearish" ? "向下假突" : ""}
                color={data.false_break_score > 60 ? "#ef5350" : "#ffd740"}
              />
            </div>
          </div>
        )}

        {/* 多時段對齊 */}
        {data.mtf_alignment != null && (
          <div className="py-1.5 border-b" style={{ borderColor: "#1e1e1e" }}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] text-[#888]">多時段對齊</span>
              <span className="text-[11px] font-mono" style={{ color: data.mtf_alignment > 70 ? "#4caf50" : data.mtf_alignment < 30 ? "#ef5350" : "#ffd740" }}>
                {data.mtf_alignment.toFixed(0)}%
              </span>
            </div>
            <div className="h-1 rounded-full overflow-hidden" style={{ background: "#1e1e1e" }}>
              <div className="h-full rounded-full" style={{
                width: `${data.mtf_alignment}%`,
                background: data.mtf_alignment > 70 ? "#4caf50" : data.mtf_alignment < 30 ? "#ef5350" : "#ffd740"
              }} />
            </div>
          </div>
        )}

        {/* S/R */}
        <div className="flex items-center justify-between py-1.5 border-b" style={{ borderColor: "#1e1e1e" }}>
          <span className="text-[11px] text-[#888]">支撐</span>
          <span className="text-[11px] font-mono text-[#4caf50]">{fmt(data.support)}</span>
        </div>
        <div className="flex items-center justify-between py-1.5 border-b" style={{ borderColor: "#1e1e1e" }}>
          <span className="text-[11px] text-[#888]">阻力</span>
          <span className="text-[11px] font-mono text-[#ef5350]">{fmt(data.resistance)}</span>
        </div>

        {/* Breakout */}
        {breakout && (
          <div className="py-1.5 border-b" style={{ borderColor: "#1e1e1e" }}>
            <div className="flex items-center gap-1.5 mb-0.5">
              <span className="text-[10px] text-[#666]">突破分析</span>
              <TagBadge
                label={breakout.genuine ? "真突破" : "疑似假突破"}
                color={breakout.genuine ? (breakout.direction === "up" ? "#4caf50" : "#ef5350") : "#ffd740"}
              />
              <span className="text-[10px] text-[#555] ml-auto">{breakout.score}/100</span>
            </div>
            <div className="flex gap-2 text-[10px] text-[#555]">
              <span style={{ color: breakout.volume_confirm ? "#4caf50" : "#555" }}>
                {breakout.volume_confirm ? "✓" : "✗"} 成交量
              </span>
              <span style={{ color: breakout.retest_confirm ? "#4caf50" : "#555" }}>
                {breakout.retest_confirm ? "✓" : "✗"} 回測
              </span>
            </div>
          </div>
        )}

        {/* S/R Levels (multi-touch) */}
        {srLevels.length > 0 && (
          <div className="py-1.5 border-b" style={{ borderColor: "#1e1e1e" }}>
            <div className="text-[10px] text-[#555] mb-1">多觸確認位</div>
            <div className="space-y-0.5">
              {srLevels.slice(0, 3).map((sr, i) => (
                <div key={i} className="flex items-center justify-between text-[10px]">
                  <div className="flex items-center gap-1">
                    <span style={{ color: sr.type === "resistance" ? "#ef5350" : "#4caf50" }}>
                      {sr.type === "resistance" ? "阻" : "撐"}
                    </span>
                    <span className="text-[#555]">×{sr.touches}</span>
                    {(sr.strength as unknown as string) === "strong" && <span style={{ color: "#ffd740" }}>★</span>}
                  </div>
                  <span className="font-mono text-[#aaa]">{fmt(sr.price)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Candle Patterns */}
        {(candlePatterns.length > 0 || data.patterns.length > 0) && (
          <div className="py-2">
            <div className="text-[10px] text-[#555] mb-1.5">K 線形態</div>
            <div className="flex flex-wrap gap-1">
              {candlePatterns.slice(0, 3).map((p, i) => (
                <TagBadge key={`cp${i}`} label={p.pattern}
                  color={p.direction === "bullish" ? "#4caf50" : p.direction === "bearish" ? "#ef5350" : "#888"} />
              ))}
              {data.patterns.slice(0, 3).map((p, i) => (
                <TagBadge key={`p${i}`} label={p.name}
                  color={p.type === "bullish" ? "#4caf50" : p.type === "bearish" ? "#ef5350" : "#888"} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 方方土供需區域理論面板
// ─────────────────────────────────────────────────────────────────────────────

function FangFangTuPanel({ pa }: { pa: PaData }) {
  // 從 PA 數據計算供需區域（基於 SR levels 和 ATR）
  const tfs = Object.entries(pa.timeframes);
  const mainTf = tfs[0]?.[1] as TimeframePaResult | undefined;
  const close = mainTf?.close ?? 0;
  const atr = mainTf?.atr ?? 0;
  const srLevels = (mainTf as unknown as { sr_levels?: Array<{ price: number; type: string; touches: number; strength: string }> })?.sr_levels ?? [];

  // 計算供給區（阻力）和需求區（支撐）
  const demandZones = srLevels
    .filter(l => l.type === "support")
    .slice(0, 3)
    .map(l => ({ top: l.price + atr * 0.3, bottom: l.price - atr * 0.3, price: l.price, touches: l.touches, strength: l.strength }));

  const supplyZones = srLevels
    .filter(l => l.type === "resistance")
    .slice(0, 3)
    .map(l => ({ top: l.price + atr * 0.3, bottom: l.price - atr * 0.3, price: l.price, touches: l.touches, strength: l.strength }));

  // 判斷當前價格所在區域
  const inDemand = demandZones.some(z => close >= z.bottom && close <= z.top);
  const inSupply = supplyZones.some(z => close >= z.bottom && close <= z.top);
  const zoneStatus = inDemand ? { label: "位於需求區（買入區）", color: "#4caf50" }
    : inSupply ? { label: "位於供給區（賣出區）", color: "#ef5350" }
    : { label: "位於中性區間", color: "#ffd740" };

  return (
    <div className="space-y-3">
      {/* 當前位置 */}
      <div className="rounded-lg p-3" style={{ background: "#111", border: `1px solid ${zoneStatus.color}30` }}>
        <div className="text-[10px] text-[#666] mb-1">當前價格位置（方方土供需框架）</div>
        <div className="flex items-center gap-3">
          <span className="text-base font-bold font-mono text-[#ccc]">{fmt(close)}</span>
          <TagBadge label={zoneStatus.label} color={zoneStatus.color} />
        </div>
      </div>

      {/* 供需區域列表 */}
      <div className="grid grid-cols-2 gap-3">
        {/* 需求區 */}
        <div className="rounded-lg overflow-hidden" style={{ background: "#111", border: "1px solid #4caf5030" }}>
          <div className="px-3 py-2 border-b text-xs font-semibold" style={{ borderColor: "#1e1e1e", background: "#4caf5008", color: "#4caf50" }}>
            需求區（Demand Zone）
          </div>
          <div className="p-2 space-y-1.5">
            {demandZones.length === 0 ? (
              <div className="text-[11px] text-[#555] text-center py-2">暫無識別到需求區</div>
            ) : demandZones.map((z, i) => (
              <div key={i} className="rounded p-2" style={{ background: "#161616", border: "1px solid #4caf5020" }}>
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-[10px] text-[#555]">需求區 {i + 1}</span>
                  <TagBadge label={z.touches >= 3 ? "強力" : "普通"} color={z.touches >= 3 ? "#00e676" : "#4caf50"} />
                </div>
                <div className="text-[11px] font-mono text-[#4caf50]">{fmt(z.bottom)} – {fmt(z.top)}</div>
                <div className="text-[10px] text-[#555] mt-0.5">觸碰 {z.touches} 次 | 中心 {fmt(z.price)}</div>
              </div>
            ))}
          </div>
        </div>

        {/* 供給區 */}
        <div className="rounded-lg overflow-hidden" style={{ background: "#111", border: "1px solid #ef535030" }}>
          <div className="px-3 py-2 border-b text-xs font-semibold" style={{ borderColor: "#1e1e1e", background: "#ef535008", color: "#ef5350" }}>
            供給區（Supply Zone）
          </div>
          <div className="p-2 space-y-1.5">
            {supplyZones.length === 0 ? (
              <div className="text-[11px] text-[#555] text-center py-2">暫無識別到供給區</div>
            ) : supplyZones.map((z, i) => (
              <div key={i} className="rounded p-2" style={{ background: "#161616", border: "1px solid #ef535020" }}>
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-[10px] text-[#555]">供給區 {i + 1}</span>
                  <TagBadge label={z.touches >= 3 ? "強力" : "普通"} color={z.touches >= 3 ? "#f44336" : "#ef5350"} />
                </div>
                <div className="text-[11px] font-mono text-[#ef5350]">{fmt(z.bottom)} – {fmt(z.top)}</div>
                <div className="text-[10px] text-[#555] mt-0.5">觸碰 {z.touches} 次 | 中心 {fmt(z.price)}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 方方土理論說明 */}
      <div className="rounded-lg overflow-hidden" style={{ background: "#111", border: "1px solid #1e1e1e" }}>
        <div className="px-3 py-2 border-b text-xs font-semibold text-[#ccc]" style={{ borderColor: "#1e1e1e", background: "#0d0d0d" }}>
          方方土供需區域理論（Supply & Demand）
        </div>
        <div className="p-3 space-y-2 text-xs">
          {[
            {
              title: "供需區域的本質",
              desc: "供給區是機構賣家大量賣出的價格區間，需求區是機構買家大量買入的價格區間。這些區域形成的原因是機構訂單無法一次性全部成交，當價格再次回到該區域時，剩餘訂單會被觸發，導致強烈的反應。",
              color: "#4fc3f7"
            },
            {
              title: "有效供需區的識別條件",
              desc: "1) 價格從該區域快速離開（急漲或急跌），代表大量訂單被執行；2) 離開後形成較長的趨勢行情；3) 該區域尚未被完全消耗（未被多次測試）；4) 越新鮮的供需區效力越強，被測試次數越少越好。",
              color: "#ce93d8"
            },
            {
              title: "入場策略（回測進場法）",
              desc: "等待價格回測至供需區域後，觀察是否出現反轉K線形態（如吞噬、針形K線）再入場。需求區做多：止損設在需求區底部以下，目標設在最近的供給區。供給區做空：止損設在供給區頂部以上，目標設在最近的需求區。",
              color: "#ffd740"
            },
            {
              title: "供需區的消耗與失效",
              desc: "每次價格測試供需區都會消耗該區域的訂單。被測試超過 3 次的供需區通常已大部分消耗，效力減弱。當價格以大陰/陽線突破並收盤在供需區另一側時，該區域失效，角色互換（供給變需求，需求變供給）。",
              color: "#ffab40"
            },
          ].map(({ title, desc, color }) => (
            <div key={title} className="rounded p-2.5" style={{ background: "#161616", border: `1px solid ${color}20` }}>
              <div className="font-semibold mb-1" style={{ color }}>{title}</div>
              <p className="text-[#888] leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 羅晟市場週期理論面板
// ─────────────────────────────────────────────────────────────────────────────

function LuoShengPanel({ pa }: { pa: PaData }) {
  const tfs = Object.entries(pa.timeframes);
  const mainTf = tfs[0]?.[1] as TimeframePaResult | undefined;
  const close = mainTf?.close ?? 0;
  const ema20 = mainTf?.ema20 ?? 0;
  const ema50 = mainTf?.ema50 ?? 0;
  const ema200 = mainTf?.ema200 ?? 0;
  const rsi = mainTf?.rsi ?? 50;
  const adx = mainTf?.adx ?? 0;
  const score = pa.avg_score;

  // 判斷市場週期階段
  let phase: { name: string; nameEn: string; color: string; desc: string; action: string };
  if (close > ema200 && close > ema50 && rsi > 55 && adx > 20) {
    phase = {
      name: "上升期（Markup）", nameEn: "Markup Phase",
      color: "#00e676",
      desc: "機構已完成吸籌，市場進入主升浪。價格持續創新高，回調幅度淺，EMA 呈多頭排列（20>50>200）。散戶開始大量進場，FOMO 情緒蔓延。",
      action: "趨勢追蹤策略：回調至 EMA20 或 EMA50 附近做多，止損設在前低，不要在高位追多。"
    };
  } else if (close > ema200 && close < ema50 && rsi > 45 && rsi < 60) {
    phase = {
      name: "吸籌期（Accumulation）", nameEn: "Accumulation Phase",
      color: "#4fc3f7",
      desc: "機構在低位悄悄吸籌，市場呈現橫盤震盪，成交量逐漸萎縮。散戶因長期橫盤而失去耐心，機構趁機低價收集籌碼。",
      action: "區間策略：在震盪區間底部分批建倉，止損設在區間底部以下，等待突破信號。"
    };
  } else if (close < ema200 && close < ema50 && rsi < 45 && adx > 20) {
    phase = {
      name: "下跌期（Markdown）", nameEn: "Markdown Phase",
      color: "#f44336",
      desc: "機構已完成出貨，市場進入主跌浪。價格持續創新低，反彈幅度淺，EMA 呈空頭排列（20<50<200）。散戶恐慌性拋售，市場情緒極度悲觀。",
      action: "空頭策略或觀望：反彈至 EMA20 或 EMA50 附近做空，或等待市場企穩後再考慮做多。"
    };
  } else if (close < ema200 && rsi < 40 && score < 2.5) {
    phase = {
      name: "出貨期（Distribution）", nameEn: "Distribution Phase",
      color: "#ef5350",
      desc: "機構在高位悄悄出貨，市場呈現高位震盪，成交量放大但價格不漲。散戶仍然樂觀，機構趁機高位派發籌碼。",
      action: "減倉策略：逐步減少多頭倉位，不要在高位追多，等待明確的趨勢反轉信號。"
    };
  } else {
    phase = {
      name: "過渡期（Transition）", nameEn: "Transition Phase",
      color: "#ffd740",
      desc: "市場處於週期轉換階段，方向尚不明確。可能是吸籌轉上升，或上升轉出貨，需要更多數據確認。",
      action: "觀望策略：等待明確的週期信號出現後再入場，避免在不確定階段過度交易。"
    };
  }

  // 週期進度指標
  const cycleIndicators = [
    { name: "EMA 排列", value: close > ema20 && ema20 > ema50 && ema50 > ema200 ? "多頭排列" : close < ema20 && ema20 < ema50 && ema50 < ema200 ? "空頭排列" : "混合排列", color: close > ema20 && ema20 > ema50 ? "#4caf50" : close < ema20 && ema20 < ema50 ? "#ef5350" : "#ffd740" },
    { name: "RSI 位置", value: rsi > 70 ? "超買區" : rsi > 55 ? "強勢區" : rsi > 45 ? "中性區" : rsi > 30 ? "弱勢區" : "超賣區", color: rsi > 70 ? "#ef5350" : rsi > 55 ? "#4caf50" : rsi > 45 ? "#ffd740" : rsi > 30 ? "#ef5350" : "#f44336" },
    { name: "趨勢強度", value: adx > 40 ? "極強趨勢" : adx > 25 ? "強趨勢" : adx > 15 ? "弱趨勢" : "無趨勢", color: adx > 25 ? "#4caf50" : adx > 15 ? "#ffd740" : "#555" },
    { name: "PA 評分", value: `${score.toFixed(2)}/5`, color: scoreColor(score) },
  ];

  return (
    <div className="space-y-3">
      {/* 當前週期階段 */}
      <div className="rounded-lg p-4" style={{ background: "#111", border: `1px solid ${phase.color}40` }}>
        <div className="text-[10px] text-[#666] mb-1">當前市場週期（羅晟四階段框架）</div>
        <div className="flex items-center gap-3 mb-2">
          <span className="text-lg font-bold" style={{ color: phase.color }}>{phase.name}</span>
          <TagBadge label={phase.nameEn} color={phase.color} />
        </div>
        <p className="text-xs text-[#888] leading-relaxed mb-3">{phase.desc}</p>
        <div className="rounded p-2.5 text-xs" style={{ background: `${phase.color}10`, border: `1px solid ${phase.color}30` }}>
          <span className="font-semibold" style={{ color: phase.color }}>操作建議：</span>
          <span className="text-[#aaa] ml-1">{phase.action}</span>
        </div>
      </div>

      {/* 週期指標 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {cycleIndicators.map(({ name, value, color }) => (
          <div key={name} className="rounded p-2.5 text-center" style={{ background: "#111", border: "1px solid #1e1e1e" }}>
            <div className="text-[10px] text-[#555] mb-1">{name}</div>
            <div className="text-xs font-semibold" style={{ color }}>{value}</div>
          </div>
        ))}
      </div>

      {/* 四階段週期說明 */}
      <div className="rounded-lg overflow-hidden" style={{ background: "#111", border: "1px solid #1e1e1e" }}>
        <div className="px-3 py-2 border-b text-xs font-semibold text-[#ccc]" style={{ borderColor: "#1e1e1e", background: "#0d0d0d" }}>
          羅晟市場週期四階段理論（Wyckoff + 羅晟改良版）
        </div>
        <div className="p-3 space-y-2 text-xs">
          {[
            {
              phase: "1. 吸籌期（Accumulation）",
              signs: ["價格在低位橫盤震盪，成交量逐漸萎縮", "EMA 均線糾纏，無明顯方向", "RSI 在 40–60 之間震盪", "機構悄悄在低位買入，散戶因橫盤而失去興趣"],
              color: "#4fc3f7",
              action: "分批低位建倉，設置較寬止損，等待突破"
            },
            {
              phase: "2. 上升期（Markup）",
              signs: ["價格持續創新高，回調幅度淺", "EMA 呈多頭排列（20>50>200）", "RSI 長期維持在 50 以上", "成交量在上漲時放大，回調時縮量"],
              color: "#00e676",
              action: "趨勢追蹤，回調至 EMA 附近加倉，持倉不動"
            },
            {
              phase: "3. 出貨期（Distribution）",
              signs: ["價格在高位橫盤，成交量放大但價格不漲", "出現大幅震盪，多次測試高點失敗", "RSI 出現頂背離，動能減弱", "機構在高位出貨，散戶仍然樂觀"],
              color: "#ef5350",
              action: "逐步減倉，不追高，等待明確反轉信號"
            },
            {
              phase: "4. 下跌期（Markdown）",
              signs: ["價格持續創新低，反彈幅度淺", "EMA 呈空頭排列（20<50<200）", "RSI 長期維持在 50 以下", "成交量在下跌時放大，反彈時縮量"],
              color: "#f44336",
              action: "空頭策略或空倉觀望，等待下一個吸籌期"
            },
          ].map(({ phase: p, signs, color, action }) => (
            <div key={p} className="rounded p-2.5" style={{ background: "#161616", border: `1px solid ${color}20` }}>
              <div className="font-semibold mb-1.5" style={{ color }}>{p}</div>
              <ul className="space-y-0.5 mb-2">
                {signs.map((s, i) => (
                  <li key={i} className="flex gap-1.5 text-[#888]">
                    <span style={{ color }}>•</span>
                    <span>{s}</span>
                  </li>
                ))}
              </ul>
              <div className="text-[10px] rounded px-2 py-1" style={{ background: `${color}10`, color: `${color}cc` }}>
                操作：{action}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

export function PaPanel({ pa, isLoading }: Props) {
  if (isLoading && !pa) {
    return (
      <div className="flex items-center justify-center py-16 text-[#555] text-sm">
        正在計算 PA 分析...
      </div>
    );
  }

  if (!pa) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="text-sm text-[#555]">請點擊「分析」按鈕取得 PA 分析數據</div>
      </div>
    );
  }

  const consensus = getTrend(pa.consensus);

  return (
    <div className="space-y-4">
      {/* Consensus Banner */}
      <div className="rounded-lg p-4" style={{ background: "#111", border: `1px solid ${consensus.border}` }}>
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div>
            <div className="text-[10px] text-[#666] mb-1">PA 多時間框架共識（Rayner Teo 方法）</div>
            <div className="flex items-center gap-3">
              <span className="text-xl font-bold" style={{ color: consensus.color }}>{consensus.label}</span>
              <span className="text-sm font-mono" style={{ color: consensus.color }}>
                評分 {pa.avg_score.toFixed(2)}/5
              </span>
            </div>
            {/* Al Brooks Trend Context */}
            <p className="text-xs text-[#888] mt-2 leading-relaxed max-w-md">
              {(pa.consensus as string) === "strong_bullish" || (pa.consensus as string) === "strong_up"
                ? "Al Brooks：強勢多頭趨勢，每次回調都是買入機會，不要做空，等待旗形整理後的突破入場"
                : (pa.consensus as string) === "bullish" || (pa.consensus as string) === "up"
                ? "Al Brooks：多頭趨勢，尋找回調至支撐位或 EMA 的做多機會，避免在趨勢頂部追多"
                : (pa.consensus as string) === "strong_bearish" || (pa.consensus as string) === "strong_down"
                ? "Al Brooks：強勢空頭趨勢，每次反彈都是賣出機會，不要做多，等待熊旗整理後的下跌延續"
                : (pa.consensus as string) === "bearish" || (pa.consensus as string) === "down"
                ? "Al Brooks：空頭趨勢，尋找反彈至阻力位或 EMA 的做空機會，避免在趨勢底部追空"
                : "Al Brooks：震盪市場，在通道上下邊界做反轉交易，突破前不要追趨勢，等待假突破後的反向入場"}
            </p>
          </div>

          {/* Entry params */}
          {"entry" in pa.entry_params && pa.entry_params.entry && (
            <div className="grid grid-cols-4 gap-2 text-center shrink-0">
              {[
                { k: "方向", v: pa.entry_params.direction === "long" ? "做多" : "做空", c: pa.entry_params.direction === "long" ? "#4caf50" : "#ef5350" },
                { k: "入場", v: fmt(pa.entry_params.entry as number), c: "#ccc" },
                { k: "止損", v: fmt(pa.entry_params.sl as number), c: "#ef5350" },
                { k: "目標", v: fmt(pa.entry_params.tp1 as number), c: "#4caf50" },
              ].map(({ k, v, c }) => (
                <div key={k} className="rounded p-2" style={{ background: "#161616", border: "1px solid #2a2a2a" }}>
                  <div className="text-[10px] text-[#666]">{k}</div>
                  <div className="text-xs font-bold font-mono" style={{ color: c }}>{v}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {pa.suggestion && (
          <div className="mt-3 text-xs text-[#aaa] leading-relaxed border-t pt-3" style={{ borderColor: "#1e1e1e" }}>
            {pa.suggestion}
          </div>
        )}
      </div>

      <Tabs defaultValue="timeframes">
        <TabsList className="bg-secondary/50 h-8 flex-wrap gap-0.5">
          <TabsTrigger value="timeframes" className="text-xs px-2.5 h-7">各時間框架</TabsTrigger>
          <TabsTrigger value="compare" className="text-xs px-2.5 h-7">多時段對比</TabsTrigger>
          <TabsTrigger value="sr_theory" className="text-xs px-2.5 h-7">支撑阻力理論</TabsTrigger>
          <TabsTrigger value="breakout_theory" className="text-xs px-2.5 h-7">真假突破判斷</TabsTrigger>
          <TabsTrigger value="candle_theory" className="text-xs px-2.5 h-7">K 線形態</TabsTrigger>
          <TabsTrigger value="fangfangtu" className="text-xs px-2.5 h-7">方方土供需</TabsTrigger>
          <TabsTrigger value="luosheng" className="text-xs px-2.5 h-7">羅晶週期</TabsTrigger>
        </TabsList>

        {/* ── Timeframes ── */}
        <TabsContent value="timeframes" className="mt-3">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {Object.entries(pa.timeframes).map(([tf, data]) => (
              <TfCard key={tf} tf={tf} data={data as TimeframePaResult} />
            ))}
          </div>
        </TabsContent>

        {/* ── Multi-TF Compare ── */}
        <TabsContent value="compare" className="mt-3">
          <div className="rounded-lg overflow-hidden" style={{ background: "#111", border: "1px solid #1e1e1e" }}>
            <div className="px-3 py-2 border-b text-xs font-semibold text-[#ccc]" style={{ borderColor: "#1e1e1e", background: "#0d0d0d" }}>
              多時段 PA 評分對比表
            </div>
            <div className="p-3 overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="border-b" style={{ borderColor: "#1e1e1e" }}>
                    <th className="text-left py-2 pr-3 text-[#555] font-semibold">指標</th>
                    {Object.keys(pa.timeframes).map(tf => (
                      <th key={tf} className="text-center py-2 px-2 text-[#888] font-bold">{tf}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[
                    { key: "score", label: "評分", render: (d: TimeframePaResult) => <span style={{ color: scoreColor(d.score) }}>{d.score.toFixed(2)}</span> },
                    { key: "trend", label: "趨勢", render: (d: TimeframePaResult) => { const t = getTrend(d.trend); return <span style={{ color: t.color }}>{t.label}</span>; } },
                    { key: "rsi", label: "RSI", render: (d: TimeframePaResult) => <span style={{ color: d.rsi > 70 ? "#ef5350" : d.rsi < 30 ? "#4caf50" : "#aaa" }}>{d.rsi.toFixed(1)}</span> },
                    { key: "macd", label: "MACD", render: (d: TimeframePaResult) => <span style={{ color: d.macd_hist > 0 ? "#4caf50" : "#ef5350" }}>{d.macd_hist > 0 ? "多" : "空"}</span> },
                    { key: "ema", label: "EMA20/50", render: (d: TimeframePaResult) => {
                      const a20 = d.close > d.ema20, a50 = d.close > d.ema50;
                      return <span style={{ color: a20 && a50 ? "#4caf50" : !a20 && !a50 ? "#ef5350" : "#ffd740" }}>{a20 && a50 ? "上方" : !a20 && !a50 ? "下方" : "混合"}</span>;
                    }},
                    { key: "adx", label: "ADX", render: (d: TimeframePaResult) => <span style={{ color: (d.adx ?? 0) > 25 ? "#ffd740" : "#555" }}>{(d.adx ?? 0).toFixed(1)}</span> },
                    { key: "vwap", label: "VWAP", render: (d: TimeframePaResult) => <span style={{ color: d.close > (d.vwap ?? 0) ? "#4caf50" : "#ef5350" }}>{d.close > (d.vwap ?? 0) ? "上方" : "下方"}</span> },
                    { key: "cmf", label: "CMF", render: (d: TimeframePaResult) => <span style={{ color: (d.cmf ?? 0) > 0.1 ? "#4caf50" : (d.cmf ?? 0) < -0.1 ? "#ef5350" : "#888" }}>{(d.cmf ?? 0).toFixed(3)}</span> },
                    { key: "sr", label: "支撑/阻力", render: (d: TimeframePaResult) => {
                      const distS = d.support > 0 ? ((d.close - d.support) / d.close * 100) : null;
                      const distR = d.resistance > 0 ? ((d.resistance - d.close) / d.close * 100) : null;
                      return (
                        <span className="text-[10px]">
                          <span style={{ color: "#4caf50" }}>{distS != null ? `+${distS.toFixed(1)}%` : "—"}</span>
                          <span className="text-[#555]"> / </span>
                          <span style={{ color: "#ef5350" }}>{distR != null ? `-${distR.toFixed(1)}%` : "—"}</span>
                        </span>
                      );
                    }},
                    { key: "signal", label: "訊號強度", render: (d: TimeframePaResult) => {
                      const s = d.score;
                      const label = s >= 4 ? "強烈看多" : s >= 3 ? "看多" : s >= 2 ? "中性" : s >= 1 ? "看空" : "強烈看空";
                      const color = s >= 4 ? "#00e676" : s >= 3 ? "#4caf50" : s >= 2 ? "#ffd740" : s >= 1 ? "#ef5350" : "#f44336";
                      return <span style={{ color }}>{label}</span>;
                    }},
                  ].map(({ key, label, render }) => (
                    <tr key={key} className="border-b" style={{ borderColor: "#1a1a1a" }}>
                      <td className="py-2 pr-3 text-[#666]">{label}</td>
                      {Object.values(pa.timeframes).map((d, i) => (
                        <td key={i} className="text-center py-2 px-2">{render(d as TimeframePaResult)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          {/* Signal strength legend */}
          <div className="mt-3 rounded-lg p-3" style={{ background: "#111", border: "1px solid #1e1e1e" }}>
            <div className="text-[10px] text-[#555] mb-2">訊號強度說明（基於 PA 評分 0–5）</div>
            <div className="flex flex-wrap gap-2">
              {[
                { label: "強烈看多 (≥ 4.0)", color: "#00e676", desc: "RSI+EMA+MACD+ADX 全部對齊，高確信度多頭訊號" },
                { label: "看多 (3.0–3.9)", color: "#4caf50", desc: "大部分指標看多，可考慮多頭入場" },
                { label: "中性 (2.0–2.9)", color: "#ffd740", desc: "指標混雜，建議觀望等待明確方向" },
                { label: "看空 (1.0–1.9)", color: "#ef5350", desc: "大部分指標看空，可考慮空頭入場" },
                { label: "強烈看空 (< 1.0)", color: "#f44336", desc: "全部指標看空，高確信度空頭訊號" },
              ].map(({ label, color, desc }) => (
                <div key={label} className="flex items-start gap-1.5 text-[10px]">
                  <span className="font-bold shrink-0" style={{ color }}>{label}:</span>
                  <span className="text-[#555]">{desc}</span>
                </div>
              ))}
            </div>
          </div>
        </TabsContent>

        {/* ── S/R Theory ── */}
        <TabsContent value="sr_theory" className="mt-3">
          <div className="rounded-lg overflow-hidden" style={{ background: "#111", border: "1px solid #1e1e1e" }}>
            <div className="px-3 py-2 border-b text-xs font-semibold text-[#ccc]" style={{ borderColor: "#1e1e1e", background: "#0d0d0d" }}>
              Rayner Teo 支撐阻力識別方法
            </div>
            <div className="p-3 space-y-2 text-xs">
              {[
                { title: "1. 多次觸碰確認（核心原則）", desc: "有效的支撐/阻力位需要被價格至少觸碰 2–3 次。觸碰次數越多，位置越重要，突破後的反轉也越強烈。本系統已自動識別觸碰次數並標記。", color: "#4fc3f7" },
                { title: "2. 時間框架重要性", desc: "高時間框架（日線/週線）的支撐阻力比低時間框架更重要。當多個時間框架的關鍵位重疊時，該位置的意義倍增（稱為「匯聚」）。", color: "#ce93d8" },
                { title: "3. 角色互換原則（Support ↔ Resistance）", desc: "被突破的支撐位變成阻力位，被突破的阻力位變成支撐位。這是 PA 交易中最重要的概念之一，也是太妃 PA 課程的核心內容。", color: "#ffd740" },
                { title: "4. 區間而非精確位", desc: "支撐阻力是一個區間，不是精確的價格點。通常以 ATR 的 0.5–1 倍作為區間範圍，避免因為小幅穿越而誤判突破。", color: "#ffab40" },
              ].map(({ title, desc, color }) => (
                <div key={title} className="rounded p-2.5" style={{ background: "#161616", border: `1px solid ${color}20` }}>
                  <div className="font-semibold mb-1" style={{ color }}>{title}</div>
                  <p className="text-[#888] leading-relaxed">{desc}</p>
                </div>
              ))}
            </div>
          </div>
        </TabsContent>

        {/* ── Breakout Theory ── */}
        <TabsContent value="breakout_theory" className="mt-3">
          <div className="rounded-lg overflow-hidden" style={{ background: "#111", border: "1px solid #1e1e1e" }}>
            <div className="px-3 py-2 border-b text-xs font-semibold text-[#ccc]" style={{ borderColor: "#1e1e1e", background: "#0d0d0d" }}>
              Rayner Teo / 太妃 PA 真假突破判斷框架
            </div>
            <div className="p-3 space-y-2 text-xs">
              {[
                {
                  title: "真突破特徵",
                  items: ["收盤價明確突破關鍵位（不只是影線穿越）", "突破K線成交量明顯放大（通常是均量的 1.5 倍以上）", "突破後回測原關鍵位並守住（角色互換確認）", "突破方向與更高時間框架趨勢一致"],
                  color: "#4caf50", bg: "#4caf5008", border: "#4caf5025"
                },
                {
                  title: "假突破特徵（Al Brooks 稱為 Trap / Failed Breakout）",
                  items: ["影線穿越但收盤價回到關鍵位內側", "突破時成交量萎縮或無明顯放量", "突破後迅速反轉，形成針形K線或吞噬形態", "與更高時間框架趨勢相反方向的突破"],
                  color: "#ef5350", bg: "#ef535008", border: "#ef535025"
                },
                {
                  title: "太妃 PA 突破確認方法（等待確認再入場）",
                  items: ["等待突破K線收盤確認（不要在突破瞬間入場）", "觀察次根K線是否回測突破位並反彈/反轉", "結合 RSI 背離判斷突破動能是否充足", "在突破後的第一個回調點入場，風險報酬比更佳"],
                  color: "#ffd740", bg: "#ffd74008", border: "#ffd74025"
                },
              ].map(({ title, items, color, bg, border }) => (
                <div key={title} className="rounded p-2.5" style={{ background: bg, border: `1px solid ${border}` }}>
                  <div className="font-semibold mb-1.5" style={{ color }}>{title}</div>
                  <ul className="space-y-0.5">
                    {items.map((item, i) => (
                      <li key={i} className="flex gap-1.5 text-[#888]">
                        <span style={{ color }}>•</span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </TabsContent>

        {/* ── Candle Theory ── */}
        <TabsContent value="candle_theory" className="mt-3">
          <div className="rounded-lg overflow-hidden" style={{ background: "#111", border: "1px solid #1e1e1e" }}>
            <div className="px-3 py-2 border-b text-xs font-semibold text-[#ccc]" style={{ borderColor: "#1e1e1e", background: "#0d0d0d" }}>
              Al Brooks / 太妃 PA 重要 K 線形態
            </div>
            <div className="p-3 space-y-2 text-xs">
              {[
                { name: "吞噬形態（Engulfing）", type: "bullish/bearish", desc: "後一根K線的實體完全包覆前一根K線的實體。多頭吞噬（陽線吞噬陰線）在支撐位出現是強力做多信號；空頭吞噬（陰線吞噬陽線）在阻力位出現是強力做空信號。", color: "#ffd740" },
                { name: "針形K線（Pin Bar / Hammer / Shooting Star）", type: "reversal", desc: "長影線短實體的K線，代表市場拒絕了某個價格區域。下影線長的針形（錘子線）在支撐位是做多信號；上影線長的針形（射擊之星）在阻力位是做空信號。", color: "#4fc3f7" },
                { name: "內包K線（Inside Bar）", type: "continuation/reversal", desc: "後一根K線的高低點完全在前一根K線的高低點範圍內，代表市場在盤整。突破內包K線的方向通常是下一段行情的方向。", color: "#ce93d8" },
                { name: "外包K線（Outside Bar）", type: "reversal", desc: "後一根K線的高低點完全超出前一根K線的高低點範圍，代表市場波動劇烈。通常出現在關鍵位附近時是反轉信號。", color: "#ffab40" },
                { name: "十字星（Doji）", type: "indecision", desc: "開盤價和收盤價幾乎相同，代表多空力量均衡。在趨勢末端出現時是反轉警告，需要等待下一根K線確認方向。", color: "#888" },
              ].map(({ name, type, desc, color }) => (
                <div key={name} className="rounded p-2.5" style={{ background: "#161616", border: `1px solid ${color}20` }}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-semibold" style={{ color }}>{name}</span>
                    <TagBadge label={type} color={color} />
                  </div>
                  <p className="text-[#888] leading-relaxed">{desc}</p>
                </div>
              ))}
            </div>
          </div>
        </TabsContent>

        {/* ── 方方土供需區域 ── */}
        <TabsContent value="fangfangtu" className="mt-3">
          <FangFangTuPanel pa={pa} />
        </TabsContent>

        {/* ── 羅晟市場週期 ── */}
        <TabsContent value="luosheng" className="mt-3">
          <LuoShengPanel pa={pa} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
