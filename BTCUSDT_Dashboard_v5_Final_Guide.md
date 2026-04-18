# BTCUSDT Dashboard v5 部署與接續工作指南

本指南旨在幫助您在任何新環境中快速恢復 **BTCUSDT Dashboard v5** 的運行，並接續已完成的策略改良與勝率提升工作。

---

## 🚀 快速啟動流程

### 1. 環境準備
確保系統已安裝以下工具：
- **Node.js** (v18+)
- **pnpm** (推薦) 或 npm
- **PM2** (進程管理)

### 2. 解壓與安裝
```bash
# 1. 解壓縮專案
tar -zxvf BTCUSDT_Dashboard_v5_Final_Package.gz -C ~/btcusdt

# 2. 進入目錄並安裝依賴
cd ~/btcusdt
pnpm install

# 3. 配置環境變數
# 請確保 .env 文件中 KRAKEN_API_KEY / TELEGRAM_BOT_TOKEN 等金鑰已填寫
# 如果沒有 .env，請參考 package.json 或從舊環境複製
```

### 3. 編譯與運行
```bash
# 1. 編譯前端與後端
pnpm run build

# 2. 單獨編譯核心 Live Worker (包含最新勝率提升引擎)
npx esbuild server/run_v4_five_strategy_live.ts --bundle --platform=node --target=node18 --outfile=dist/server/run_v4_five_strategy_live.js

# 3. 使用 PM2 啟動服務
pm2 start dist/index.js --name "btcusdt-dashboard"
pm2 start dist/server/run_v4_five_strategy_live.js --name "btcusdt-live-worker"
```

---

## 🛠 已完成的重大改良 (v4.3+)

專案目前已處於高度優化狀態，以下是您接手時擁有的核心資產：

### 1. 勝率提升引擎 (`server/win_rate_booster.ts`)
這是本次改良的核心，整合了六大模組：
- **多策略共振投票**：當不同家族策略同向時，自動提升信心分。
- **動態市況感知**：自動識別「趨勢」、「震盪」、「高波動」或「壓縮」盤面，並適配對應策略。
- **進場品質強化**：在原有信號上疊加 4H EMA 方向、成交量確認、RSI 極端值過濾。
- **智能出場優化**：根據市況動態調整 TP/SL 比例。

### 2. 家族聚合診斷面板
Dashboard 已新增家族層級的診斷視圖，能自動分析各家族（PA、趨勢回踩、結構等）的通過率與主要阻擋原因。

### 3. 門檻建議引擎
後端會根據歷史 30 輪掃描數據，自動在 Dashboard 顯示「調參建議」，例如當前市場是否需要放寬 1D 方向過濾。

---

## 📈 接續工作建議

如果您想進一步提升表現，建議從以下方向著手：

1. **實作共振過濾器**：
   - 目前 `win_rate_booster.ts` 已寫好評估邏輯，您可以將其正式引入 `run_v4_five_strategy_live.ts` 的 `runVersion` 函數中，作為最終發送 Telegram 前的「否決權 (Veto)」機制。

2. **優化 HWR-B 的 TP 邏輯**：
   - 根據回測，HWR-B 的勝率雖高，但在極端波動中 SL 可能被掃。可以嘗試引入 `SmartExit` 中的「1R 獲利平倉一半」邏輯。

3. **視覺化報告自動化**：
   - 專案根目錄下的 `visualize_win_rates.py` 可定期執行，生成最新的勝率與權益曲線圖。

---

## 📁 檔案結構說明
- `/server`: 後端核心邏輯、策略、回測引擎。
- `/client`: React 前端 Dashboard。
- `/shared`: 前後端共享的類型定義。
- `/runtime`: 存放即時 snapshot 的目錄（建議在 `.env` 中指向此處）。

**祝交易順利！如有任何問題，請隨時召喚 Manus 協助。**
