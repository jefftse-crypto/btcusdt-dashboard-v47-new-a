# BTCUSDT Dashboard v4.7 — 新環境部署說明

> 版本：v4.7 多幣對分散式策略 Worker
> 打包日期：2026-04-18
> 作者：Manus AI

---

## 目錄

1. [系統需求](#一系統需求)
2. [專案結構說明](#二專案結構說明)
3. [快速部署（5 步驟）](#三快速部署5-步驟)
4. [環境變數設定](#四環境變數設定)
5. [啟動服務](#五啟動服務)
6. [驗證運行狀態](#六驗證運行狀態)
7. [常用管理指令](#七常用管理指令)
8. [策略說明與調整](#八策略說明與調整)
9. [回測工具使用](#九回測工具使用)
10. [故障排除](#十故障排除)

---

## 一、系統需求

| 項目 | 最低需求 | 建議 |
|---|---|---|
| OS | Ubuntu 20.04+ / macOS 12+ | Ubuntu 22.04 |
| Node.js | v18+ | v22 LTS |
| pnpm | v8+ | v10 |
| RAM | 1 GB | 2 GB |
| 磁碟 | 2 GB（含 node_modules） | 5 GB |
| 網路 | 可連 Binance/Kraken API | 穩定連線 |

### 安裝 Node.js（若未安裝）
```bash
# 使用 nvm（推薦）
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc
nvm install 22
nvm use 22

# 安裝 pnpm
npm install -g pnpm
```

### 安裝 PM2（程序管理器）
```bash
pnpm install -g pm2
# 或
npm install -g pm2
```

---

## 二、專案結構說明

```
btcusdt/
├── server/                         # 後端核心邏輯
│   ├── _core/                      # Express 伺服器框架
│   ├── services/                   # 各種服務模組
│   ├── utils/                      # 工具函數
│   ├── analysis.ts                 # K 線抓取與技術指標
│   ├── backtest.ts                 # 回測引擎核心
│   ├── win_rate_booster.ts         # 勝率提升引擎（8 項核心 + PA 檢查）
│   ├── live_strategy_governance.ts # 策略治理規則
│   ├── live_btcusdt_strategy_presets.ts  # PA 策略預設
│   ├── diagnostics_engine.ts       # 診斷引擎
│   ├── run_v4_five_strategy_live.ts # ★ Live Worker 主程式（v4.7 多幣對）
│   ├── backtest_year_binance.ts    # 一年回測腳本（Binance 資料源）
│   └── backtest_multi_symbol_strict.ts  # 多幣對 strict 回測
│
├── client/                         # 前端 React Dashboard
│   └── src/
│       ├── pages/                  # 頁面元件
│       └── components/             # UI 元件
│
├── dist/                           # 編譯輸出
│   ├── index.js                    # Dashboard 主服務
│   └── server/
│       └── run_v4_five_strategy_live.js  # Live Worker 編譯版
│
├── shared/                         # 前後端共用型別
├── .env                            # ★ 環境變數（含 API Keys）
├── package.json                    # 依賴定義
├── pnpm-lock.yaml                  # 鎖定版本
├── tsconfig.json                   # TypeScript 設定
├── vite.config.ts                  # 前端打包設定
│
├── v47_year_diagnostic_report.md   # 一年回測分析報告
├── BTCUSDT_Dashboard_v5_Final_Guide.md
└── DEPLOY_README.md                # 本文件
```

---

## 三、快速部署（5 步驟）

### 步驟 1：解壓縮

```bash
tar -zxvf BTCUSDT_Dashboard_v4.7_Package.tar.gz
cd btcusdt/btcusdt
```

### 步驟 2：安裝依賴

```bash
pnpm install
```

> 約需 1~3 分鐘，會安裝約 500MB 的 node_modules。

### 步驟 3：設定環境變數

```bash
cp .env .env.backup   # 備份原始 .env
nano .env             # 編輯設定（見第四節）
```

**必填項目**：
- `TELEGRAM_BOT_TOKEN`：你的 Telegram Bot Token
- `TELEGRAM_CHAT_ID`：你的 Telegram Chat ID

### 步驟 4：建立 runtime 目錄

```bash
mkdir -p /home/ubuntu/runtime
# 若不是 ubuntu 用戶，請修改路徑：
# mkdir -p ~/runtime
# 並在 .env 中更新 LATEST_LIVE_SNAPSHOT_PATH
```

### 步驟 5：編譯並啟動

```bash
# 編譯前端 + 後端主服務
pnpm run build

# 單獨編譯 Live Worker
npx esbuild server/run_v4_five_strategy_live.ts \
  --platform=node --packages=external --bundle \
  --format=esm --outdir=dist/server

# 啟動兩個服務
pm2 start dist/index.js --name btcusdt-dashboard
pm2 start dist/server/run_v4_five_strategy_live.js --name btcusdt-live-worker

# 確認狀態
pm2 list
```

---

## 四、環境變數設定

完整的 `.env` 範本：

```bash
# ── 基礎設定 ──
NODE_ENV=production
PORT=3000                          # Dashboard 監聽端口

# ── 認證 ──
JWT_SECRET=your-secret-key-here    # 自訂一個隨機字串

# ── AI 模型（可選，用於 AI 分析功能）──
OPENAI_API_KEY=your-openai-key
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4o-mini

# ── Telegram 推送（必填）──
TELEGRAM_BOT_TOKEN=1234567890:AAExxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TELEGRAM_CHAT_ID=123456789

# ── Snapshot 路徑 ──
LATEST_LIVE_SNAPSHOT_PATH=/home/ubuntu/runtime/btcusdt_live_signal_snapshot.json

# ── v4.7 多幣對設定 ──
WIN_RATE_MODE=strict               # strict（高勝率）或 balanced（高頻率）
SYMBOLS=BTCUSDT,XRPUSDT,LINKUSDT  # 掃描的幣對（逗號分隔）

# ── Kraken API（可選，不填也能用公開資料）──
KRAKEN_API_KEY=
KRAKEN_PRIVATE_KEY=
```

### WIN_RATE_MODE 說明

| 模式 | 核心容錯 | PA 容錯 | 預期頻率 | 預期勝率 |
|---|---|---|---|---|
| `strict` | ≤ 1 | 0 | ~7 天/筆（單幣） | ~59%（一年實測） |
| `balanced` | S: ≥7 / A: ≥6 | 1（PA1 必過） | ~3.5 天/筆（單幣） | ~56%（一年實測） |

### SYMBOLS 推薦組合

```bash
# 高勝率精選（PA 策略友好）
SYMBOLS=BTCUSDT,SOLUSDT,AVAXUSDT,ETHUSDT

# 原始三幣組合
SYMBOLS=BTCUSDT,XRPUSDT,LINKUSDT

# 單幣（最簡單）
SYMBOLS=BTCUSDT
```

---

## 五、啟動服務

### 一般啟動

```bash
# 啟動 Dashboard（前端 + API）
pm2 start dist/index.js --name btcusdt-dashboard

# 啟動 Live Worker（每 2 分鐘掃描）
pm2 start dist/server/run_v4_five_strategy_live.js --name btcusdt-live-worker

# 設定開機自啟
pm2 startup
pm2 save
```

### 使用 ecosystem 設定檔（推薦）

```bash
# 建立 ecosystem.config.cjs
cat > ecosystem.config.cjs << 'EOF'
module.exports = {
  apps: [
    {
      name: 'btcusdt-dashboard',
      script: 'dist/index.js',
      env_file: '.env',
      restart_delay: 5000,
      max_restarts: 10,
    },
    {
      name: 'btcusdt-live-worker',
      script: 'dist/server/run_v4_five_strategy_live.js',
      env_file: '.env',
      restart_delay: 10000,
      max_restarts: 20,
    }
  ]
};
EOF

# 啟動
pm2 start ecosystem.config.cjs
pm2 save
```

---

## 六、驗證運行狀態

### 確認服務在線

```bash
pm2 list
# 應看到兩個服務都是 online 狀態
```

### 確認 Dashboard 可訪問

```bash
curl http://localhost:3000
# 或在瀏覽器開啟 http://你的IP:3000
```

### 確認 Live Worker 正常掃描

```bash
pm2 logs btcusdt-live-worker --lines 50 --nostream | grep -E "v4\.7|掃描|Snapshot"
```

正常輸出範例：
```
[LiveWorker v4.7] ┏━━ 多幣對輪詢開始：BTCUSDT, XRPUSDT, LINKUSDT ━━┓
[LiveWorker v4.7][BTCUSDT] ========== 掃描開始 2026-04-18T08:32:43Z ==========（模式：strict）
[LiveWorker v4.7][BTCUSDT] K 線：1h=500 4h=500 1d=400 15m=500
[LiveWorker v4.7][BTCUSDT] ✅ Snapshot 已寫入 /home/ubuntu/runtime/btcusdt_live_signal_snapshot.json
[LiveWorker v4.7][BTCUSDT] ========== 掃描完成 ==========
```

### 確認 Snapshot 正常產生

```bash
ls -la /home/ubuntu/runtime/*_live_signal_snapshot.json
# 應看到各幣對的 snapshot 檔案，時間戳應為最近幾分鐘內
```

---

## 七、常用管理指令

### 查看日誌

```bash
pm2 logs btcusdt-live-worker --lines 100 --nostream
pm2 logs btcusdt-dashboard --lines 50 --nostream
```

### 重啟服務（修改 .env 後必須執行）

```bash
# 重啟 Live Worker 並重新載入環境變數
pm2 delete btcusdt-live-worker
source .env && pm2 start dist/server/run_v4_five_strategy_live.js --name btcusdt-live-worker

# 或使用 restart（不一定重新載入 env）
pm2 restart btcusdt-live-worker --update-env
```

### 切換幣對

```bash
# 修改 .env
sed -i 's|^SYMBOLS=.*|SYMBOLS=BTCUSDT,SOLUSDT,AVAXUSDT|' .env

# 重啟 Worker
pm2 delete btcusdt-live-worker
source .env && pm2 start dist/server/run_v4_five_strategy_live.js --name btcusdt-live-worker
```

### 切換模式

```bash
# 切換到 balanced（更多信號）
sed -i 's|^WIN_RATE_MODE=.*|WIN_RATE_MODE=balanced|' .env
pm2 delete btcusdt-live-worker
source .env && pm2 start dist/server/run_v4_five_strategy_live.js --name btcusdt-live-worker

# 切換回 strict（高勝率）
sed -i 's|^WIN_RATE_MODE=.*|WIN_RATE_MODE=strict|' .env
pm2 delete btcusdt-live-worker
source .env && pm2 start dist/server/run_v4_five_strategy_live.js --name btcusdt-live-worker
```

### 停止所有服務

```bash
pm2 stop all
pm2 delete all
```

### 重新編譯（修改程式碼後）

```bash
# 重新編譯前端 + 後端
pnpm run build

# 重新編譯 Live Worker
npx esbuild server/run_v4_five_strategy_live.ts \
  --platform=node --packages=external --bundle \
  --format=esm --outdir=dist/server

# 重啟服務
pm2 restart all
```

---

## 八、策略說明與調整

### 五大策略

| 策略 key | 名稱 | 家族 | TP/SL | 說明 |
|---|---|---|---|---|
| `pa_v4_focus` | PA V4 | pa | 0.5/1.95 | 價格行為策略，勝率最穩定 |
| `hwr_b_guarded` | HWR-B | trend_pullback | 2/1.5 | 趨勢回踩延續 |
| `cannonball_guarded` | CannonBall | structure | 2/1.5 | 結構 + OB/FVG |
| `ema_cross_confirm` | EMA 交叉 | trend_pullback | 2/1.5 | EMA 交叉確認 |
| `vwap_reversion_confirm` | VWAP 回歸 | pa | 1/1.5 | VWAP 均值回歸 |

### 8 項核心確認清單

| 項目 | 說明 | 容錯影響 |
|---|---|---|
| C1_session | 必須在 UTC 7~22 時段 | 可容錯 |
| C2_htf_trend | 4H EMA20 方向一致 | **must-have（A 級）** |
| C3_rsi | RSI 在合理區間 | 可容錯 |
| C4_volume | RVOL ≥ 0.9 | **must-have（A 級）** |
| C5_overextended | 未過度延伸（< 1.8 ATR） | **must-have（A 級）** |
| C6_candle_form | K 線實體 ≥ 35% | 可容錯（建議加入 must-have） |
| C7_momentum | 最近 2 根 K 線方向一致 | 可容錯 |
| C8_atr_health | ATR 百分位 20~88% | 可容錯 |

### 信號品質分級

- **S 級**：核心通過 ≥ 7/8（建議正常倉位）
- **A 級**：核心通過 6/8 + C2/C4/C5 全過（建議半倉）
- **拒絕**：其他情況

---

## 九、回測工具使用

### 一年多幣對回測（Binance 資料源）

```bash
cd ~/btcusdt/btcusdt
npx tsx server/backtest_year_binance.ts
# 結果輸出到 /home/ubuntu/runtime/year_diagnostic_binance.json
```

### 多幣對 strict 模式回測（30 天）

```bash
npx tsx server/backtest_multi_symbol_strict.ts
```

### 頻率掃描回測

```bash
npx tsx server/backtest_frequency_sweep.ts
```

---

## 十、故障排除

### 問題 1：Live Worker 啟動後立即停止

```bash
# 查看錯誤日誌
pm2 logs btcusdt-live-worker --lines 30 --nostream

# 常見原因：.env 未正確載入
# 解決：使用 source 載入
source .env && pm2 start dist/server/run_v4_five_strategy_live.js --name btcusdt-live-worker
```

### 問題 2：K 線抓取失敗

```bash
# 測試 Kraken API
curl "https://api.kraken.com/0/public/OHLC?pair=XBTUSD&interval=60&since=0" | head -c 200

# 測試 Binance API
curl "https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=1h&limit=3"
```

若 Kraken 失敗但 Binance 正常，系統會自動使用快取資料，不影響運作。

### 問題 3：Telegram 沒有收到訊號

```bash
# 測試 Bot Token
curl "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getMe"

# 測試發送訊息
curl -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
  -d "chat_id=${TELEGRAM_CHAT_ID}&text=測試訊息"
```

### 問題 4：Dashboard 無法訪問

```bash
# 確認 port 3000 是否被占用
netstat -tlnp | grep 3000

# 確認服務狀態
pm2 list
pm2 logs btcusdt-dashboard --lines 20 --nostream
```

### 問題 5：pnpm install 失敗

```bash
# 清除快取重試
pnpm store prune
pnpm install --force
```

### 問題 6：esbuild 編譯失敗

```bash
# 確認 TypeScript 無錯誤
npx tsc --noEmit 2>&1 | head -20

# 若有型別錯誤，嘗試忽略型別檢查直接編譯
npx esbuild server/run_v4_five_strategy_live.ts \
  --platform=node --packages=external --bundle \
  --format=esm --outdir=dist/server \
  --log-level=warning
```

---

## 附錄：Snapshot 檔案說明

每個幣對的 snapshot 包含以下資訊：

```json
{
  "symbol": "BTCUSDT",
  "worker_version": "v4.7",
  "generated_at": "2026-04-18T08:34:05Z",
  "market_context": {
    "regime": "weak_trend",
    "adx": 37.7,
    "session": "london"
  },
  "signals": [],
  "state_overview": {
    "strategies": {
      "pa_v4_focus": { "status": "filtered", "reason": "1D EMA200 方向不符" },
      ...
    }
  }
}
```

---

## 附錄：一年回測關鍵結論

根據 `v47_year_diagnostic_report.md`（365 天 × 8 幣對 × 3,272 筆原始信號）：

| 幣對 | strict 勝率 | balanced 勝率 | PF | 推薦 |
|---|---|---|---|---|
| SOLUSDT | **62.1%** | 58.3% | **1.38** | ⭐ 最佳 |
| BTCUSDT | 59.2% | 56.3% | 1.19 | ✅ 推薦 |
| AVAXUSDT | 52.6% | 55.6% | 1.07 | ✅ 可用 |
| XRPUSDT | 58.2% | 54.9% | 1.03 | ⚠️ 邊緣 |
| LINKUSDT | 46.6% | 46.4% | 0.80 | ❌ 不建議 |
| DOGEUSDT | 47.2% | 45.5% | 0.85 | ❌ 不建議 |

**PA 策略是所有幣對中最穩定的策略**（ETH PA 75.9%、AVAX PA 80.8%、DOGE PA 81.8%）。

---

*最後更新：2026-04-18 | BTCUSDT Dashboard v4.7*
