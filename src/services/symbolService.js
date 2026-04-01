import bybitClient from '../api/bybitClient.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('symbol');

class SymbolService {
  constructor() {
    this.activeSymbols = [];
    this.lastUpdate = null;
  }

  /**
   * Filter symbols based on criteria:
   * - USDT perpetual futures only
   * - turnover24h > 50,000,000 USD
   * - (highPrice24h - lowPrice24h) / lowPrice24h > 0.05 (5% volatility)
   */
  filterSymbols(tickers) {
    const filtered = [];

    for (const ticker of tickers) {
      try {
        // Only USDT perpetual futures (symbol ends with USDT)
        if (!ticker.symbol.endsWith('USDT')) {
          continue;
        }

        // Parse turnover (24h volume in USD)
        const turnover24h = parseFloat(ticker.turnover24h || 0);
        if (turnover24h <= 50_000_000) {
          continue;
        }

        // Calculate volatility: (high - low) / low
        const highPrice = parseFloat(ticker.highPrice24h || 0);
        const lowPrice = parseFloat(ticker.lowPrice24h || 0);

        if (lowPrice <= 0 || highPrice <= 0) {
          logger.warn('Invalid price data for symbol, skipping', {
            symbol: ticker.symbol,
            highPrice,
            lowPrice,
          });
          continue;
        }

        const volatility = (highPrice - lowPrice) / lowPrice;
        if (volatility <= 0.05) {
          continue;
        }

        filtered.push({
          symbol: ticker.symbol,
          turnover24h,
          volatility,
          lastPrice: parseFloat(ticker.lastPrice || 0),
        });
      } catch (error) {
        logger.error('Error filtering symbol', {
          symbol: ticker.symbol,
          error: error.message,
        });
        continue;
      }
    }

    return filtered;
  }

  /**
   * Refresh the active symbols list from Bybit API
   */
  async refreshSymbols() {
    try {
      logger.info('Fetching tickers from Bybit...');
      const tickers = await bybitClient.fetchLinearTickers();

      const previousCount = this.activeSymbols.length;
      this.activeSymbols = this.filterSymbols(tickers);
      this.lastUpdate = new Date();

      logger.info('Symbol selection completed', {
        totalTickers: tickers.length,
        selectedSymbols: this.activeSymbols.length,
        added: this.activeSymbols.length - previousCount,
        symbols: this.activeSymbols.map((s) => s.symbol),
      });

      return this.activeSymbols;
    } catch (error) {
      logger.error('Failed to refresh symbols', { error: error.message });
      // Return existing list on failure
      return this.activeSymbols;
    }
  }

  /**
   * Get current active symbols
   */
  getActiveSymbols() {
    return this.activeSymbols.map((s) => s.symbol);
  }

  /**
   * Check if a symbol is in the active list
   */
  isActive(symbol) {
    return this.activeSymbols.some((s) => s.symbol === symbol);
  }
}

export default new SymbolService();