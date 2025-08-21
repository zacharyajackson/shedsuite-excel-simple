const { Client } = require('pg');
const { logger } = require('../utils/logger');

async function runStartupMigrations() {
  try {
    const connectionString = process.env.SUPABASE_DB_URL;
    if (!connectionString) {
      logger.info('DB migration: SUPABASE_DB_URL not set; skipping startup migrations');
      return;
    }

    // Force SSL and prefer IPv4 to avoid ENETUNREACH on some deploy networks
    const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
    await client.connect();

    // Check current data type of sold_by_dealer
    const checkRes = await client.query(
      `select data_type from information_schema.columns
       where table_schema = 'public' and table_name = 'shedsuite_orders' and column_name = 'sold_by_dealer'`
    );

    const currentType = checkRes.rows[0]?.data_type;
    if (!currentType) {
      logger.info('DB migration: Column sold_by_dealer not found; skipping');
      await client.end();
      return;
    }

    if (currentType === 'boolean') {
      logger.info('DB migration: Altering sold_by_dealer from BOOLEAN to VARCHAR(500)');
      await client.query(
        `alter table public.shedsuite_orders
         alter column sold_by_dealer type varchar(500)
         using case when sold_by_dealer is true then 'true'
                    when sold_by_dealer is false then 'false'
                    else null end;`
      );
      logger.info('DB migration: sold_by_dealer column altered successfully');
    } else {
      logger.info(`DB migration: sold_by_dealer already type ${currentType}; no change`);
    }

    await client.end();
  } catch (error) {
    logger.error('DB migration failed', { error: error.message });
  }
}

module.exports = { runStartupMigrations };


