import { createLogger } from '../utils/logger.js';
import telegramService from './telegramService.js';
import pushoverService from './pushoverService.js';

const logger = createLogger('alert');

class AlertService {
  constructor() {
    this.isReady = false;
  }

  /**
   * Initialize alert service (checks telegram is connected)
   * Returns true on success, false on failure (caller handles retries)
   */
  async initialize() {
    if (!telegramService.isConnected || !telegramService.bot) {
      logger.error('Cannot initialize alert service: Telegram not connected');
      this.isReady = false;
      return false;
    }
    this.isReady = true;
    logger.info('Alert service initialized');
    return true;
  }

  /**
   * Send OI spike alert via Telegram and Pushover
   */
  async sendOISpikeAlert(signal) {
    if (!this.isReady) {
      logger.error('Alert service not ready');
      return false;
    }

    try {
      const { symbol, type, change5m, change15m, strength, currentOI, previousOI5m, currentOI5m, previousOI15m, currentOI15m, timestamp, buildupChange5m, buildupStrength, buildupTimeAgoMinutes } = signal;

      // Format message once (HTML for Telegram)
      const message = this.formatAlertMessage({
        symbol,
        type,
        change5m,
        change15m,
        strength,
        currentOI,
        previousOI5m,
        currentOI5m,
        previousOI15m,
        currentOI15m,
        timestamp,
        buildupChange5m,
        buildupStrength,
        buildupTimeAgoMinutes,
      });

      // Send to Telegram
      await telegramService.sendAlert(message);

      logger.info('Telegram alert sent', {
        symbol,
        type,
        strength,
        change5m,
        change15m,
      });

      // Send same message to Pushover
      pushoverService.sendAlert(message, signal).catch((err) => {
        logger.error('Pushover alert failed', { error: err.message });
      });
    } catch (error) {
      logger.error('Failed to send Telegram alert', {
        symbol: signal.symbol,
        error: error.message,
      });
      return false;
    }

    return true;
  }

  /**
   * Format alert message according to specification
   */
  formatAlertMessage({ symbol, type, change5m, change15m, strength, currentOI, previousOI5m, currentOI5m, previousOI15m, currentOI15m, timestamp, buildupChange5m, buildupStrength, buildupTimeAgoMinutes }) {
    const bybitUrl = `https://www.bybit.com/trade/usdt/${symbol}`;
    const coinglassUrl = `https://www.coinglass.com/tv/ru/Bybit_${symbol}`;

    // Format timestamp to UTC
    const utcTime = new Date(timestamp).toUTCString();

    // Add emoji based on strength
    const strengthEmoji = this.getStrengthEmoji(strength);

    // Format percentage changes with proper sign
    const formatChange = (val) => (val != null ? (val >= 0 ? `+${val.toFixed(2)}%` : `${val.toFixed(2)}%`) : 'N/A');

    // Format OI values with previous→current notation
    const formatOIPair = (prev, curr) => {
      if (prev == null || curr == null) return '';
      return ` (${prev.toLocaleString()} → ${curr.toLocaleString()})`;
    };

    if (type === 'CASCADE') {
      return `
🚨 CASCADE DETECTED ${strengthEmoji}

Symbol: <b>${symbol}</b>

Earlier:
BUILDUP <b>${formatChange(buildupChange5m)}</b> (${buildupStrength}, ${buildupTimeAgoMinutes} min ago)

Now:
LIQUIDATION <b>${formatChange(change5m)}</b>${formatOIPair(previousOI5m, currentOI5m)}
15m: <b>${formatChange(change15m)}</b>${formatOIPair(previousOI15m, currentOI15m)}

Signal Strength: <b>${strength}</b>

Links:
Bybit: ${bybitUrl}
Coinglass: ${coinglassUrl}

Timestamp: ${utcTime}
      `.trim();
    }

    return `
🚨 OI Event Detected ${strengthEmoji}

Symbol: <b>${symbol}</b>

Type: <b>${type}</b>

OI Change:
• 5m: <b>${formatChange(change5m)}</b>${formatOIPair(previousOI5m, currentOI5m)}
• 15m: <b>${formatChange(change15m)}</b>${formatOIPair(previousOI15m, currentOI15m)}

Signal Strength: <b>${strength}</b>

Links:
Bybit: ${bybitUrl}
Coinglass: ${coinglassUrl}

Timestamp: ${utcTime}
    `.trim();
  }

  /**
   * Get emoji for signal strength
   */
  getStrengthEmoji(strength) {
    switch (strength) {
      case 'EXTREME':
        return '🔴🔴🔴';
      case 'STRONG':
        return '🟠🟠';
      case 'WEAK':
        return '🟡';
      default:
        return '';
    }
  }

  /**
   * Send test message to verify bot is working
   */
  async sendTestMessage() {
    await telegramService.sendTestMessage();
  }

}

export default new AlertService();