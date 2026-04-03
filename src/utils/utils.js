import { createLogger } from './logger.js';

const logger = createLogger('retry');

/**
 * Retry an async operation with exponential backoff
 * @param {Function} fn - Async function to retry
 * @param {number} maxRetries - Maximum number of attempts
 * @param {number} baseDelayMs - Base delay between retries
 * @param {string} label - Label for logging
 * @returns {Promise<any>} Result or null if all retries failed
 */
export async function withRetry(fn, maxRetries = 3, baseDelayMs = 5000, label = 'operation') {
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