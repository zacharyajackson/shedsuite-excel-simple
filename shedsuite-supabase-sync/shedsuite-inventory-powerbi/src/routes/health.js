'use strict';

const express = require('express');

function healthRoute({ stateStore }) {
  const router = express.Router();
  router.get('/health', async (req, res) => {
    // Health endpoint should always return 200 if service is running
    // Even if state store has issues, the service itself is healthy
    try {
      let lastSuccess = null;
      let watermark = null;
      
      // Try to get state, but don't fail if it doesn't work
      try {
        lastSuccess = await stateStore.get('inventory_last_success') || null;
        watermark = await stateStore.get('inventory_watermark') || null;
      } catch (stateError) {
        // State store unavailable, but service is still running
        // This is fine for health check - just log it
        console.warn('State store unavailable in health check:', stateError.message);
      }
      
      res.status(200).json({ 
        status: 'ok', 
        service: 'shedsuite-inventory-sync',
        lastSync: lastSuccess,
        watermark: watermark,
        timestamp: new Date().toISOString()
      });
    } catch (e) {
      // Only return 500 for unexpected errors
      res.status(500).json({ 
        status: 'error', 
        service: 'shedsuite-inventory-sync',
        message: e.message,
        timestamp: new Date().toISOString()
      });
    }
  });
  return router;
}

module.exports = { healthRoute };


