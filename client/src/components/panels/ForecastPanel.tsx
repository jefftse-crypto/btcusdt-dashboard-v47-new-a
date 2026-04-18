import type { ForecastData } from "@shared/cryptoTypes";
import { Clock, XCircle, TrendingUp, TrendingDown, Zap } from "lucide-react";

interface Props {
  forecast: ForecastData | undefined;
  isLoading: boolean;
}

function ScenarioCard({
  title,
  scenario,
  probability,
  target,
  description,
  candles_estimate,
  invalidation,
  color,
  icon,
}: {
  title: string;
  scenario: string;
  probability: number;
  target?: number;
  description?: string;
  candles_estimate?: number;
  invalidation?: string;
  color: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="crypto-panel overflow-hidden">
      <div className="crypto-panel-header flex items-center justify-between">
        <div className="flex items-center gap-2">
          {icon}
          <span>{title}</span>
        </div>
        <span className="text-xs font-mono font-bold" style={{ color }}>
          {probability}%
        </span>
      </div>
      <div className="p-3 space-y-2.5">
        {/* Scenario + Target */}
        <div className="flex items-start justify-between gap-2">
          <span className="text-sm font-semibold leading-snug" style={{ color }}>
            {scenario}
          </span>
          {target != null && target > 0 && (
            <span className="text-xs font-mono text-foreground shrink-0 bg-secondary/30 rounded px-2 py-0.5">
              目標 {target.toLocaleString("en-US", { maximumFractionDigits: 2 })}
            </span>
          )}
        </div>

        {/* Probability bar */}
        <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${probability}%`, background: color }}
          />
        </div>

        {/* Description */}
        {description && (
          <div className="text-xs text-muted-foreground leading-relaxed bg-secondary/20 rounded p-2">
            {description}
          </div>
        )}

        {/* Time estimate + Invalidation */}
        <div className="space-y-1.5">
          {candles_estimate != null && candles_estimate > 0 && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground bg-secondary/10 rounded px-2 py-1.5">
              <Clock className="w-3 h-3 shrink-0 text-primary/60" />
              <span>
                預計時間：約 <span className="text-foreground font-semibold">{candles_estimate} 根 K 線</span>
                {candles_estimate <= 6 ? "（短期）" : candles_estimate <= 24 ? "（中期）" : "（長期）"}
              </span>
            </div>
          )}
          {invalidation && (
            <div className="flex items-start gap-2 text-xs text-bear/80 bg-bear/5 border border-bear/20 rounded px-2 py-1.5">
              <XCircle className="w-3 h-3 shrink-0 mt-0.5 text-bear/60" />
              <span>
                <span className="font-semibold text-bear/90">失效條件：</span>
                {invalidation}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function ForecastPanel({ forecast, isLoading }: Props) {
  if (isLoading && !forecast) {
    return (
      <div className="crypto-panel">
        <div className="crypto-panel-header">預測情境</div>
        <div className="p-3 space-y-2">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-4 bg-secondary/50 rounded animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (!forecast) {
    return (
      <div className="crypto-panel p-6 text-center">
        <div className="text-muted-foreground text-sm">請點擊「分析」按鈕取得預測情境</div>
      </div>
    );
  }

  const mainColor = forecast.main_probability >= 50 ? "#4caf50" : "#ef5350";

  // Extreme scenario fields (optional, from backend)
  const f = forecast as ForecastData & {
    extreme_scenario?: string;
    extreme_probability?: number;
    extreme_target?: number;
    extreme_description?: string;
    extreme_invalidation?: string;
    extreme_candles_estimate?: number;
  };

  // Probability total bar
  const total = forecast.main_probability + (forecast.alt_probability ?? 0) + (f.extreme_probability ?? 0);

  return (
    <div className="space-y-3">
      {/* Probability overview */}
      <div className="crypto-panel">
        <div className="crypto-panel-header">情境概率分佈</div>
        <div className="p-3 space-y-2">
          <div className="flex h-3 rounded-full overflow-hidden gap-0.5">
            <div
              className="h-full rounded-l-full transition-all"
              style={{ width: `${(forecast.main_probability / total) * 100}%`, background: mainColor }}
              title={`主要情境 ${forecast.main_probability}%`}
            />
            {forecast.alt_probability != null && forecast.alt_probability > 0 && (
              <div
                className="h-full transition-all"
                style={{ width: `${(forecast.alt_probability / total) * 100}%`, background: "#ffd740" }}
                title={`備選情境 ${forecast.alt_probability}%`}
              />
            )}
            {f.extreme_probability != null && f.extreme_probability > 0 && (
              <div
                className="h-full rounded-r-full transition-all"
                style={{ width: `${(f.extreme_probability / total) * 100}%`, background: "#ff6b35" }}
                title={`極端情境 ${f.extreme_probability}%`}
              />
            )}
          </div>
          <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full" style={{ background: mainColor }} />
              主要 {forecast.main_probability}%
            </div>
            {forecast.alt_probability != null && forecast.alt_probability > 0 && (
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-full bg-yellow-500" />
                備選 {forecast.alt_probability}%
              </div>
            )}
            {f.extreme_probability != null && f.extreme_probability > 0 && (
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-full" style={{ background: "#ff6b35" }} />
                極端 {f.extreme_probability}%
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Main Scenario */}
      <ScenarioCard
        title="主要情境"
        scenario={forecast.main_scenario}
        probability={forecast.main_probability}
        target={forecast.main_target}
        description={forecast.main_description}
        candles_estimate={(forecast as ForecastData & { main_candles_estimate?: number }).main_candles_estimate}
        invalidation={(forecast as ForecastData & { main_invalidation?: string }).main_invalidation}
        color={mainColor}
        icon={<TrendingUp className="w-3.5 h-3.5" style={{ color: mainColor }} />}
      />

      {/* Alt Scenario */}
      {forecast.alt_scenario && (
        <ScenarioCard
          title="備選情境"
          scenario={forecast.alt_scenario}
          probability={forecast.alt_probability ?? 0}
          target={forecast.alt_target}
          description={forecast.alt_description}
          candles_estimate={(forecast as ForecastData & { alt_candles_estimate?: number }).alt_candles_estimate}
          invalidation={(forecast as ForecastData & { alt_invalidation?: string }).alt_invalidation}
          color="#ffd740"
          icon={<TrendingDown className="w-3.5 h-3.5 text-yellow-500" />}
        />
      )}

      {/* Extreme Scenario */}
      {f.extreme_scenario && (
        <ScenarioCard
          title="極端情境"
          scenario={f.extreme_scenario}
          probability={f.extreme_probability ?? 0}
          target={f.extreme_target}
          description={f.extreme_description}
          candles_estimate={f.extreme_candles_estimate}
          invalidation={f.extreme_invalidation}
          color="#ff6b35"
          icon={<Zap className="w-3.5 h-3.5" style={{ color: "#ff6b35" }} />}
        />
      )}
    </div>
  );
}
