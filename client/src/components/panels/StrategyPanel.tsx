import { useState } from "react";
import type { StrategyData } from "@shared/cryptoTypes";
import { TrendingUp, TrendingDown, Minus, AlertTriangle, Target, CheckCircle2, XCircle, Circle } from "lucide-react";

interface Props {
  strategy: StrategyData | undefined;
  symbol: string;
  isLoading: boolean;
  currentPrice?: number | null;
  lastPriceUpdateTs?: number | null;
  wsStatus?: "connecting" | "connected" | "disconnected" | "error" | "fallback";
}

interface StrategyChecklistItem {
  item: string;
  passed: boolean;
  note?: string;
}

interface BackendStrategyChecklistItem {
  label: string;
  passed: boolean;
  value?: string;
}

interface EnhancedStrategyData extends Omit<StrategyData, "checklist" | "similar_pattern"> {
  tp3?: number;
  checklist?: Array<StrategyChecklistItem | BackendStrategyChecklistItem>;
  twitter_sentiment?: {
    bullish_pct: number;
    bearish_pct: number;
    neutral_pct: number;
    score: number;
    label: string;
    passed: boolean;
  };
  similar_pattern?: {
    description: string;
    outcome?: string;
    similarity?: number;
    date?: string;
    win_rate?: number;
    avg_return?: number;
    sample_count?: number;
    is_real_history?: boolean;
    corr_threshold?: number;
  };
  kelly_criterion?: {
    win_rate_est: number;
    rr_ratio: number;
    kelly_pct: number;
    half_kelly_pct: number;
    max_risk_pct: number;
    suggestion: string;
  };
}

function MetricBox({ label, value, color, sub }: {
  label: string;
  value: string;
  color?: string;
  sub?: string;
}) {
  return (
    <div className="rounded p-3" style={{ background: "#161616", border: "1px solid #2a2a2a" }}>
      <div className="text-[10px] text-[#666] mb-1">{label}</div>
      <div className="text-sm font-mono font-bold" style={{ color: color ?? "#ccc" }}>{value}</div>
      {sub && <div className="text-[10px] text-[#555] mt-0.5">{sub}</div>}
    </div>
  );
}

// ─── 入場 Checklist ───────────────────────────────────────────────────────────

function EntryChecklist({ checklist }: { checklist: StrategyChecklistItem[] }) {
  const passedCount = checklist.filter(c => c.passed).length;
  const total = checklist.length;
  const allPassed = passedCount === total;
  const pct = Math.round((passedCount / total) * 100);

  return (
    <div className="rounded-lg overflow-hidden" style={{ background: "#111", border: `1px solid ${allPassed ? "#4caf5030" : passedCount >= total * 0.6 ? "#ffd74030" : "#ef535030"}` }}>
      <div className="px-3 py-2 border-b flex items-center justify-between" style={{ borderColor: "#1e1e1e", background: "#0d0d0d" }}>
        <span className="text-xs font-semibold text-[#ccc]">入場 Checklist</span>
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-20 rounded-full overflow-hidden" style={{ background: "#1e1e1e" }}>
            <div className="h-full rounded-full transition-all" style={{
              width: `${pct}%`,
              background: allPassed ? "#4caf50" : passedCount >= total * 0.6 ? "#ffd740" : "#ef5350"
            }} />
          </div>
          <span className="text-[11px] font-mono" style={{ color: allPassed ? "#4caf50" : passedCount >= total * 0.6 ? "#ffd740" : "#ef5350" }}>
            {passedCount}/{total}
          </span>
        </div>
      </div>
      <div className="p-2 space-y-1">
        {checklist.map((c, i) => (
          <div key={i} className="flex items-start gap-2 text-xs py-1 px-1.5 rounded" style={{ background: c.passed ? "#4caf5008" : "#ef535008" }}>
            {c.passed
              ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: "#4caf50" }} />
              : <XCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: "#ef5350" }} />
            }
            <div className="flex-1 min-w-0">
              <span style={{ color: c.passed ? "#ccc" : "#888" }}>{c.item}</span>
              {c.note && <span className="text-[10px] ml-1.5" style={{ color: c.passed ? "#4caf5099" : "#ef535099" }}>({c.note})</span>}
            </div>
          </div>
        ))}
      </div>
      {!allPassed && (
        <div className="px-3 py-2 border-t text-[10px]" style={{ borderColor: "#1e1e1e", color: "#ffd740" }}>
          ⚠ 未全部通過，建議等待更多確認訊號後再入場
        </div>
      )}
    </div>
  );
}

// ─── 倉位計算器（增強版：槓桿選擇、分批止盈、爆倉價） ─────────────────────────

function RiskCalculator({ strategy, dirColor }: { strategy: EnhancedStrategyData; dirColor: string }) {
  const [capital, setCapital] = useState("10000");
  const [riskPctInput, setRiskPctInput] = useState("1");
  const [manualLeverage, setManualLeverage] = useState("");
  const [tp1Pct, setTp1Pct] = useState("50");
  const [tp2Pct, setTp2Pct] = useState("30");
  const [tp3Pct, setTp3Pct] = useState("20");
  const isLong = dirColor === "#4caf50" || dirColor === "#00e676";

  const capitalNum = parseFloat(capital) || 10000;
  const riskPctNum = parseFloat(riskPctInput) || 1;
  const riskAmount = capitalNum * (riskPctNum / 100);
  const stopDist = strategy.entry && strategy.sl ? Math.abs(strategy.entry - strategy.sl) : null;
  const positionSize = stopDist && stopDist > 0 ? riskAmount / stopDist : null;
  const positionValue = positionSize && strategy.entry ? positionSize * strategy.entry : null;
  const autoLeverage = positionValue ? positionValue / capitalNum : null;
  const leverage = manualLeverage ? parseFloat(manualLeverage) : autoLeverage;

  // 爆倉價計算（維持保證金率 0.5%）
  const mmRate = 0.005;
  const liqPrice = strategy.entry && leverage
    ? isLong
      ? strategy.entry * (1 - (1 / leverage) + mmRate)
      : strategy.entry * (1 + (1 / leverage) - mmRate)
    : null;

  // 分批止盈計算
  const tp1PctNum = parseFloat(tp1Pct) / 100;
  const tp2PctNum = parseFloat(tp2Pct) / 100;
  const tp3PctNum = parseFloat(tp3Pct) / 100;
  const tp1Profit = positionSize && strategy.tp1 && strategy.entry
    ? positionSize * tp1PctNum * Math.abs(strategy.tp1 - strategy.entry) : null;
  const tp2Profit = positionSize && strategy.tp2 && strategy.entry
    ? positionSize * tp2PctNum * Math.abs(strategy.tp2 - strategy.entry) : null;
  const strategyAny = strategy;
  const tp3Profit = positionSize && strategyAny.tp3 && strategy.entry
    ? positionSize * tp3PctNum * Math.abs((strategyAny.tp3) - strategy.entry) : null;
  const totalMaxProfit = (tp1Profit ?? 0) + (tp2Profit ?? 0) + (tp3Profit ?? 0);
  const finalRR = totalMaxProfit > 0 ? totalMaxProfit / riskAmount : null;

  const leverageColor = !leverage ? "#888" : leverage > 10 ? "#ef5350" : leverage > 5 ? "#ffd740" : "#4caf50";

  return (
    <div className="rounded-lg overflow-hidden" style={{ background: "#111", border: "1px solid #1e1e1e" }}>
      <div className="px-3 py-2 border-b flex items-center justify-between" style={{ borderColor: "#1e1e1e", background: "#0d0d0d" }}>
        <span className="text-xs font-semibold text-[#ccc]">倉位計算器</span>
        {finalRR && (
          <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded" style={{ color: finalRR >= 2 ? "#4caf50" : "#ffd740", background: finalRR >= 2 ? "#4caf5015" : "#ffd74015" }}>
            最終 RR {finalRR.toFixed(2)}
          </span>
        )}
      </div>
      <div className="p-3 space-y-3">
        {/* 輸入區 */}
        <div className="grid grid-cols-3 gap-2">
          <div>
            <div className="text-[10px] text-[#666] mb-1">總資金 (USDT)</div>
            <input type="number" value={capital} onChange={e => setCapital(e.target.value)}
              className="w-full text-xs font-mono px-2 py-1.5 rounded outline-none"
              style={{ background: "#161616", border: "1px solid #2a2a2a", color: "#ccc" }} />
          </div>
          <div>
            <div className="text-[10px] text-[#666] mb-1">風險比例 (%)</div>
            <input type="number" value={riskPctInput} onChange={e => setRiskPctInput(e.target.value)}
              step="0.5" min="0.1" max="10"
              className="w-full text-xs font-mono px-2 py-1.5 rounded outline-none"
              style={{ background: "#161616", border: "1px solid #2a2a2a", color: "#ccc" }} />
          </div>
          <div>
            <div className="text-[10px] text-[#666] mb-1">手動槓桿 (空=自動)</div>
            <input type="number" value={manualLeverage} onChange={e => setManualLeverage(e.target.value)}
              placeholder={autoLeverage ? autoLeverage.toFixed(1) : "自動"}
              min="1" max="125"
              className="w-full text-xs font-mono px-2 py-1.5 rounded outline-none"
              style={{ background: "#161616", border: "1px solid #2a2a2a", color: "#ccc" }} />
          </div>
        </div>

        {/* 快速槓桿按鈕 */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] text-[#555]">快選：</span>
          {[1, 2, 3, 5, 10, 20].map(lv => (
            <button key={lv} onClick={() => setManualLeverage(lv === parseFloat(manualLeverage) ? "" : String(lv))}
              className="text-[10px] font-mono px-2 py-0.5 rounded transition-colors"
              style={{
                background: parseFloat(manualLeverage) === lv ? "#ffd74020" : "#161616",
                border: `1px solid ${parseFloat(manualLeverage) === lv ? "#ffd740" : "#2a2a2a"}`,
                color: parseFloat(manualLeverage) === lv ? "#ffd740" : "#888"
              }}>
              {lv}x
            </button>
          ))}
        </div>

        {/* 核心結果 */}
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded p-2 text-center" style={{ background: "#161616", border: "1px solid #2a2a2a" }}>
            <div className="text-[10px] text-[#666] mb-0.5">風險金額</div>
            <div className="text-sm font-mono font-bold text-[#ef5350]">${riskAmount.toFixed(2)}</div>
          </div>
          <div className="rounded p-2 text-center" style={{ background: "#161616", border: "1px solid #2a2a2a" }}>
            <div className="text-[10px] text-[#666] mb-0.5">建議倉位</div>
            <div className="text-sm font-mono font-bold" style={{ color: dirColor }}>
              {positionSize ? positionSize.toFixed(4) : "—"} 個
            </div>
          </div>
          <div className="rounded p-2 text-center" style={{ background: "#161616", border: "1px solid #2a2a2a" }}>
            <div className="text-[10px] text-[#666] mb-0.5">倉位價值</div>
            <div className="text-sm font-mono font-bold text-[#888]">
              ${positionValue ? positionValue.toFixed(2) : "—"}
            </div>
          </div>
          <div className="rounded p-2 text-center" style={{ background: "#161616", border: "1px solid #2a2a2a" }}>
            <div className="text-[10px] text-[#666] mb-0.5">實際槓桿</div>
            <div className="text-sm font-mono font-bold" style={{ color: leverageColor }}>
              {leverage ? `${leverage.toFixed(1)}x` : "—"}
            </div>
          </div>
        </div>

        {/* 爆倉價警示 */}
        {liqPrice && (
          <div className="rounded p-2 flex items-center justify-between" style={{ background: "#ef535010", border: "1px solid #ef535030" }}>
            <div>
              <div className="text-[10px] text-[#ef5350] font-semibold">⚠ 預估爆倉價</div>
              <div className="text-[10px] text-[#888] mt-0.5">維持保證金率 0.5%，僅供參考</div>
            </div>
            <div className="text-sm font-mono font-bold text-[#ef5350]">
              ${liqPrice.toLocaleString("en-US", { maximumFractionDigits: 2 })}
            </div>
          </div>
        )}

        {/* 分批止盈設定 */}
        {(strategy.tp1 || strategy.tp2 || strategy.tp3) && (
          <div className="rounded-lg overflow-hidden" style={{ border: "1px solid #1e1e1e" }}>
            <div className="px-3 py-1.5 border-b text-[10px] font-semibold text-[#888] uppercase tracking-wider" style={{ borderColor: "#1e1e1e", background: "#0d0d0d" }}>
              分批止盈設定（出場比例 %）
            </div>
            <div className="p-2 space-y-1.5">
              {strategy.tp1 && (
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-[#888] w-20 shrink-0">TP1 <span className="font-mono text-[#4caf50]">${strategy.tp1.toLocaleString("en-US", { maximumFractionDigits: 2 })}</span></span>
                  <input type="number" value={tp1Pct} onChange={e => setTp1Pct(e.target.value)} min="0" max="100"
                    className="w-14 text-xs font-mono px-2 py-1 rounded outline-none text-center"
                    style={{ background: "#161616", border: "1px solid #2a2a2a", color: "#ccc" }} />
                  <span className="text-[10px] text-[#555]">%</span>
                  {tp1Profit && <span className="text-[10px] font-mono font-bold text-[#4caf50] ml-auto">+${tp1Profit.toFixed(2)}</span>}
                </div>
              )}
              {strategy.tp2 && (
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-[#888] w-20 shrink-0">TP2 <span className="font-mono text-[#00e676]">${strategy.tp2.toLocaleString("en-US", { maximumFractionDigits: 2 })}</span></span>
                  <input type="number" value={tp2Pct} onChange={e => setTp2Pct(e.target.value)} min="0" max="100"
                    className="w-14 text-xs font-mono px-2 py-1 rounded outline-none text-center"
                    style={{ background: "#161616", border: "1px solid #2a2a2a", color: "#ccc" }} />
                  <span className="text-[10px] text-[#555]">%</span>
                  {tp2Profit && <span className="text-[10px] font-mono font-bold text-[#00e676] ml-auto">+${tp2Profit.toFixed(2)}</span>}
                </div>
              )}
              {strategyAny.tp3 && (
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-[#888] w-20 shrink-0">TP3 <span className="font-mono text-[#69f0ae]">${(strategyAny.tp3).toLocaleString("en-US", { maximumFractionDigits: 2 })}</span></span>
                  <input type="number" value={tp3Pct} onChange={e => setTp3Pct(e.target.value)} min="0" max="100"
                    className="w-14 text-xs font-mono px-2 py-1 rounded outline-none text-center"
                    style={{ background: "#161616", border: "1px solid #2a2a2a", color: "#ccc" }} />
                  <span className="text-[10px] text-[#555]">%</span>
                  {tp3Profit && <span className="text-[10px] font-mono font-bold text-[#69f0ae] ml-auto">+${tp3Profit.toFixed(2)}</span>}
                </div>
              )}
              {totalMaxProfit > 0 && (
                <div className="flex items-center justify-between pt-1 border-t" style={{ borderColor: "#1e1e1e" }}>
                  <span className="text-[10px] text-[#888]">總預期獲利</span>
                  <span className="text-sm font-mono font-bold text-[#4caf50]">+${totalMaxProfit.toFixed(2)}</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── 歷史相似形態 ─────────────────────────────────────────────────────────────

function SimilarPatternCard({ pattern }: {
  pattern: {
    description: string;
    outcome?: string;
    similarity?: number;
    date?: string;
    win_rate?: number;
    avg_return?: number;
    sample_count?: number;
  }
}) {
  const outcomeText = pattern.outcome ?? "";
  const outcomeColor = outcomeText.includes("上漲") || outcomeText.includes("突破") || outcomeText.includes("看多")
    ? "#4caf50" : outcomeText.includes("下跌") || outcomeText.includes("跌破") || outcomeText.includes("看空")
    ? "#ef5350" : "#ffd740";
  const similarity = pattern.similarity ?? 0;

  return (
    <div className="rounded p-2.5" style={{ background: "#161616", border: "1px solid #2a2a2a" }}>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] text-[#555]">{pattern.date ?? "歷史形態"}</span>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-[#666]">相似度</span>
          <span className="text-[11px] font-mono font-bold" style={{ color: similarity >= 80 ? "#4caf50" : similarity >= 60 ? "#ffd740" : "#888" }}>
            {similarity}%
          </span>
        </div>
      </div>
      <div className="text-[11px] text-[#aaa] leading-relaxed mb-1.5">{pattern.description}</div>
      {/* 勝率、平均回報、樣本數 */}
      {(pattern.win_rate != null || pattern.avg_return != null || pattern.sample_count != null) && (
        <div className="grid grid-cols-3 gap-1.5 mb-1.5">
          {pattern.win_rate != null && (
            <div className="rounded p-1.5 text-center" style={{ background: "#0d0d0d" }}>
              <div className="text-[9px] text-[#555] mb-0.5">勝率</div>
              <div className="text-[11px] font-mono font-bold" style={{ color: pattern.win_rate >= 60 ? "#4caf50" : pattern.win_rate >= 50 ? "#ffd740" : "#ef5350" }}>
                {pattern.win_rate}%
              </div>
            </div>
          )}
          {pattern.avg_return != null && (
            <div className="rounded p-1.5 text-center" style={{ background: "#0d0d0d" }}>
              <div className="text-[9px] text-[#555] mb-0.5">平均回報</div>
              <div className="text-[11px] font-mono font-bold" style={{ color: pattern.avg_return >= 0 ? "#4caf50" : "#ef5350" }}>
                {pattern.avg_return >= 0 ? "+" : ""}{pattern.avg_return}%
              </div>
            </div>
          )}
          {pattern.sample_count != null && (
            <div className="rounded p-1.5 text-center" style={{ background: "#0d0d0d" }}>
              <div className="text-[9px] text-[#555] mb-0.5">樣本數</div>
              <div className="text-[11px] font-mono font-bold text-[#888]">{pattern.sample_count}</div>
            </div>
          )}
        </div>
      )}
      {outcomeText && (
        <div className="flex items-center gap-1.5">
          <Circle className="w-2 h-2 shrink-0" style={{ color: outcomeColor, fill: outcomeColor }} />
          <span className="text-[11px] font-semibold" style={{ color: outcomeColor }}>{outcomeText}</span>
        </div>
      )}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function StrategyPanel({ strategy, symbol, isLoading, currentPrice = null, lastPriceUpdateTs = null, wsStatus = "disconnected" }: Props) {
  if (isLoading && !strategy) {
    return (
      <div className="flex items-center justify-center py-16 text-[#555] text-sm">
        正在計算策略建議...
      </div>
    );
  }

  if (!strategy) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Target className="w-8 h-8 text-[#333] mb-3" />
        <div className="text-sm text-[#555]">請點擊「分析」按鈕取得策略建議</div>
      </div>
    );
  }

  const enhancedStrategy = strategy as EnhancedStrategyData;

  const isLong  = enhancedStrategy.direction === "long";
  const isShort = enhancedStrategy.direction === "short";
  const isNeutral = enhancedStrategy.direction === "neutral";

  const dirColor = isLong ? "#4caf50" : isShort ? "#ef5350" : "#ffd740";
  const dirLabel = isLong ? "做多" : isShort ? "做空" : "觀望";
  const DirIcon = isLong ? TrendingUp : isShort ? TrendingDown : Minus;

  const suggestedEntry = enhancedStrategy.entry ?? null;
  const effectiveEntry = !suggestedEntry || !currentPrice || isNeutral
    ? suggestedEntry
    : isLong
      ? Math.min(suggestedEntry, currentPrice)
      : isShort
        ? Math.max(suggestedEntry, currentPrice)
        : suggestedEntry;
  const entryWasAdjusted = suggestedEntry != null && effectiveEntry != null && Math.abs(suggestedEntry - effectiveEntry) > 0.000001;
  const entryDeviationPct = suggestedEntry != null && currentPrice != null && currentPrice > 0
    ? Math.abs((suggestedEntry - currentPrice) / currentPrice) * 100
    : null;
  const priceAgeMs = lastPriceUpdateTs ? Date.now() - lastPriceUpdateTs : null;
  const isPriceStale = priceAgeMs != null && priceAgeMs > 45_000;
  const liveStatusLabel = wsStatus === "connected"
    ? "即時行情正常"
    : wsStatus === "connecting"
      ? "即時行情連線中"
      : wsStatus === "fallback"
        ? "行情來源降級"
        : wsStatus === "error"
          ? "即時行情異常"
          : "即時行情中斷";
  const effectiveStrategy: EnhancedStrategyData = effectiveEntry == null
    ? enhancedStrategy
    : { ...enhancedStrategy, entry: effectiveEntry };

  const riskPct = effectiveStrategy.entry && effectiveStrategy.sl
    ? Math.abs((effectiveStrategy.sl - effectiveStrategy.entry) / effectiveStrategy.entry * 100)
    : null;
  const rewardPct = effectiveStrategy.entry && effectiveStrategy.tp1
    ? Math.abs((effectiveStrategy.tp1 - effectiveStrategy.entry) / effectiveStrategy.entry * 100)
    : null;

  // Checklist from backend or generate default
  // 強化版：加入 SMC/LIT 學習到的進場條件（Photon Trading / Phantom Trading / Waqar Asim 理論）
  const checklist: StrategyChecklistItem[] = enhancedStrategy.checklist && enhancedStrategy.checklist.length > 0
    ? enhancedStrategy.checklist.map((item) => {
        if ("item" in item) return item;
        return {
          item: item.label,
          passed: item.passed,
          note: item.value,
        };
      })
    : [
        // ── MTFA 多時間框架對齊（Photon Trading 核心原則）──
        { item: "MTFA：4H/日線大方向確認（趨勢對齊）", passed: !isNeutral },
        // ── 進場點位合理性 ──
        { item: "入場點貼近即時市價（< 0.5% 偏差）", passed: entryDeviationPct != null ? entryDeviationPct <= 0.5 : !isNeutral && !!effectiveStrategy.entry, note: entryDeviationPct != null ? `${entryDeviationPct.toFixed(2)}%` : undefined },
        // ── Premium/Discount 區間（ICT 核心）──
        { item: isLong ? "做多：在 Discount 區間（均衡點以下）" : isShort ? "做空：在 Premium 區間（均衡點以上）" : "觀察 Premium/Discount 區間", passed: !isNeutral },
        // ── 止損與 RR（資金管理）──
        { item: "止損設置合理（< 3% 風險，OB 底/頂下方）", passed: riskPct != null && riskPct < 3, note: riskPct ? `${riskPct.toFixed(2)}%` : undefined },
        { item: "風險報酬比 ≥ 1:2（TP1 目標為流動性池）", passed: (effectiveStrategy.rr_ratio ?? 0) >= 2, note: effectiveStrategy.rr_ratio ? `1:${effectiveStrategy.rr_ratio.toFixed(1)}` : undefined },
        // ── LIT 流動性清掃確認（Waqar Asim 理論）──
        { item: isLong ? "SSL 流動性已被清掃（LIT 真實反轉訊號）" : isShort ? "BSL 流動性已被清掃（LIT 真實反轉訊號）" : "等待流動性清掃訊號", passed: !isNeutral },
        // ── 行情資料新鮮度 ──
        { item: "行情資料新鮮（< 45 秒）", passed: !isPriceStale, note: priceAgeMs != null ? `${Math.round(priceAgeMs / 1000)} 秒前` : undefined },
      ];

  // Twitter 情緒分數
  const twitterSentiment = enhancedStrategy.twitter_sentiment;

  // Similar pattern from backend（含真實歷史比對標記）
  const similarPattern = enhancedStrategy.similar_pattern;

  return (
    <div className="space-y-4">
      {/* Direction header */}
      <div className="rounded-lg p-4 flex items-center justify-between"
           style={{ background: "#111", border: `1px solid ${dirColor}30` }}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center"
               style={{ background: `${dirColor}15`, border: `1px solid ${dirColor}30` }}>
            <DirIcon className="w-5 h-5" style={{ color: dirColor }} />
          </div>
          <div>
            <div className="text-xs text-[#888] mb-0.5">{symbol.replace("USDT", "")} 策略方向</div>
            <div className="text-lg font-bold" style={{ color: dirColor }}>{dirLabel}</div>
          </div>
        </div>
        {enhancedStrategy.rr_ratio && (
          <div className="text-right">
            <div className="text-[10px] text-[#666]">風險報酬比</div>
            <div className={`text-xl font-bold font-mono ${enhancedStrategy.rr_ratio >= 2 ? "text-[#4caf50]" : "text-[#ffd740]"}`}>
              1:{enhancedStrategy.rr_ratio.toFixed(1)}
            </div>
          </div>
        )}
      </div>

      {!isNeutral && (currentPrice || entryWasAdjusted || isPriceStale || wsStatus !== "connected") && (
        <div className="space-y-2">
          <div className="rounded-lg p-3" style={{ background: "#10151a", border: `1px solid ${isPriceStale || wsStatus === "error" || wsStatus === "disconnected" ? "#ef535040" : "#2a3a4a"}` }}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[11px] font-semibold" style={{ color: isPriceStale || wsStatus === "error" || wsStatus === "disconnected" ? "#ffd740" : "#8ab4f8" }}>
                  價格一致性檢查
                </div>
                <div className="text-[11px] text-[#777] mt-0.5">
                  {liveStatusLabel}{priceAgeMs != null ? ` · 最近更新 ${Math.max(0, Math.round(priceAgeMs / 1000))} 秒前` : " · 尚未收到最新 tick"}
                </div>
              </div>
              {currentPrice != null && (
                <div className="text-right">
                  <div className="text-[10px] text-[#666]">即時市價</div>
                  <div className="text-sm font-mono font-bold text-[#e6e6e6]">{currentPrice.toLocaleString("en-US", { maximumFractionDigits: 2 })}</div>
                </div>
              )}
            </div>
            {(entryWasAdjusted || (entryDeviationPct != null && entryDeviationPct > 0.5) || isPriceStale) && (
              <div className="mt-2 space-y-1 text-[11px] leading-relaxed">
                {entryWasAdjusted && suggestedEntry != null && effectiveStrategy.entry != null && (
                  <div className="text-[#ffd740]">系統已自動把建議入場價由 {suggestedEntry.toLocaleString("en-US", { maximumFractionDigits: 2 })} 修正為 {effectiveStrategy.entry.toLocaleString("en-US", { maximumFractionDigits: 2 })}，避免方向與市價不一致。</div>
                )}
                {entryDeviationPct != null && entryDeviationPct > 0.5 && (
                  <div className="text-[#ffab91]">原始策略入場價與即時市價偏離 {entryDeviationPct.toFixed(2)}%，建議等待價格回到區域或重新分析後再下單。</div>
                )}
                {isPriceStale && (
                  <div className="text-[#ffab91]">目前行情更新偏舊，請先確認連線恢復或重新整理資料後再依策略執行。</div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Trade parameters */}
      {!isNeutral && effectiveStrategy.entry && effectiveStrategy.sl && (
        <div>
          <div className="text-[11px] text-[#555] font-semibold uppercase tracking-wider mb-2">交易參數</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <MetricBox label="入場價" value={effectiveStrategy.entry.toLocaleString("en-US", { maximumFractionDigits: 2 })} color={dirColor} sub={entryWasAdjusted ? "已依即時市價修正" : "建議入場"} />
            <MetricBox label="止損" value={effectiveStrategy.sl.toLocaleString("en-US", { maximumFractionDigits: 2 })} color="#ef5350" sub={riskPct ? `風險 ${riskPct.toFixed(2)}%` : undefined} />
            {effectiveStrategy.tp1 && <MetricBox label="目標 1" value={effectiveStrategy.tp1.toLocaleString("en-US", { maximumFractionDigits: 2 })} color="#4caf50" sub={rewardPct ? `獲利 ${rewardPct.toFixed(2)}%` : undefined} />}
            {effectiveStrategy.tp2 && <MetricBox label="目標 2" value={effectiveStrategy.tp2.toLocaleString("en-US", { maximumFractionDigits: 2 })} color="#00e676" sub="延伸目標" />}
          </div>
        </div>
      )}

      {/* Entry Checklist */}
      <EntryChecklist checklist={checklist} />

      {/* Risk Calculator */}
      {!isNeutral && effectiveStrategy.entry && effectiveStrategy.sl && (
        <RiskCalculator strategy={effectiveStrategy} dirColor={dirColor} />
      )}

      {/* Risk metrics */}
      <div>
        <div className="text-[11px] text-[#555] font-semibold uppercase tracking-wider mb-2">風險指標</div>
        <div className="grid grid-cols-3 gap-2">
          <MetricBox label="ATR 波動率" value={(enhancedStrategy.atr ?? 0).toFixed(2)} color="#888" sub="14 期 ATR" />
          {riskPct && <MetricBox label="止損幅度" value={`${riskPct.toFixed(2)}%`} color={riskPct > 3 ? "#ef5350" : "#ffd740"} sub={riskPct > 3 ? "風險偏高" : "風險合理"} />}
          {effectiveStrategy.rr_ratio && <MetricBox label="RR 比" value={`1:${effectiveStrategy.rr_ratio.toFixed(1)}`} color={effectiveStrategy.rr_ratio >= 2 ? "#4caf50" : "#ffd740"} sub={effectiveStrategy.rr_ratio >= 2 ? "優質交易" : "可接受"} />}
        </div>
      </div>

      {/* Similar Pattern */}
      {similarPattern && (
        <div>
          <div className="text-[11px] text-[#555] font-semibold uppercase tracking-wider mb-2 flex items-center gap-2">
            <span>歷史形態比對</span>
            {similarPattern.is_real_history ? (
              <span className="text-[9px] px-1.5 py-0.5 rounded font-mono" style={{ background: "#4caf5020", color: "#4caf50", border: "1px solid #4caf5040" }}>
                真實歷史 相關係數&gt;{similarPattern.corr_threshold ?? 0.85}
              </span>
            ) : (
              <span className="text-[9px] px-1.5 py-0.5 rounded font-mono" style={{ background: "#ffd74020", color: "#ffd740", border: "1px solid #ffd74040" }}>
                估算模型
              </span>
            )}
            {similarPattern.sample_count != null && similarPattern.sample_count > 0 && (
              <span className="text-[9px] text-[#666]">{similarPattern.sample_count} 個樣本</span>
            )}
          </div>
          <SimilarPatternCard pattern={similarPattern} />
        </div>
      )}

      {/* Twitter 情緒面板 */}
      {twitterSentiment && (
        <div>
          <div className="text-[11px] text-[#555] font-semibold uppercase tracking-wider mb-2 flex items-center gap-2">
            <span>Twitter 社群情緒</span>
            <span
              className="text-[9px] px-1.5 py-0.5 rounded font-mono"
              style={{
                background: twitterSentiment.passed ? "#4caf5020" : "#ef535020",
                color: twitterSentiment.passed ? "#4caf50" : "#ef5350",
                border: `1px solid ${twitterSentiment.passed ? "#4caf5040" : "#ef535040"}`,
              }}
            >
              {twitterSentiment.passed ? "情緒支持當前方向" : "情緒警示"}
            </span>
          </div>
          <div className="rounded p-3" style={{ background: "#161616", border: "1px solid #2a2a2a" }}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-semibold" style={{ color: twitterSentiment.score > 0.1 ? "#4caf50" : twitterSentiment.score < -0.1 ? "#ef5350" : "#ffd740" }}>
                {twitterSentiment.label}
              </span>
              <span className="text-[10px] font-mono text-[#666]">情緒分數: {twitterSentiment.score.toFixed(2)}</span>
            </div>
            {/* 情緒比例条 */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-[#4caf50] w-8">看多</span>
                <div className="flex-1 bg-[#0d0d0d] rounded-full h-2 overflow-hidden">
                  <div className="h-full rounded-full bg-[#4caf50]" style={{ width: `${twitterSentiment.bullish_pct}%` }} />
                </div>
                <span className="text-[10px] font-mono text-[#888] w-8 text-right">{twitterSentiment.bullish_pct}%</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-[#ef5350] w-8">看空</span>
                <div className="flex-1 bg-[#0d0d0d] rounded-full h-2 overflow-hidden">
                  <div className="h-full rounded-full bg-[#ef5350]" style={{ width: `${twitterSentiment.bearish_pct}%` }} />
                </div>
                <span className="text-[10px] font-mono text-[#888] w-8 text-right">{twitterSentiment.bearish_pct}%</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-[#888] w-8">中性</span>
                <div className="flex-1 bg-[#0d0d0d] rounded-full h-2 overflow-hidden">
                  <div className="h-full rounded-full bg-[#888]" style={{ width: `${twitterSentiment.neutral_pct}%` }} />
                </div>
                <span className="text-[10px] font-mono text-[#888] w-8 text-right">{twitterSentiment.neutral_pct}%</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Kelly Criterion */}
      {!isNeutral && (() => {
        const kelly = enhancedStrategy.kelly_criterion;
        if (!kelly) return null;
        const riskColor = kelly.max_risk_pct >= 1.5 ? "#4caf50" : kelly.max_risk_pct >= 0.5 ? "#ffd740" : "#ef5350";
        return (
          <div>
            <div className="text-[11px] text-[#555] font-semibold uppercase tracking-wider mb-2 flex items-center gap-2">
              <span>資金管理（Kelly Criterion）</span>
            </div>
            <div className="rounded p-3" style={{ background: "#161616", border: "1px solid #2a2a2a" }}>
              <div className="grid grid-cols-3 gap-3 mb-3">
                <div className="text-center">
                  <div className="text-[10px] text-[#666] mb-0.5">估算勝率</div>
                  <div className="text-sm font-bold font-mono" style={{ color: kelly.win_rate_est >= 60 ? "#4caf50" : "#ffd740" }}>{kelly.win_rate_est}%</div>
                </div>
                <div className="text-center">
                  <div className="text-[10px] text-[#666] mb-0.5">Half-Kelly 倉位</div>
                  <div className="text-sm font-bold font-mono" style={{ color: riskColor }}>{kelly.half_kelly_pct}%</div>
                </div>
                <div className="text-center">
                  <div className="text-[10px] text-[#666] mb-0.5">建議風險</div>
                  <div className="text-sm font-bold font-mono" style={{ color: riskColor }}>≤{kelly.max_risk_pct}%</div>
                </div>
              </div>
              <div className="text-[11px] text-[#888] leading-relaxed">{kelly.suggestion}</div>
            </div>
          </div>
        );
      })()}

      {/* Suggestion */}
      {enhancedStrategy.suggestion && (
        <div className="rounded-lg p-4" style={{ background: "#111", border: "1px solid #1e1e1e" }}>
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-3.5 h-3.5 text-[#ffd740]" />
            <span className="text-[11px] font-semibold text-[#888] uppercase tracking-wider">策略說明</span>
          </div>
          <div className="text-xs text-[#aaa] leading-relaxed">{enhancedStrategy.suggestion}</div>
        </div>
      )}

      {/* SMC 進場模式建議（基於 SMC 學習資源） */}
      {!isNeutral && (
        <div className="rounded-lg overflow-hidden" style={{ background: "#0d0d0d", border: "1px solid #1e1e1e" }}>
          <div className="px-3 py-2 border-b" style={{ borderColor: "#1e1e1e", background: "#111" }}>
            <span className="text-[11px] font-semibold text-[#888] uppercase tracking-wider">🎯 SMC 進場模式參考</span>
          </div>
          <div className="p-3 grid grid-cols-2 gap-2">
            <div className="rounded p-2.5" style={{ background: "rgba(255,215,64,0.05)", border: "1px solid rgba(255,215,64,0.2)" }}>
              <div className="text-[10px] font-bold text-[#ffd740] mb-1">⚡ Risk Entry（激進）</div>
              <div className="text-[9px] text-[#777] leading-relaxed space-y-0.5">
                <div>• 流動性清掃後直接在 OB 頂部進場</div>
                <div>• 止損設在 OB 底部下方</div>
                <div>• 風報比更高，但確認度較低</div>
                <div className="text-[#ffd740]">適合：清掃訊號強烈且有 FVG 支撑</div>
              </div>
            </div>
            <div className="rounded p-2.5" style={{ background: "rgba(79,195,247,0.05)", border: "1px solid rgba(79,195,247,0.2)" }}>
              <div className="text-[10px] font-bold text-[#4fc3f7] mb-1">✓ Confirmation Entry（保守）</div>
              <div className="text-[9px] text-[#777] leading-relaxed space-y-0.5">
                <div>• 等待 CHoCH 後在 OB 中點進場</div>
                <div>• 止損設在 OB 底部下方（稍寬）</div>
                <div>• 確認度高，勝率更穩定</div>
                <div className="text-[#4fc3f7]">適合：新手或市場不確定時使用</div>
              </div>
            </div>
          </div>
          <div className="px-3 pb-3">
            <div className="rounded p-2" style={{ background: "#111", border: "1px solid #1e1e1e" }}>
              <div className="text-[9px] text-[#555] leading-relaxed">
                <span className="text-[#888]">MTFA 流程（Photon Trading）：</span>
                4H/日線 確認大方向與流動性目標 → 15M 尋找流動性清掃訊號 → 5M/1M 尋找 CHoCH + OB 精確進場點
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Neutral state */}
      {isNeutral && (
        <div className="rounded-lg p-4" style={{ background: "#111", border: "1px solid #2a2a2a" }}>
          <div className="flex items-center gap-2 mb-2">
            <Minus className="w-3.5 h-3.5 text-[#ffd740]" />
            <span className="text-[11px] font-semibold text-[#ffd740]">觀望建議</span>
          </div>
          <div className="text-xs text-[#888] leading-relaxed">
            目前市場訊號分歧，建議觀望等待更明確的方向訊號後再入場。
            留意關鍵支撐阻力位的突破情況，配合成交量確認方向。
          </div>
        </div>
      )}
    </div>
  );
}
