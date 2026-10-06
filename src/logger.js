import { config } from './config.js';

const LEVELS = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
};

const currentLevel = LEVELS[config.logLevel] !== undefined ? LEVELS[config.logLevel] : LEVELS.info;

function formatMessage(level, protocol, msg, meta = {}) {
  const timestamp = new Date().toISOString();
  const tag = protocol ? `[${protocol}]` : '';
  const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
  return `[${timestamp}] [${level.toUpperCase().padEnd(5)}] ${tag} ${msg}${metaStr}`;
}

export const logger = {
  error(msg, protocol = '', meta = {}) {
    if (currentLevel >= LEVELS.error) {
      console.error(formatMessage('error', protocol, msg, meta));
    }
  },
  warn(msg, protocol = '', meta = {}) {
    if (currentLevel >= LEVELS.warn) {
      console.warn(formatMessage('warn', protocol, msg, meta));
    }
  },
  info(msg, protocol = '', meta = {}) {
    if (currentLevel >= LEVELS.info) {
      console.log(formatMessage('info', protocol, msg, meta));
    }
  },
  debug(msg, protocol = '', meta = {}) {
    if (currentLevel >= LEVELS.debug) {
      console.log(formatMessage('debug', protocol, msg, meta));
    }
  },
};
