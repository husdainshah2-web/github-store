const engine = require('./db/engine');
const ops = require('./worker/ops');
const { bootstrap } = require('./db/bootstrap');

async function main() {
  const cmd = process.argv[2];
  await bootstrap();
  if (cmd === 'rebuild-index') {
    console.log(await engine.rebuildIndex());
    return;
  }
  if (cmd === 'verify-object') {
    const id = process.argv[3];
    if (!id) throw new Error('usage: verify-object obj_xxx');
    console.log(await ops.verifyObject(id));
    return;
  }
  if (cmd === 'reconcile') {
    const apis = await engine.listApis();
    const report = [];
    for (const a of apis) {
      const ids = await engine.listObjectIdsForApi(a.api_id);
      for (const id of ids) report.push(await ops.verifyObject(id));
    }
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log('commands: rebuild-index | verify-object <id> | reconcile');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
