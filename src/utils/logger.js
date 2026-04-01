import winston from 'winston';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Define log formats
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf(
    ({ timestamp, level, message, service, ...meta }) => {
      let msg = `${timestamp} [${service}] ${level}: ${message}`;
      if (Object.keys(meta).length > 0) {
        msg += ` ${JSON.stringify(meta)}`;
      }
      return msg;
    }
  )
);

const fileFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.json()
);

// Create a logger factory that returns a logger for a specific service
export function createLogger(serviceName) {
  const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: fileFormat,
    defaultMeta: { service: serviceName },
    transports: [
      // Console transport (human readable in development)
      new winston.transports.Console({
        format: consoleFormat,
      }),
      // Single service log file (all levels)
      new winston.transports.File({
        filename: join(__dirname, `../logs/${serviceName}.log`),
      }),
    ],
  });

  return logger;
}

// Default logger for general use (backward compatibility)
export const logger = createLogger('app');
