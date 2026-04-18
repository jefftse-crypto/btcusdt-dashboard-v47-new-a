/**
 * PaLouiePanel — 方方土 Price Action 分析面板
 *
 * 設計哲學：Al Brooks 價格行為學 × 方方土實戰體系
 * 核心概念：
 *   - 80-20 規則：震盪區間 80% 突破失敗；強趨勢 80% 反轉失敗
 *   - 第二段陷阱（2nd Leg Trap）：TR 中第二段越強，陷阱越深
 *   - Measured Move（MM）：三種計算方式，60% 達成率
 *   - 楔形三推反轉（Wedge Reversal）：Overshoot 是最強反轉信號
 *   - 信號 K 線強度評分：實體大、收在極值、突破單入場
 */

import { useMemo } from "react";
import type { CryptoSnapshot } from "@shared/cryptoTypes";

interface Props {
  snapshot: CryptoSnapshot | null;
  currentPrice: number | null;
  isLoading: boolean;
}

// ─── 工具函數 ────────────────────────────────────────────────────────────────

function pct(a: number, b: number): string {
  if (!b) return "—";
  return ((a - b) / b * 100).toFixed(2) + "%";
}

function pctDist(price: number | null, target: number): string {
  if (!price) return "—";
  return ((target - price) / price * 100).toFixed(2) + "%";
}

function RiskBadge({ level }: { level: "high" | "medium" | "low" | "none" }) {
  const map = {
    high:   { label: "高風險", bg: "#ef5350", text: "#fff" },
    medium: { label: "中風險", bg: "#ffd740", text: "#000" },
    low:    { label: "低風險", bg: "#4caf50", text: "#fff" },
    none:   { label: "無信號", bg: "#333",    text: "#888" },
  };
  const m = map[level];
  return (
    <span className="text-[10px] px-2 py-0.5 rounded font-bold"
      style={{ background: m.bg, color: m.text }}>
      {m.label}
    </span>
  );
}

function MetricRow({ label, value, sub, color }: {
  label: string; value: string; sub?: string; color?: string;
}) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-[#1e1e1e]">
      <span className="text-[11px] text-[#888]">{label}</span>
      <div className="text-right">
        <span className="text-[11px] font-mono" style={{ color: color ?? "#ccc" }}>{value}</span>
        {sub && <div className="text-[9px] text-[#555]">{sub}</div>}
      </div>
    </div>
  );
}

function SectionTitle({ icon, title, badge }: { icon: string; title: string; badge?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 border-b border-[#1e1e1e]"
      style={{ background: "#0d0d0d" }}>
      <span className="text-sm">{icon}</span>
      <span className="text-[11px] font-semibold text-[#ccc] uppercase tracking-wider">{title}</span>
      {badge && <div className="ml-auto">{badge}</div>}
    </div>
  );
}

// ─── 主元件 ──────────────────────────────────────────────────────────────────

export function PaLouiePanel({ snapshot, currentPrice, isLoading }: Props) {

  // ── 1. 80-20 假突破分析 ──────────────────────────────────────────────────
  const falseBreakAnalysis = useMemo(() => {
    if (!snapshot?.pa) return null;
    const tf4h = snapshot.pa.timeframes["4h"];
    if (!tf4h) return null;

    const score = tf4h.false_break_score ?? 0;
    const dir   = tf4h.false_break_direction ?? "none";
    const ctx   = tf4h.trend_context ?? "ranging";

    // 80-20 規則：在 ranging 市場中，80% 突破失敗
    // 在 strong_trend 市場中，80% 反轉失敗
    const isRanging = ctx === "ranging";
    const isTrend   = ctx === "strong_trend";

    let riskLevel: "high" | "medium" | "low" | "none" = "none";
    let ruleApplied = "";
    let interpretation = "";

    if (isRanging && score > 60) {
      riskLevel = "high";
      ruleApplied = "80-20 規則（震盪區間）";
      interpretation = `震盪區間中，${dir === "bullish" ? "向上" : "向下"}突破有 80% 機率失敗。`;
    } else if (isRanging && score > 35) {
      riskLevel = "medium";
      ruleApplied = "80-20 規則（震盪區間）";
      interpretation = `處於震盪區間，突破後需觀察「跟隨」強度再決策。`;
    } else if (isTrend && score > 60) {
      riskLevel = "medium";
      ruleApplied = "80-20 規則（強趨勢）";
      interpretation = `強趨勢中，80% 反轉嘗試會失敗。此假突破信號需謹慎對待。`;
    } else if (score > 30) {
      riskLevel = "low";
      ruleApplied = "假突破偵測";
      interpretation = `有輕微假突破跡象，但信號強度不足。`;
    } else {
      riskLevel = "none";
      ruleApplied = "—";
      interpretation = "無明顯假突破信號，市場方向較為清晰。";
    }

    // 真突破特徵評估（方方土：體積大、收在極值、遠離前期區間、急迫感）
    const patterns = tf4h.patterns ?? [];
    const hasStrongBreakout = patterns.some(p =>
      (p.name.includes("突破") || p.name.toLowerCase().includes("breakout")) && p.strength === "strong"
    );

    return {
      score, dir, ctx, isRanging, isTrend,
      riskLevel, ruleApplied, interpretation,
      hasStrongBreakout,
      followThrough: score < 30 ? "強" : score < 60 ? "弱" : "無跟隨",
    };
  }, [snapshot]);

  // ── 2. 第二段陷阱偵測 ────────────────────────────────────────────────────
  const secondLegTrap = useMemo(() => {
    if (!snapshot?.pa || !currentPrice) return null;
    const tf4h = snapshot.pa.timeframes["4h"];
    if (!tf4h) return null;

    const ctx   = tf4h.trend_context ?? "ranging";
    const score = tf4h.score ?? 50;
    const srLevels = tf4h.sr_levels ?? [];
    const support    = tf4h.support;
    const resistance = tf4h.resistance;

    if (!support || !resistance) return null;

    const rangeHeight = resistance - support;
    const priceInRange = currentPrice >= support && currentPrice <= resistance;
    const priceNearTop = currentPrice > support + rangeHeight * 0.75;
    const priceNearBot = currentPrice < support + rangeHeight * 0.25;

    // 第二段陷阱條件：
    // 1. 處於震盪區間（ranging）
    // 2. 現價接近區間邊緣（上方 25% 或下方 25%）
    // 3. 短期動能強（score > 60）但在區間邊緣
    const isRanging = ctx === "ranging";
    const nearEdge  = priceNearTop || priceNearBot;
    const strongMomentum = score > 60;

    let trapRisk: "high" | "medium" | "low" | "none" = "none";
    let trapDirection = "";
    let trapMessage = "";

    if (isRanging && nearEdge && strongMomentum) {
      trapRisk = "high";
      trapDirection = priceNearTop ? "看跌陷阱（TR 頂部）" : "看漲陷阱（TR 底部）";
      trapMessage = priceNearTop
        ? "現價接近區間上沿，短期動能強勁——這正是第二段陷阱的特徵！絕不追多，等待反轉信號。"
        : "現價接近區間下沿，短期動能強勁——這正是第二段陷阱的特徵！絕不追空，等待反轉信號。";
    } else if (isRanging && nearEdge) {
      trapRisk = "medium";
      trapDirection = priceNearTop ? "接近 TR 頂部" : "接近 TR 底部";
      trapMessage = "處於震盪區間邊緣，需警惕第二段陷阱。觀察跟隨 K 線再決策。";
    } else if (isRanging && priceInRange) {
      trapRisk = "low";
      trapDirection = "TR 中部";
      trapMessage = "處於震盪區間中部，等待明確方向突破。";
    } else {
      trapRisk = "none";
      trapDirection = "非震盪區間";
      trapMessage = "當前不處於震盪區間，第二段陷阱風險低。";
    }

    // 計算 TR 高度與位置百分比
    const positionPct = rangeHeight > 0
      ? ((currentPrice - support) / rangeHeight * 100).toFixed(0)
      : "—";

    // 強 SR 水位
    const strongLevels = srLevels.filter(l => l.strength >= 3).slice(0, 3);

    return {
      trapRisk, trapDirection, trapMessage,
      support, resistance, rangeHeight,
      positionPct, isRanging, strongLevels,
      priceNearTop, priceNearBot,
    };
  }, [snapshot, currentPrice]);

  // ── 3. Measured Move 三種計算 ────────────────────────────────────────────
  const measuredMoves = useMemo(() => {
    if (!snapshot?.pa || !currentPrice) return null;
    const tf4h = snapshot.pa.timeframes["4h"];
    if (!tf4h) return null;

    const support    = tf4h.support;
    const resistance = tf4h.resistance;
    const atr        = tf4h.atr ?? 0;
    const close      = tf4h.close ?? currentPrice;
    const ema20      = tf4h.ema20 ?? currentPrice;
    const ema50      = tf4h.ema50 ?? currentPrice;

    if (!support || !resistance) return null;

    const trHeight = resistance - support;

    // MM 方法一：TR 高度突破（最常用）
    const mmTrBull = resistance + trHeight;  // 向上突破目標
    const mmTrBear = support - trHeight;     // 向下突破目標

    // MM 方法二：Leg1=Leg2（N字形，基於 EMA20 到 EMA50 的距離估算第一段）
    const leg1Height = Math.abs(ema20 - ema50);
    const mmLeg2Bull = close + leg1Height;
    const mmLeg2Bear = close - leg1Height;

    // MM 方法三：突破 K 線實體（基於 ATR 估算，ATR ≈ 平均實體高度）
    const mmBarBull = close + atr * 2;  // 2 ATR 作為強勢突破 K 線實體的估算
    const mmBarBear = close - atr * 2;

    // 判斷當前方向（基於 PA 共識）
    const consensus = snapshot.pa.consensus;
    const isBullish = consensus === "bullish" || consensus === "strong_bullish";
    const isBearish = consensus === "bearish" || consensus === "strong_bearish";

    return {
      // TR 突破 MM
      mmTrBull, mmTrBear, trHeight,
      // Leg1=Leg2 MM
      mmLeg2Bull, mmLeg2Bear, leg1Height,
      // 突破 K 線實體 MM
      mmBarBull, mmBarBear,
      // 當前偏向
      isBullish, isBearish, consensus,
      // 主要目標（根據方向）
      primaryTarget: isBullish ? mmTrBull : isBearish ? mmTrBear : null,
      primaryMethod: "TR 高度突破（最常用）",
    };
  }, [snapshot, currentPrice]);

  // ── 4. 楔形三推偵測 ──────────────────────────────────────────────────────
  const wedgeAnalysis = useMemo(() => {
    if (!snapshot?.pa) return null;
    const tf4h = snapshot.pa.timeframes["4h"];
    if (!tf4h) return null;

    const patterns = tf4h.patterns ?? [];
    const highConfluence = tf4h.high_confluence_patterns ?? [];

    // 偵測楔形相關形態
    const wedgePatterns = patterns.filter(p =>
      p.name.includes("楔") || p.name.toLowerCase().includes("wedge") ||
      p.name.includes("三推") || p.name.includes("三角") ||
      p.name.toLowerCase().includes("triangle") || p.name.includes("收斂")
    );

    // 偵測 Overshoot 相關形態（長影線 + 反轉）
    const overshootPatterns = patterns.filter(p =>
      p.name.includes("射擊之星") || p.name.includes("錘子") ||
      p.name.toLowerCase().includes("shooting star") || p.name.toLowerCase().includes("hammer") ||
      p.name.includes("長影線") || p.name.includes("pin bar") || p.name.toLowerCase().includes("pin")
    );

    // 三推形態：基於 trend_context 和 score 推斷
    const score = tf4h.score ?? 50;
    const ctx   = tf4h.trend_context ?? "ranging";
    const trend = tf4h.trend ?? "neutral";

    // 三推衰竭信號：強趨勢但 score 開始下降 + 出現長影線
    const hasThreePushSignal = (ctx === "strong_trend" || ctx === "weak_trend") &&
      score > 55 && overshootPatterns.length > 0;

    const hasWedgePattern = wedgePatterns.length > 0;
    const hasOvershoot    = overshootPatterns.length > 0;

    let wedgeRisk: "high" | "medium" | "low" | "none" = "none";
    let wedgeMessage = "";

    if (hasOvershoot && hasThreePushSignal) {
      wedgeRisk = "high";
      wedgeMessage = "偵測到 Overshoot 信號！趨勢通道線被刺穿後迅速拉回，這是楔形三推的最強反轉信號。";
    } else if (hasWedgePattern) {
      wedgeRisk = "medium";
      wedgeMessage = "偵測到楔形形態，代表動能衰竭。等待第三推完成後的反轉信號 K 線。";
    } else if (hasOvershoot) {
      wedgeRisk = "medium";
      wedgeMessage = "出現長影線（Pin Bar），可能是趨勢衰竭的 Overshoot 信號。";
    } else if (ctx === "strong_trend" && score > 70) {
      wedgeRisk = "low";
      wedgeMessage = "強趨勢中，注意三推衰竭的可能性。觀察後續 K 線是否出現重疊。";
    } else {
      wedgeRisk = "none";
      wedgeMessage = "無明顯楔形或三推衰竭信號。";
    }

    return {
      wedgeRisk, wedgeMessage,
      wedgePatterns, overshootPatterns,
      hasThreePushSignal, hasWedgePattern, hasOvershoot,
      trend, ctx,
    };
  }, [snapshot]);

  // ── 5. 信號 K 線強度評分 ─────────────────────────────────────────────────
  const signalBarAnalysis = useMemo(() => {
    if (!snapshot?.pa) return null;
    const tf4h = snapshot.pa.timeframes["4h"];
    if (!tf4h) return null;

    const patterns = tf4h.patterns ?? [];
    const highConfluence = tf4h.high_confluence_patterns ?? [];

    // 找最近的強勢信號 K 線
    const strongPatterns = patterns.filter(p => p.strength === "strong");
    const bestPattern    = strongPatterns[0] ?? patterns[0] ?? null;

    // 信號 K 線評分（方方土標準）：
    // 1. 實體大（strong = 高分）
    // 2. 收在極值（bullish 收在頂部，bearish 收在底部）
    // 3. 有高共振（high_confluence_patterns）
    let signalScore = 0;
    let signalGrade: "A+" | "A" | "B" | "C" | "無" = "無";
    let entryMethod = "";
    let signalDesc  = "";

    if (bestPattern) {
      if (bestPattern.strength === "strong") signalScore += 40;
      else if (bestPattern.strength === "medium") signalScore += 20;

      if (highConfluence.length > 0) signalScore += 30;
      if (tf4h.mtf_alignment > 70) signalScore += 20;
      if (tf4h.key_level_proximity < 1) signalScore += 10;

      if (signalScore >= 80) {
        signalGrade = "A+";
        entryMethod = "突破單（Stop Order）入場";
        signalDesc  = "A+ 信號：實體飽滿 + 高共振 + 多時間框架對齊，在信號 K 線外側掛突破單。";
      } else if (signalScore >= 60) {
        signalGrade = "A";
        entryMethod = "突破單（Stop Order）入場";
        signalDesc  = "良好信號：等待信號 K 線確認後，在其高/低點外側掛突破單。";
      } else if (signalScore >= 40) {
        signalGrade = "B";
        entryMethod = "謹慎突破單入場";
        signalDesc  = "中等信號：信號強度一般，需配合其他確認因素。";
      } else {
        signalGrade = "C";
        entryMethod = "觀望";
        signalDesc  = "信號強度不足，建議觀望等待更好的設置。";
      }
    }

    // TBTL（Two-Legged Pullback）：回調兩段後的第二入場點
    const hasTbtl = tf4h.trend_context !== "ranging" && patterns.some(p =>
      p.name.includes("回調") || p.name.includes("pullback") || p.name.toLowerCase().includes("retest")
    );

    return {
      bestPattern, signalScore, signalGrade, entryMethod, signalDesc,
      strongPatterns, highConfluence, hasTbtl,
      mtfAlignment: tf4h.mtf_alignment ?? 0,
      keyLevelProximity: tf4h.key_level_proximity ?? 0,
    };
  }, [snapshot]);

  // ─── 渲染 ─────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-[#555] text-sm">
        分析中...
      </div>
    );
  }

  if (!snapshot?.pa) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="text-3xl mb-3">📊</div>
        <div className="text-[#888] text-sm mb-1">尚未執行分析</div>
        <div className="text-[#555] text-xs">請先點擊「分析」按鈕取得 PA 資料</div>
      </div>
    );
  }

  const pa4h = snapshot.pa.timeframes["4h"];

  return (
    <div className="space-y-0 divide-y divide-[#1a1a1a]">

      {/* ── 頂部總覽 ── */}
      <div className="px-3 py-3" style={{ background: "#0a0a0a" }}>
        <div className="flex items-center justify-between mb-2">
          <div>
            <div className="text-[13px] font-bold text-[#ccc]">方方土 Price Action 分析</div>
            <div className="text-[10px] text-[#555]">Al Brooks 體系 · 80-20 規則 · Measured Move</div>
          </div>
          <div className="text-right">
            <div className="text-[10px] text-[#555]">PA 共識</div>
            <div className="text-[12px] font-bold" style={{
              color: snapshot.pa.consensus.includes("bullish") ? "#4caf50"
                : snapshot.pa.consensus.includes("bearish") ? "#ef5350" : "#ffd740"
            }}>
              {snapshot.pa.consensus === "strong_bullish" ? "強烈看多"
                : snapshot.pa.consensus === "bullish" ? "看多"
                : snapshot.pa.consensus === "bearish" ? "看空"
                : snapshot.pa.consensus === "strong_bearish" ? "強烈看空"
                : "中性"}
            </div>
          </div>
        </div>
        {/* 市場背景標籤 */}
        <div className="flex gap-2 flex-wrap">
          {pa4h && (
            <>
              <span className="text-[9px] px-2 py-0.5 rounded border" style={{
                borderColor: pa4h.trend_context === "strong_trend" ? "rgba(76,175,80,0.5)"
                  : pa4h.trend_context === "ranging" ? "rgba(255,215,64,0.5)" : "rgba(100,100,100,0.5)",
                color: pa4h.trend_context === "strong_trend" ? "#4caf50"
                  : pa4h.trend_context === "ranging" ? "#ffd740" : "#888",
              }}>
                {pa4h.trend_context === "strong_trend" ? "強趨勢" : pa4h.trend_context === "ranging" ? "震盪區間" : "弱趨勢"}
              </span>
              <span className="text-[9px] px-2 py-0.5 rounded border border-[#2a2a2a] text-[#666]">
                4H ADX: {pa4h.adx?.toFixed(1) ?? "—"}
              </span>
              <span className="text-[9px] px-2 py-0.5 rounded border border-[#2a2a2a] text-[#666]">
                MTF 對齊: {pa4h.mtf_alignment?.toFixed(0) ?? "—"}%
              </span>
            </>
          )}
        </div>
      </div>

      {/* ── 1. 80-20 假突破分析 ── */}
      <div>
        <SectionTitle
          icon="🎯"
          title="80-20 假突破分析"
          badge={falseBreakAnalysis ? <RiskBadge level={falseBreakAnalysis.riskLevel} /> : null}
        />
        <div className="px-3 py-2 space-y-1">
          {falseBreakAnalysis ? (
            <>
              <MetricRow
                label="假突破分數"
                value={`${falseBreakAnalysis.score.toFixed(0)}/100`}
                color={falseBreakAnalysis.score > 60 ? "#ef5350" : falseBreakAnalysis.score > 30 ? "#ffd740" : "#4caf50"}
              />
              <MetricRow
                label="方向"
                value={falseBreakAnalysis.dir === "bullish" ? "向上假突破" : falseBreakAnalysis.dir === "bearish" ? "向下假突破" : "無"}
                color={falseBreakAnalysis.dir === "bullish" ? "#4caf50" : falseBreakAnalysis.dir === "bearish" ? "#ef5350" : "#888"}
              />
              <MetricRow
                label="市場背景"
                value={falseBreakAnalysis.isRanging ? "震盪區間" : falseBreakAnalysis.isTrend ? "強趨勢" : "弱趨勢"}
                color={falseBreakAnalysis.isRanging ? "#ffd740" : "#4caf50"}
              />
              <MetricRow
                label="跟隨強度"
                value={falseBreakAnalysis.followThrough}
                color={falseBreakAnalysis.followThrough === "強" ? "#4caf50" : falseBreakAnalysis.followThrough === "弱" ? "#ffd740" : "#ef5350"}
              />
              <div className="mt-2 p-2 rounded text-[10px] text-[#aaa] leading-relaxed"
                style={{ background: "#111", border: "1px solid #1e1e1e" }}>
                <span className="text-[#ffd740] font-bold">{falseBreakAnalysis.ruleApplied}：</span>
                {falseBreakAnalysis.interpretation}
              </div>
              {/* 方方土核心提示 */}
              <div className="mt-1 p-2 rounded text-[9px] text-[#555]"
                style={{ background: "#0d0d0d", border: "1px solid #1a1a1a" }}>
                💡 方方土：真突破特徵 = 體積大 + 收在極值（無影線）+ 遠離前期區間 + 有「急迫感」（無回調）
              </div>
            </>
          ) : (
            <div className="py-3 text-center text-[#555] text-xs">無資料</div>
          )}
        </div>
      </div>

      {/* ── 2. 第二段陷阱偵測 ── */}
      <div>
        <SectionTitle
          icon="⚠️"
          title="第二段陷阱（2nd Leg Trap）"
          badge={secondLegTrap ? <RiskBadge level={secondLegTrap.trapRisk} /> : null}
        />
        <div className="px-3 py-2 space-y-1">
          {secondLegTrap ? (
            <>
              <MetricRow label="區間上沿（阻力）" value={secondLegTrap.resistance.toFixed(2)} color="#ef5350" />
              <MetricRow label="區間下沿（支撐）" value={secondLegTrap.support.toFixed(2)} color="#4caf50" />
              <MetricRow
                label="現價位置"
                value={`${secondLegTrap.positionPct}%`}
                sub={secondLegTrap.priceNearTop ? "接近頂部" : secondLegTrap.priceNearBot ? "接近底部" : "中部"}
                color={secondLegTrap.priceNearTop ? "#ef5350" : secondLegTrap.priceNearBot ? "#4caf50" : "#888"}
              />
              <MetricRow label="區間高度" value={secondLegTrap.rangeHeight.toFixed(2)} />
              <MetricRow label="方向判斷" value={secondLegTrap.trapDirection} color={
                secondLegTrap.trapRisk === "high" ? "#ef5350"
                  : secondLegTrap.trapRisk === "medium" ? "#ffd740" : "#888"
              } />
              <div className="mt-2 p-2 rounded text-[10px] text-[#aaa] leading-relaxed"
                style={{ background: "#111", border: "1px solid #1e1e1e" }}>
                {secondLegTrap.trapMessage}
              </div>
              {/* 強 SR 水位 */}
              {secondLegTrap.strongLevels.length > 0 && (
                <div className="mt-1">
                  <div className="text-[9px] text-[#555] mb-1">強力 S/R 水位（觸碰次數 ≥ 3）：</div>
                  {secondLegTrap.strongLevels.map((l, i) => (
                    <div key={i} className="flex justify-between text-[10px] py-0.5">
                      <span style={{ color: l.type === "support" ? "#4caf50" : "#ef5350" }}>
                        {l.type === "support" ? "▲ 支撐" : "▼ 阻力"} × {l.touches}
                      </span>
                      <span className="font-mono text-[#ccc]">{l.price.toFixed(2)}</span>
                      <span className="text-[#555]">{pctDist(currentPrice, l.price)}</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="mt-1 p-2 rounded text-[9px] text-[#555]"
                style={{ background: "#0d0d0d", border: "1px solid #1a1a1a" }}>
                💡 方方土：震盪區間中，第二段越強勢，陷阱越深。「Big Up, Big Down, Big Confusion」是 TR 的核心特徵。
              </div>
            </>
          ) : (
            <div className="py-3 text-center text-[#555] text-xs">無資料</div>
          )}
        </div>
      </div>

      {/* ── 3. Measured Move 止盈目標 ── */}
      <div>
        <SectionTitle icon="📏" title="Measured Move 止盈目標（60% 達成率）" />
        <div className="px-3 py-2 space-y-1">
          {measuredMoves ? (
            <>
              {/* 方法一：TR 高度突破 */}
              <div className="mb-2">
                <div className="text-[9px] text-[#555] mb-1 uppercase tracking-wider">方法一：TR 高度突破（最常用）</div>
                <div className="grid grid-cols-2 gap-1">
                  <div className="p-2 rounded text-center" style={{ background: "#0d1a0d", border: "1px solid #1a2a1a" }}>
                    <div className="text-[9px] text-[#4caf50] mb-0.5">看多目標 ↑</div>
                    <div className="text-[11px] font-mono text-[#4caf50]">{measuredMoves.mmTrBull.toFixed(2)}</div>
                    <div className="text-[9px] text-[#555]">{pctDist(currentPrice, measuredMoves.mmTrBull)}</div>
                  </div>
                  <div className="p-2 rounded text-center" style={{ background: "#1a0d0d", border: "1px solid #2a1a1a" }}>
                    <div className="text-[9px] text-[#ef5350] mb-0.5">看空目標 ↓</div>
                    <div className="text-[11px] font-mono text-[#ef5350]">{measuredMoves.mmTrBear.toFixed(2)}</div>
                    <div className="text-[9px] text-[#555]">{pctDist(currentPrice, measuredMoves.mmTrBear)}</div>
                  </div>
                </div>
                <div className="text-[9px] text-[#444] mt-0.5">TR 高度：{measuredMoves.trHeight.toFixed(2)}</div>
              </div>

              {/* 方法二：Leg1=Leg2 */}
              <div className="mb-2">
                <div className="text-[9px] text-[#555] mb-1 uppercase tracking-wider">方法二：Leg1 = Leg2（N 字形）</div>
                <div className="grid grid-cols-2 gap-1">
                  <div className="p-2 rounded text-center" style={{ background: "#0d1a0d", border: "1px solid #1a2a1a" }}>
                    <div className="text-[9px] text-[#4caf50] mb-0.5">看多目標 ↑</div>
                    <div className="text-[11px] font-mono text-[#4caf50]">{measuredMoves.mmLeg2Bull.toFixed(2)}</div>
                    <div className="text-[9px] text-[#555]">{pctDist(currentPrice, measuredMoves.mmLeg2Bull)}</div>
                  </div>
                  <div className="p-2 rounded text-center" style={{ background: "#1a0d0d", border: "1px solid #2a1a1a" }}>
                    <div className="text-[9px] text-[#ef5350] mb-0.5">看空目標 ↓</div>
                    <div className="text-[11px] font-mono text-[#ef5350]">{measuredMoves.mmLeg2Bear.toFixed(2)}</div>
                    <div className="text-[9px] text-[#555]">{pctDist(currentPrice, measuredMoves.mmLeg2Bear)}</div>
                  </div>
                </div>
                <div className="text-[9px] text-[#444] mt-0.5">第一段估算高度：{measuredMoves.leg1Height.toFixed(2)}</div>
              </div>

              {/* 方法三：突破 K 線實體 */}
              <div className="mb-2">
                <div className="text-[9px] text-[#555] mb-1 uppercase tracking-wider">方法三：突破 K 線實體（ATR × 2）</div>
                <div className="grid grid-cols-2 gap-1">
                  <div className="p-2 rounded text-center" style={{ background: "#0d1a0d", border: "1px solid #1a2a1a" }}>
                    <div className="text-[9px] text-[#4caf50] mb-0.5">看多目標 ↑</div>
                    <div className="text-[11px] font-mono text-[#4caf50]">{measuredMoves.mmBarBull.toFixed(2)}</div>
                    <div className="text-[9px] text-[#555]">{pctDist(currentPrice, measuredMoves.mmBarBull)}</div>
                  </div>
                  <div className="p-2 rounded text-center" style={{ background: "#1a0d0d", border: "1px solid #2a1a1a" }}>
                    <div className="text-[9px] text-[#ef5350] mb-0.5">看空目標 ↓</div>
                    <div className="text-[11px] font-mono text-[#ef5350]">{measuredMoves.mmBarBear.toFixed(2)}</div>
                    <div className="text-[9px] text-[#555]">{pctDist(currentPrice, measuredMoves.mmBarBear)}</div>
                  </div>
                </div>
              </div>

              {/* 主要目標 */}
              {measuredMoves.primaryTarget && (
                <div className="mt-2 p-2 rounded" style={{ background: "#111", border: "1px solid #1e1e1e" }}>
                  <div className="text-[9px] text-[#555] mb-1">當前偏向主要目標（{measuredMoves.primaryMethod}）</div>
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold" style={{
                      color: measuredMoves.isBullish ? "#4caf50" : "#ef5350"
                    }}>
                      {measuredMoves.primaryTarget.toFixed(2)}
                    </span>
                    <span className="text-[10px]" style={{
                      color: measuredMoves.isBullish ? "#4caf50" : "#ef5350"
                    }}>
                      {pctDist(currentPrice, measuredMoves.primaryTarget)}
                    </span>
                  </div>
                </div>
              )}

              <div className="mt-1 p-2 rounded text-[9px] text-[#555]"
                style={{ background: "#0d0d0d", border: "1px solid #1a1a1a" }}>
                💡 方方土：MM 只有 60% 達成率。為防止 Tick Failure，止盈單應掛在目標位稍微靠近現價的位置。
              </div>
            </>
          ) : (
            <div className="py-3 text-center text-[#555] text-xs">無資料</div>
          )}
        </div>
      </div>

      {/* ── 4. 楔形三推反轉 ── */}
      <div>
        <SectionTitle
          icon="🔺"
          title="楔形三推反轉（Wedge Reversal）"
          badge={wedgeAnalysis ? <RiskBadge level={wedgeAnalysis.wedgeRisk} /> : null}
        />
        <div className="px-3 py-2 space-y-1">
          {wedgeAnalysis ? (
            <>
              <MetricRow
                label="楔形形態"
                value={wedgeAnalysis.hasWedgePattern ? `偵測到（${wedgeAnalysis.wedgePatterns.length} 個）` : "未偵測到"}
                color={wedgeAnalysis.hasWedgePattern ? "#ffd740" : "#555"}
              />
              <MetricRow
                label="Overshoot 信號"
                value={wedgeAnalysis.hasOvershoot ? `偵測到（${wedgeAnalysis.overshootPatterns.length} 個）` : "未偵測到"}
                color={wedgeAnalysis.hasOvershoot ? "#ef5350" : "#555"}
              />
              <MetricRow
                label="三推衰竭"
                value={wedgeAnalysis.hasThreePushSignal ? "有衰竭信號" : "無"}
                color={wedgeAnalysis.hasThreePushSignal ? "#ffd740" : "#555"}
              />
              {wedgeAnalysis.overshootPatterns.length > 0 && (
                <div className="mt-1">
                  {wedgeAnalysis.overshootPatterns.slice(0, 2).map((p, i) => (
                    <div key={i} className="flex justify-between text-[10px] py-0.5">
                      <span style={{ color: p.type === "bullish" ? "#4caf50" : "#ef5350" }}>
                        {p.type === "bullish" ? "▲" : "▼"} {p.name}
                      </span>
                      <span className="text-[#666]">{p.strength === "strong" ? "強" : p.strength === "medium" ? "中" : "弱"}</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="mt-2 p-2 rounded text-[10px] text-[#aaa] leading-relaxed"
                style={{ background: "#111", border: "1px solid #1e1e1e" }}>
                {wedgeAnalysis.wedgeMessage}
              </div>
              <div className="mt-1 p-2 rounded text-[9px] text-[#555]"
                style={{ background: "#0d0d0d", border: "1px solid #1a1a1a" }}>
                💡 方方土：Overshoot = 第三推刺破趨勢通道線後迅速拉回，是楔形中最強的反轉信號。好的楔形特徵是推動與回調之間有較深的「重疊（Overlap）」。
              </div>
            </>
          ) : (
            <div className="py-3 text-center text-[#555] text-xs">無資料</div>
          )}
        </div>
      </div>

      {/* ── 5. 信號 K 線強度評分 ── */}
      <div>
        <SectionTitle
          icon="🕯️"
          title="信號 K 線強度評分"
          badge={signalBarAnalysis ? (
            <span className="text-[10px] px-2 py-0.5 rounded font-bold" style={{
              background: signalBarAnalysis.signalGrade === "A+" ? "#4caf50"
                : signalBarAnalysis.signalGrade === "A" ? "#66bb6a"
                : signalBarAnalysis.signalGrade === "B" ? "#ffd740"
                : signalBarAnalysis.signalGrade === "C" ? "#ef5350" : "#333",
              color: signalBarAnalysis.signalGrade === "B" ? "#000" : "#fff",
            }}>
              {signalBarAnalysis.signalGrade}
            </span>
          ) : null}
        />
        <div className="px-3 py-2 space-y-1">
          {signalBarAnalysis ? (
            <>
              <MetricRow
                label="信號評分"
                value={`${signalBarAnalysis.signalScore}/100`}
                color={signalBarAnalysis.signalScore >= 80 ? "#4caf50" : signalBarAnalysis.signalScore >= 60 ? "#ffd740" : "#ef5350"}
              />
              <MetricRow
                label="最強形態"
                value={signalBarAnalysis.bestPattern?.name ?? "無"}
                color={signalBarAnalysis.bestPattern?.type === "bullish" ? "#4caf50"
                  : signalBarAnalysis.bestPattern?.type === "bearish" ? "#ef5350" : "#888"}
                sub={signalBarAnalysis.bestPattern?.strength === "strong" ? "強" : signalBarAnalysis.bestPattern?.strength === "medium" ? "中" : "弱"}
              />
              <MetricRow
                label="MTF 對齊度"
                value={`${signalBarAnalysis.mtfAlignment.toFixed(0)}%`}
                color={signalBarAnalysis.mtfAlignment > 70 ? "#4caf50" : signalBarAnalysis.mtfAlignment > 40 ? "#ffd740" : "#ef5350"}
              />
              <MetricRow
                label="關鍵水位距離"
                value={`${signalBarAnalysis.keyLevelProximity.toFixed(2)}%`}
                color={signalBarAnalysis.keyLevelProximity < 1 ? "#4caf50" : "#888"}
              />
              <MetricRow
                label="高共振形態"
                value={`${signalBarAnalysis.highConfluence.length} 個`}
                color={signalBarAnalysis.highConfluence.length > 0 ? "#4caf50" : "#555"}
              />
              <MetricRow
                label="TBTL 回調機會"
                value={signalBarAnalysis.hasTbtl ? "有（第二入場點）" : "無"}
                color={signalBarAnalysis.hasTbtl ? "#ffd740" : "#555"}
              />
              <div className="mt-2 p-2 rounded" style={{ background: "#111", border: "1px solid #1e1e1e" }}>
                <div className="text-[9px] text-[#555] mb-1">建議入場方式</div>
                <div className="text-[10px] font-bold" style={{
                  color: signalBarAnalysis.signalGrade === "A+" ? "#4caf50"
                    : signalBarAnalysis.signalGrade === "A" ? "#66bb6a"
                    : signalBarAnalysis.signalGrade === "B" ? "#ffd740" : "#ef5350"
                }}>
                  {signalBarAnalysis.entryMethod}
                </div>
                <div className="text-[10px] text-[#aaa] mt-1 leading-relaxed">
                  {signalBarAnalysis.signalDesc}
                </div>
              </div>
              <div className="mt-1 p-2 rounded text-[9px] text-[#555]"
                style={{ background: "#0d0d0d", border: "1px solid #1a1a1a" }}>
                💡 方方土：信號 K 線 = 實體大 + 收在極值 + 突破單在外側掛單。TBTL（兩段回調）後的第二入場點勝率更高。
              </div>
            </>
          ) : (
            <div className="py-3 text-center text-[#555] text-xs">無資料</div>
          )}
        </div>
      </div>

      {/* ── 底部：PA 進場參數 ── */}
      {snapshot.pa.entry_params && "entry" in snapshot.pa.entry_params && (
        <div>
          <SectionTitle icon="🎯" title="PA 進場參數（方方土風格）" />
          <div className="px-3 py-2 space-y-1">
            <MetricRow
              label="方向"
              value={snapshot.pa.entry_params.direction === "long" ? "做多 ▲" : "做空 ▼"}
              color={snapshot.pa.entry_params.direction === "long" ? "#4caf50" : "#ef5350"}
            />
            <MetricRow label="進場位" value={snapshot.pa.entry_params.entry.toFixed(2)} color="#ccc" />
            <MetricRow label="止損位（信號K線另一端）" value={snapshot.pa.entry_params.sl.toFixed(2)} color="#ef5350" />
            <MetricRow label="TP1（MM 保守目標）" value={snapshot.pa.entry_params.tp1.toFixed(2)} color="#4caf50" />
            <MetricRow label="TP2（MM 延伸目標）" value={snapshot.pa.entry_params.tp2.toFixed(2)} color="#66bb6a" />
            <MetricRow
              label="盈虧比"
              value={`1 : ${snapshot.pa.entry_params.rr_ratio.toFixed(1)}`}
              color={snapshot.pa.entry_params.rr_ratio >= 2 ? "#4caf50" : snapshot.pa.entry_params.rr_ratio >= 1.5 ? "#ffd740" : "#ef5350"}
            />
            <div className="mt-1 p-2 rounded text-[9px] text-[#555]"
              style={{ background: "#0d0d0d", border: "1px solid #1a1a1a" }}>
              💡 方方土止損鐵律：止損設在信號 K 線另一端；絕不加倉攤平虧損；固定每筆風險 1-2%。
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
