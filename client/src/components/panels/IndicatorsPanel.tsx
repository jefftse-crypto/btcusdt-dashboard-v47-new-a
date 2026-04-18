import type { CryptoSnapshot, IndicatorData } from "@shared/cryptoTypes";

interface Props {
  snap: CryptoSnapshot | null | undefined;
  isAnalyzing: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function rsiColor(rsi: number) {
  if (rsi >= 70) return "#ef5350";
  if (rsi >= 60) return "#ffd740";
  if (rsi <= 30) return "#4caf50";
  if (rsi <= 40) return "#81c784";
  return "#aaa";
}

function macdColor(hist: number) {
  return hist > 0 ? "#4caf50" : "#ef5350";
}

function adxStrength(adx: number) {
  if (adx >= 40) return { label: "極強趨勢", color: "#ef5350" };
  if (adx >= 25) return { label: "強趨勢", color: "#ffd740" };
  if (adx >= 15) return { label: "弱趨勢", color: "#888" };
  return { label: "無趨勢", color: "#555" };
}

function trendLabel(trend: string) {
  if (trend === "bullish") return { label: "多頭", color: "#4caf50" };
  if (trend === "bearish") return { label: "空頭", color: "#ef5350" };
  return { label: "中性", color: "#ffd740" };
}

function momentumLabel(m: string) {
  if (m === "strong_bullish") return { label: "強烈看多", color: "#00e676" };
  if (m === "bullish")        return { label: "看多", color: "#4caf50" };
  if (m === "bearish")        return { label: "看空", color: "#ef5350" };
  if (m === "strong_bearish") return { label: "強烈看空", color: "#f44336" };
  return { label: "中性", color: "#ffd740" };
}

function bbPositionLabel(pctB: number) {
  if (pctB > 0.9) return { label: "超買區", color: "#ef5350" };
  if (pctB > 0.6) return { label: "上軌附近", color: "#ffd740" };
  if (pctB > 0.4) return { label: "中軌附近", color: "#aaa" };
  if (pctB > 0.1) return { label: "下軌附近", color: "#81c784" };
  return { label: "超賣區", color: "#4caf50" };
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function MetricRow({ label, value, sub, color }: {
  label: string;
  value: string | number;
  sub?: string;
  color?: string;
}) {
  return (
    <div className="flex items-start justify-between py-1.5 border-b" style={{ borderColor: "#1e1e1e" }}>
      <span className="text-[11px] text-[#888]">{label}</span>
      <div className="text-right">
        <span className="text-[11px] font-mono font-semibold" style={{ color: color ?? "#ccc" }}>{value}</span>
        {sub && <div className="text-[10px] text-[#555]">{sub}</div>}
      </div>
    </div>
  );
}

function TagBadge({ label, color }: { label: string; color: string }) {
  return (
    <span
      className="inline-block text-[10px] font-semibold px-2 py-0.5 rounded"
      style={{ color, background: `${color}18`, border: `1px solid ${color}40` }}
    >
      {label}
    </span>
  );
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg overflow-hidden" style={{ background: "#111", border: "1px solid #1e1e1e" }}>
      <div className="px-3 py-2 border-b text-[11px] font-semibold text-[#888] uppercase tracking-wider"
           style={{ borderColor: "#1e1e1e", background: "#0d0d0d" }}>
        {title}
      </div>
      <div className="px-3 py-1">{children}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Timeframe column
// ─────────────────────────────────────────────────────────────────────────────

function TfColumn({ tf, ind }: { tf: string; ind: IndicatorData }) {
  const adxObj = ind.adx as unknown as { adx: number; plus_di: number; minus_di: number };
  const adxVal = typeof adxObj?.adx === "number" ? adxObj.adx : (typeof ind.adx === "number" ? ind.adx : 20);
  const plusDi = typeof adxObj?.plus_di === "number" ? adxObj.plus_di : null;
  const minusDi = typeof adxObj?.minus_di === "number" ? adxObj.minus_di : null;
  const { label: adxLbl, color: adxColor } = adxStrength(adxVal);
  const { label: trendLbl, color: trendColor } = trendLabel(ind.trend);
  const { label: momLbl, color: momColor } = momentumLabel(ind.momentum);
  const bbPctB = (ind.bollinger as { percent_b?: number })?.percent_b ?? 0.5;
  const { label: bbLbl, color: bbColor } = bbPositionLabel(bbPctB);
  const macdObj = ind.macd as { macd?: number; signal?: number; histogram?: number };
  const macdHist = macdObj?.histogram ?? 0;

  return (
    <div className="rounded-lg overflow-hidden" style={{ background: "#111", border: "1px solid #1e1e1e" }}>
      {/* TF header */}
      <div className="px-3 py-2 border-b flex items-center justify-between"
           style={{ borderColor: "#1e1e1e", background: "#0d0d0d" }}>
        <span className="text-xs font-bold text-[#ccc]">{tf}</span>
        <TagBadge label={trendLbl} color={trendColor} />
      </div>

      <div className="px-3 py-1">
        {/* RSI */}
        <div className="flex items-center justify-between py-1.5 border-b" style={{ borderColor: "#1e1e1e" }}>
          <span className="text-[11px] text-[#888]">RSI</span>
          <div className="flex items-center gap-2">
            <div className="w-20 h-1.5 rounded-full overflow-hidden" style={{ background: "#1e1e1e" }}>
              <div className="h-full rounded-full" style={{ width: `${ind.rsi}%`, background: rsiColor(ind.rsi) }} />
            </div>
            <span className="text-[11px] font-mono font-semibold w-10 text-right" style={{ color: rsiColor(ind.rsi ?? 50) }}>
              {(ind.rsi ?? 50).toFixed(1)}
            </span>
          </div>
        </div>

        {/* MACD with mini bar */}
        <div className="flex items-center justify-between py-1.5 border-b" style={{ borderColor: "#1e1e1e" }}>
          <span className="text-[11px] text-[#888]">MACD 柱</span>
          <div className="flex items-center gap-2">
            {/* mini bar visualisation */}
            <div className="flex items-end gap-px h-4">
              {[0.3, 0.5, 0.7, 1.0, 0.8, 0.6].map((h, i) => (
                <div key={i} className="w-1 rounded-sm" style={{
                  height: `${h * 100}%`,
                  background: macdHist > 0 ? `rgba(76,175,80,${0.4 + h * 0.5})` : `rgba(239,83,80,${0.4 + h * 0.5})`
                }} />
              ))}
            </div>
            <span className="text-[11px] font-mono font-semibold" style={{ color: macdColor(macdHist) }}>
              {macdHist > 0 ? "+" : ""}{macdHist.toFixed(4)}
            </span>
          </div>
        </div>

        {/* ADX */}
        <div className="flex items-center justify-between py-1.5 border-b" style={{ borderColor: "#1e1e1e" }}>
          <span className="text-[11px] text-[#888]">ADX</span>
          <div className="text-right">
            <span className="text-[11px] font-mono font-semibold" style={{ color: adxColor }}>
              {typeof adxVal === "number" ? adxVal.toFixed(1) : "—"}
            </span>
            <div className="text-[10px]" style={{ color: adxColor }}>{adxLbl}</div>
          </div>
        </div>

        {/* DI */}
        {plusDi != null && minusDi != null && (
          <div className="flex items-center justify-between py-1.5 border-b" style={{ borderColor: "#1e1e1e" }}>
            <span className="text-[11px] text-[#888]">+DI / -DI</span>
            <span className="text-[11px] font-mono">
              <span className="text-[#4caf50]">{plusDi.toFixed(1)}</span>
              <span className="text-[#555]"> / </span>
              <span className="text-[#ef5350]">{minusDi.toFixed(1)}</span>
            </span>
          </div>
        )}

        {/* EMA */}
        <div className="flex items-center justify-between py-1.5 border-b" style={{ borderColor: "#1e1e1e" }}>
          <span className="text-[11px] text-[#888]">EMA 20</span>
          <span className="text-[11px] font-mono text-[#3b82f6]">
            {ind.ema.ema20.toLocaleString("en-US", { maximumFractionDigits: 2 })}
          </span>
        </div>
        <div className="flex items-center justify-between py-1.5 border-b" style={{ borderColor: "#1e1e1e" }}>
          <span className="text-[11px] text-[#888]">EMA 50</span>
          <span className="text-[11px] font-mono text-[#a855f7]">
            {ind.ema.ema50.toLocaleString("en-US", { maximumFractionDigits: 2 })}
          </span>
        </div>
        <div className="flex items-center justify-between py-1.5 border-b" style={{ borderColor: "#1e1e1e" }}>
          <span className="text-[11px] text-[#888]">EMA 200</span>
          <span className="text-[11px] font-mono text-[#ef4444]">
            {ind.ema.ema200.toLocaleString("en-US", { maximumFractionDigits: 2 })}
          </span>
        </div>

        {/* Bollinger */}
        <div className="flex items-center justify-between py-1.5 border-b" style={{ borderColor: "#1e1e1e" }}>
          <span className="text-[11px] text-[#888]">布林帶位置</span>
          <TagBadge label={bbLbl} color={bbColor} />
        </div>
        <div className="flex items-center justify-between py-1.5 border-b" style={{ borderColor: "#1e1e1e" }}>
          <span className="text-[11px] text-[#888]">帶寬</span>
          <span className="text-[11px] font-mono text-[#aaa]">{((ind.bollinger as { bandwidth?: number })?.bandwidth ?? 0).toFixed(2)}%</span>
        </div>

        {/* VWAP */}
        <div className="flex items-center justify-between py-1.5 border-b" style={{ borderColor: "#1e1e1e" }}>
          <span className="text-[11px] text-[#888]">VWAP</span>
          <span className="text-[11px] font-mono text-[#ffd740]">
            {(ind.vwap ?? 0) > 0 ? (ind.vwap).toLocaleString("en-US", { maximumFractionDigits: 2 }) : "—"}
          </span>
        </div>

        {/* Stochastic with cross indicator */}
        {(() => {
          const stK = (ind.stochastic as { k?: number })?.k ?? 50;
          const stD = (ind.stochastic as { d?: number })?.d ?? 50;
          const cross = stK > stD ? "金叉" : stK < stD ? "死叉" : "";
          const crossColor = stK > stD ? "#4caf50" : "#ef5350";
          const stColor = stK > 80 ? "#ef5350" : stK < 20 ? "#4caf50" : "#aaa";
          return (
            <div className="flex items-center justify-between py-1.5 border-b" style={{ borderColor: "#1e1e1e" }}>
              <span className="text-[11px] text-[#888]">Stoch K/D</span>
              <div className="flex items-center gap-1.5">
                {cross && <span className="text-[9px] font-bold px-1 py-0.5 rounded" style={{ color: crossColor, background: `${crossColor}20` }}>{cross}</span>}
                <span className="text-[11px] font-mono">
                  <span style={{ color: stColor }}>{stK.toFixed(1)}</span>
                  <span className="text-[#555]"> / </span>
                  <span className="text-[#888]">{stD.toFixed(1)}</span>
                </span>
              </div>
            </div>
          );
        })()}

        {/* ATR */}
        <div className="flex items-center justify-between py-1.5 border-b" style={{ borderColor: "#1e1e1e" }}>
          <span className="text-[11px] text-[#888]">ATR</span>
          <span className="text-[11px] font-mono text-[#aaa]">{(ind.atr ?? 0).toFixed(2)}</span>
        </div>

        {/* Momentum */}
        <div className="flex items-center justify-between py-2">
          <span className="text-[11px] text-[#888]">動量</span>
          <TagBadge label={momLbl} color={momColor} />
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

export function IndicatorsPanel({ snap, isAnalyzing }: Props) {
  if (isAnalyzing && !snap) {
    return (
      <div className="flex items-center justify-center py-16 text-[#555] text-sm">
        正在計算技術指標...
      </div>
    );
  }
  if (!snap?.indicators) return null;

  const ind = snap.indicators;

  return (
    <div className="space-y-4">
      {/* Summary row */}
      <div className="grid grid-cols-3 gap-3">
        <SectionCard title="趨勢判斷">
          <MetricRow
            label="整體趨勢"
            value={trendLabel(ind.trend).label}
            color={trendLabel(ind.trend).color}
          />
          <MetricRow
            label="動量"
            value={momentumLabel(ind.momentum).label}
            color={momentumLabel(ind.momentum).color}
          />
          <MetricRow
            label="RSI"
            value={(ind.rsi ?? 50).toFixed(1)}
            color={rsiColor(ind.rsi ?? 50)}
            sub={(ind.rsi ?? 50) >= 70 ? "超買" : (ind.rsi ?? 50) <= 30 ? "超賣" : "正常"}
          />
        </SectionCard>

        <SectionCard title="MACD">
          <MetricRow
            label="MACD"
            value={((ind.macd as { macd?: number })?.macd ?? 0).toFixed(4)}
            color={((ind.macd as { macd?: number })?.macd ?? 0) > 0 ? "#4caf50" : "#ef5350"}
          />
          <MetricRow
            label="訊號線"
            value={((ind.macd as { signal?: number })?.signal ?? 0).toFixed(4)}
            color="#888"
          />
          <MetricRow
            label="柱狀圖"
            value={`${((ind.macd as { histogram?: number })?.histogram ?? 0) > 0 ? "+" : ""}${((ind.macd as { histogram?: number })?.histogram ?? 0).toFixed(4)}`}
            color={macdColor((ind.macd as { histogram?: number })?.histogram ?? 0)}
          />
        </SectionCard>

        <SectionCard title="布林帶">
          <MetricRow
            label="上軌"
            value={((ind.bollinger as { upper?: number })?.upper ?? 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}
            color="#ef5350"
          />
          <MetricRow
            label="中軌"
            value={((ind.bollinger as { middle?: number })?.middle ?? 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}
            color="#888"
          />
          <MetricRow
            label="下軌"
            value={((ind.bollinger as { lower?: number })?.lower ?? 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}
            color="#4caf50"
          />
          <MetricRow
            label="%B"
            value={((ind.bollinger as { percent_b?: number })?.percent_b ?? 0.5).toFixed(3)}
            color={bbPositionLabel((ind.bollinger as { percent_b?: number })?.percent_b ?? 0.5).color}
            sub={bbPositionLabel((ind.bollinger as { percent_b?: number })?.percent_b ?? 0.5).label}
          />
        </SectionCard>
      </div>

      {/* Multi-TF columns - 各時間框架使用各自的指標數值 */}
      <div className="text-[11px] text-[#555] font-semibold uppercase tracking-wider">多時間框架指標</div>
      <div className="grid grid-cols-4 gap-3">
        <TfColumn tf="4H" ind={snap.mtf_indicators?.["4h"] ?? ind} />
        <TfColumn tf="1H" ind={snap.mtf_indicators?.["1h"] ?? ind} />
        <TfColumn tf="15m" ind={snap.mtf_indicators?.["15m"] ?? ind} />
        <TfColumn tf="5M" ind={snap.mtf_indicators?.["5m"] ?? ind} />
      </div>
    </div>
  );
}
