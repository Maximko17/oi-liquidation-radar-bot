import TelegramBot from 'node-telegram-bot-api';
import { createLogger } from './utils/logger.js';
import { config } from './config/config.js';
import symbolService from './services/symbolService.js';
import oiService from './services/oiService.js';
import signalService from './services/signalService.js';
import alertService from './services/alertService.js';
import telegramService from './services/telegramService.js';

const logger = createLogger('app');

/**
 * Retry an async operation with exponential backoff
 * @param {Function} fn - Async function to retry
 * @param {number} maxRetries - Maximum number of attempts
 * @param {number} baseDelayMs - Base delay between retries
 * @param {string} label - Label for logging
 * @returns {Promise<any>} Result or null if all retries failed
 */
async function withRetry(fn, maxRetries = 3, baseDelayMs = 5000, label = 'operation') {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt < maxRetries) {
        const delay = baseDelayMs * Math.pow(2, attempt - 1);
        logger.warn(`${label} failed (attempt ${attempt}/${maxRetries}), retrying in ${delay}ms`, {
          error: error.message,
        });
        await new Promise((resolve) => setTimeout(resolve, delay));
      } else {
        logger.error(`${label} failed after ${maxRetries} attempts`, { error: error.message });
        return null;
      }
    }
  }
  return null;
}

class Application {
  constructor() {
    this.symbolRefreshInterval = null;
    this.mainLoopInterval = null;
    this.telegramReconnectInterval = null;
    this.bot = null;
    this.isRunning = false;
    this.telegramReady = false;
  }

  /**
   * Initialize and start the application
   */
  async initialize() {
    logger.info('Initializing OI Spike Detector...', {
      version: '1.0.0',
      config: {
        mainLoopIntervalMs: config.app.oiFetchIntervalMs,
        symbolRefreshIntervalMs: config.app.symbolRefreshIntervalMs,
        alertCooldownMinutes: config.app.alertCooldownMinutes,
      },
    });

    // Create single Telegram bot instance with polling enabled (for interactive commands)
    this.bot = new TelegramBot(config.telegram.botToken, {
      polling: true, // Enable polling to receive commands and callbacks
    });

    // Inject bot into services before initialization
    alertService.setBot(this.bot);
    telegramService.setBot(this.bot);

    // Initialize Telegram services with retry (non-fatal)
    const alertInitOk = await withRetry(
      () => alertService.initialize(),
      3, 5000, 'Alert service init'
    );
    const telegramInitOk = await withRetry(
      () => telegramService.initialize(),
      3, 5000, 'Telegram service init'
    );
    this.telegramReady = !!(alertInitOk && telegramInitOk);

    if (!this.telegramReady) {
      logger.warn('Telegram services failed to initialize — starting without alerts. Will retry in background.');
      this.startTelegramReconnect();
    }

    // Initial symbol selection
    await this.refreshSymbols();

    // Set up unified main loop (fetch OI + check signals)
    this.mainLoopInterval = setInterval(() => {
      this.runMainLoop();
    }, config.app.oiFetchIntervalMs);

    // Set up symbol refresh loop (every 10-15 minutes)
    this.symbolRefreshInterval = setInterval(() => {
      this.refreshSymbols().catch((error) => {
        logger.error('Symbol refresh failed', { error: error.message });
      });
    }, config.app.symbolRefreshIntervalMs);

    this.isRunning = true;
    logger.info('Application started successfully', { telegramReady: this.telegramReady });

    // Send startup notification (non-fatal)
    if (this.telegramReady) {
      await withRetry(
        () => alertService.sendTestMessage(),
        2, 3000, 'Startup notification'
      );
    }

    // Send Pushover test message (non-fatal)
    await alertService.sendPushoverTestMessage();
  }

  /**
   * Start background Telegram reconnection attempts
   */
  startTelegramReconnect() {
    if (this.telegramReconnectInterval) {
      return; // Already running
    }
    this.telegramReconnectInterval = setInterval(async () => {
      if (this.telegramReady || !this.isRunning) {
        return;
      }
      logger.info('Attempting Telegram reconnection...');
      const alertInitOk = await withRetry(
        () => alertService.initialize(),
        2, 3000, 'Alert service reconnect'
      );
      const telegramInitOk = await withRetry(
        () => telegramService.initialize(),
        2, 3000, 'Telegram service reconnect'
      );
      if (alertInitOk && telegramInitOk) {
        this.telegramReady = true;
        logger.info('Telegram reconnection successful — alerts re-enabled');
        clearInterval(this.telegramReconnectInterval);
        this.telegramReconnectInterval = null;
        // Send notification that we're back online
        await withRetry(() => alertService.sendTestMessage(), 2, 3000, 'Reconnect notification');
      }
    }, 60_000); // Retry every 60 seconds
  }

  /**
   * Main unified loop: fetch OI data then check signals
   */
  async runMainLoop() {
    if (!this.isRunning) {
      return;
    }

    try {
      // Step 1: Fetch OI for all active symbols
      await this.fetchOIForActiveSymbols();

      // Step 2: Check signals for all monitored symbols
      await this.checkSignals();
    } catch (error) {
      logger.error('Error in main loop', { error: error.message });
    }
  }

  /**
   * Refresh the active symbols list
   */
  async refreshSymbols() {
    await symbolService.refreshSymbols();
  }

  /**
   * Fetch OI for all currently active symbols
   */
  async fetchOIForActiveSymbols() {
    const activeSymbols = symbolService.getActiveSymbols();
    if (activeSymbols.length === 0) {
      logger.warn('No active symbols to fetch OI for - check symbol selection');
      return;
    }

    logger.debug('Fetching OI for active symbols', {
      count: activeSymbols.length,
      symbols: activeSymbols.slice(0, 5),
    });

    await oiService.fetchAllOpenInterest(activeSymbols);
  }

  /**
   * Check all monitored symbols for signals
   */
  async checkSignals() {
    if (!this.isRunning) {
      return;
    }

    const monitoredSymbols = oiService.getMonitoredSymbols();

    if (monitoredSymbols.length === 0) {
      logger.debug('No symbols monitored yet for signal checking');
      return;
    }

    let signalsFound = 0;

    for (const symbol of monitoredSymbols) {
      try {
        const signal = await signalService.checkSignal(symbol, oiService);

        if (signal) {
          signalsFound++;
          logger.info('Signal detected', { symbol, strength: signal.strength });

          // Send alert via Telegram (skip if not ready)
          if (this.telegramReady) {
            const sent = await alertService.sendOISpikeAlert(signal);
            if (sent) {
              logger.info('Alert sent successfully', { symbol });
            } else {
              logger.warn('Alert failed to send', { symbol });
            }
          } else {
            logger.warn('Alert skipped — Telegram not available', { symbol });
          }
        }
      } catch (error) {
        logger.error('Error processing signal for symbol', { symbol, error: error.message });
      }
    }

    if (signalsFound > 0) {
      logger.info('Signal check cycle completed', {
        checked: monitoredSymbols.length,
        signals: signalsFound,
      });
    }
  }

  /**
   * Handle symbol button click - send detailed analytics
   */
  async handleSymbolCallback(chatId, symbol) {
    // Check if symbol is being tracked
    if (!symbolService.isActive(symbol)) {
      await this.bot.sendMessage(chatId, `⚠️ Symbol <b>${symbol}</b> is not currently tracked.`, {
        parse_mode: 'HTML',
      });
      logger.warn('Requested symbol not tracked', { chatId, symbol });
      return;
    }

    // Check if OI data exists
    const currentOI = oiService.getCurrentOI(symbol);
    if (currentOI === null) {
      await this.bot.sendMessage(chatId, `⏳ OI data for <b>${symbol}</b> is still loading. Please wait 1-2 minutes and try again.`, {
        parse_mode: 'HTML',
      });
      logger.warn('OI data not ready for symbol', { chatId, symbol });
      return;
    }

    // Generate detailed message (async - needs to fetch 5min/15min data)
    const message = await this.formatSymbolDetails(symbol);

    if (!message) {
      await this.bot.sendMessage(chatId, `❌ Data not available for <b>${symbol}</b> at this time.`, {
        parse_mode: 'HTML',
      });
      logger.warn('Symbol data not available', { chatId, symbol });
      return;
    }

    await this.bot.sendMessage(chatId, message, {
      parse_mode: 'HTML',
      disable_web_page_preview: false, // Show link previews
    });

    logger.info('Sent symbol details', { chatId, symbol });
  }

  /**
   * Format detailed symbol information message (async - fetches OI changes)
   */
  async formatSymbolDetails(symbol) {
    // Get OI data
    const currentOI = oiService.getCurrentOI(symbol);
    if (currentOI === null) {
      return null;
    }

    // Fetch OI changes for both intervals in parallel
    const [change5m, change15m] = await Promise.all([
      oiService.getOIChange(symbol, '5min'),
      oiService.getOIChange(symbol, '15min'),
    ]);

    // Get signal strength (based on 5m change)
    let signalStrength = 'NONE';
    if (change5m.available && change5m.changePercent > 0) {
      const strength = signalService.determineStrength(change5m.changePercent);
      signalStrength = strength ? strength.level : 'NONE';
    }

    // Get market info from symbolService
    const activeSymbols = symbolService.activeSymbols;
    const symbolInfo = activeSymbols.find((s) => s.symbol === symbol);

    if (!symbolInfo) {
      return null;
    }

    // Format 24h volume (turnover)
    const volumeFormatted = this.formatNumber(symbolInfo.turnover24h);
    const rangePercent = (symbolInfo.volatility * 100).toFixed(2);

    // Format changes
    const change5mText = change5m.available ? `+${change5m.changePercent}%` : 'N/A';
    const change15mText = change15m.available ? `+${change15m.changePercent}%` : 'N/A';

    // Build message
    const bybitUrl = `https://www.bybit.com/trade/usdt/${symbol}`;
    const coinglassUrl = `https://www.coinglass.com/tv/${symbol}`;

    return `
📊 Symbol: <b>${symbol}</b>

Open Interest:
• Current: <b>${currentOI.toLocaleString()}</b>
• 5m change: <b>${change5mText}</b>
• 15m change: <b>${change15mText}</b>

Status:
• Signal strength: <b>${signalStrength}</b>

Market Info:
• 24h Volume: <b>$${volumeFormatted}</b>
• 24h Range: <b>${rangePercent}%</b>

Links:
Bybit: ${bybitUrl}
Coinglass: ${coinglassUrl}
    `.trim();
  }

  /**
   * Format large numbers with commas
   */
  formatNumber(num) {
    if (num >= 1_000_000_000) {
      return (num / 1_000_000_000).toFixed(2) + 'B';
    } else if (num >= 1_000_000) {
      return (num / 1_000_000).toFixed(2) + 'M';
    } else if (num >= 1_000) {
      return (num / 1_000).toFixed(2) + 'K';
    }
    return num.toFixed(2);
  }

  /**
   * Shutdown the application
   */
  shutdown() {
    logger.info('Shutting down application...');
    this.isRunning = false;

    if (this.mainLoopInterval) {
      clearInterval(this.mainLoopInterval);
      this.mainLoopInterval = null;
    }

    if (this.symbolRefreshInterval) {
      clearInterval(this.symbolRefreshInterval);
      this.symbolRefreshInterval = null;
    }

    oiService.stop();

    // Stop Telegram reconnection interval
    if (this.telegramReconnectInterval) {
      clearInterval(this.telegramReconnectInterval);
      this.telegramReconnectInterval = null;
    }

     // Shutdown the centralized bot connection
    if (this.bot) {
      this.bot.stopPolling();
      this.bot.close();
      logger.info('Telegram bot shutdown');
    }
    
    logger.info('Application shutdown complete');
    process.exit(0);
  }
}

// Create and start application
const app = new Application();

// Handle graceful shutdown
process.on('SIGINT', () => {
  logger.info('Received SIGINT, initiating shutdown...');
  app.shutdown();
});

process.on('SIGTERM', () => {
  logger.info('Received SIGTERM, initiating shutdown...');
  app.shutdown();
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', { error: error.message, stack: error.stack });
  app.shutdown();
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled promise rejection', { reason, promise });
});

// Start the application
app.initialize().catch((error) => {
  logger.error('Failed to start application', { error: error.message });
  process.exit(1);
});