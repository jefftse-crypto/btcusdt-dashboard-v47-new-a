module.exports = {
  apps: [
    {
      name: 'btcusdt-dashboard',
      script: 'dist/index.js',
      env: {
        NODE_ENV: 'production',
        PORT: '3000',
        JWT_SECRET: 'crypto-dashboard-v57-secure-jwt-secret-key-2026-manus',
        OPENAI_API_KEY: 'cr_b1fba44be8947ba8687fc33442b5cadc107d90ffe53084935e6783dabbb1a91e',
        OPENAI_BASE_URL: 'https://apikey.soxio.me/openai',
        OPENAI_MODEL: 'gpt-5.4',
        TELEGRAM_BOT_TOKEN: '8743009948:AAEEnmRT0No0swpmHODx9aO_8D0z9MOUVqU',
        TELEGRAM_CHAT_ID: '813844991',
        LATEST_LIVE_SNAPSHOT_PATH: '/home/ubuntu/runtime/btcusdt_live_signal_snapshot.json',
        WIN_RATE_MODE: 'strict',
        SYMBOLS: 'ADAUSDT,SUIUSDT,ENAUSDT,AVAXUSDT,NEARUSDT,TAOUSDT,WLDUSDT,SOLUSDT,DOTUSDT,ZECUSDT,AAVEUSDT,BTCUSDT',
      },
      restart_delay: 5000,
      max_restarts: 10,
    },
    {
      name: 'btcusdt-live-worker',
      script: 'dist/server/run_v4_five_strategy_live.js',
      env: {
        NODE_ENV: 'production',
        TELEGRAM_BOT_TOKEN: '8743009948:AAEEnmRT0No0swpmHODx9aO_8D0z9MOUVqU',
        TELEGRAM_CHAT_ID: '813844991',
        LATEST_LIVE_SNAPSHOT_PATH: '/home/ubuntu/runtime/btcusdt_live_signal_snapshot.json',
        WIN_RATE_MODE: 'strict',
        SYMBOLS: 'ADAUSDT,SUIUSDT,ENAUSDT,AVAXUSDT,NEARUSDT,TAOUSDT,WLDUSDT,SOLUSDT,DOTUSDT,ZECUSDT,AAVEUSDT,BTCUSDT',
      },
      restart_delay: 10000,
      max_restarts: 20,
    }
  ]
};
