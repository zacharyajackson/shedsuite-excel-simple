'use strict';

const express = require('express');
const { config } = require('./config');
const { createLogger, createHttpLogger } = require('./utils/logger');
const { createStateStore } = require('./state');
const { createShedSuiteClient } = require('./clients/shedsuite');
const { createPostgresClient } = require('./db/postgres');
const { healthRoute } = require('./routes/health');
const { syncRoute } = require('./routes/sync');
const { syncInventory } = require('./jobs/syncInventory');

async function main() {
  const logger = createLogger(config.logLevel);
  const app = express();
  app.use(createHttpLogger(logger));
  app.use(express.json());

  const stateStore = createStateStore(config, logger);
  const shedsuiteClient = createShedSuiteClient(config, logger);
  const dbClient = createPostgresClient(config, logger);

  app.use(healthRoute({ stateStore }));
  app.use(
    syncRoute({
      config,
      logger,
      stateStore,
      shedsuiteClient,
      dbClient,
      syncInventory
    })
  );

  const port = config.port;
  app.listen(port, () => logger.info({ port }, 'Service listening'));
}

main().catch((err) => {
  // Emit to stderr for pipeline integration
  // eslint-disable-next-line no-console
  console.error(JSON.stringify({ level: 'fatal', msg: 'Failed to start server', err: err.message }));
  process.exit(1);
});


