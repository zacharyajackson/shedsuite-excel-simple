'use strict';

const { Client } = require('pg');

class MemoryStateStore {
  constructor() {
    this.map = new Map();
  }

  async get(key) {
    return this.map.get(key) || null;
  }

  async set(key, value) {
    this.map.set(key, value);
  }
}

class PostgresStateStore {
  constructor(databaseUrl, logger) {
    this.databaseUrl = databaseUrl;
    this.logger = logger;
    this.client = new Client({ connectionString: databaseUrl });
    this.initialized = false;
  }

  async init() {
    if (this.initialized) return;
    await this.client.connect();
    await this.client.query(
      'CREATE TABLE IF NOT EXISTS service_state (key text PRIMARY KEY, value text NOT NULL)'
    );
    this.initialized = true;
  }

  async get(key) {
    await this.init();
    const res = await this.client.query('SELECT value FROM service_state WHERE key=$1', [key]);
    return res.rows[0]?.value || null;
  }

  async set(key, value) {
    await this.init();
    await this.client.query(
      'INSERT INTO service_state(key, value) VALUES($1, $2) ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value',
      [key, value]
    );
  }
}

function createStateStore(config, logger) {
  if (config.state.store === 'postgres' || config.state.store === 'supabase') {
    if (!config.state.databaseUrl) {
      throw new Error('DATABASE_URL is required for postgres state store');
    }
    return new PostgresStateStore(config.state.databaseUrl, logger);
  }
  return new MemoryStateStore();
}

module.exports = { createStateStore };


