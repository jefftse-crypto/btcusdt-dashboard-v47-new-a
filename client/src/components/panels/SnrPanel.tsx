/**
 * SnrPanel — SNR（支撐與阻力）策略分析面板
 *
 * 設計哲學（基於 JiaSheng 家陞 + TradingLife + The Trading Channel 學習筆記）：
 * - SNR 是「區域（Zone）」，不是「線（Line）」
 * - 訂單消耗原理：觸碰次數越多 → 越容易突破（新鮮度評分）
 * - 故事線（Storyline）：HTF 阻力 → 路障管理 → HTF 支撐
 * - 三重確認進場：Key Level + 反轉 K 線型態 + 8 EMA 交叉
 * - 高時間框架 SNR 優先於低時間框架
 */

import { useMemo } from "react";
import type { CryptoSnapshot, SRLevel } from "@shared/cryptoTypes";

interface Props {
  snapshot: CryptoSnapshot | null;
  currentPrice: number | null;
  isLoading: boolean;
}

// ─── 工具函數 ────────────────────────────────────────────────────────────────

function pctFromPrice(price: number | null, target: number): string {
  if (!price) return "—";
  return ((target - price) / price * 100).toFixed(2) + "%";
}

function pctAbs(price: number | null, target: number): number {
  if (!price) return 999;
  return Math.abs((target - price) / price * 100);
}

/** 訂單消耗原理：觸碰次數 → 新鮮度評級 */
function getFreshnessRating(touches: number): {
  label: string;
  color: string;
  bg: string;
  score: number;
  desc: string;
} {
  if (touches <= 1) return {
    label: "新鮮", color: "#00e676", bg: "rgba(0,230,118,0.1)",
    score: 100, desc: "首次測試，訂單充足，最強效力"
  };
  if (touches === 2) return {
    label: "良好", color: "#4caf50", bg: "rgba(76,175,80,0.1)",
    score: 75, desc: "二次測試，仍有效力"
  };
  if (touches === 3) return {
    label: "減弱", color: "#ffd740", bg: "rgba(255,215,64,0.1)",
    score: 45, desc: "三次測試，訂單已消耗約半"
  };
  if (touches === 4) return {
    label: "危弱", color: "#ff9800", bg: "rgba(255,152,0,0.1)",
    score: 20, desc: "四次測試，突破風險升高"
  };
  return {
    label: "耗盡", color: "#ef5350", bg: "rgba(239,83,80,0.1)",
    score: 5, desc: `${touches}次測試，訂單幾乎耗盡，易突破`
  };
}

/** SNR 區域寬度估算（基於 ATR） */
function getZoneWidth(price: number, atr: number): { top: number; bottom: number } {
  const half = atr * 0.5;
  return { top: price + half, bottom: price - half };
}

/** 判斷價格是否在 SNR 區域內 */
function isPriceInZone(currentPrice: number | null, level: number, atr: number): boolean {
  if (!currentPrice) return false;
  const zone = getZoneWidth(level, atr);
  return currentPrice >= zone.bottom && currentPrice <= zone.top;
}

// ─── 子元件 ──────────────────────────────────────────────────────────────────

function FreshnessBar({ touches }: { touches: number }) {
  const rating = getFreshnessRating(touches);
  const bars = 5;
  return (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: bars }).map((_, i) => (
        <div
          key={i}
          className="h-1.5 w-2.5 rounded-sm"
          style={{
            background: i < Math.ceil(rating.score / 20)
              ? rating.color
              : "#1e1e1e",
            opacity: i < Math.ceil(rating.score / 20) ? 1 : 0.3,
          }}
        />
      ))}
      <span className="text-[9px] ml-1" style={{ color: rating.color }}>{rating.label}</span>
    </div>
  );
}

function SRZoneCard({
  level, currentPrice, atr, isNearby,
}: {
  level: SRLevel;
  currentPrice: number | null;
  atr: number;
  isNearby: boolean;
}) {
  const rating = getFreshnessRating(level.touches);
  const inZone = isPriceInZone(currentPrice, level.price, atr);
  const dist = pctFromPrice(currentPrice, level.price);
  const isSupport = level.type === "support";
  const zone = getZoneWidth(level.price, atr);

  return (
    <div
      className="rounded p-2 mb-1.5 relative"
      style={{
        background: inZone
          ? (isSupport ? "rgba(0,230,118,0.06)" : "rgba(239,83,80,0.06)")
          : "#111",
        border: `1px solid ${inZone
          ? (isSupport ? "rgba(0,230,118,0.3)" : "rgba(239,83,80,0.3)")
          : "#1e1e1e"}`,
      }}
    >
      {inZone && (
        <div
          className="absolute top-1 right-1 text-[8px] px-1 py-0.5 rounded"
          style={{ background: isSupport ? "rgba(0,230,118,0.2)" : "rgba(239,83,80,0.2)", color: isSupport ? "#00e676" : "#ef5350" }}
        >
          ⚡ 價格在區域內
        </div>
      )}
      {isNearby && !inZone && (
        <div
          className="absolute top-1 right-1 text-[8px] px-1 py-0.5 rounded"
          style={{ background: "rgba(255,215,64,0.15)", color: "#ffd740" }}
        >
          ⚠ 接近
        </div>
      )}

      <div className="flex items-start justify-between mb-1">
        <div className="flex items-center gap-1.5">
          <span
            className="text-[9px] px-1.5 py-0.5 rounded font-semibold"
            style={{
              background: isSupport ? "rgba(0,230,118,0.15)" : "rgba(239,83,80,0.15)",
              color: isSupport ? "#00e676" : "#ef5350",
            }}
          >
            {isSupport ? "支撐" : "阻力"}
          </span>
          {level.label && (
            <span className="text-[9px] text-[#666]">{level.label}</span>
          )}
        </div>
        <FreshnessBar touches={level.touches} />
      </div>

      <div className="flex items-center justify-between">
        <div>
          <div className="text-[12px] font-mono font-bold" style={{ color: isSupport ? "#4caf50" : "#ef5350" }}>
            {level.price.toFixed(2)}
          </div>
          <div className="text-[9px] text-[#444] mt-0.5">
            區域：{zone.bottom.toFixed(2)} – {zone.top.toFixed(2)}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] font-mono" style={{ color: isSupport ? "#4caf50" : "#ef5350" }}>
            {dist}
          </div>
          <div className="text-[9px] text-[#555]">
            觸碰 {level.touches} 次 · 強度 {level.strength}/5
          </div>
        </div>
      </div>

      <div className="mt-1 text-[9px]" style={{ color: rating.color }}>
        {rating.desc}
      </div>
    </div>
  );
}

// ─── 主元件 ──────────────────────────────────────────────────────────────────

export function SnrPanel({ snapshot, currentPrice, isLoading }: Props) {

  // ── 故事線分析 ──────────────────────────────────────────────────────────────
  const storyline = useMemo(() => {
    if (!snapshot?.pa || !currentPrice) return null;

    // 取 4h 時間框架作為主要分析框架
    const tf4h = snapshot.pa.timeframes["4h"];
    const tf1h = snapshot.pa.timeframes["1h"];
    if (!tf4h) return null;

    const srLevels = tf4h.sr_levels ?? [];
    const support = tf4h.support;
    const resistance = tf4h.resistance;
    const atr = tf4h.atr ?? 0;
    const rsi = tf4h.rsi ?? 50;
    const ema20 = tf4h.ema20 ?? currentPrice;
    const ema50 = tf4h.ema50 ?? currentPrice;

    // 找最近的上方阻力與下方支撐
    const resistanceLevels = srLevels
      .filter(l => l.type === "resistance" && l.price > currentPrice)
      .sort((a, b) => a.price - b.price);
    const supportLevels = srLevels
      .filter(l => l.type === "support" && l.price < currentPrice)
      .sort((a, b) => b.price - a.price);

    const nearestRes = resistanceLevels[0] ?? { price: resistance, type: "resistance" as const, strength: 3, touches: 1 };
    const nearestSup = supportLevels[0] ?? { price: support, type: "support" as const, strength: 3, touches: 1 };

    // 路障：在最近支撐與阻力之間的其他 SR 水平
    const roadblocks = srLevels.filter(l => {
      if (l.price >= nearestRes.price || l.price <= nearestSup.price) return false;
      if (Math.abs(l.price - currentPrice) / currentPrice < 0.002) return false;
      return true;
    }).sort((a, b) => Math.abs(a.price - currentPrice) - Math.abs(b.price - currentPrice));

    // 故事線方向（基於 PA consensus）
    const consensus = snapshot.pa.consensus;
    const isBullish = consensus === "bullish" || consensus === "strong_bullish";
    const isBearish = consensus === "bearish" || consensus === "strong_bearish";

    // 三重確認評分
    const atKeyLevel = pctAbs(currentPrice, nearestRes.price) < 1.5 || pctAbs(currentPrice, nearestSup.price) < 1.5;
    const rsiConfirm = isBullish ? rsi < 40 : isBearish ? rsi > 60 : false;
    const emaConfirm = isBullish
      ? (ema20 > ema50 && currentPrice > ema20)
      : isBearish
        ? (ema20 < ema50 && currentPrice < ema20)
        : false;

    const confirmScore = [atKeyLevel, rsiConfirm, emaConfirm].filter(Boolean).length;

    // 1h 框架的 RSI 與 EMA（降級確認）
    const rsi1h = tf1h?.rsi ?? 50;
    const ema20_1h = tf1h?.ema20 ?? currentPrice;

    return {
      nearestRes,
      nearestSup,
      roadblocks: roadblocks.slice(0, 3),
      isBullish,
      isBearish,
      atr,
      rsi,
      rsi1h,
      ema20,
      ema50,
      ema20_1h,
      atKeyLevel,
      rsiConfirm,
      emaConfirm,
      confirmScore,
      allSrLevels: srLevels,
    };
  }, [snapshot, currentPrice]);

  // ── 多時間框架 SR 彙整 ──────────────────────────────────────────────────────
  const mtfSrSummary = useMemo(() => {
    if (!snapshot?.pa || !currentPrice) return [];
    const tfs = ["1d", "4h", "1h"] as const;
    return tfs.map(tf => {
      const data = snapshot.pa!.timeframes[tf];
      if (!data) return null;
      const srLevels = data.sr_levels ?? [];
      const nearRes = srLevels.filter(l => l.type === "resistance" && l.price > currentPrice)
        .sort((a, b) => a.price - b.price)[0];
      const nearSup = srLevels.filter(l => l.type === "support" && l.price < currentPrice)
        .sort((a, b) => b.price - a.price)[0];
      return { tf, nearRes, nearSup, rsi: data.rsi, atr: data.atr };
    }).filter(Boolean);
  }, [snapshot, currentPrice]);

  // ─── 渲染 ─────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-40 text-[#555] text-sm">
        <div className="text-center">
          <div className="text-2xl mb-2">📐</div>
          <div>SNR 分析中...</div>
        </div>
      </div>
    );
  }

  if (!snapshot?.pa) {
    return (
      <div className="flex items-center justify-center h-40 text-[#555] text-sm">
        <div className="text-center">
          <div className="text-2xl mb-2">📐</div>
          <div>請先執行分析以載入 SNR 資料</div>
        </div>
      </div>
    );
  }

  const tf4h = snapshot.pa.timeframes["4h"];
  const allSrLevels = tf4h?.sr_levels ?? [];
  const atr = tf4h?.atr ?? 0;

  return (
    <div className="text-[#ccc] text-xs space-y-3">

      {/* ── 標題 ── */}
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-bold text-[#ccc]">📐 SNR 支撐阻力分析</div>
          <div className="text-[9px] text-[#555] mt-0.5">
            基於 JiaSheng 機構畫法 · 訂單消耗原理 · 故事線策略
          </div>
        </div>
        {storyline && (
          <div
            className="text-[9px] px-2 py-1 rounded"
            style={{
              background: storyline.isBullish ? "rgba(0,230,118,0.1)" : storyline.isBearish ? "rgba(239,83,80,0.1)" : "rgba(255,215,64,0.1)",
              color: storyline.isBullish ? "#00e676" : storyline.isBearish ? "#ef5350" : "#ffd740",
              border: `1px solid ${storyline.isBullish ? "rgba(0,230,118,0.2)" : storyline.isBearish ? "rgba(239,83,80,0.2)" : "rgba(255,215,64,0.2)"}`,
            }}
          >
            {storyline.isBullish ? "↑ 看多故事線" : storyline.isBearish ? "↓ 看空故事線" : "↔ 盤整"}
          </div>
        )}
      </div>

      {/* ── 故事線視覺化 ── */}
      {storyline && (
        <div className="rounded p-3" style={{ background: "#0d0d0d", border: "1px solid #1e1e1e" }}>
          <div className="text-[10px] text-[#888] mb-2 font-semibold uppercase tracking-wider">
            📖 故事線（Storyline）
          </div>

          {/* 故事線圖示 */}
          <div className="relative">
            {/* 阻力 */}
            <div className="flex items-center justify-between mb-1.5 p-2 rounded"
              style={{ background: "rgba(239,83,80,0.06)", border: "1px solid rgba(239,83,80,0.2)" }}>
              <div>
                <span className="text-[9px] text-[#ef5350] font-semibold">上方阻力（目標/起點）</span>
                <div className="text-[11px] font-mono text-[#ef5350] mt-0.5">
                  {storyline.nearestRes.price.toFixed(2)}
                </div>
              </div>
              <div className="text-right">
                <div className="text-[9px] text-[#ef5350]">{pctFromPrice(currentPrice, storyline.nearestRes.price)}</div>
                <FreshnessBar touches={storyline.nearestRes.touches ?? 1} />
              </div>
            </div>

            {/* 路障 */}
            {storyline.roadblocks.length > 0 && (
              <div className="ml-3 mb-1.5">
                <div className="text-[9px] text-[#555] mb-1">路障（Roadblocks）— 部分止盈位</div>
                {storyline.roadblocks.map((rb, i) => (
                  <div key={i} className="flex items-center justify-between p-1.5 rounded mb-1"
                    style={{ background: "rgba(255,152,0,0.05)", border: "1px solid rgba(255,152,0,0.15)" }}>
                    <span className="text-[9px] text-[#ff9800]">
                      {rb.type === "resistance" ? "阻力路障" : "支撐路障"} {i + 1}
                    </span>
                    <span className="text-[9px] font-mono text-[#ff9800]">
                      {rb.price.toFixed(2)} ({pctFromPrice(currentPrice, rb.price)})
                    </span>
                  </div>
                ))}
                <div className="text-[9px] text-[#444] mt-0.5">
                  💡 TradingLife：在路障處部分止盈（50%），等回調後再加倉
                </div>
              </div>
            )}

            {/* 現價 */}
            <div className="flex items-center gap-2 mb-1.5 p-2 rounded"
              style={{ background: "rgba(255,215,64,0.05)", border: "1px solid rgba(255,215,64,0.2)" }}>
              <span className="text-[9px] text-[#ffd740]">▶ 現價</span>
              <span className="text-[11px] font-mono text-[#ffd740] font-bold">
                {currentPrice?.toFixed(2) ?? "—"}
              </span>
            </div>

            {/* 支撐 */}
            <div className="flex items-center justify-between p-2 rounded"
              style={{ background: "rgba(0,230,118,0.06)", border: "1px solid rgba(0,230,118,0.2)" }}>
              <div>
                <span className="text-[9px] text-[#00e676] font-semibold">下方支撐（目標/終點）</span>
                <div className="text-[11px] font-mono text-[#00e676] mt-0.5">
                  {storyline.nearestSup.price.toFixed(2)}
                </div>
              </div>
              <div className="text-right">
                <div className="text-[9px] text-[#00e676]">{pctFromPrice(currentPrice, storyline.nearestSup.price)}</div>
                <FreshnessBar touches={storyline.nearestSup.touches ?? 1} />
              </div>
            </div>
          </div>

          {/* 故事線描述 */}
          <div className="mt-2 p-2 rounded text-[9px] text-[#666]"
            style={{ background: "#111", border: "1px solid #1a1a1a" }}>
            {storyline.isBullish
              ? `📗 看多劇本：價格從下方支撐 ${storyline.nearestSup.price.toFixed(2)} 反彈，目標上方阻力 ${storyline.nearestRes.price.toFixed(2)}。途中注意路障處的回調。`
              : storyline.isBearish
                ? `📕 看空劇本：價格從上方阻力 ${storyline.nearestRes.price.toFixed(2)} 被拒絕，目標下方支撐 ${storyline.nearestSup.price.toFixed(2)}。途中路障可能引發回調。`
                : `📘 盤整劇本：價格在支撐 ${storyline.nearestSup.price.toFixed(2)} 與阻力 ${storyline.nearestRes.price.toFixed(2)} 之間震盪，等待突破方向確認。`
            }
          </div>
        </div>
      )}

      {/* ── 三重確認進場 Checklist ── */}
      {storyline && (
        <div className="rounded p-3" style={{ background: "#0d0d0d", border: "1px solid #1e1e1e" }}>
          <div className="flex items-center justify-between mb-2">
            <div className="text-[10px] text-[#888] font-semibold uppercase tracking-wider">
              ✅ 三重確認進場（The Trading Channel）
            </div>
            <div
              className="text-[10px] px-2 py-0.5 rounded font-bold"
              style={{
                background: storyline.confirmScore === 3 ? "rgba(0,230,118,0.15)" : storyline.confirmScore === 2 ? "rgba(255,215,64,0.15)" : "rgba(239,83,80,0.15)",
                color: storyline.confirmScore === 3 ? "#00e676" : storyline.confirmScore === 2 ? "#ffd740" : "#ef5350",
              }}
            >
              {storyline.confirmScore}/3 確認
            </div>
          </div>

          <div className="space-y-1.5">
            {/* 確認一：Key Level */}
            <div className="flex items-start gap-2 p-2 rounded"
              style={{ background: storyline.atKeyLevel ? "rgba(0,230,118,0.05)" : "#111", border: `1px solid ${storyline.atKeyLevel ? "rgba(0,230,118,0.2)" : "#1e1e1e"}` }}>
              <span className="text-[11px] mt-0.5">{storyline.atKeyLevel ? "✅" : "⬜"}</span>
              <div>
                <div className="text-[10px] font-semibold" style={{ color: storyline.atKeyLevel ? "#00e676" : "#555" }}>
                  確認一：價格進入 SNR 區域
                </div>
                <div className="text-[9px] text-[#444] mt-0.5">
                  {storyline.atKeyLevel
                    ? `✓ 距最近 SNR 在 1.5% 以內`
                    : `距上方阻力 ${pctFromPrice(currentPrice, storyline.nearestRes.price)}，距下方支撐 ${pctFromPrice(currentPrice, storyline.nearestSup.price)}`
                  }
                </div>
              </div>
            </div>

            {/* 確認二：RSI 超買/超賣 */}
            <div className="flex items-start gap-2 p-2 rounded"
              style={{ background: storyline.rsiConfirm ? "rgba(0,230,118,0.05)" : "#111", border: `1px solid ${storyline.rsiConfirm ? "rgba(0,230,118,0.2)" : "#1e1e1e"}` }}>
              <span className="text-[11px] mt-0.5">{storyline.rsiConfirm ? "✅" : "⬜"}</span>
              <div>
                <div className="text-[10px] font-semibold" style={{ color: storyline.rsiConfirm ? "#00e676" : "#555" }}>
                  確認二：RSI 超買/超賣確認
                </div>
                <div className="text-[9px] text-[#444] mt-0.5">
                  4H RSI：<span className="font-mono" style={{ color: storyline.rsi > 70 ? "#ef5350" : storyline.rsi < 30 ? "#4caf50" : "#888" }}>
                    {storyline.rsi.toFixed(1)}
                  </span>
                  {" "}（1H RSI：<span className="font-mono">{storyline.rsi1h.toFixed(1)}</span>）
                  {storyline.rsiConfirm
                    ? ` ✓ ${storyline.isBullish ? "超賣區（<40）" : "超買區（>60）"}`
                    : ` — 需達到 ${storyline.isBullish ? "<40" : ">60"}`
                  }
                </div>
              </div>
            </div>

            {/* 確認三：EMA 交叉 */}
            <div className="flex items-start gap-2 p-2 rounded"
              style={{ background: storyline.emaConfirm ? "rgba(0,230,118,0.05)" : "#111", border: `1px solid ${storyline.emaConfirm ? "rgba(0,230,118,0.2)" : "#1e1e1e"}` }}>
              <span className="text-[11px] mt-0.5">{storyline.emaConfirm ? "✅" : "⬜"}</span>
              <div>
                <div className="text-[10px] font-semibold" style={{ color: storyline.emaConfirm ? "#00e676" : "#555" }}>
                  確認三：EMA 交叉方向確認
                </div>
                <div className="text-[9px] text-[#444] mt-0.5">
                  EMA20：<span className="font-mono text-[#3b82f6]">{storyline.ema20.toFixed(2)}</span>
                  {" "}EMA50：<span className="font-mono text-[#a855f7]">{storyline.ema50.toFixed(2)}</span>
                  {storyline.emaConfirm
                    ? ` ✓ EMA 方向${storyline.isBullish ? "看多" : "看空"}排列`
                    : ` — EMA 尚未確認方向`
                  }
                </div>
              </div>
            </div>
          </div>

          {storyline.confirmScore === 3 && (
            <div className="mt-2 p-2 rounded text-[9px]"
              style={{ background: "rgba(0,230,118,0.08)", border: "1px solid rgba(0,230,118,0.2)", color: "#00e676" }}>
              🎯 三重確認齊備！可考慮進場。止損設在 SNR 區域最外側（插針位置）再加 0.5% 呼吸空間。
            </div>
          )}
          {storyline.confirmScore === 2 && (
            <div className="mt-2 p-2 rounded text-[9px]"
              style={{ background: "rgba(255,215,64,0.08)", border: "1px solid rgba(255,215,64,0.2)", color: "#ffd740" }}>
              ⏳ 兩項確認，繼續等待第三項確認信號再進場。
            </div>
          )}
          {storyline.confirmScore < 2 && (
            <div className="mt-2 p-2 rounded text-[9px]"
              style={{ background: "rgba(239,83,80,0.08)", border: "1px solid rgba(239,83,80,0.2)", color: "#ef5350" }}>
              ⛔ 確認不足，勿盲目進場。等待價格進入 SNR 區域後再評估。
            </div>
          )}
        </div>
      )}

      {/* ── SNR 區域清單（帶新鮮度評分） ── */}
      <div className="rounded p-3" style={{ background: "#0d0d0d", border: "1px solid #1e1e1e" }}>
        <div className="text-[10px] text-[#888] mb-2 font-semibold uppercase tracking-wider">
          🗺 SNR 區域清單（4H · 訂單消耗評分）
        </div>

        {allSrLevels.length === 0 ? (
          <div className="text-[9px] text-[#444]">無 SNR 資料</div>
        ) : (
          <>
            {/* 阻力 */}
            {allSrLevels.filter(l => l.type === "resistance").length > 0 && (
              <div className="mb-2">
                <div className="text-[9px] text-[#ef5350] mb-1 uppercase tracking-wider">阻力區域</div>
                {allSrLevels
                  .filter(l => l.type === "resistance")
                  .sort((a, b) => a.price - b.price)
                  .map((level, i) => (
                    <SRZoneCard
                      key={i}
                      level={level}
                      currentPrice={currentPrice}
                      atr={atr}
                      isNearby={pctAbs(currentPrice, level.price) < 3}
                    />
                  ))
                }
              </div>
            )}

            {/* 支撐 */}
            {allSrLevels.filter(l => l.type === "support").length > 0 && (
              <div>
                <div className="text-[9px] text-[#4caf50] mb-1 uppercase tracking-wider">支撐區域</div>
                {allSrLevels
                  .filter(l => l.type === "support")
                  .sort((a, b) => b.price - a.price)
                  .map((level, i) => (
                    <SRZoneCard
                      key={i}
                      level={level}
                      currentPrice={currentPrice}
                      atr={atr}
                      isNearby={pctAbs(currentPrice, level.price) < 3}
                    />
                  ))
                }
              </div>
            )}
          </>
        )}
      </div>

      {/* ── 多時間框架 SNR 彙整 ── */}
      <div className="rounded p-3" style={{ background: "#0d0d0d", border: "1px solid #1e1e1e" }}>
        <div className="text-[10px] text-[#888] mb-2 font-semibold uppercase tracking-wider">
          🕐 多時間框架 SNR 彙整（MTFA）
        </div>
        <div className="text-[9px] text-[#444] mb-2">
          高時間框架的 SNR 優先於低時間框架。日線 SNR 比 4H 更具約束力。
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-[9px]" style={{ borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #1e1e1e" }}>
                <th className="text-left py-1 pr-2 text-[#555]">時間框架</th>
                <th className="text-right py-1 px-2 text-[#ef5350]">最近阻力</th>
                <th className="text-right py-1 px-2 text-[#4caf50]">最近支撐</th>
                <th className="text-right py-1 pl-2 text-[#888]">RSI</th>
              </tr>
            </thead>
            <tbody>
              {mtfSrSummary.map((row, i) => row && (
                <tr key={i} style={{ borderBottom: "1px solid #111" }}>
                  <td className="py-1 pr-2 font-mono text-[#666]">{row.tf.toUpperCase()}</td>
                  <td className="py-1 px-2 text-right font-mono" style={{ color: "#ef5350" }}>
                    {row.nearRes ? row.nearRes.price.toFixed(2) : "—"}
                    {row.nearRes && <span className="text-[#444] ml-1">({pctFromPrice(currentPrice, row.nearRes.price)})</span>}
                  </td>
                  <td className="py-1 px-2 text-right font-mono" style={{ color: "#4caf50" }}>
                    {row.nearSup ? row.nearSup.price.toFixed(2) : "—"}
                    {row.nearSup && <span className="text-[#444] ml-1">({pctFromPrice(currentPrice, row.nearSup.price)})</span>}
                  </td>
                  <td className="py-1 pl-2 text-right font-mono" style={{
                    color: row.rsi > 70 ? "#ef5350" : row.rsi < 30 ? "#4caf50" : "#888"
                  }}>
                    {row.rsi?.toFixed(0) ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── 常見錯誤提醒 ── */}
      <div className="rounded p-3" style={{ background: "#0d0d0d", border: "1px solid #1e1e1e" }}>
        <div className="text-[10px] text-[#888] mb-2 font-semibold uppercase tracking-wider">
          ⚠ SNR 常見錯誤提醒
        </div>
        <div className="space-y-1 text-[9px] text-[#555]">
          <div>❌ <span className="text-[#666]">只畫一條線</span>：SNR 必須是「區域（Zone）」，用矩形框出插針到實體密集處</div>
          <div>❌ <span className="text-[#666]">觸碰次數越多越好</span>：實際上觸碰越多 → 訂單消耗越多 → 越容易突破</div>
          <div>❌ <span className="text-[#666]">盲目進場</span>：必須等待 K 線型態（吞沒/晨星）+ EMA 交叉 + RSI 確認</div>
          <div>❌ <span className="text-[#666]">止損過緊</span>：止損要設在 SNR 區域最外側插針再加呼吸空間，避免被假突破掃出</div>
          <div>❌ <span className="text-[#666]">逆勢交易</span>：強趨勢中不要在支撐接飛刀，順勢找阻力做空才是正確方向</div>
        </div>
      </div>

    </div>
  );
}
