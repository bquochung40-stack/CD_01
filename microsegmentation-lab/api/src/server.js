'use strict';

const { createApp } = require('./app');
const { createRepository } = require('./repository');

if (!process.env.PGHOST || !process.env.PGUSER || !process.env.PGPASSWORD || !process.env.PGDATABASE) {
  console.error('PGHOST, PGUSER, PGPASSWORD and PGDATABASE are required');
  process.exit(1);
}

const repository = createRepository();
const port = Number(process.env.PORT || 3000);
let server;

async function start() {
  await repository.migrate();
  server = createApp(repository).listen(port, '0.0.0.0', () => {
    console.log('Recipe API listening on port ' + port);
  });
}

start().catch(async (error) => {
  console.error('Recipe API startup failed:', error);
  await repository.close();
  process.exit(1);
});

async function stop() {
  if (!server) {
    await repository.close();
    process.exit(0);
  }
  server.close(async () => {
    await repository.close();
    process.exit(0);
  });
}
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
