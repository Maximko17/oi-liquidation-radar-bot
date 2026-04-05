import { createLogger } from './utils/logger.js';
import { config } from './config/config.js';
import symbolService from './services/symbolService.js';
import oiService from './services/oiService.js';
import signalService from './services/signalService.js';
import alertService from './services/alertService.js';
import telegramService from './services/telegramService.js';
import pushoverService from './services/pushoverService.js';

const logger = createLogger('app');

class Application {
  constructor() {
    this.symbolRefreshInterval = null;
    this.mainLoopInterval = null;
    this.isRunning = false;
  }

  /**
   * Initialize and start the application
   */
  async initialize() {
    logger.info('Initializing OI Pressure Scanner...', {
      version: '1.0.0',
      config: {
        mainLoopIntervalMs: config.app.oiFetchIntervalMs,
        symbolRefreshIntervalMs: config.app.symbolRefreshIntervalMs,
        alertCooldownMinutes: config.app.alertCooldownMinutes,
      },
    });

    // Initialize Telegram service (handles its own retries internally)
    // Telegram is a hard dependency — app will not start without it
    const telegramInitOk = await telegramService.initialize();

    if (!telegramInitOk) {
      logger.error('Telegram service failed to initialize after retries — shutting down');
      await this.shutdown();
      return;
    }

    // Initialize alert service (depends on telegram being ready)
    await alertService.initialize();

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
    logger.info('Application started successfully');

    // Send startup notification
    await alertService.sendTestMessage();

    // Send Pushover test message (non-fatal)
    await pushoverService.sendTestMessage();
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

          // Send alert via Telegram
          const sent = await alertService.sendOISpikeAlert(signal);
          if (sent) {
            logger.info('Alert sent successfully', { symbol });
          } else {
            logger.warn('Alert failed to send', { symbol });
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
   * Shutdown the application
   */
  async shutdown() {
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

    // Shutdown Telegram service (handles bot cleanup)
    telegramService.shutdown();

    // Send shutdown notification via Pushover
    try {
      await pushoverService.sendShutdownMessage();
    } catch (e) {
      // Ignore errors during shutdown
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
  app.shutdown().catch(() => process.exit(1));
});

process.on('SIGTERM', () => {
  logger.info('Received SIGTERM, initiating shutdown...');
  app.shutdown().catch(() => process.exit(1));
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', { error: error.message, stack: error.stack });
  app.shutdown().catch(() => process.exit(1));
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled promise rejection', { reason, promise });
});

// Start the application
app.initialize().catch((error) => {
  logger.error('Failed to start application', { error: error.message });
  process.exit(1);
});