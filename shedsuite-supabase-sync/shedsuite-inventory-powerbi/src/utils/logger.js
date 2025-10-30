'use strict';

const pino = require('pino');
const pinoHttp = require('pino-http');

function createLogger(level) {
  return pino({
    level,
    base: undefined,
    timestamp: pino.stdTimeFunctions.isoTime
  });
}

function createHttpLogger(logger) {
  return pinoHttp({ logger });
}

module.exports = { createLogger, createHttpLogger };


