'use strict';

const { config } = require('../config');
const { createLogger } = require('../utils/logger');
const { createStateStore } = require('../state');
const { createShedSuiteClient } = require('../clients/shedsuite');
const { createPostgresClient } = require('../db/postgres');
const { syncInventory } = require('../jobs/syncInventory');

(async () => {
  const logger = createLogger(config.logLevel);
  const stateStore = createStateStore(config, logger);
  const shedsuiteClient = createShedSuiteClient(config, logger);
  const dbClient = createPostgresClient(config, logger);
  try {
    const result = await syncInventory({
      config,
      logger,
      stateStore,
      shedsuiteClient,
      dbClient
    });
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ level: 'info', msg: 'sync completed', result }));
    process.exit(0);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(JSON.stringify({ level: 'error', msg: 'sync failed', error: e.message }));
    process.exit(1);
  }
})();


