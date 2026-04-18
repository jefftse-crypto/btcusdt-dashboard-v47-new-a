const sampleSignal = {
  preset: {
    label: 'BTCUSDT 實戰執行終版 90 / 85.56',
  },
  direction: 'long',
  entry_time: 1776265200,
  signal_time: 1776268800,
  entry_price: 73912.55,
  entry_type: 'retest_confirmation',
  used_15m_execution: true,
  reason: 'BTCUSDT 實戰執行終版 90 / 85.56 | exclude_offhours + ADX >= 20 | score 85.56 | ADX 27.4 | session London',
};

function formatUtc(tsSec) {
  return new Date(tsSec * 1000).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

function formatTelegramMessage(signal) {
  const side = signal.direction === 'long' ? 'BUY / LONG' : 'SELL / SHORT';
  return [
    'BTCUSDT 实战提醒',
    `策略：${signal.preset.label}`,
    `动作：${side}`,
    `进场时间：${formatUtc(signal.entry_time)}`,
    `触发时间：${formatUtc(signal.signal_time)}`,
    `进场价：${signal.entry_price}`,
    `类型：${signal.entry_type}`,
    signal.used_15m_execution ? '执行：15m 共振触发' : '执行：1h 主信号触发',
    `说明：${signal.reason}`,
  ].join('\n');
}

console.log(formatTelegramMessage(sampleSignal));
