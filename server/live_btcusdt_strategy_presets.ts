import type { BacktestStrategy } from './backtest.ts';

export type PaSessionMode = 'all' | 'exclude_offhours' | 'london_newyork';
export type RetestMode = 'same_bar' | 'next_bar_confirm' | 'either';

export type LivePreset = {
  key: string;
  label: string;
  family: 'single_strategy_terminal' | 'execution_terminal';
  symbol: 'BTCUSDT';
  strategy: BacktestStrategy;
  interval: '1h';
  atr_sl_mult: number;
  atr_tp_mult: number;
  enable_mtf_filter: boolean;
  enable_adx_filter: boolean;
  enable_trailing_stop: boolean;
  pa_allow_pattern: boolean;
  pa_allow_true_breakout: boolean;
  pa_allow_trap: boolean;
  pa_require_retest_on_continuation: boolean;
  pa_retest_soft_score?: boolean;
  pa_retest_soft_bonus?: number;
  pa_retest_soft_min_score?: number;
  pa_retest_touch_tolerance_atr: number;
  pa_retest_mode: RetestMode;
  pa_retest_require_candle_color: boolean;
  pa_retest_lookback_bars: number;
  pa_retest_reclaim_offset_atr: number;
  pa_dual_tf_resonance?: boolean;
  pa_resonance_bias_window_bars?: number;
  pa_resonance_min_score?: number;
  pa_resonance_require_key_level?: boolean;
  pa_resonance_require_momentum?: boolean;
  pa_session_mode?: PaSessionMode;
  expected_summary: string;
};

export const BTCUSDT_LIVE_PRESETS: LivePreset[] = [
  {
    key: 'btcusdt_1h_single_strategy_181',
    label: 'BTCUSDT 1H 单策略终版 181 / 81.2 / PF1.28',
    family: 'single_strategy_terminal',
    symbol: 'BTCUSDT',
    strategy: 'pa',
    interval: '1h',
    atr_sl_mult: 1.95,
    atr_tp_mult: 0.21,
    enable_mtf_filter: true,
    enable_adx_filter: true,
    enable_trailing_stop: true,
    pa_allow_pattern: true,
    pa_allow_true_breakout: false,
    pa_allow_trap: true,
    pa_require_retest_on_continuation: false,
    pa_retest_soft_score: true,
    pa_retest_soft_bonus: 0.5,
    pa_retest_soft_min_score: 7.5,
    pa_retest_touch_tolerance_atr: 0.04,
    pa_retest_mode: 'same_bar',
    pa_retest_require_candle_color: true,
    pa_retest_lookback_bars: 20,
    pa_retest_reclaim_offset_atr: 0.03,
    pa_dual_tf_resonance: true,
    pa_resonance_bias_window_bars: 2,
    pa_resonance_min_score: 40,
    pa_resonance_require_key_level: true,
    pa_resonance_require_momentum: false,
    pa_session_mode: 'all',
    expected_summary: '旧版 1H 单策略终结版，用 1H 偏见 + 15m 共振触发实际买卖点。',
  },
  {
    key: 'btcusdt_execution_main_90',
    label: 'BTCUSDT 实战执行终版 90 / 85.56',
    family: 'execution_terminal',
    symbol: 'BTCUSDT',
    strategy: 'pa',
    interval: '1h',
    atr_sl_mult: 1.75,
    atr_tp_mult: 0.19,
    enable_mtf_filter: true,
    enable_adx_filter: true,
    enable_trailing_stop: false,
    pa_allow_pattern: true,
    pa_allow_true_breakout: false,
    pa_allow_trap: true,
    pa_require_retest_on_continuation: true,
    pa_retest_touch_tolerance_atr: 0.08,
    pa_retest_mode: 'either',
    pa_retest_require_candle_color: false,
    pa_retest_lookback_bars: 12,
    pa_retest_reclaim_offset_atr: 0.03,
    pa_session_mode: 'exclude_offhours',
    expected_summary: '后续精炼后的默认实战主版本，核心过滤为 exclude_offhours + ADX >= 20。',
  },
];

export function getBtcusdtLivePreset(key: string): LivePreset | undefined {
  return BTCUSDT_LIVE_PRESETS.find((item) => item.key === key);
}
