# 勝率改良架構設計 v4.4

## 現狀問題

1. **HWR-B 是唯一正回報策略**（+2.80%），但勝率僅 50%（4 筆）
2. **PA 主力勝率僅 25%**（8 筆），淨回報 -1.70%
3. **CannonBall 勝率 50%** 但淨回報 -0.40%（TP 不足以覆蓋 SL）
4. **EMA-X / VWAP 無信號**（0 筆交易）
5. `win_rate_booster.ts` 已寫好但**未整合進 Live Worker**
6. 信號發送前**無品質閘門**，所有通過基本過濾的信號都會推送

## 改良方案

### A. 共振 Veto 層（發送前最終否決權）

在 `runVersion()` 返回有效信號後、`sendTelegram()` 之前，插入 `evaluateSignal()` 評估：
- 收集所有 5 策略的信號方向
- 計算跨策略共振分數
- 若 `should_trade === false`，則降級為「觀望信號」（不推送或標記為低信心）

### B. 市況感知策略啟停

在每輪掃描開始時，先用 `detectMarketRegime(candles1h)` 判斷市況：
- `strong_trend` → 啟用 trend_pullback, trend_confirm；停用 mean_reversion
- `ranging` → 啟用 mean_reversion, pa；停用 trend_pullback, trend_confirm
- `volatile` → 啟用 pa, structure；停用 trend_confirm, mean_reversion
- `compressed` → 啟用 structure；停用 trend_pullback, trend_confirm
- 被停用的策略仍執行掃描但不推送（標記為 `regime_blocked`）

### C. 進場品質閘門

對通過基本過濾的信號，額外檢查：
- 成交量確認（>= 80% 平均量）
- 動量對齊（近 3 根 K 線方向一致）
- RSI 非極端（做多 < 75，做空 > 25）
- 4H EMA20 方向對齊
- 品質分 >= 50 才推送

### D. 智能出場建議

根據市況動態調整 TP/SL 倍數，附加在 Telegram 訊息中：
- 強趨勢：TP × 1.5，啟用移動止損
- 震盪市：TP × 0.8，1R 平半倉
- 高波動：SL/TP × 1.3

### E. 時段 + 波動率加權

- 倫敦/紐約重疊時段：品質乘數 1.3x
- 亞洲時段：品質乘數 0.85x
- 低波動環境：提高門檻
- 高波動環境：略微放寬但配合移動止損

## 實作位置

主要修改 `run_v4_five_strategy_live.ts` 的 `runOnce()` 函數：
1. 掃描開始時：偵測 regime
2. 各策略執行後：收集信號
3. 推送前：evaluateSignal() 綜合評估
4. Telegram 訊息：附加品質分、市況、出場建議
