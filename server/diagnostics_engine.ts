/**
 * diagnostics_engine.ts
 * 家族聚合診斷 + 門檻建議引擎
 *
 * 功能：
 * 1. 按策略家族（PA、趨勢回踩、結構、趨勢確認、均值回歸）聚合診斷數據
 * 2. 根據近 N 輪診斷歷史，自動生成門檻調整建議
 * 3. 為每個策略生成近 N 輪的狀態趨勢序列（供前端迷你圖使用）
 */

import type { StrategyFamily } from "./live_strategy_governance.js";
import { WORKER_GOVERNANCE_RULES } from "./live_strategy_governance.js";

// ── 類型定義 ──

export type StrategyStatus = "sent" | "duplicate_skip" | "blocked" | "idle" | "error";

export interface HistoryEntry {
  checked_at: string;
  status: StrategyStatus;
  reason: string | null;
  reason_code: string | null;
  direction: string | null;
  filtered_trades: number;
  filtered_win_rate: number;
}

export interface StrategyDiagnostics {
  total_rounds: number;
  blocked_rounds: number;
  sent_rounds: number;
  duplicate_rounds: number;
  idle_rounds: number;
  error_rounds: number;
  blocked_rate: number;
  sent_rate: number;
  top_blockers: Array<{ reason: string; count: number }>;
}

export interface FamilyAggregation {
  family: StrategyFamily;
  family_label: string;
  strategy_count: number;
  total_rounds: number;
  blocked_rounds: number;
  sent_rounds: number;
  duplicate_rounds: number;
  idle_rounds: number;
  error_rounds: number;
  blocked_rate: number;
  sent_rate: number;
  active_rate: number; // sent + duplicate
  top_blockers: Array<{ reason: string; count: number }>;
  strategies: string[]; // strategy keys in this family
}

export interface ThresholdSuggestion {
  strategy_key: string;
  strategy_label: string;
  family: StrategyFamily;
  severity: "info" | "warning" | "critical";
  category: string;
  current_value: string;
  suggested_action: string;
  reason: string;
}

export interface TrendEntry {
  status: StrategyStatus;
  reason_code: string | null;
}

export interface DiagnosticsEnrichment {
  family_aggregations: FamilyAggregation[];
  threshold_suggestions: ThresholdSuggestion[];
  strategy_trends: Record<string, TrendEntry[]>;
}

// ── 家族標籤 ──
const FAMILY_LABELS: Record<StrategyFamily, string> = {
  pa: "PA 價格行為",
  trend_pullback: "趨勢回踩",
  structure: "結構確認",
  trend_confirm: "趨勢確認",
  mean_reversion: "均值回歸",
};

// ── 家族聚合 ──
export function buildFamilyAggregations(
  strategies: Record<string, {
    history?: HistoryEntry[];
    diagnostics?: StrategyDiagnostics;
    last_status?: string;
  }>,
  activePresets: Array<{ key: string; family: StrategyFamily; label: string }>
): FamilyAggregation[] {
  const familyMap = new Map<StrategyFamily, {
    keys: string[];
    totalRounds: number;
    blocked: number;
    sent: number;
    duplicate: number;
    idle: number;
    error: number;
    blockerCounts: Map<string, number>;
  }>();

  for (const preset of activePresets) {
    const family = preset.family;
    if (!familyMap.has(family)) {
      familyMap.set(family, {
        keys: [],
        totalRounds: 0,
        blocked: 0,
        sent: 0,
        duplicate: 0,
        idle: 0,
        error: 0,
        blockerCounts: new Map(),
      });
    }
    const agg = familyMap.get(family)!;
    agg.keys.push(preset.key);

    const stratState = strategies[preset.key];
    const diag = stratState?.diagnostics;
    if (diag) {
      agg.totalRounds += diag.total_rounds;
      agg.blocked += diag.blocked_rounds;
      agg.sent += diag.sent_rounds;
      agg.duplicate += diag.duplicate_rounds;
      agg.idle += diag.idle_rounds;
      agg.error += diag.error_rounds;
      for (const b of diag.top_blockers) {
        agg.blockerCounts.set(b.reason, (agg.blockerCounts.get(b.reason) ?? 0) + b.count);
      }
    }
  }

  const results: FamilyAggregation[] = [];
  for (const [family, agg] of familyMap) {
    const topBlockers = [...agg.blockerCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([reason, count]) => ({ reason, count }));

    results.push({
      family,
      family_label: FAMILY_LABELS[family] ?? family,
      strategy_count: agg.keys.length,
      total_rounds: agg.totalRounds,
      blocked_rounds: agg.blocked,
      sent_rounds: agg.sent,
      duplicate_rounds: agg.duplicate,
      idle_rounds: agg.idle,
      error_rounds: agg.error,
      blocked_rate: agg.totalRounds > 0 ? Math.round((agg.blocked / agg.totalRounds) * 1000) / 10 : 0,
      sent_rate: agg.totalRounds > 0 ? Math.round((agg.sent / agg.totalRounds) * 1000) / 10 : 0,
      active_rate: agg.totalRounds > 0 ? Math.round(((agg.sent + agg.duplicate) / agg.totalRounds) * 1000) / 10 : 0,
      top_blockers: topBlockers,
      strategies: agg.keys,
    });
  }

  return results.sort((a, b) => b.sent_rate - a.sent_rate);
}

// ── 門檻建議引擎 ──
export function generateThresholdSuggestions(
  strategies: Record<string, {
    history?: HistoryEntry[];
    diagnostics?: StrategyDiagnostics;
    last_status?: string;
    filtered_trades?: number;
    filtered_win_rate?: number;
  }>,
  activePresets: Array<{ key: string; family: StrategyFamily; label: string }>
): ThresholdSuggestion[] {
  const suggestions: ThresholdSuggestion[] = [];

  for (const preset of activePresets) {
    const state = strategies[preset.key];
    const diag = state?.diagnostics;
    const governance = WORKER_GOVERNANCE_RULES[preset.key];
    if (!diag || !governance || diag.total_rounds < 5) continue;

    // 規則 1：阻擋率過高（> 80%）且主要原因是「訊號過舊」
    if (diag.blocked_rate > 80) {
      const topBlocker = diag.top_blockers[0];
      if (topBlocker?.reason === "訊號過舊") {
        suggestions.push({
          strategy_key: preset.key,
          strategy_label: preset.label,
          family: preset.family,
          severity: "warning",
          category: "signal_age",
          current_value: `max_signal_age_bars = ${governance.max_signal_age_bars}`,
          suggested_action: `建議將 max_signal_age_bars 從 ${governance.max_signal_age_bars} 放寬至 ${Math.min(governance.max_signal_age_bars * 2, 96)}`,
          reason: `近 ${diag.total_rounds} 輪中有 ${diag.blocked_rate.toFixed(1)}% 被阻擋，主因為「訊號過舊」（${topBlocker.count} 次），可考慮放寬時效門檻。`,
        });
      }
    }

    // 規則 2：阻擋率過高且主因是「歷史樣本不足」
    if (diag.blocked_rate > 70) {
      const sampleBlocker = diag.top_blockers.find(b => b.reason === "歷史樣本不足");
      if (sampleBlocker && governance.min_filtered_trades > 0) {
        suggestions.push({
          strategy_key: preset.key,
          strategy_label: preset.label,
          family: preset.family,
          severity: "warning",
          category: "min_trades",
          current_value: `min_filtered_trades = ${governance.min_filtered_trades}`,
          suggested_action: `建議將 min_filtered_trades 從 ${governance.min_filtered_trades} 降至 ${Math.max(governance.min_filtered_trades - 2, 0)}`,
          reason: `「歷史樣本不足」佔 ${sampleBlocker.count} 次阻擋，可降低最低樣本門檻以提高可用性。`,
        });
      }
    }

    // 規則 3：阻擋率過高且主因是「最新評分不足」
    if (diag.blocked_rate > 60) {
      const scoreBlocker = diag.top_blockers.find(b => b.reason === "最新評分不足");
      if (scoreBlocker && governance.min_signal_score !== undefined) {
        suggestions.push({
          strategy_key: preset.key,
          strategy_label: preset.label,
          family: preset.family,
          severity: "info",
          category: "signal_score",
          current_value: `min_signal_score = ${governance.min_signal_score}`,
          suggested_action: `建議將 min_signal_score 從 ${governance.min_signal_score} 降至 ${Math.max(governance.min_signal_score - 1.0, 6.0).toFixed(1)}`,
          reason: `「最新評分不足」佔 ${scoreBlocker.count} 次阻擋，可適度降低評分門檻以增加信號觸發機會。`,
        });
      }
    }

    // 規則 4：1D EMA200 方向不符持續阻擋
    if (diag.blocked_rate > 50) {
      const d1Blocker = diag.top_blockers.find(b => b.reason === "1D EMA200 方向不符");
      if (d1Blocker && d1Blocker.count > diag.total_rounds * 0.4) {
        suggestions.push({
          strategy_key: preset.key,
          strategy_label: preset.label,
          family: preset.family,
          severity: "info",
          category: "d1_filter",
          current_value: "1D EMA200 過濾啟用中",
          suggested_action: "市場可能處於盤整期，1D 方向過濾持續阻擋信號。可考慮在震盪市暫時放寬 1D 過濾條件。",
          reason: `「1D EMA200 方向不符」佔 ${d1Blocker.count} 次阻擋（${((d1Blocker.count / diag.total_rounds) * 100).toFixed(0)}%），可能是盤整行情導致。`,
        });
      }
    }

    // 規則 5：完全無信號（sent_rate = 0 且 idle 佔多數）
    if (diag.sent_rate === 0 && diag.idle_rounds > diag.total_rounds * 0.8) {
      suggestions.push({
        strategy_key: preset.key,
        strategy_label: preset.label,
        family: preset.family,
        severity: "info",
        category: "no_signal",
        current_value: `近 ${diag.total_rounds} 輪全部 idle`,
        suggested_action: "此策略近期無任何信號觸發，屬正常低頻狀態。若長期無信號可考慮調整策略參數。",
        reason: `近 ${diag.total_rounds} 輪中 ${diag.idle_rounds} 輪為 idle，策略可能處於等待期。`,
      });
    }

    // 規則 6：錯誤率過高
    if (diag.error_rounds > 0 && (diag.error_rounds / diag.total_rounds) > 0.1) {
      suggestions.push({
        strategy_key: preset.key,
        strategy_label: preset.label,
        family: preset.family,
        severity: "critical",
        category: "error_rate",
        current_value: `錯誤率 ${((diag.error_rounds / diag.total_rounds) * 100).toFixed(1)}%`,
        suggested_action: "建議檢查策略執行日誌，排查錯誤原因。",
        reason: `近 ${diag.total_rounds} 輪中有 ${diag.error_rounds} 輪出現錯誤，需要關注。`,
      });
    }
  }

  // 按嚴重度排序
  const severityOrder: Record<string, number> = { critical: 0, warning: 1, info: 2 };
  return suggestions.sort((a, b) => (severityOrder[a.severity] ?? 9) - (severityOrder[b.severity] ?? 9));
}

// ── 策略趨勢序列 ──
export function buildStrategyTrends(
  strategies: Record<string, {
    history?: HistoryEntry[];
  }>
): Record<string, TrendEntry[]> {
  const trends: Record<string, TrendEntry[]> = {};
  for (const [key, state] of Object.entries(strategies)) {
    const history = state?.history ?? [];
    trends[key] = history.map(h => ({
      status: h.status,
      reason_code: h.reason_code,
    }));
  }
  return trends;
}

// ── 主入口：生成完整診斷增強數據 ──
export function buildDiagnosticsEnrichment(
  strategies: Record<string, {
    history?: HistoryEntry[];
    diagnostics?: StrategyDiagnostics;
    last_status?: string;
    filtered_trades?: number;
    filtered_win_rate?: number;
  }>,
  activePresets: Array<{ key: string; family: StrategyFamily; label: string }>
): DiagnosticsEnrichment {
  return {
    family_aggregations: buildFamilyAggregations(strategies, activePresets),
    threshold_suggestions: generateThresholdSuggestions(strategies, activePresets),
    strategy_trends: buildStrategyTrends(strategies),
  };
}
