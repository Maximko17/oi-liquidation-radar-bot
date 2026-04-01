import { createLogger } from '../utils/logger.js';
import { config } from '../config/config.js';

const logger = createLogger('alert');

class AlertService {
  constructor() {
    this.bot = null;
    this.isConnected = false;
  }

  /**
 * Set the Telegram bot instance (dependency injection)
 */
setBot(bot) {
  this.bot = bot;
}

/**
 * Initialize alert service (assumes bot already set)
 * Returns true on success, false on failure (caller handles retries)
 */
async initialize() {
  if (!this.bot) {
    logger.error('Cannot initialize alert service: bot not set');
    return false;
  }

  try {
    // Test connection
    const botInfo = await this.bot.getMe();
    logger.info('Alert service initialized', {
      username: botInfo.username,
      botId: botInfo.id,
    });
    this.isConnected = true;
    return true;
  } catch (error) {
    logger.error('Failed to initialize alert service', { error: error.message });
    this.isConnected = false;
    return false;
  }
}

  /**
   * Send OI spike alert to Telegram
   */
  async sendOISpikeAlert(signal) {
    if (!this.isConnected || !this.bot) {
      logger.error('Telegram bot not initialized');
      return false;
    }

    try {
      const { symbol, type, change5m, change15m, strength, currentOI, timestamp } = signal;

      // Format message according to specification
      const message = this.formatAlertMessage({
        symbol,
        type,
        change5m,
        change15m,
        strength,
        currentOI,
        timestamp,
      });

      await this.bot.sendMessage(config.telegram.chatId, message, {
        parse_mode: 'HTML',
        disable_web_page_preview: false,
      });

      logger.info('Telegram alert sent', {
        symbol,
        type,
        strength,
        change5m,
        change15m,
      });

      return true;
    } catch (error) {
      logger.error('Failed to send Telegram alert', {
        symbol: signal.symbol,
        error: error.message,
      });
      return false;
    }
  }

  /**
   * Format alert message according to specification
   */
  formatAlertMessage({ symbol, type, change5m, change15m, strength, currentOI, timestamp }) {
    const bybitUrl = `https://www.bybit.com/trade/usdt/${symbol}`;
    const coinglassUrl = `https://www.coinglass.com/tv/ru/Bybit_${symbol}`;

    // Format timestamp to UTC
    const utcTime = new Date(timestamp).toUTCString();

    // Add emoji based on strength
    const strengthEmoji = this.getStrengthEmoji(strength);

    // Format percentage changes with proper sign
    const formatChange = (val) => (val >= 0 ? `+${val.toFixed(2)}%` : `${val.toFixed(2)}%`);

    return `
🚨 OI Event Detected ${strengthEmoji}

Symbol: <b>${symbol}</b>

Type: <b>${type}</b>

OI Change:
• 5m: <b>${formatChange(change5m)}</b>
• 15m: <b>${formatChange(change15m)}</b>

Signal Strength: <b>${strength}</b>

Current OI: ${currentOI.toLocaleString()}

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
    if (!this.isConnected || !this.bot) {
      throw new Error('Bot not initialized');
    }

    const testMessage = '🟢 OI Spike Detector is online and working!';
    await this.bot.sendMessage(config.telegram.chatId, testMessage);
    logger.info('Test message sent to Telegram');
  }

}

export default new AlertService();