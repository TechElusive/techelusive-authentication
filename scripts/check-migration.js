// CI check: runs the auth migration up, down and up again against a real PostgreSQL.
// Usage: npm run build && DATABASE_URL=postgres://... node scripts/check-migration.js
require('reflect-metadata');
const { DataSource } = require('typeorm');
const { AUTH_ENTITIES, AUTH_MIGRATIONS } = require('../dist');

async function main() {
  const dataSource = new DataSource({
    type: 'postgres',
    url: process.env.DATABASE_URL,
    entities: AUTH_ENTITIES,
    migrations: AUTH_MIGRATIONS,
  });
  await dataSource.initialize();
  // Every migration up, then each one down in reverse order, then up again.
  await dataSource.runMigrations();
  for (let index = 0; index < AUTH_MIGRATIONS.length; index++) await dataSource.undoLastMigration();
  await dataSource.runMigrations();
  const [{ count }] = await dataSource.query(
    `SELECT count(*)::int AS count FROM information_schema.tables WHERE table_name LIKE 'auth\\_%'`,
  );
  await dataSource.destroy();
  if (count !== 20) throw new Error(`Expected 20 auth tables, found ${count}`);
  console.log('Migration OK: 20 tables');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
