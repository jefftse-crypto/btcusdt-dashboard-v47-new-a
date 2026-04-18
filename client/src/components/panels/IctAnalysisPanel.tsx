/**
 * IctAnalysisPanel — ICT 交易知識體系分析面板
 *
 * 設計哲學：深色儀表板風格，ICT 概念直接運用於當前市場資料
 * 核心理論來源：
 *   - TJR Trading（基礎市場結構）
 *   - DodgysDD iFVG 機械化模型
 *   - TTrades/GXT I2E/E2I 通用模型
 *   - Romeo CRT Model 1（蠟燭範圍理論）
 *   - MMXM Trader（造市商模型）
 *   - Zeussy AMD 算法時間理論
 */
import { useMemo } from "react";
import type { CryptoSnapshot } from "@shared/cryptoTypes";

interface Props {
  snapshot: CryptoSnapshot | null | undefined;
  currentPrice: number | null | undefined;
  isLoading?: boolean;
  timeframe?: string;
}

// ── AMD 時間窗口定義（Zeussy 90 分鐘週期，UTC 時間）──
// 倫敦盤：07:30-16:00 UTC；紐約盤：13:30-22:00 UTC
const AMD_WINDOWS = [
  // 倫敦盤
  { name: "倫敦累積", phase: "A", start: 7 * 60 + 30, end: 9 * 60,       color: "#4fc3f7", session: "London" },
  { name: "倫敦操縱", phase: "M", start: 9 * 60,       end: 10 * 60 + 30, color: "#ffd740", session: "London" },
  { name: "倫敦派發", phase: "D", start: 10 * 60 + 30, end: 12 * 60,      color: "#4caf50", session: "London" },
  // 紐約盤
  { name: "紐約累積", phase: "A", start: 13 * 60 + 30, end: 15 * 60,      color: "#4fc3f7", session: "New York" },
  { name: "紐約操縱", phase: "M", start: 15 * 60,      end: 16 * 60 + 30, color: "#ffd740", session: "New York" },
  { name: "紐約派發", phase: "D", start: 16 * 60 + 30, end: 18 * 60,      color: "#4caf50", session: "New York" },
  // 亞洲盤（清掃流動性）
  { name: "亞洲累積", phase: "A", start: 0 * 60,        end: 1 * 60 + 30,  color: "#4fc3f7", session: "Asia" },
  { name: "亞洲操縱", phase: "M", start: 1 * 60 + 30,  end: 3 * 60,       color: "#ffd740", session: "Asia" },
  { name: "亞洲派發", phase: "D", start: 3 * 60,        end: 4 * 60 + 30,  color: "#4caf50", session: "Asia" },
];

function getCurrentAmdPhase() {
  const now = new Date();
  const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const current = AMD_WINDOWS.find(w => utcMinutes >= w.start && utcMinutes < w.end);
  const next = AMD_WINDOWS.find(w => w.start > utcMinutes);
  return { current, next, utcMinutes };
}

function formatUtcTime(minutes: number) {
  const h = Math.floor(minutes / 60).toString().padStart(2, "0");
  const m = (minutes % 60).toString().padStart(2, "0");
  return `${h}:${m} UTC`;
}

// ── iFVG 偵測邏輯 ──
// iFVG = 原本的 FVG 被後續 K 線實體完全穿越後反轉
// 在 dashboard 中，我們用 FVG.filled === true 來近似表示 iFVG
function detectIFvg(snapshot: CryptoSnapshot | null | undefined) {
  if (!snapshot?.smc) return { bullIfvg: null, bearIfvg: null };
  const fvgs = snapshot.smc.fvgs ?? [];
  // filled FVG = 已被穿越 = 潛在 iFVG
  const filledBull = fvgs.filter(f => f.type === "bullish" && f.filled);
  const filledBear = fvgs.filter(f => f.type === "bearish" && f.filled);
  // 最近的 filled FVG 即為最新 iFVG
  const bullIfvg = filledBull.length > 0 ? filledBull[filledBull.length - 1] : null;
  const bearIfvg = filledBear.length > 0 ? filledBear[filledBear.length - 1] : null;
  return { bullIfvg, bearIfvg };
}

// ── I2E / E2I 模型判斷 ──
// I2E（內部到外部）：價格在 FVG（IRL）附近 → 預期推向前高/低（ERL）
// E2I（外部到內部）：價格剛掃過前高/低（ERL）→ 預期回撤至 FVG（IRL）
function detectI2eE2i(snapshot: CryptoSnapshot | null | undefined, currentPrice: number | null | undefined) {
  if (!snapshot?.smc || !currentPrice) return null;
  const smc = snapshot.smc;
  const nearBullFvg = smc.nearest_bull_fvg;
  const nearBearFvg = smc.nearest_bear_fvg;
  const nearestSell = smc.liquidity?.nearest_sell ?? 0;
  const nearestBuy  = smc.liquidity?.nearest_buy ?? 0;

  // 判斷價格相對 FVG 的距離
  const distToBullFvg = nearBullFvg ? Math.abs(currentPrice - nearBullFvg.mid) / currentPrice * 100 : 999;
  const distToBearFvg = nearBearFvg ? Math.abs(currentPrice - nearBearFvg.mid) / currentPrice * 100 : 999;
  const distToSell    = nearestSell > 0 ? Math.abs(currentPrice - nearestSell) / currentPrice * 100 : 999;
  const distToBuy     = nearestBuy  > 0 ? Math.abs(currentPrice - nearestBuy)  / currentPrice * 100 : 999;

  // 是否剛掃過流動性（距離 < 0.5%）
  const justSweptSell = distToSell < 0.5;
  const justSweptBuy  = distToBuy  < 0.5;

  if (justSweptSell) {
    return {
      model: "E2I",
      direction: "bearish",
      desc: "價格剛掃過 BSL（買方流動性），預期 E2I 回撤至 FVG（IRL）",
      target: nearBearFvg ? `目標 FVG 區間：${nearBearFvg.bottom.toFixed(2)} – ${nearBearFvg.top.toFixed(2)}` : "尋找最近看跌 FVG",
      confidence: "高",
    };
  }
  if (justSweptBuy) {
    return {
      model: "E2I",
      direction: "bullish",
      desc: "價格剛掃過 SSL（賣方流動性），預期 E2I 回撤至 FVG（IRL）",
      target: nearBullFvg ? `目標 FVG 區間：${nearBullFvg.bottom.toFixed(2)} – ${nearBullFvg.top.toFixed(2)}` : "尋找最近看漲 FVG",
      confidence: "高",
    };
  }
  // 在 FVG 附近（< 1%）
  if (distToBullFvg < 1.0 && smc.structure === "bullish") {
    return {
      model: "I2E",
      direction: "bullish",
      desc: "價格在看漲 FVG（IRL）附近，預期 I2E 推向 BSL（ERL）",
      target: nearestSell > 0 ? `目標 BSL：${nearestSell.toFixed(2)}` : "尋找最近 BSL",
      confidence: "中",
    };
  }
  if (distToBearFvg < 1.0 && smc.structure === "bearish") {
    return {
      model: "I2E",
      direction: "bearish",
      desc: "價格在看跌 FVG（IRL）附近，預期 I2E 推向 SSL（ERL）",
      target: nearestBuy > 0 ? `目標 SSL：${nearestBuy.toFixed(2)}` : "尋找最近 SSL",
      confidence: "中",
    };
  }
  return null;
}

// ── CRT Model 1 偵測 ──
// 假突破 = 影線刺穿舊高/低，但實體未收盤在外
// 用近期 BOS/CHoCH 資料近似：若有 CHoCH 且方向與結構一致，代表假突破已被確認
function detectCrtModel1(snapshot: CryptoSnapshot | null | undefined, currentPrice: number | null | undefined) {
  if (!snapshot?.smc || !currentPrice) return null;
  const smc = snapshot.smc;
  const bosChochs = smc.bos_choch ?? [];
  // 找最近的 CHoCH（結構轉換 = CRT 假突破確認）
  const recentChoch = [...bosChochs].reverse().find(b => b.type === "CHoCH" || b.type === "MSS");
  if (!recentChoch) return null;

  const isBull = recentChoch.direction === "bullish";
  const swingHigh = smc.recent_swing_high;
  const swingLow  = smc.recent_swing_low;

  // CRT Model 1 看漲：假突破舊低 + CHoCH 向上確認
  if (isBull && swingLow) {
    const distToLow = Math.abs(currentPrice - swingLow) / currentPrice * 100;
    return {
      direction: "bullish",
      trigger: `CHoCH 看漲確認 @ ${recentChoch.level.toFixed(2)}`,
      stab: `假突破舊低 ${swingLow.toFixed(2)}（誘空蠟燭）`,
      entry: `等待實體收盤突破 CHoCH 水位（${recentChoch.level.toFixed(2)}）後做多`,
      sl: `止損設在最低點 ${swingLow.toFixed(2)} 之下`,
      tp: `目標：上方舊高 ${swingHigh?.toFixed(2) ?? "N/A"}`,
      distPct: distToLow.toFixed(2),
      status: distToLow < 2 ? "active" : "watching",
    };
  }
  // CRT Model 1 看跌：假突破舊高 + CHoCH 向下確認
  if (!isBull && swingHigh) {
    const distToHigh = Math.abs(currentPrice - swingHigh) / currentPrice * 100;
    return {
      direction: "bearish",
      trigger: `CHoCH 看跌確認 @ ${recentChoch.level.toFixed(2)}`,
      stab: `假突破舊高 ${swingHigh.toFixed(2)}（誘多蠟燭）`,
      entry: `等待實體收盤跌破 CHoCH 水位（${recentChoch.level.toFixed(2)}）後做空`,
      sl: `止損設在最高點 ${swingHigh.toFixed(2)} 之上`,
      tp: `目標：下方舊低 ${swingLow?.toFixed(2) ?? "N/A"}`,
      distPct: distToHigh.toFixed(2),
      status: distToHigh < 2 ? "active" : "watching",
    };
  }
  return null;
}

// ── MMXM 造市商模型階段判斷 ──
function detectMmxmPhase(snapshot: CryptoSnapshot | null | undefined, currentPrice: number | null | undefined) {
  if (!snapshot?.smc || !currentPrice) return null;
  const smc = snapshot.smc;
  const pd = smc.premium_discount;
  if (!pd) return null;

  const zone = pd.current_zone;
  const pos  = pd.percent_position; // 0=最低, 100=最高
  const structure = smc.structure;

  // MMBM（造市商買入模型）：在折價區（Discount）
  if (zone === "discount" && pos < 30) {
    return {
      model: "MMBM",
      phase: structure === "bullish" ? "Accumulation 2 (Silver Bullet)" : "SMR 聰明錢反轉區",
      desc: structure === "bullish"
        ? "價格在折價區且結構看漲 → 可能是 MMBM 右側「銀彈」機會（Accumulation 2）"
        : "價格在折價區但結構看跌 → 可能是 MMBM 底部 SMR 建倉區",
      action: "在緩解塊（Mitigation Block）內尋找新形成的 FVG，兩者重合即為高勝率進場點",
      color: "#4caf50",
    };
  }
  // MMSM（造市商賣出模型）：在溢價區（Premium）
  if (zone === "premium" && pos > 70) {
    return {
      model: "MMSM",
      phase: structure === "bearish" ? "Distribution 2 (Silver Bullet)" : "SMR 聰明錢反轉區",
      desc: structure === "bearish"
        ? "價格在溢價區且結構看跌 → 可能是 MMSM 右側「銀彈」機會（Distribution 2）"
        : "價格在溢價區但結構看漲 → 可能是 MMSM 頂部 SMR 派發區",
      action: "在緩解塊（Mitigation Block）內尋找新形成的看跌 FVG，兩者重合即為高勝率做空點",
      color: "#ef5350",
    };
  }
  // 中間區域
  return {
    model: zone === "equilibrium" ? "均衡觀望" : zone === "discount" ? "MMBM 左側" : "MMSM 左側",
    phase: `均衡點位置：${pos.toFixed(0)}%`,
    desc: zone === "equilibrium"
      ? "價格在均衡點附近，方向不明確，等待突破"
      : zone === "discount"
      ? "價格在折價區，機構可能正在左側建立多頭頭寸（曲線賣方階段）"
      : "價格在溢價區，機構可能正在左側建立空頭頭寸（曲線買方階段）",
    action: "觀望，等待 SMR 信號或結構確認後再尋找進場機會",
    color: "#888",
  };
}

// ── iFVG 進場信號評分 ──
function scoreIfvgSetup(snapshot: CryptoSnapshot | null | undefined, currentPrice: number | null | undefined) {
  if (!snapshot?.smc || !currentPrice) return null;
  const smc = snapshot.smc;
  let score = 0;
  const reasons: string[] = [];

  // 1. 流動性清掃確認（+30分）
  const liqLevels = smc.liquidity_levels ?? [];
  const recentSwept = liqLevels.filter(l => l.swept);
  if (recentSwept.length > 0) {
    score += 30;
    reasons.push(`✓ 流動性清掃確認（${recentSwept.length} 個水位已清掃）`);
  } else {
    reasons.push("✗ 尚未偵測到流動性清掃");
  }

  // 2. iFVG 存在（+25分）
  const fvgs = smc.fvgs ?? [];
  const filledFvgs = fvgs.filter(f => f.filled);
  if (filledFvgs.length > 0) {
    score += 25;
    reasons.push(`✓ iFVG 已形成（${filledFvgs.length} 個 FVG 已被穿越反轉）`);
  } else {
    reasons.push("✗ 尚未偵測到 iFVG（等待 FVG 被實體收盤穿越）");
  }

  // 3. CHoCH 結構確認（+25分）
  const bosChochs = smc.bos_choch ?? [];
  const hasChoch = bosChochs.some(b => b.type === "CHoCH" || b.type === "MSS");
  if (hasChoch) {
    score += 25;
    reasons.push("✓ CHoCH 結構轉換已確認");
  } else {
    reasons.push("✗ 尚未出現 CHoCH（等待結構轉換確認）");
  }

  // 4. Premium/Discount 區間正確（+20分）
  const pd = smc.premium_discount;
  const structure = smc.structure;
  if (pd) {
    const inCorrectZone = (structure === "bullish" && pd.current_zone === "discount") ||
                          (structure === "bearish" && pd.current_zone === "premium");
    if (inCorrectZone) {
      score += 20;
      reasons.push(`✓ 在正確的 ${pd.current_zone === "discount" ? "折價" : "溢價"} 區間進場`);
    } else {
      reasons.push(`⚠ 在 ${pd.current_zone === "equilibrium" ? "均衡" : pd.current_zone === "discount" ? "折價" : "溢價"} 區間，${structure === "bullish" ? "做多應在折價區" : "做空應在溢價區"}`);
    }
  }

  const grade = score >= 80 ? "A+" : score >= 60 ? "A" : score >= 40 ? "B" : "C";
  const gradeColor = score >= 80 ? "#4caf50" : score >= 60 ? "#8bc34a" : score >= 40 ? "#ffd740" : "#ef5350";

  return { score, grade, gradeColor, reasons };
}

export function IctAnalysisPanel({ snapshot, currentPrice, isLoading, timeframe = "1h" }: Props) {
  const amd = useMemo(() => getCurrentAmdPhase(), []);
  const { bullIfvg, bearIfvg } = useMemo(() => detectIFvg(snapshot), [snapshot]);
  const i2eE2i = useMemo(() => detectI2eE2i(snapshot, currentPrice), [snapshot, currentPrice]);
  const crtModel1 = useMemo(() => detectCrtModel1(snapshot, currentPrice), [snapshot, currentPrice]);
  const mmxm = useMemo(() => detectMmxmPhase(snapshot, currentPrice), [snapshot, currentPrice]);
  const ifvgScore = useMemo(() => scoreIfvgSetup(snapshot, currentPrice), [snapshot, currentPrice]);

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="rounded-lg h-20 animate-pulse" style={{ background: "#111" }} />
        ))}
      </div>
    );
  }

  if (!snapshot) {
    return (
      <div className="rounded-lg p-6 text-center" style={{ background: "#111", border: "1px solid #1e1e1e" }}>
        <div className="text-[#555] text-sm">請先選擇幣種並執行分析</div>
      </div>
    );
  }

  const smc = snapshot.smc;
  const structure = smc?.structure ?? "ranging";
  const structureColor = structure === "bullish" ? "#4caf50" : structure === "bearish" ? "#ef5350" : "#ffd740";

  return (
    <div className="space-y-3">
      {/* ── 標題列 ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-[#e6e6e6]">ICT 交易框架分析</span>
          <span className="text-[9px] px-1.5 py-0.5 rounded font-mono" style={{ background: "#1e1e1e", color: "#555", border: "1px solid #2a2a2a" }}>
            {timeframe.toUpperCase()}
          </span>
        </div>
        <span className="text-[9px] font-semibold px-2 py-0.5 rounded" style={{ background: `${structureColor}15`, color: structureColor, border: `1px solid ${structureColor}30` }}>
          {structure === "bullish" ? "▲ 看漲結構" : structure === "bearish" ? "▼ 看跌結構" : "◆ 盤整"}
        </span>
      </div>

      {/* ── Section 1：iFVG 機械化模型評分（DodgysDD）── */}
      <div className="rounded-lg overflow-hidden" style={{ background: "#0d0d0d", border: "1px solid #1e1e1e" }}>
        <div className="px-3 py-2 flex items-center justify-between" style={{ background: "#111", borderBottom: "1px solid #1e1e1e" }}>
          <span className="text-[11px] font-semibold text-[#888]">① iFVG 機械化模型評分</span>
          <span className="text-[9px] text-[#555]">DodgysDD 方法論</span>
        </div>
        {ifvgScore ? (
          <div className="p-3">
            <div className="flex items-center gap-3 mb-3">
              <div className="text-center">
                <div className="text-2xl font-bold font-mono" style={{ color: ifvgScore.gradeColor }}>{ifvgScore.grade}</div>
                <div className="text-[9px] text-[#555]">評級</div>
              </div>
              <div className="text-center">
                <div className="text-xl font-bold font-mono" style={{ color: ifvgScore.gradeColor }}>{ifvgScore.score}</div>
                <div className="text-[9px] text-[#555]">/ 100</div>
              </div>
              <div className="flex-1">
                <div className="w-full rounded-full h-2 overflow-hidden" style={{ background: "#1e1e1e" }}>
                  <div className="h-full rounded-full transition-all" style={{ width: `${ifvgScore.score}%`, background: ifvgScore.gradeColor }} />
                </div>
                <div className="text-[9px] text-[#555] mt-1">
                  {ifvgScore.score >= 80 ? "A+ 級：可考慮進場（流動性清掃 + iFVG + CHoCH 三重確認）"
                    : ifvgScore.score >= 60 ? "A 級：條件基本具備，注意風險管理"
                    : ifvgScore.score >= 40 ? "B 級：部分條件缺失，建議觀望"
                    : "C 級：條件不足，等待更多確認"}
                </div>
              </div>
            </div>
            <div className="space-y-1">
              {ifvgScore.reasons.map((r, i) => (
                <div key={i} className="text-[10px] leading-relaxed" style={{ color: r.startsWith("✓") ? "#4caf50" : r.startsWith("✗") ? "#ef5350" : "#ffd740" }}>
                  {r}
                </div>
              ))}
            </div>
            {/* iFVG 詳情 */}
            {(bullIfvg || bearIfvg) && (
              <div className="mt-2 pt-2 border-t border-[#1e1e1e] grid grid-cols-2 gap-2">
                {bullIfvg && (
                  <div className="rounded p-2" style={{ background: "rgba(76,175,80,0.06)", border: "1px solid rgba(76,175,80,0.2)" }}>
                    <div className="text-[9px] font-bold text-green-500 mb-1">iFVG 看漲（支撐）</div>
                    <div className="text-[9px] font-mono text-[#888]">{bullIfvg.bottom.toFixed(2)} – {bullIfvg.top.toFixed(2)}</div>
                    <div className="text-[9px] text-[#555]">中點：{bullIfvg.mid.toFixed(2)}</div>
                  </div>
                )}
                {bearIfvg && (
                  <div className="rounded p-2" style={{ background: "rgba(239,83,80,0.06)", border: "1px solid rgba(239,83,80,0.2)" }}>
                    <div className="text-[9px] font-bold text-red-400 mb-1">iFVG 看跌（阻力）</div>
                    <div className="text-[9px] font-mono text-[#888]">{bearIfvg.bottom.toFixed(2)} – {bearIfvg.top.toFixed(2)}</div>
                    <div className="text-[9px] text-[#555]">中點：{bearIfvg.mid.toFixed(2)}</div>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="p-3 text-[10px] text-[#555]">資料不足，無法評分</div>
        )}
      </div>

      {/* ── Section 2：TTrades I2E / E2I 通用模型 ── */}
      <div className="rounded-lg overflow-hidden" style={{ background: "#0d0d0d", border: "1px solid #1e1e1e" }}>
        <div className="px-3 py-2 flex items-center justify-between" style={{ background: "#111", borderBottom: "1px solid #1e1e1e" }}>
          <span className="text-[11px] font-semibold text-[#888]">② TTrades I2E / E2I 通用模型</span>
          <span className="text-[9px] text-[#555]">GXT 框架</span>
        </div>
        <div className="p-3">
          {i2eE2i ? (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm font-bold font-mono" style={{ color: i2eE2i.direction === "bullish" ? "#4caf50" : "#ef5350" }}>
                  {i2eE2i.model}
                </span>
                <span className="text-[9px] px-1.5 py-0.5 rounded" style={{
                  background: i2eE2i.confidence === "高" ? "rgba(76,175,80,0.1)" : "rgba(255,215,64,0.1)",
                  color: i2eE2i.confidence === "高" ? "#4caf50" : "#ffd740",
                  border: `1px solid ${i2eE2i.confidence === "高" ? "rgba(76,175,80,0.3)" : "rgba(255,215,64,0.3)"}`,
                }}>
                  信心：{i2eE2i.confidence}
                </span>
              </div>
              <div className="text-[10px] text-[#aaa] leading-relaxed mb-2">{i2eE2i.desc}</div>
              <div className="text-[10px] font-mono rounded p-2" style={{ background: "#111", color: i2eE2i.direction === "bullish" ? "#4caf50" : "#ef5350" }}>
                🎯 {i2eE2i.target}
              </div>
              <div className="mt-2 text-[9px] text-[#555] leading-relaxed">
                {i2eE2i.model === "I2E"
                  ? "IRL→ERL：從內部流動性（FVG）出發，推向外部流動性（前高/前低）"
                  : "ERL→IRL：從外部流動性（前高/前低）清掃後，回撤至內部流動性（FVG）"}
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="text-[10px] text-[#555]">當前價格未觸及關鍵 IRL/ERL 水位，等待明確訊號</div>
              <div className="grid grid-cols-2 gap-2 text-[9px]">
                <div className="rounded p-2" style={{ background: "#111", border: "1px solid #1e1e1e" }}>
                  <div className="text-[#4fc3f7] font-bold mb-1">I2E 觸發條件</div>
                  <div className="text-[#555]">價格回測 FVG（IRL）後反轉，推向前高/低（ERL）</div>
                </div>
                <div className="rounded p-2" style={{ background: "#111", border: "1px solid #1e1e1e" }}>
                  <div className="text-[#ffd740] font-bold mb-1">E2I 觸發條件</div>
                  <div className="text-[#555]">價格掃過前高/低（ERL）後反轉，回撤至 FVG（IRL）</div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Section 3：CRT Model 1 假突破偵測（Romeo）── */}
      <div className="rounded-lg overflow-hidden" style={{ background: "#0d0d0d", border: "1px solid #1e1e1e" }}>
        <div className="px-3 py-2 flex items-center justify-between" style={{ background: "#111", borderBottom: "1px solid #1e1e1e" }}>
          <span className="text-[11px] font-semibold text-[#888]">③ CRT Model 1 假突破偵測</span>
          <span className="text-[9px] text-[#555]">Romeo 蠟燭範圍理論</span>
        </div>
        <div className="p-3">
          {crtModel1 ? (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[10px] font-bold" style={{ color: crtModel1.direction === "bullish" ? "#4caf50" : "#ef5350" }}>
                  {crtModel1.direction === "bullish" ? "▲ 看漲 Model 1" : "▼ 看跌 Model 1"}
                </span>
                <span className="text-[9px] px-1.5 py-0.5 rounded" style={{
                  background: crtModel1.status === "active" ? "rgba(76,175,80,0.1)" : "rgba(255,215,64,0.1)",
                  color: crtModel1.status === "active" ? "#4caf50" : "#ffd740",
                  border: `1px solid ${crtModel1.status === "active" ? "rgba(76,175,80,0.3)" : "rgba(255,215,64,0.3)"}`,
                }}>
                  {crtModel1.status === "active" ? "⚡ 活躍" : "👁 觀察中"}
                </span>
              </div>
              <div className="space-y-1.5 text-[10px]">
                <div className="flex gap-2">
                  <span className="text-[#555] w-12 shrink-0">刺穿</span>
                  <span className="text-[#aaa]">{crtModel1.stab}</span>
                </div>
                <div className="flex gap-2">
                  <span className="text-[#555] w-12 shrink-0">觸發</span>
                  <span className="text-[#ffd740]">{crtModel1.trigger}</span>
                </div>
                <div className="flex gap-2">
                  <span className="text-[#555] w-12 shrink-0">進場</span>
                  <span className="text-[#4caf50]">{crtModel1.entry}</span>
                </div>
                <div className="flex gap-2">
                  <span className="text-[#555] w-12 shrink-0">止損</span>
                  <span className="text-[#ef5350]">{crtModel1.sl}</span>
                </div>
                <div className="flex gap-2">
                  <span className="text-[#555] w-12 shrink-0">目標</span>
                  <span className="text-[#4fc3f7]">{crtModel1.tp}</span>
                </div>
              </div>
              <div className="mt-2 text-[9px] text-[#444] rounded p-2" style={{ background: "#111" }}>
                CRT 核心：假突破（刺穿舊高/低）→ 誘餌蠟燭 → 實體收盤吞沒（觸發）→ 跟隨做市商真實意圖
              </div>
            </div>
          ) : (
            <div className="text-[10px] text-[#555] space-y-1">
              <div>尚未偵測到 CRT Model 1 假突破形態</div>
              <div className="text-[9px] text-[#444]">等待：刺穿舊高/低 → 誘餌蠟燭 → 實體收盤吞沒確認</div>
            </div>
          )}
        </div>
      </div>

      {/* ── Section 4：MMXM 造市商模型階段（MMXM Trader）── */}
      <div className="rounded-lg overflow-hidden" style={{ background: "#0d0d0d", border: "1px solid #1e1e1e" }}>
        <div className="px-3 py-2 flex items-center justify-between" style={{ background: "#111", borderBottom: "1px solid #1e1e1e" }}>
          <span className="text-[11px] font-semibold text-[#888]">④ MMXM 造市商模型階段</span>
          <span className="text-[9px] text-[#555]">MMXM Trader</span>
        </div>
        <div className="p-3">
          {mmxm ? (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[10px] font-bold font-mono" style={{ color: mmxm.color }}>{mmxm.model}</span>
                <span className="text-[9px] text-[#888]">{mmxm.phase}</span>
              </div>
              <div className="text-[10px] text-[#aaa] leading-relaxed mb-2">{mmxm.desc}</div>
              <div className="rounded p-2 text-[9px]" style={{ background: "#111", border: `1px solid ${mmxm.color}20`, color: mmxm.color }}>
                💡 {mmxm.action}
              </div>
              {/* Premium/Discount 視覺化 */}
              {smc?.premium_discount && (
                <div className="mt-2">
                  <div className="flex justify-between text-[9px] text-[#555] mb-1">
                    <span>SSL（折價）</span>
                    <span>均衡點 50%</span>
                    <span>BSL（溢價）</span>
                  </div>
                  <div className="relative w-full h-3 rounded-full overflow-hidden" style={{ background: "#1e1e1e" }}>
                    <div className="absolute left-0 top-0 h-full rounded-l-full" style={{ width: "50%", background: "linear-gradient(to right, rgba(79,195,247,0.3), rgba(79,195,247,0.1))" }} />
                    <div className="absolute right-0 top-0 h-full rounded-r-full" style={{ width: "50%", background: "linear-gradient(to left, rgba(239,83,80,0.3), rgba(239,83,80,0.1))" }} />
                    <div className="absolute top-0 h-full w-1 rounded" style={{ left: `${smc.premium_discount.percent_position}%`, background: "#ffd740", transform: "translateX(-50%)" }} />
                  </div>
                  <div className="text-[9px] text-center mt-1" style={{ color: mmxm.color }}>
                    當前位置：{smc.premium_discount.percent_position.toFixed(0)}%（{smc.premium_discount.current_zone === "discount" ? "折價區" : smc.premium_discount.current_zone === "premium" ? "溢價區" : "均衡區"}）
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="text-[10px] text-[#555]">資料不足</div>
          )}
        </div>
      </div>

      {/* ── Section 5：Zeussy AMD 算法時間窗口 ── */}
      <div className="rounded-lg overflow-hidden" style={{ background: "#0d0d0d", border: "1px solid #1e1e1e" }}>
        <div className="px-3 py-2 flex items-center justify-between" style={{ background: "#111", borderBottom: "1px solid #1e1e1e" }}>
          <span className="text-[11px] font-semibold text-[#888]">⑤ Zeussy AMD 算法時間窗口</span>
          <span className="text-[9px] text-[#555]">時間大於價格</span>
        </div>
        <div className="p-3">
          {amd.current ? (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <div className="w-2 h-2 rounded-full animate-pulse" style={{ background: amd.current.color }} />
                <span className="text-sm font-bold" style={{ color: amd.current.color }}>{amd.current.name}</span>
                <span className="text-[9px] text-[#555]">（{amd.current.session} 盤）</span>
              </div>
              <div className="grid grid-cols-3 gap-2 mb-2 text-center">
                {(["A", "M", "D"] as const).map(phase => {
                  const phaseInfo = { A: { label: "累積", desc: "機構悄悄建倉", color: "#4fc3f7" }, M: { label: "操縱", desc: "故意清掃流動性", color: "#ffd740" }, D: { label: "派發", desc: "真正方向性行情", color: "#4caf50" } }[phase];
                  const isActive = amd.current?.phase === phase;
                  return (
                    <div key={phase} className="rounded p-2" style={{ background: isActive ? `${phaseInfo.color}15` : "#111", border: `1px solid ${isActive ? phaseInfo.color + "40" : "#1e1e1e"}` }}>
                      <div className="text-[10px] font-bold" style={{ color: isActive ? phaseInfo.color : "#555" }}>{phaseInfo.label}</div>
                      <div className="text-[9px] mt-0.5" style={{ color: isActive ? "#aaa" : "#333" }}>{phaseInfo.desc}</div>
                    </div>
                  );
                })}
              </div>
              <div className="text-[9px] text-[#555] leading-relaxed">
                {amd.current.phase === "A" && "📌 累積階段：機構正在悄悄建倉，避免追漲殺跌，等待操縱訊號"}
                {amd.current.phase === "M" && "⚠️ 操縱階段：機構正在清掃流動性（Turtle Soup），不要被假突破欺騙！等待 CSD 確認後才進場"}
                {amd.current.phase === "D" && "🚀 派發階段：真實方向行情，此時進場勝率最高，可配合 iFVG 或 CRT Model 1 執行"}
              </div>
              <div className="mt-2 text-[9px] rounded p-1.5" style={{ background: "#111", color: "#444" }}>
                窗口：{formatUtcTime(amd.current.start)} – {formatUtcTime(amd.current.end)} UTC
                {amd.next && ` | 下一階段：${amd.next.name} @ ${formatUtcTime(amd.next.start)} UTC`}
              </div>
            </div>
          ) : (
            <div>
              <div className="text-[10px] text-[#555] mb-2">當前不在主要交易時間窗口（{formatUtcTime(amd.utcMinutes)} UTC）</div>
              <div className="grid grid-cols-3 gap-1 text-[9px]">
                {AMD_WINDOWS.slice(0, 3).map(w => (
                  <div key={w.name} className="rounded p-1.5" style={{ background: "#111", border: "1px solid #1e1e1e" }}>
                    <div style={{ color: w.color }} className="font-bold">{w.name}</div>
                    <div className="text-[#444]">{formatUtcTime(w.start)}–{formatUtcTime(w.end)}</div>
                  </div>
                ))}
              </div>
              {amd.next && (
                <div className="mt-2 text-[9px] text-[#555]">
                  下一個窗口：<span style={{ color: amd.next.color }}>{amd.next.name}</span> @ {formatUtcTime(amd.next.start)} UTC
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Section 6：ICT 進場條件總覽 ── */}
      <div className="rounded-lg overflow-hidden" style={{ background: "#0d0d0d", border: "1px solid #1e1e1e" }}>
        <div className="px-3 py-2" style={{ background: "#111", borderBottom: "1px solid #1e1e1e" }}>
          <span className="text-[11px] font-semibold text-[#888]">⑥ ICT 進場條件總覽</span>
        </div>
        <div className="p-3 space-y-1.5">
          {[
            {
              label: "時間窗口正確（AMD 派發階段）",
              passed: amd.current?.phase === "D",
              note: amd.current ? `當前：${amd.current.name}` : "非主要時間窗口",
            },
            {
              label: "流動性清掃確認（ERL 已被掃取）",
              passed: (smc?.liquidity_levels ?? []).some(l => l.swept),
              note: `已清掃：${(smc?.liquidity_levels ?? []).filter(l => l.swept).length} 個水位`,
            },
            {
              label: "iFVG 形成（FVG 被實體收盤穿越）",
              passed: (smc?.fvgs ?? []).some(f => f.filled),
              note: `已形成：${(smc?.fvgs ?? []).filter(f => f.filled).length} 個 iFVG`,
            },
            {
              label: "CHoCH 結構轉換確認",
              passed: (smc?.bos_choch ?? []).some(b => b.type === "CHoCH" || b.type === "MSS"),
              note: (smc?.bos_choch ?? []).find(b => b.type === "CHoCH")?.level.toFixed(2) ?? "未偵測到",
            },
            {
              label: "在正確 Premium/Discount 區間",
              passed: smc?.premium_discount
                ? (structure === "bullish" && smc.premium_discount.current_zone === "discount") ||
                  (structure === "bearish" && smc.premium_discount.current_zone === "premium")
                : false,
              note: smc?.premium_discount ? `${smc.premium_discount.current_zone}（${smc.premium_discount.percent_position.toFixed(0)}%）` : "N/A",
            },
            {
              label: "OB 未被測試（進場品質良好）",
              passed: (() => {
                const obs = smc?.order_blocks ?? [];
                const nearOb = structure === "bullish"
                  ? smc?.nearest_bull_ob
                  : smc?.nearest_bear_ob;
                return nearOb ? !nearOb.tested : obs.some(o => !o.tested);
              })(),
              note: (() => {
                const nearOb = structure === "bullish" ? smc?.nearest_bull_ob : smc?.nearest_bear_ob;
                return nearOb ? `最近 OB：${nearOb.bottom.toFixed(2)}–${nearOb.top.toFixed(2)}${nearOb.tested ? "（已測試）" : "（未測試）"}` : "無 OB 資料";
              })(),
            },
          ].map((item, i) => (
            <div key={i} className="flex items-center gap-2 text-[10px]">
              <span style={{ color: item.passed ? "#4caf50" : "#ef5350" }} className="w-3 shrink-0">
                {item.passed ? "✓" : "✗"}
              </span>
              <span style={{ color: item.passed ? "#ccc" : "#666" }} className="flex-1">{item.label}</span>
              <span className="text-[9px] font-mono" style={{ color: item.passed ? "#4caf50" : "#555" }}>{item.note}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
