/**
 * SmcConfirmPanel.tsx
 * SMC/ICT 三重確認模型面板 — 強化版
 *
 * 新增（根據 SMC 學習資源 Waqar Asim LIT 理論）：
 * - Inducement 陷阱警告：偵測「看起來完美但可能是誘騙」的 OB
 * - Risk Entry vs Confirmation Entry 兩種進場模式
 * - MTFA 多時間框架對齊提示
 * - 清掃品質評估（真實清掃 vs 誘騙清掃）
 */
import { useMemo, useState } from "react";
import { CheckCircle2, XCircle, AlertCircle, TrendingUp, TrendingDown, Target, Shield, Zap, AlertTriangle, Info } from "lucide-react";

interface SmcData {
  structure: "bullish" | "bearish" | "ranging";
  fvg_count: number;
  nearest_bull_fvg?: { top: number; bottom: number; size: number } | null;
  nearest_bear_fvg?: { top: number; bottom: number; size: number } | null;
  nearest_bull_ob?: { top: number; bottom: number; strength: number | string; tested?: boolean } | null;
  nearest_bear_ob?: { top: number; bottom: number; strength: number | string; tested?: boolean } | null;
  liquidity: { nearest_sell: number; nearest_buy: number };
  liquidity_levels?: Array<{ price: number; type: string; swept: boolean; strength: string }>;
  premium_discount?: { equilibrium: number; current_zone: string; percent_position: number };
  ote_zone?: { direction: string; fib_618: number; fib_705: number; fib_786: number; in_zone: boolean } | null;
  recent_swing_high?: number;
  recent_swing_low?: number;
  bos_choch?: Array<{ type: string; direction: string; level: number; time?: number; idx?: number; description?: string }>;
}

interface Props {
  smc: SmcData | undefined;
  currentPrice: number | null;
  isLoading: boolean;
}

const fmt = (v: number | undefined | null, d = 2) =>
  v == null || isNaN(v) ? "—" : v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });

function ConfirmCheck({ label, passed, detail, warning }: {
  label: string; passed: boolean | null; detail?: string; warning?: boolean;
}) {
  return (
    <div className={`flex items-start gap-2 p-2.5 rounded-lg border ${
      warning ? "border-yellow-500/40 bg-yellow-500/5" :
      passed === true ? "border-bull/30 bg-bull/5" :
      passed === false ? "border-bear/30 bg-bear/5" :
      "border-border bg-muted/20"
    }`}>
      {warning ? <AlertTriangle className="w-4 h-4 text-yellow-400 flex-shrink-0 mt-0.5" /> :
       passed === true ? <CheckCircle2 className="w-4 h-4 text-bull flex-shrink-0 mt-0.5" /> :
       passed === false ? <XCircle className="w-4 h-4 text-bear flex-shrink-0 mt-0.5" /> :
       <AlertCircle className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-0.5" />}
      <div>
        <div className={`text-xs font-semibold ${
          warning ? "text-yellow-400" :
          passed === true ? "text-bull" : passed === false ? "text-bear" : "text-muted-foreground"
        }`}>
          {label}
        </div>
        {detail && <div className="text-[11px] text-muted-foreground mt-0.5">{detail}</div>}
      </div>
    </div>
  );
}

function RRBadge({ rr }: { rr: number }) {
  const color = rr >= 3 ? "text-bull bg-bull/10 border-bull/30" : rr >= 2 ? "text-yellow-400 bg-yellow-400/10 border-yellow-400/30" : "text-bear bg-bear/10 border-bear/30";
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-xs font-bold ${color}`}>
      <Target className="w-3 h-3" />
      R:R {rr.toFixed(1)}
    </span>
  );
}

/** LIT 誘騙偵測：當 OB 已被測試但流動性清掃不夠乾淨時，警告可能是 Inducement */
function detectInducement(smc: SmcData, direction: "long" | "short"): {
  risk: "low" | "medium" | "high";
  reason: string;
} {
  const liqLevels = smc.liquidity_levels ?? [];

  if (direction === "long") {
    const ob = smc.nearest_bull_ob;
    const sslSwept = liqLevels.some(l => l.type === "SSL" && l.swept);
    const bslSwept = liqLevels.some(l => l.type === "BSL" && l.swept);
    const obTested = ob?.tested;

    // 高風險：OB 已被多次測試 + BSL 被清掃（機構可能在誘騙多方）
    if (obTested && bslSwept && !sslSwept) {
      return { risk: "high", reason: "⚠️ LIT 警告：OB 已測試且 BSL 被清掃但 SSL 未掃，可能是誘騙多方的 Inducement 陷阱" };
    }
    // 中風險：OB 已被測試，強度可能降低
    if (obTested && !sslSwept) {
      return { risk: "medium", reason: "注意：OB 已被測試（強度降低），且 SSL 尚未被清掃，建議等待 SSL 清掃後再入場" };
    }
    // 低風險：SSL 已清掃 + 未測試 OB
    if (sslSwept && !obTested) {
      return { risk: "low", reason: "✓ 清掃品質良好：SSL 已清掃 + OB 未測試，符合 LIT 真實清掃條件" };
    }
    return { risk: "low", reason: "暫無明顯 Inducement 風險" };
  } else {
    const ob = smc.nearest_bear_ob;
    const bslSwept = liqLevels.some(l => l.type === "BSL" && l.swept);
    const sslSwept = liqLevels.some(l => l.type === "SSL" && l.swept);
    const obTested = ob?.tested;

    if (obTested && sslSwept && !bslSwept) {
      return { risk: "high", reason: "⚠️ LIT 警告：OB 已測試且 SSL 被清掃但 BSL 未掃，可能是誘騙空方的 Inducement 陷阱" };
    }
    if (obTested && !bslSwept) {
      return { risk: "medium", reason: "注意：OB 已被測試（強度降低），且 BSL 尚未被清掃，建議等待 BSL 清掃後再入場" };
    }
    if (bslSwept && !obTested) {
      return { risk: "low", reason: "✓ 清掃品質良好：BSL 已清掃 + OB 未測試，符合 LIT 真實清掃條件" };
    }
    return { risk: "low", reason: "暫無明顯 Inducement 風險" };
  }
}

export function SmcConfirmPanel({ smc, currentPrice, isLoading }: Props) {
  const [entryMode, setEntryMode] = useState<"risk" | "confirm">("confirm");

  const analysis = useMemo(() => {
    if (!smc || !currentPrice || currentPrice === 0) return null;

    const price = currentPrice;
    const pd = smc.premium_discount;
    const ote = smc.ote_zone;
    const liqLevels = smc.liquidity_levels ?? [];
    const swingHigh = smc.recent_swing_high ?? 0;
    const swingLow = smc.recent_swing_low ?? 0;

    // 最近的 CHoCH（結構轉換）確認 — 使用 shared/cryptoTypes BosChoch.level 欄位
    const recentChoch = smc.bos_choch?.find(b => b.type === "CHoCH");

    // ── LONG SETUP CHECKS ──
    const longChecks = {
      structureBull: smc.structure === "bullish",
      inDiscount: pd ? pd.current_zone === "discount" : null,
      bullObNearby: smc.nearest_bull_ob
        ? price >= smc.nearest_bull_ob.bottom * 0.998 && price <= smc.nearest_bull_ob.top * 1.01
        : false,
      bullFvgNearby: smc.nearest_bull_fvg
        ? price >= smc.nearest_bull_fvg.bottom * 0.998 && price <= smc.nearest_bull_fvg.top * 1.01
        : false,
      sslSwept: liqLevels.some(l => l.type === "SSL" && l.swept),
      inOte: ote?.direction === "bullish" && ote.in_zone,
      // 新增：CHOCH 確認（LIT 理論：需要 CHOCH 才算真實反轉）
      chochConfirmed: recentChoch?.direction === "bullish",
    };

    // ── SHORT SETUP CHECKS ──
    const shortChecks = {
      structureBear: smc.structure === "bearish",
      inPremium: pd ? pd.current_zone === "premium" : null,
      bearObNearby: smc.nearest_bear_ob
        ? price <= smc.nearest_bear_ob.top * 1.002 && price >= smc.nearest_bear_ob.bottom * 0.99
        : false,
      bearFvgNearby: smc.nearest_bear_fvg
        ? price <= smc.nearest_bear_fvg.top * 1.002 && price >= smc.nearest_bear_fvg.bottom * 0.99
        : false,
      bslSwept: liqLevels.some(l => l.type === "BSL" && l.swept),
      inOte: ote?.direction === "bearish" && ote.in_zone,
      chochConfirmed: recentChoch?.direction === "bearish",
    };

    const longScore = [
      longChecks.structureBull, longChecks.inDiscount,
      longChecks.bullObNearby, longChecks.bullFvgNearby,
      longChecks.sslSwept, longChecks.inOte,
    ].filter(Boolean).length;

    const shortScore = [
      shortChecks.structureBear, shortChecks.inPremium,
      shortChecks.bearObNearby, shortChecks.bearFvgNearby,
      shortChecks.bslSwept, shortChecks.inOte,
    ].filter(Boolean).length;

    const primarySetup: "long" | "short" | "wait" =
      longScore >= 3 && longScore > shortScore ? "long" :
      shortScore >= 3 && shortScore > longScore ? "short" : "wait";

    // Inducement 分析
    const inducementAnalysis = primarySetup !== "wait"
      ? detectInducement(smc, primarySetup)
      : { risk: "low" as const, reason: "" };

    // ── Entry Calculation ──
    // Risk Entry：在 OB/FVG 區間直接進場，不等待 CHOCH 確認
    // Confirmation Entry：等待 CHOCH 後在 OB 回踩進場
    let entry = price;
    let sl = 0;
    let tp1 = 0;
    let tp2 = 0;

    if (primarySetup === "long") {
      if (entryMode === "risk") {
        // Risk Entry：在 OB 頂部附近直接進場（較激進，止損較小）
        entry = smc.nearest_bull_ob ? Math.min(smc.nearest_bull_ob.top, price) : price;
        const obBottom = smc.nearest_bull_ob?.bottom ?? swingLow;
        sl = Math.min(obBottom * 0.997, swingLow * 0.997);
      } else {
        // Confirmation Entry：等待 CHOCH 後在 OB 中點進場（較保守，確認度高）
        entry = smc.nearest_bull_ob
          ? (smc.nearest_bull_ob.top + smc.nearest_bull_ob.bottom) / 2
          : price;
        const obBottom = smc.nearest_bull_ob?.bottom ?? swingLow;
        sl = Math.min(obBottom * 0.995, swingLow * 0.995);
      }
      tp1 = smc.liquidity.nearest_sell > 0 ? smc.liquidity.nearest_sell : swingHigh;
      const risk = entry - sl;
      tp2 = entry + risk * 3;
    } else if (primarySetup === "short") {
      if (entryMode === "risk") {
        entry = smc.nearest_bear_ob ? Math.max(smc.nearest_bear_ob.bottom, price) : price;
        const obTop = smc.nearest_bear_ob?.top ?? swingHigh;
        sl = Math.max(obTop * 1.003, swingHigh * 1.003);
      } else {
        entry = smc.nearest_bear_ob
          ? (smc.nearest_bear_ob.top + smc.nearest_bear_ob.bottom) / 2
          : price;
        const obTop = smc.nearest_bear_ob?.top ?? swingHigh;
        sl = Math.max(obTop * 1.005, swingHigh * 1.005);
      }
      tp1 = smc.liquidity.nearest_buy > 0 ? smc.liquidity.nearest_buy : swingLow;
      const risk = sl - entry;
      tp2 = entry - risk * 3;
    }

    const risk = primarySetup === "long" ? entry - sl : sl - entry;
    const reward1 = primarySetup === "long" ? tp1 - entry : entry - tp1;
    const reward2 = primarySetup === "long" ? tp2 - entry : entry - tp2;
    const rr1 = risk > 0 ? reward1 / risk : 0;
    const rr2 = risk > 0 ? reward2 / risk : 0;

    return {
      longChecks, shortChecks, longScore, shortScore,
      primarySetup, entry, sl, tp1, tp2, rr1, rr2, risk,
      inducementAnalysis,
    };
  }, [smc, currentPrice, entryMode]);

  if (isLoading && !smc) {
    return (
      <div className="bg-card border border-border rounded-xl p-4">
        <div className="space-y-2">
          {[...Array(4)].map((_, i) => <div key={i} className="h-10 bg-muted/30 rounded animate-pulse" />)}
        </div>
      </div>
    );
  }

  if (!smc || !currentPrice) {
    return (
      <div className="bg-card border border-border rounded-xl p-6 text-center text-muted-foreground text-sm">
        請先執行分析以取得 SMC 確認模型數據
      </div>
    );
  }

  if (!analysis) return null;

  const { longChecks, shortChecks, longScore, shortScore, primarySetup, entry, sl, tp1, tp2, rr1, rr2, inducementAnalysis } = analysis;

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card/80">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-primary" />
          <span className="font-semibold text-sm">SMC/ICT 三重確認模型</span>
        </div>
        <div className="flex items-center gap-2">
          {primarySetup === "long" && (
            <span className="flex items-center gap-1 px-2.5 py-1 rounded text-xs font-bold bg-bull/15 text-bull border border-bull/30">
              <TrendingUp className="w-3 h-3" /> 做多訊號 ({longScore}/6)
            </span>
          )}
          {primarySetup === "short" && (
            <span className="flex items-center gap-1 px-2.5 py-1 rounded text-xs font-bold bg-bear/15 text-bear border border-bear/30">
              <TrendingDown className="w-3 h-3" /> 做空訊號 ({shortScore}/6)
            </span>
          )}
          {primarySetup === "wait" && (
            <span className="flex items-center gap-1 px-2.5 py-1 rounded text-xs font-bold bg-muted text-muted-foreground border border-border">
              <AlertCircle className="w-3 h-3" /> 等待確認
            </span>
          )}
        </div>
      </div>

      <div className="p-4 space-y-4">

        {/* ── LIT Inducement 警告區塊 ── */}
        {primarySetup !== "wait" && inducementAnalysis.risk !== "low" && (
          <div className={`rounded-lg p-3 border ${
            inducementAnalysis.risk === "high"
              ? "border-red-500/40 bg-red-500/5"
              : "border-yellow-500/40 bg-yellow-500/5"
          }`}>
            <div className="flex items-start gap-2">
              <AlertTriangle className={`w-4 h-4 flex-shrink-0 mt-0.5 ${
                inducementAnalysis.risk === "high" ? "text-red-400" : "text-yellow-400"
              }`} />
              <div>
                <div className={`text-xs font-bold mb-0.5 ${
                  inducementAnalysis.risk === "high" ? "text-red-400" : "text-yellow-400"
                }`}>
                  LIT Inducement 偵測（{inducementAnalysis.risk === "high" ? "高風險" : "中風險"}）
                </div>
                <div className="text-[11px] text-muted-foreground">{inducementAnalysis.reason}</div>
                <div className="text-[10px] text-muted-foreground/70 mt-1">
                  基於 Waqar Asim LIT 理論：機構常製造完美 OB 誘騙散戶，真實清掃需要乾淨的流動性獵取 + 未測試 OB
                </div>
              </div>
            </div>
          </div>
        )}
        {primarySetup !== "wait" && inducementAnalysis.risk === "low" && inducementAnalysis.reason && (
          <div className="rounded-lg p-3 border border-bull/20 bg-bull/5">
            <div className="flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 text-bull flex-shrink-0 mt-0.5" />
              <div>
                <div className="text-xs font-bold text-bull mb-0.5">LIT 清掃品質評估</div>
                <div className="text-[11px] text-muted-foreground">{inducementAnalysis.reason}</div>
              </div>
            </div>
          </div>
        )}

        {/* Confirmation Checks Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* Long Checks */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="w-3.5 h-3.5 text-bull" />
              <span className="text-xs font-semibold text-bull">做多確認 ({longScore}/6)</span>
              <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden">
                <div className="h-full bg-bull rounded-full" style={{ width: `${(longScore / 6) * 100}%` }} />
              </div>
            </div>
            <div className="space-y-1.5">
              <ConfirmCheck
                label="SMC 多頭結構 (HH/HL)"
                passed={longChecks.structureBull}
                detail={longChecks.structureBull ? "高高低低結構確認，趨勢向上" : "結構尚未看多，等待 BOS"}
              />
              <ConfirmCheck
                label="ICT Discount 區間"
                passed={longChecks.inDiscount}
                detail={longChecks.inDiscount ? "價格在均衡點以下，有利做多" : "價格在 Premium 或均衡區，不宜追多"}
              />
              <ConfirmCheck
                label="多頭 Order Block"
                passed={longChecks.bullObNearby}
                detail={smc.nearest_bull_ob ? `OB: ${fmt(smc.nearest_bull_ob.bottom)}–${fmt(smc.nearest_bull_ob.top)}${smc.nearest_bull_ob.tested ? " ⚠️已測試" : " ✓未測試"}` : "無有效多頭 OB"}
              />
              <ConfirmCheck
                label="多頭 FVG 支撐"
                passed={longChecks.bullFvgNearby}
                detail={smc.nearest_bull_fvg ? `FVG: ${fmt(smc.nearest_bull_fvg.bottom)}–${fmt(smc.nearest_bull_fvg.top)}` : "無近期多頭 FVG"}
              />
              <ConfirmCheck
                label="SSL 流動性清掃"
                passed={longChecks.sslSwept}
                detail={longChecks.sslSwept ? "✓ 賣方止損已被清掃，LIT 真實反轉訊號" : "SSL 尚未被清掃，可能仍有下行風險"}
              />
              <ConfirmCheck
                label="OTE 最佳入場區 (61.8%–78.6%)"
                passed={longChecks.inOte ?? false}
                detail={longChecks.inOte ? "當前在 Fibonacci OTE 區間，最佳入場位" : "尚未回調至 OTE 區間"}
              />
              {/* 新增：CHOCH 確認 */}
              <ConfirmCheck
                label="CHoCH 結構轉換確認"
                passed={longChecks.chochConfirmed ?? false}
                detail={longChecks.chochConfirmed ? "✓ 已出現看多 CHoCH，趨勢轉換確認（Confirmation Entry 條件）" : "尚未出現 CHoCH，Risk Entry 模式下可忽略"}
                warning={!longChecks.chochConfirmed && longChecks.sslSwept}
              />
            </div>
          </div>

          {/* Short Checks */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <TrendingDown className="w-3.5 h-3.5 text-bear" />
              <span className="text-xs font-semibold text-bear">做空確認 ({shortScore}/6)</span>
              <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden">
                <div className="h-full bg-bear rounded-full" style={{ width: `${(shortScore / 6) * 100}%` }} />
              </div>
            </div>
            <div className="space-y-1.5">
              <ConfirmCheck
                label="SMC 空頭結構 (LH/LL)"
                passed={shortChecks.structureBear}
                detail={shortChecks.structureBear ? "低高低低結構確認，趨勢向下" : "結構尚未看空，等待 BOS"}
              />
              <ConfirmCheck
                label="ICT Premium 區間"
                passed={shortChecks.inPremium}
                detail={shortChecks.inPremium ? "價格在均衡點以上，有利做空" : "價格在 Discount 或均衡區，不宜追空"}
              />
              <ConfirmCheck
                label="空頭 Order Block"
                passed={shortChecks.bearObNearby}
                detail={smc.nearest_bear_ob ? `OB: ${fmt(smc.nearest_bear_ob.bottom)}–${fmt(smc.nearest_bear_ob.top)}${smc.nearest_bear_ob.tested ? " ⚠️已測試" : " ✓未測試"}` : "無有效空頭 OB"}
              />
              <ConfirmCheck
                label="空頭 FVG 阻力"
                passed={shortChecks.bearFvgNearby}
                detail={smc.nearest_bear_fvg ? `FVG: ${fmt(smc.nearest_bear_fvg.bottom)}–${fmt(smc.nearest_bear_fvg.top)}` : "無近期空頭 FVG"}
              />
              <ConfirmCheck
                label="BSL 流動性清掃"
                passed={shortChecks.bslSwept}
                detail={shortChecks.bslSwept ? "✓ 買方止損已被清掃，LIT 真實反轉訊號" : "BSL 尚未被清掃，可能仍有上行風險"}
              />
              <ConfirmCheck
                label="OTE 最佳入場區 (61.8%–78.6%)"
                passed={shortChecks.inOte ?? false}
                detail={shortChecks.inOte ? "當前在 Fibonacci OTE 區間，最佳入場位" : "尚未反彈至 OTE 區間"}
              />
              <ConfirmCheck
                label="CHoCH 結構轉換確認"
                passed={shortChecks.chochConfirmed ?? false}
                detail={shortChecks.chochConfirmed ? "✓ 已出現看空 CHoCH，趨勢轉換確認（Confirmation Entry 條件）" : "尚未出現 CHoCH，Risk Entry 模式下可忽略"}
                warning={!shortChecks.chochConfirmed && shortChecks.bslSwept}
              />
            </div>
          </div>
        </div>

        {/* ── Entry Mode Selector (Risk vs Confirmation) ── */}
        {primarySetup !== "wait" && (
          <div className="rounded-lg border border-border bg-muted/10 p-3">
            <div className="flex items-center gap-2 mb-2">
              <Info className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-xs font-semibold text-muted-foreground">進場模式（Photon Trading 理論）</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setEntryMode("risk")}
                className={`p-2.5 rounded-lg border text-left transition-all ${
                  entryMode === "risk"
                    ? "border-yellow-500/50 bg-yellow-500/10"
                    : "border-border bg-background/30 hover:border-border/80"
                }`}
              >
                <div className={`text-xs font-bold mb-0.5 ${entryMode === "risk" ? "text-yellow-400" : "text-muted-foreground"}`}>
                  ⚡ Risk Entry
                </div>
                <div className="text-[10px] text-muted-foreground">
                  流動性清掃後直接在 OB 頂部進場。止損更小，風報比更高，但確認度較低。
                </div>
              </button>
              <button
                onClick={() => setEntryMode("confirm")}
                className={`p-2.5 rounded-lg border text-left transition-all ${
                  entryMode === "confirm"
                    ? "border-blue-500/50 bg-blue-500/10"
                    : "border-border bg-background/30 hover:border-border/80"
                }`}
              >
                <div className={`text-xs font-bold mb-0.5 ${entryMode === "confirm" ? "text-blue-400" : "text-muted-foreground"}`}>
                  ✓ Confirmation Entry
                </div>
                <div className="text-[10px] text-muted-foreground">
                  等待 CHoCH 後在 OB 中點進場。確認度高，止損略大，勝率更穩定。
                </div>
              </button>
            </div>
          </div>
        )}

        {/* Entry Plan */}
        {primarySetup !== "wait" && entry > 0 && sl > 0 && (
          <div className={`rounded-xl border p-4 ${primarySetup === "long" ? "border-bull/30 bg-bull/5" : "border-bear/30 bg-bear/5"}`}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                {primarySetup === "long" ? <TrendingUp className="w-4 h-4 text-bull" /> : <TrendingDown className="w-4 h-4 text-bear" />}
                <span className="text-sm font-semibold">
                  {primarySetup === "long" ? "做多" : "做空"}交易計劃
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    ({entryMode === "risk" ? "⚡ Risk Entry" : "✓ Confirmation Entry"})
                  </span>
                </span>
              </div>
              <div className="flex gap-2">
                <RRBadge rr={rr1} />
                <RRBadge rr={rr2} />
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="bg-background/50 rounded-lg p-2.5">
                <div className="text-[10px] text-muted-foreground mb-1 flex items-center gap-1">
                  <Target className="w-3 h-3" /> 建議入場
                </div>
                <div className="text-sm font-mono font-bold text-foreground">${fmt(entry)}</div>
                <div className="text-[10px] text-muted-foreground mt-0.5">
                  {entryMode === "risk"
                    ? (primarySetup === "long" ? "OB 頂部（激進）" : "OB 底部（激進）")
                    : (primarySetup === "long" ? "OB 中點（保守）" : "OB 中點（保守）")}
                </div>
              </div>
              <div className="bg-background/50 rounded-lg p-2.5">
                <div className="text-[10px] text-muted-foreground mb-1 flex items-center gap-1">
                  <Shield className="w-3 h-3" /> 止損位
                </div>
                <div className="text-sm font-mono font-bold text-bear">${fmt(sl)}</div>
                <div className="text-[10px] text-muted-foreground mt-0.5">
                  {primarySetup === "long" ? "OB 底部下方" : "OB 頂部上方"}
                </div>
              </div>
              <div className="bg-background/50 rounded-lg p-2.5">
                <div className="text-[10px] text-muted-foreground mb-1 flex items-center gap-1">
                  <TrendingUp className="w-3 h-3" /> 止盈 1 (R:R {rr1.toFixed(1)})
                </div>
                <div className="text-sm font-mono font-bold text-bull">${fmt(tp1)}</div>
                <div className="text-[10px] text-muted-foreground mt-0.5">
                  {primarySetup === "long" ? "BSL 流動性目標" : "SSL 流動性目標"}
                </div>
              </div>
              <div className="bg-background/50 rounded-lg p-2.5">
                <div className="text-[10px] text-muted-foreground mb-1 flex items-center gap-1">
                  <TrendingUp className="w-3 h-3" /> 止盈 2 (R:R {rr2.toFixed(1)})
                </div>
                <div className="text-sm font-mono font-bold text-bull">${fmt(tp2)}</div>
                <div className="text-[10px] text-muted-foreground mt-0.5">延伸目標 (3R)</div>
              </div>
            </div>
            {/* MTFA 提示 */}
            <div className="mt-3 text-[11px] text-muted-foreground bg-background/30 rounded p-2 space-y-1">
              <div className="text-[10px] font-semibold text-muted-foreground/80">📊 MTFA 多時間框架建議（Photon Trading / Phantom Trading）</div>
              <div>
                在 <span className="text-foreground">4H/日線</span> 確認大方向與主要流動性目標 →
                在 <span className="text-foreground">15M</span> 尋找流動性清掃訊號 →
                在 <span className="text-foreground">5M/1M</span> 尋找 CHoCH 與精確 OB 進場點
              </div>
              {(primarySetup === "long" ? longScore : shortScore) < 4 && (
                <div className="text-yellow-400">⚠️ 確認數量不足 4/6，建議等待更多確認再入場，或使用 Risk Entry 模式並嚴格控制倉位。</div>
              )}
              {inducementAnalysis.risk === "high" && (
                <div className="text-red-400">🚨 LIT 高風險警告：當前形態可能是 Inducement 陷阱，建議暫緩入場，等待更乾淨的流動性清掃。</div>
              )}
            </div>
          </div>
        )}

        {/* Wait state */}
        {primarySetup === "wait" && (
          <div className="rounded-xl border border-border bg-muted/10 p-4 text-center">
            <AlertCircle className="w-8 h-8 mx-auto mb-2 text-muted-foreground opacity-50" />
            <div className="text-sm font-medium text-muted-foreground">等待更多確認訊號</div>
            <div className="text-xs text-muted-foreground mt-1">
              做多確認 {longScore}/6，做空確認 {shortScore}/6。建議等待至少 3 個確認後再考慮入場。
            </div>
            <div className="text-[10px] text-muted-foreground/60 mt-2">
              LIT 建議：等待明確的流動性清掃（SSL/BSL Sweep）+ CHoCH 出現後，才是真實的機構建倉訊號
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
