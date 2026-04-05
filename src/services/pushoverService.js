import { createLogger } from '../utils/logger.js';
import { config } from '../config/config.js';

const logger = createLogger('pushover');

class PushoverService {
  /**
   * Check if Pushover is configured
   */
  get isConfigured() {
    return !!(config.pushover.token && config.pushover.user);
  }

  /**
   * Send a plain text message via Pushover
   */
  async send(message, title = 'OI Scanner', priority = 0) {
    if (!this.isConfigured) {
      logger.debug('Pushover not configured, skipping');
      return false;
    }

    try {
      const body = new URLSearchParams({
        token: config.pushover.token,
        user: config.pushover.user,
        message,
        title,
        priority: String(priority),
      });

      const response = await fetch('https://api.pushover.net/1/messages.json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Pushover API error ${response.status}: ${text}`);
      }

      logger.info('Pushover message sent', { title, priority });
      return true;
    } catch (error) {
      logger.error('Failed to send Pushover message', { error: error.message });
      return false;
    }
  }

  /**
   * Send an alert message (strips HTML from the message)
   */
  async sendAlert(htmlMessage, signal) {
    if (!this.isConfigured) {
      return false;
    }

    // Strip HTML tags to get plain text version
    const plainMessage = htmlMessage.replace(/<[^>]*>/g, '');

    const { symbol, type, strength } = signal;

    // CASCADE always gets priority 2 (emergency)
    const priority = type === 'CASCADE' ? 2 : strength === 'EXTREME' ? 2 : strength === 'STRONG' ? 1 : 0;
    const title = type === 'CASCADE' ? `CASCADE: ${symbol}` : `OI Alert: ${symbol}`;

    logger.info('Sending Pushover alert', { symbol, strength, priority });

    return this.send(plainMessage, title, priority);
  }

  /**
   * Send test message
   */
  async sendTestMessage() {
    if (!this.isConfigured) {
      logger.debug('Pushover not configured, skipping test message');
      return false;
    }

    return this.send(
      '🟢 OI Pressure Scanner — Pushover is configured and working!',
      'OI Scanner Test',
      0
    );
  }

  /**
   * Send shutdown notification
   */
  async sendShutdownMessage() {
    if (!this.isConfigured) {
      logger.debug('Pushover not configured, skipping shutdown message');
      return false;
    }

    return this.send(
      '🔴 OI Pressure Scanner is shutting down.',
      'OI Scanner Shutdown',
      0
    );
  }
}

export default new PushoverService();