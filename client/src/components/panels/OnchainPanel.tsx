import type { OnchainData } from "@shared/cryptoTypes";

interface Props {
  onchain: OnchainData | null | undefined;
  isLoading: boolean;
}

// Fear & Greed 儀表板
function FearGreedGauge({ value, label }: { value: number; label: string }) {
  const color =
    value >= 75 ? "#4caf50"
    : value >= 55 ? "#8bc34a"
    : value >= 45 ? "#ffd740"
    : value >= 25 ? "#ff9800"
    : "#ef5350";

  const emoji =
    value >= 75 ? "😄"
    : value >= 55 ? "🙂"
    : value >= 45 ? "😐"
    : value >= 25 ? "😟"
    : "😱";

  // SVG arc gauge
  const radius = 36;
  const cx = 50;
  const cy = 52;
  const startAngle = -180;
  const endAngle = 0;
  const totalDeg = endAngle - startAngle;
  const valueDeg = startAngle + (value / 100) * totalDeg;

  function polarToXY(angle: number, r: number) {
    const rad = (angle * Math.PI) / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  }

  const trackStart = polarToXY(startAngle, radius);
  const trackEnd = polarToXY(endAngle, radius);
  const valueEnd = polarToXY(valueDeg, radius);
  const largeArc = (valueDeg - startAngle) > 180 ? 1 : 0;

  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 100 60" className="w-32 h-20">
        {/* Track */}
        <path
          d={`M ${trackStart.x} ${trackStart.y} A ${radius} ${radius} 0 0 1 ${trackEnd.x} ${trackEnd.y}`}
          fill="none"
          stroke="#1e1e1e"
          strokeWidth="8"
          strokeLinecap="round"
        />
        {/* Value arc */}
        {value > 0 && (
          <path
            d={`M ${trackStart.x} ${trackStart.y} A ${radius} ${radius} 0 ${largeArc} 1 ${valueEnd.x} ${valueEnd.y}`}
            fill="none"
            stroke={color}
            strokeWidth="8"
            strokeLinecap="round"
          />
        )}
        {/* Center value */}
        <text x={cx} y={cy - 4} textAnchor="middle" fontSize="16" fontWeight="bold" fill={color} fontFamily="monospace">
          {value}
        </text>
        <text x={cx} y={cy + 8} textAnchor="middle" fontSize="6" fill="#666" fontFamily="sans-serif">
          {emoji} {label}
        </text>
      </svg>
      {/* Color scale */}
      <div className="flex items-center gap-0.5 mt-1">
        {[
          { label: "極恐", color: "#ef5350" },
          { label: "恐懼", color: "#ff9800" },
          { label: "中性", color: "#ffd740" },
          { label: "貪婪", color: "#8bc34a" },
          { label: "極貪", color: "#4caf50" },
        ].map((s) => (
          <div key={s.label} className="flex flex-col items-center">
            <div className="w-8 h-1.5 rounded-sm" style={{ background: s.color }} />
            <div className="text-[8px] mt-0.5" style={{ color: "#555" }}>{s.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function OnchainPanel({ onchain, isLoading }: Props) {
  if (isLoading && !onchain) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="crypto-panel">
            <div className="crypto-panel-header h-8 animate-pulse bg-secondary/50" />
            <div className="p-3 space-y-2">
              {[...Array(3)].map((_, j) => <div key={j} className="h-4 bg-secondary/50 rounded animate-pulse" />)}
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (!onchain) {
    return (
      <div className="crypto-panel p-6 text-center">
        <div className="text-muted-foreground text-sm">請點擊「分析」按鈕取得鏈上數據</div>
      </div>
    );
  }

  const { funding_rate, long_short_ratio, fear_greed, open_interest, coingecko } = onchain;

  const frRate = funding_rate?.rate ?? 0;
  const frPct = (frRate * 100).toFixed(4);
  const frColor = frRate > 0.001 ? "#ef5350" : frRate < -0.001 ? "#4caf50" : "#ffd740";
  const frLabel = frRate > 0.001 ? "多頭付費 — 市場偏多，注意過熱" : frRate < -0.001 ? "空頭付費 — 市場偏空，注意反彈" : "費率接近中性";

  const lsRatio = long_short_ratio?.ls_ratio ?? 1;
  const longRatio = long_short_ratio?.long_ratio ?? 0.5;
  const shortRatio = long_short_ratio?.short_ratio ?? 0.5;
  const lsColor = lsRatio > 1.2 ? "#4caf50" : lsRatio < 0.8 ? "#ef5350" : "#ffd740";

  const fgValue = fear_greed?.value ?? 50;
  const fgLabel = fear_greed?.label ?? "中性";

  const oi = open_interest?.open_interest;
  const oiStr = oi ? (oi >= 1e9 ? (oi / 1e9).toFixed(2) + "B" : (oi / 1e6).toFixed(1) + "M") : "—";

  return (
    <div className="space-y-3">
      {/* Top row: 4 KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Funding Rate */}
        <div className="crypto-panel">
          <div className="crypto-panel-header">資金費率</div>
          <div className="p-3 space-y-2">
            {funding_rate ? (
              <>
                <div className="text-2xl font-mono font-bold" style={{ color: frColor }}>
                  {frPct}%
                </div>
                <div className="text-xs text-muted-foreground leading-relaxed">{frLabel}</div>
                {/* Rate bar centered at 0 */}
                <div className="relative h-1.5 bg-secondary rounded-full overflow-hidden">
                  <div className="absolute inset-y-0 left-1/2 w-px bg-secondary-foreground/20" />
                  {frRate >= 0 ? (
                    <div
                      className="absolute inset-y-0 left-1/2 rounded-r-full"
                      style={{ width: `${Math.min(Math.abs(frRate) * 10000, 50)}%`, background: "#ef5350" }}
                    />
                  ) : (
                    <div
                      className="absolute inset-y-0 right-1/2 rounded-l-full"
                      style={{ width: `${Math.min(Math.abs(frRate) * 10000, 50)}%`, background: "#4caf50" }}
                    />
                  )}
                </div>
                <div className="flex justify-between text-[9px] text-muted-foreground">
                  <span>空頭付費</span>
                  <span>多頭付費</span>
                </div>
              </>
            ) : (
              <div className="text-xs text-muted-foreground">數據不可用</div>
            )}
          </div>
        </div>

        {/* Long/Short Ratio */}
        <div className="crypto-panel">
          <div className="crypto-panel-header">多空比</div>
          <div className="p-3 space-y-2">
            {long_short_ratio ? (
              <>
                <div className="text-2xl font-mono font-bold" style={{ color: lsColor }}>
                  {lsRatio.toFixed(2)}
                </div>
                <div className="text-xs text-muted-foreground">
                  {lsRatio > 1.2 ? "多頭佔優，市場看漲情緒強" : lsRatio < 0.8 ? "空頭佔優，市場看跌情緒強" : "多空平衡，方向不明確"}
                </div>
                {/* Long/Short bar */}
                <div className="h-3 rounded-full overflow-hidden flex">
                  <div
                    className="h-full bg-bull transition-all"
                    style={{ width: `${longRatio * 100}%` }}
                  />
                  <div
                    className="h-full bg-bear transition-all"
                    style={{ width: `${shortRatio * 100}%` }}
                  />
                </div>
                <div className="flex justify-between text-[10px]">
                  <span className="text-bull font-mono">{(longRatio * 100).toFixed(1)}% 多</span>
                  <span className="text-bear font-mono">{(shortRatio * 100).toFixed(1)}% 空</span>
                </div>
              </>
            ) : (
              <div className="text-xs text-muted-foreground">數據不可用</div>
            )}
          </div>
        </div>

        {/* Fear & Greed */}
        <div className="crypto-panel">
          <div className="crypto-panel-header">恐懼貪婪指數</div>
          <div className="p-3 flex flex-col items-center">
            {fear_greed ? (
              <FearGreedGauge value={fgValue} label={fgLabel} />
            ) : (
              <div className="text-xs text-muted-foreground">數據不可用</div>
            )}
          </div>
        </div>

        {/* Open Interest */}
        <div className="crypto-panel">
          <div className="crypto-panel-header">未平倉量</div>
          <div className="p-3 space-y-2">
            {open_interest ? (
              <>
                <div className="text-2xl font-mono font-bold text-foreground">{oiStr}</div>
                <div className="text-xs text-muted-foreground">期貨未平倉合約總量</div>
                <div className="text-xs text-muted-foreground bg-secondary/20 rounded p-1.5 leading-relaxed">
                  {oi && oi > 5e9
                    ? "未平倉量偏高，槓桿風險較大，注意清算風險"
                    : oi && oi > 2e9
                    ? "未平倉量正常，市場活躍度適中"
                    : "未平倉量偏低，市場參與度較低"}
                </div>
              </>
            ) : (
              <div className="text-xs text-muted-foreground">數據不可用</div>
            )}
          </div>
        </div>
      </div>

      {/* Market sentiment summary */}
      <div className="crypto-panel">
        <div className="crypto-panel-header">市場情緒綜合評估</div>
        <div className="p-3">
          <div className="grid grid-cols-3 gap-2 text-center text-xs">
            <div className="rounded p-2" style={{ background: "#161616", border: "1px solid #2a2a2a" }}>
              <div className="text-muted-foreground mb-1">資金費率信號</div>
              <div className="font-semibold" style={{ color: frColor }}>
                {frRate > 0.001 ? "偏多過熱" : frRate < -0.001 ? "偏空超賣" : "中性"}
              </div>
            </div>
            <div className="rounded p-2" style={{ background: "#161616", border: "1px solid #2a2a2a" }}>
              <div className="text-muted-foreground mb-1">多空情緒</div>
              <div className="font-semibold" style={{ color: lsColor }}>
                {lsRatio > 1.2 ? "多頭主導" : lsRatio < 0.8 ? "空頭主導" : "均衡"}
              </div>
            </div>
            <div className="rounded p-2" style={{ background: "#161616", border: "1px solid #2a2a2a" }}>
              <div className="text-muted-foreground mb-1">市場恐懼/貪婪</div>
              <div className="font-semibold" style={{
                color: fgValue >= 75 ? "#4caf50" : fgValue >= 55 ? "#8bc34a" : fgValue >= 45 ? "#ffd740" : fgValue >= 25 ? "#ff9800" : "#ef5350"
              }}>
                {fgLabel}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* CoinGecko Market Data */}
      {coingecko && (
        <div className="crypto-panel">
          <div className="crypto-panel-header">市場數據（CoinGecko）</div>
          <div className="p-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
            {coingecko.market_cap != null && (
              <div>
                <div className="text-xs text-muted-foreground">市值</div>
                <div className="text-sm font-mono text-foreground">${(coingecko.market_cap / 1e9).toFixed(1)}B</div>
              </div>
            )}
            {coingecko.total_volume != null && (
              <div>
                <div className="text-xs text-muted-foreground">24H 成交量</div>
                <div className="text-sm font-mono text-foreground">${(coingecko.total_volume / 1e9).toFixed(1)}B</div>
              </div>
            )}
            {coingecko.price_change_24h != null && (
              <div>
                <div className="text-xs text-muted-foreground">24H 漲跌</div>
                <div className={`text-sm font-mono font-bold ${coingecko.price_change_24h > 0 ? "text-bull" : "text-bear"}`}>
                  {coingecko.price_change_24h > 0 ? "+" : ""}{coingecko.price_change_24h.toFixed(2)}%
                </div>
              </div>
            )}
            {coingecko.price_change_7d != null && (
              <div>
                <div className="text-xs text-muted-foreground">7D 漲跌</div>
                <div className={`text-sm font-mono font-bold ${coingecko.price_change_7d > 0 ? "text-bull" : "text-bear"}`}>
                  {coingecko.price_change_7d > 0 ? "+" : ""}{coingecko.price_change_7d.toFixed(2)}%
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
