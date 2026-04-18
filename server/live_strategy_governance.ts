import type { BacktestStrategy } from "./backtest.js";

export type StrategyFamily = "pa" | "trend_pullback" | "structure" | "trend_confirm" | "mean_reversion";

export type WorkerGovernanceRule = {
  family: StrategyFamily;
  min_filtered_trades: number;
  max_signal_age_bars: number;
  min_signal_score?: number;
  summary: string;
};

export type ScannerGovernanceRule = {
  family: Exclude<StrategyFamily, "pa">;
  live_enabled: boolean;
  regime_whitelist: string[];
  min_total_trades: number;
  min_signal_score?: number;
  max_signal_age_bars: number;
  summary: string;
};

export const WORKER_GOVERNANCE_RULES: Record<string, WorkerGovernanceRule> = {
  pa_v4_focus: {
    family: "pa",
    min_filtered_trades: 6,
    max_signal_age_bars: 24,
    min_signal_score: 9.0,
    summary: "PA 主力版，保留高分門檻，並要求較新訊號與足夠過濾後樣本。",
  },
  hwr_b_guarded: {
    family: "trend_pullback",
    min_filtered_trades: 3,
    max_signal_age_bars: 48,
    summary: "趨勢回踩家族，允許較低樣本門檻，但保留時效限制避免沿用過舊波段。",
  },
  cannonball_guarded: {
    family: "structure",
    min_filtered_trades: 3,
    max_signal_age_bars: 48,
    summary: "結構確認家族，保留低樣本可用性，同時要求高週期方向與合理時效。",
  },
  ema_cross_confirm: {
    family: "trend_confirm",
    min_filtered_trades: 0,
    max_signal_age_bars: 12,
    summary: "低頻趨勢確認家族，不以樣本量卡死，但只接受較新的訊號。",
  },
  vwap_reversion_confirm: {
    family: "mean_reversion",
    min_filtered_trades: 0,
    max_signal_age_bars: 12,
    summary: "均值回歸家族，允許低頻策略待命，但要求較短時效。",
  },
};

export const SCANNER_GOVERNANCE_RULES: Partial<Record<BacktestStrategy, ScannerGovernanceRule>> = {
  hwr_model_a: {
    family: "trend_pullback",
    live_enabled: true,
    regime_whitelist: ["trending", "compressed", "chaotic"],
    min_total_trades: 1,
    max_signal_age_bars: 12,
    summary: "輔助型趨勢回踩策略，樣本門檻放寬為觀察級。",
  },
  hwr_model_b: {
    family: "trend_pullback",
    live_enabled: true,
    regime_whitelist: ["trending", "chaotic"],
    min_total_trades: 3,
    max_signal_age_bars: 12,
    summary: "主力趨勢回踩策略，維持最低可用樣本與較新訊號要求。",
  },
  cannonball: {
    family: "structure",
    live_enabled: true,
    regime_whitelist: ["trending", "compressed", "chaotic"],
    min_total_trades: 1,
    max_signal_age_bars: 16,
    summary: "結構策略以可用性優先，但仍限制為近期有效訊號。",
  },
  ema_cross: {
    family: "trend_confirm",
    live_enabled: true,
    regime_whitelist: ["trending"],
    min_total_trades: 0,
    max_signal_age_bars: 8,
    summary: "低頻確認策略保留待命資格，避免因樣本稀少永久停用。",
  },
  vwap_reversion: {
    family: "mean_reversion",
    live_enabled: true,
    regime_whitelist: ["ranging"],
    min_total_trades: 0,
    max_signal_age_bars: 8,
    summary: "均值回歸策略僅在震盪市待命，並維持較短時效。",
  },
};

export function getWorkerGovernance(versionKey: string): WorkerGovernanceRule | undefined {
  return WORKER_GOVERNANCE_RULES[versionKey];
}

export function getScannerGovernance(strategy: BacktestStrategy): ScannerGovernanceRule | undefined {
  return SCANNER_GOVERNANCE_RULES[strategy];
}
