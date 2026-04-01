# Bybit OI Spike Detector

Production-ready Node.js application that monitors cryptocurrency futures markets on Bybit and detects Open Interest (OI) spikes with Telegram alerts. Now supports both OI buildup (accumulation) and liquidation (position closing) detection.

## Features

- **Symbol Selection**: Automatically filters USDT perpetual futures with >$50M 24h turnover and >5% volatility
- **OI Monitoring**: Fetches open interest every 60 seconds with interval-based aggregation
- **Dual Signal Detection**:
  - **BUILDUP** - OI increase (position accumulation): +10% to +25%+ 
  - **LIQUIDATION** - OI decrease (position closing/liquidations): -10% to -20%+
- **Signal Strength**: WEAK (10%/10%), STRONG (15%/15%), EXTREME (25%/20%)
- **Telegram Alerts**: Instant notifications with formatted messages and trading links
- **Interactive Commands**: `/list` command with inline keyboard to explore symbol details
- **Cooldown System**: Prevents duplicate alerts within 10 minutes per symbol
- **Error Resilience**: Retry logic, rate limit handling, and graceful degradation
- **Structured Logging**: Winston logger with console and file outputs
- **Detailed Debug Logging**: Set `LOG_LEVEL=debug` to see raw API responses

## Project Structure

```
/src
  /api
    bybitClient.js      # Bybit API wrapper with intervalTime support and detailed logging
  /services
    symbolService.js    # Symbol selection & filtering
    oiService.js        # OI data collection with interval-based fetching
    signalService.js    # Spike detection - both BUILDUP and LIQUIDATION
    alertService.js     # Telegram spike alert dispatch (supports both event types)
    telegramService.js  # Telegram interactive commands
  /utils
    logger.js           # Winston logger configuration
  /config
    config.js           # Environment-based configuration
  app.js                # Main orchestrator
```

## Prerequisites

- Node.js 18+ (LTS recommended)
- Telegram Bot Token and Chat ID
- Internet connection to access Bybit API

## Installation

1. Clone or download the project
2. Install dependencies:
   ```bash
   npm install
   ```

3. Configure environment variables:
   ```bash
   cp .env.example .env
   ```
   Edit `.env` with your settings:

   ```env
   BYBIT_API_BASE=https://api.bybit.com
   TELEGRAM_BOT_TOKEN=your_bot_token_here
   TELEGRAM_CHAT_ID=your_chat_id_here
   SYMBOL_REFRESH_INTERVAL_MS=900000
   OI_FETCH_INTERVAL_MS=60000
   ALERT_COOLDOWN_MINUTES=10
   CONCURRENT_FETCHES=20
   LOG_LEVEL=info
   ```

   Set `LOG_LEVEL=debug` to see raw API responses (OI data, request/response details).

## Getting Telegram Credentials

1. Open Telegram and search for **@BotFather**
2. Send `/newbot` and follow instructions to create a bot
3. Save the **Bot Token** provided by BotFather
4. To get your **Chat ID**:
   - Search for your bot in Telegram and start a conversation
   - Send any message to the bot
   - Visit: `https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates`
   - Look for `"chat":{"id":123456789,...}` - that number is your Chat ID

## Running the Application

### Development mode (with auto-reload):
```bash
npm run dev
```

### Production mode:
```bash
npm start
```

## How It Works

### 1. Symbol Selection (every 15 minutes)
- Fetches all linear (USDT) perpetual futures tickers from Bybit
- Filters symbols with 24h turnover > $50M
- Filters symbols with 24h volatility > 5%
- Updates the active monitoring list

### 2. OI Data Collection (every 60 seconds)
- Fetches open interest for all active symbols in parallel
- Uses Bybit's interval-based API (`intervalTime=5min` or `15min`)
- Requests only latest 2 data points per call
- Stores current OI value per symbol in memory

### 3. Signal Detection (every 30 seconds)
For each monitored symbol:

**Step 1:** Fetch 5-minute OI change (primary trigger)

**Step 2:** Determine event type and strength:
| Direction | Threshold | Type | Strength |
|-----------|-----------|------|----------|
| Positive | +10% to +15% | BUILDUP | WEAK |
| Positive | +15% to +25% | BUILDUP | STRONG |
| Positive | +25%+ | BUILDUP | EXTREME |
| Negative | -10% to -15% | LIQUIDATION | WEAK |
| Negative | -15% to -20% | LIQUIDATION | STRONG |
| Negative | -20%+ | LIQUIDATION | EXTREME |

**Step 3:** If 5-minute change meets threshold (±10% minimum):
- Fetch 15-minute OI change for confirmation
- 15-minute change must confirm same direction (both positive for buildup, both negative for liquidation)
- If 15-minute signal is stronger, boost to match

**Step 4:** Set 10-minute cooldown per symbol after alert

### 4. Telegram Alerts

**Spike Alert:**
```
🚨 OI Event Detected 🔴🔴🔴

Symbol: <b>BTCUSDT</b>

Type: <b>BUILDUP</b>

OI Change:
• 5m: <b>+28.5%</b>
• 15m: <b>+32.1%</b>

Signal Strength: <b>EXTREME</b>

Current OI: 1,234,567

Links:
Bybit: https://www.bybit.com/trade/usdt/BTCUSDT
Coinglass: https://www.coinglass.com/tv/ru/Bybit_BTCUSDT

Timestamp: Wed, 31 Mar 2026 00:56:00 GMT
```

**Symbol Details (from `/list` command):**
```
📊 Symbol: <b>BTCUSDT</b>

Open Interest:
• Current: <b>1,234,567</b>
• 5m change: <b>+28.5%</b>
• 15m change: <b>+32.1%</b>

Status:
• Signal strength: <b>EXTREME</b>
• Event type: <b>BUILDUP</b>

Market Info:
• 24h Volume: <b>$1.23B</b>
• 24h Range: <b>8.45%</b>

Links:
Bybit: https://www.bybit.com/trade/usdt/BTCUSDT
Coinglass: https://www.coinglass.com/tv/ru/Bybit_BTCUSDT
```

## Logging

Logs are stored in the `logs/` directory. Each service has its own log file:

- `app.log` - Main application logs
- `bybit.log` - Bybit API client logs (set `LOG_LEVEL=debug` for raw responses)
- `symbol.log` - Symbol selection logs
- `oi.log` - Open Interest data collection logs
- `signal.log` - Signal detection logs
- `alert.log` - Telegram spike alert logs
- `telegram.log` - Telegram interactive command logs

All logs include timestamps, service name, level, and structured metadata. Console output uses colorized, human-readable format.

## Configuration Options

| Variable | Default | Description |
|----------|---------|-------------|
| `BYBIT_API_BASE` | `https://api.bybit.com` | Bybit API base URL |
| `TELEGRAM_BOT_TOKEN` | *required* | Telegram bot token from @BotFather |
| `TELEGRAM_CHAT_ID` | *required* | Telegram chat ID to receive alerts |
| `SYMBOL_REFRESH_INTERVAL_MS` | `900000` (15 min) | How often to refresh symbol list |
| `OI_FETCH_INTERVAL_MS` | `60000` (60 sec) | How often to fetch OI data |
| `ALERT_COOLDOWN_MINUTES` | `10` | Minimum time between alerts per symbol |
| `CONCURRENT_FETCHES` | `20` | Number of parallel OI fetch requests |
| `LOG_LEVEL` | `info` | Log level: error, warn, info, debug |

## Signal Detection Logic

### BUILDUP (OI Increasing)
- **Trigger**: 5-minute OI change ≥ +10%
- **Confirmation**: 15-minute OI change must also be positive
- **Strength levels**:
  - WEAK: +10% to +15%
  - STRONG: +15% to +25%
  - EXTREME: +25%+

### LIQUIDATION (OI Decreasing)
- **Trigger**: 5-minute OI change ≤ -10%
- **Confirmation**: 15-minute OI change must also be negative
- **Strength levels**:
  - WEAK: -10% to -15%
  - STRONG: -15% to -20%
  - EXTREME: -20%+

**Note**: The 15-minute interval can boost the signal strength if it's higher than the 5-minute strength.

## Error Handling

- **API Failures**: Retry with exponential backoff (handled by axios interceptor)
- **Rate Limits**: Automatic retry after `retry-after` header or 5 seconds
- **Invalid Data**: Skips symbols with malformed data, continues with others
- **Telegram Errors**: Logs error and continues monitoring
- **Graceful Shutdown**: Handles SIGINT/SIGTERM, stops intervals cleanly

## Performance Considerations

- Uses `p-limit` to control concurrent API requests (default 20)
- In-memory storage for fast access (no database required)
- Non-blocking async/await pattern throughout
- Lazy 15-minute fetch only when 5-minute shows potential signal

## Troubleshooting

### No symbols being monitored
- Check Bybit API connectivity
- Verify turnover/volatility filters may be too strict (adjust in `symbolService.js`)
- Check logs for filtering errors in `symbol.log`

### No Telegram alerts
- Verify bot token and chat ID in `.env`
- Ensure bot has been started in Telegram (send `/start` to your bot)
- Check logs for Telegram connection errors in `alert.log`

### High memory usage
- Monitor number of active symbols (could be hundreds)
- OI data is stored in memory Map, automatically updated on each fetch

### Rate limit errors
- Bybit may rate limit excessive requests
- Reduce `CONCURRENT_FETCHES` if seeing 429 errors
- The client automatically retries after delays

### Understanding log levels
- `error` - Critical failures
- `warn` - Warnings (insufficient data, invalid values)
- `info` - Normal operations (symbol refreshes, OI fetches, signals)
- `debug` - Detailed data (raw API responses, individual OI values) — Set `LOG_LEVEL=debug`

## License

MIT