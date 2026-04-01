import axios from 'axios';
import { createLogger } from '../utils/logger.js';
import { config } from '../config/config.js';

const logger = createLogger('bybit');

class BybitClient {
  constructor() {
    this.client = axios.create({
      baseURL: config.bybit.apiBase,
      timeout: 30000, // 30 seconds - Bybit API can be slow
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Request interceptor for logging
    this.client.interceptors.request.use(
      (request) => {
        logger.info('Bybit API request', {
          method: request.method,
          url: request.url,
          params: request.params,
        });
        return request;
      },
      (error) => Promise.reject(error)
    );

    // Response interceptor for error handling
    this.client.interceptors.response.use(
      (response) => response,
      async (error) => {
        const { response, request, message } = error;

        if (response) {
          // Server responded with non-2xx status
          logger.error('Bybit API error response', {
            status: response.status,
            statusText: response.statusText,
            url: response.config?.url,
            data: response.data,
          });

          // Handle rate limiting (429)
          if (response.status === 429) {
            const retryAfter = response.headers['retry-after']
              ? parseInt(response.headers['retry-after'], 10) * 1000
              : 5000;
            logger.warn('Rate limited, retrying after delay', { retryAfter });
            return new Promise((resolve) => setTimeout(resolve, retryAfter))
              .then(() => this.client(error.config));
          }
        } else if (request) {
          // Request made but no response received
          logger.error('Bybit API request failed', {
            message,
            url: error.config?.url,
          });
        } else {
          // Something else happened
          logger.error('Bybit API setup error', { message });
        }

        return Promise.reject(error);
      }
    );
  }

  /**
   * Fetch tickers for linear (USDT) perpetual futures
   * GET /v5/market/tickers?category=linear
   */
  async fetchLinearTickers() {
    try {
      logger.info('Fetching linear tickers from Bybit');
      const response = await this.client.get('/v5/market/tickers', {
        params: { category: 'linear' },
      });

      if (response.data?.retCode !== 0) {
        throw new Error(`Bybit API error: ${response.data?.retMsg || 'Unknown error'}`);
      }

      const count = response.data.result?.list?.length || 0;
      logger.info('Fetched linear tickers successfully', { count });
      return response.data.result.list;
    } catch (error) {
      logger.error('Failed to fetch linear tickers', { error: error.message });
      throw error;
    }
  }

  /**
   * Fetch open interest for a symbol with interval aggregation
   * GET /v5/market/open-interest?category=linear&symbol={symbol}&intervalTime={intervalTime}&limit={limit}
   *
   * @param {string} symbol - Trading pair symbol (e.g., "BTCUSDT")
   * @param {string} intervalTime - Interval: "5min" or "15min"
   * @param {number} limit - Number of data points to return (default 2)
   * @returns {Array} List of OI data points sorted by timestamp ascending
   */
  async fetchOpenInterest(symbol, intervalTime = '5min', limit = 2) {
    try {
      logger.info('Fetching open interest with interval', {
        symbol,
        intervalTime,
        limit,
      });

      const response = await this.client.get('/v5/market/open-interest', {
        params: {
          category: 'linear',
          symbol,
          intervalTime,
          limit,
        },
      });

      if (response.data?.retCode !== 0) {
        throw new Error(`Bybit API error: ${response.data?.retMsg || 'Unknown error'}`);
      }

      const result = response.data.result;
      if (!result || !result.list || result.list.length === 0) {
        throw new Error(`No open interest data for symbol ${symbol} with interval ${intervalTime}`);
      }

      // Sort by timestamp ascending (oldest first)
      const sortedList = result.list.sort((a, b) => {
        return parseInt(a.timestamp || 0) - parseInt(b.timestamp || 0);
      });

      logger.debug('Fetched open interest', {
        symbol,
        intervalTime,
        count: sortedList.length,
      });

      return sortedList;
    } catch (error) {
      logger.error('Failed to fetch open interest', {
        symbol,
        intervalTime,
        error: error.message,
      });
      throw error;
    }
  }
}

export default new BybitClient();