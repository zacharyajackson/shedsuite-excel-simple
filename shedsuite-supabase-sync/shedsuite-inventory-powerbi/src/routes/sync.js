'use strict';

const express = require('express');

function requireSecret(secret) {
  return function (req, res, next) {
    if (!secret) return next();
    const provided = req.header('x-sync-secret') || req.query.secret;
    if (provided !== secret) return res.status(401).json({ error: 'unauthorized' });
    next();
  };
}

function syncRoute({ config, logger, stateStore, shedsuiteClient, dbClient, syncInventory }) {
  const router = express.Router();
  const guard = requireSecret(config.security.syncSharedSecret);

  router.post('/sync/inventory', guard, async (req, res) => {
    try {
      const result = await syncInventory({ config, logger, stateStore, shedsuiteClient, dbClient });
      res.status(200).json({ ok: true, ...result });
    } catch (e) {
      logger.error({ err: e }, 'Sync failed');
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // Convenience GET for ad-hoc triggering
  router.get('/sync/inventory', guard, async (req, res) => {
    try {
      const result = await syncInventory({ config, logger, stateStore, shedsuiteClient, dbClient });
      res.status(200).json({ ok: true, ...result });
    } catch (e) {
      logger.error({ err: e }, 'Sync failed');
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  return router;
}

module.exports = { syncRoute };


