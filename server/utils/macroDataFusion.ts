/**
 * Macro Data Fusion Service v1.0
 * 
 * 改良點（來自 gpt-5.4 評估）：
 * - 原本：Layer1 只依賴價格衍生指標（ATR, 趨勢, 多時框方向）
 * - 改良：融合真實宏觀數據（恐懼貪婪指數、鏈上活躍度、時段流動性）
 * 
 * 數據來源（免費 API）：
 * 1. Alternative.me Fear & Greed Index（加密貨幣市場情緒）
 * 2. CoinGecko Global Market Data（市值、交易量、BTC 主導地位）
 * 3. 時段流動性評分（基於 UTC 時間的靜態模型）
 */

export interface MacroDataResult {
  fearGreedIndex: number;         // 0-100（0=極度恐懼，100=極度貪婪）
  fearGreedLabel: string;         // "Extreme Fear" | "Fear" | "Neutral" | "Greed" | "Extreme Greed"
  btcDominance: number;           // BTC 市值主導地位 %
  totalMarketCapChange24h: number; // 總市值 24h 變化 %
  sessionLiquidity: number;       // 時段流動性評分 0-100
  sessionName: string;            // 當前交易時段名稱
  macroScore: number;             // 綜合宏觀評分 0-100（越高越適合交易）
  macroFilter: 'proceed' | 'caution' | 'avoid'; // 宏觀過濾建議
  macroSummary: string;           // 宏觀摘要（一句話）
  dataTimestamp: number;          // 數據時間戳
  isFallback: boolean;            // 是否使用了備用數據
}

// ── 時段流動性靜態模型 ──
interface SessionProfile {
  name: string;
  liquidityScore: number; // 0-100
  description: string;
}

function getSessionProfile(utcHour: number): SessionProfile {
  // 亞洲盤：UTC 00:00-08:00
  if (utcHour >= 0 && utcHour < 8) {
    const score = utcHour >= 1 && utcHour <= 5 ? 45 : 60;
    return { name: '亞洲盤', liquidityScore: score, description: '流動性中等，BTC/ETH 為主，波動相對溫和' };
  }
  // 歐洲盤開盤：UTC 08:00-12:00
  if (utcHour >= 8 && utcHour < 12) {
    return { name: '歐洲盤開盤', liquidityScore: 78, description: '流動性上升，歐洲機構入場，波動性增加' };
  }
  // 歐美重疊盤：UTC 12:00-17:00（最高流動性）
  if (utcHour >= 12 && utcHour < 17) {
    return { name: '歐美重疊盤', liquidityScore: 95, description: '全球最高流動性時段，大行情多發生於此' };
  }
  // 美國盤：UTC 17:00-22:00
  if (utcHour >= 17 && utcHour < 22) {
    return { name: '美國盤', liquidityScore: 85, description: '美國機構主導，波動性高，趨勢延續性強' };
  }
  // 美盤收盤過渡：UTC 22:00-24:00
  return { name: '美盤收盤', liquidityScore: 55, description: '流動性下降，假突破風險增加，謹慎操作' };
}

// ── 恐懼貪婪指數解讀 ──
function interpretFearGreed(index: number): { label: string; tradeImpact: string; scoreBonus: number } {
  if (index <= 20) return { label: 'Extreme Fear', tradeImpact: '極度恐懼，反轉機會高，但需確認支撐', scoreBonus: 10 };
  if (index <= 40) return { label: 'Fear', tradeImpact: '市場偏悲觀，做多需謹慎，做空順勢', scoreBonus: 5 };
  if (index <= 60) return { label: 'Neutral', tradeImpact: '市場中性，技術面主導，信號可靠性高', scoreBonus: 15 };
  if (index <= 80) return { label: 'Greed', tradeImpact: '市場偏樂觀，做多有動力，注意回調風險', scoreBonus: 8 };
  return { label: 'Extreme Greed', tradeImpact: '極度貪婪，頂部風險高，做多需嚴格止損', scoreBonus: -5 };
}

// ── 備用靜態宏觀數據（當 API 不可用時）──
function getFallbackMacroData(): Omit<MacroDataResult, 'sessionLiquidity' | 'sessionName' | 'macroScore' | 'macroFilter' | 'macroSummary' | 'dataTimestamp' | 'isFallback'> {
  return {
    fearGreedIndex: 50,
    fearGreedLabel: 'Neutral',
    btcDominance: 55,
    totalMarketCapChange24h: 0,
  };
}

/**
 * 獲取恐懼貪婪指數（Alternative.me API）
 */
async function fetchFearGreedIndex(): Promise<{ value: number; label: string } | null> {
  try {
    const response = await fetch('https://api.alternative.me/fng/?limit=1&format=json', {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return null;
    const data = await response.json() as { data: Array<{ value: string; value_classification: string }> };
    const item = data?.data?.[0];
    if (!item) return null;
    return { value: parseInt(item.value, 10), label: item.value_classification };
  } catch {
    return null;
  }
}

/**
 * 獲取全球市場數據（CoinGecko API）
 */
async function fetchGlobalMarketData(): Promise<{ btcDominance: number; marketCapChange24h: number } | null> {
  try {
    const response = await fetch('https://api.coingecko.com/api/v3/global', {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return null;
    const data = await response.json() as {
      data: {
        market_cap_percentage: { btc: number };
        market_cap_change_percentage_24h_usd: number;
      };
    };
    return {
      btcDominance: data?.data?.market_cap_percentage?.btc ?? 55,
      marketCapChange24h: data?.data?.market_cap_change_percentage_24h_usd ?? 0,
    };
  } catch {
    return null;
  }
}

/**
 * 主函數：獲取並融合宏觀數據
 */
export async function fetchMacroData(): Promise<MacroDataResult> {
  const nowUtcHour = new Date().getUTCHours();
  const session = getSessionProfile(nowUtcHour);
  
  // 並行獲取外部數據
  const [fgData, globalData] = await Promise.all([
    fetchFearGreedIndex(),
    fetchGlobalMarketData(),
  ]);
  
  const isFallback = !fgData && !globalData;
  const fallback = getFallbackMacroData();
  
  const fearGreedIndex = fgData?.value ?? fallback.fearGreedIndex;
  const fearGreedLabel = fgData?.label ?? fallback.fearGreedLabel;
  const btcDominance = globalData?.btcDominance ?? fallback.btcDominance;
  const totalMarketCapChange24h = globalData?.marketCapChange24h ?? fallback.totalMarketCapChange24h;
  
  // ── 計算綜合宏觀評分 ──
  const fgInterp = interpretFearGreed(fearGreedIndex);
  
  let macroScore = 50; // 基礎分
  
  // 1. 時段流動性加分（最高 +25）
  macroScore += (session.liquidityScore / 100) * 25;
  
  // 2. 恐懼貪婪指數調整（-5 到 +15）
  macroScore += fgInterp.scoreBonus;
  
  // 3. 市場整體方向（24h 漲跌）
  if (totalMarketCapChange24h > 3) macroScore += 8;
  else if (totalMarketCapChange24h > 1) macroScore += 4;
  else if (totalMarketCapChange24h < -3) macroScore -= 8;
  else if (totalMarketCapChange24h < -1) macroScore -= 4;
  
  // 4. BTC 主導地位（主導地位高 = 市場風險偏好低）
  if (btcDominance > 60) macroScore -= 5; // 避險情緒
  else if (btcDominance < 45) macroScore += 5; // 山寨季，風險偏好高
  
  macroScore = Math.max(0, Math.min(100, macroScore));
  
  // ── 宏觀過濾建議 ──
  let macroFilter: 'proceed' | 'caution' | 'avoid';
  if (macroScore >= 65) macroFilter = 'proceed';
  else if (macroScore >= 45) macroFilter = 'caution';
  else macroFilter = 'avoid';
  
  // ── 宏觀摘要 ──
  const macroSummary = [
    `市場情緒：${fearGreedLabel}（${fearGreedIndex}）`,
    `時段：${session.name}（流動性 ${session.liquidityScore}%）`,
    `BTC 主導 ${btcDominance.toFixed(1)}%，24h 市值 ${totalMarketCapChange24h > 0 ? '+' : ''}${totalMarketCapChange24h.toFixed(1)}%`,
  ].join(' | ');
  
  return {
    fearGreedIndex,
    fearGreedLabel,
    btcDominance,
    totalMarketCapChange24h,
    sessionLiquidity: session.liquidityScore,
    sessionName: session.name,
    macroScore,
    macroFilter,
    macroSummary,
    dataTimestamp: Date.now(),
    isFallback,
  };
}

/**
 * 將宏觀數據整合進 Layer1 環境掃描 Prompt
 */
export function buildMacroContext(macro: MacroDataResult): string {
  return `【宏觀與情緒數據（即時）】
恐懼貪婪指數：${macro.fearGreedIndex}/100（${macro.fearGreedLabel}）
BTC 主導地位：${macro.btcDominance.toFixed(1)}%
全球市值 24h 變化：${macro.totalMarketCapChange24h > 0 ? '+' : ''}${macro.totalMarketCapChange24h.toFixed(2)}%
當前時段：${macro.sessionName}（流動性評分 ${macro.sessionLiquidity}/100）
宏觀評分：${macro.macroScore.toFixed(0)}/100 → 建議：${macro.macroFilter === 'proceed' ? '✅ 可以交易' : macro.macroFilter === 'caution' ? '⚠️ 謹慎操作' : '🚫 建議迴避'}
${macro.isFallback ? '（注意：外部 API 暫時不可用，使用備用數據）' : '（數據來源：Alternative.me + CoinGecko）'}`;
}
