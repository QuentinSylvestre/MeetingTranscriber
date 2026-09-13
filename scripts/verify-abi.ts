// scripts/verify-abi.ts
// ABI spike: run with `npx electron scripts/verify-abi.ts`
// Verifies naudiodon and better-sqlite3 can load in Electron's Node.js runtime.
import { app } from 'electron';

app.whenReady().then(() => {
  let naudiodonOk = false;
  let sqliteOk = false;

  try {
    require('naudiodon');
    naudiodonOk = true;
    console.log('naudiodon: OK');
  } catch (err) {
    console.error('naudiodon: FAIL —', (err as Error).message);
  }

  try {
    const Database = require('better-sqlite3');
    const db = new Database(':memory:');
    db.exec('CREATE TABLE t (x TEXT); INSERT INTO t VALUES ("ok");');
    const row = db.prepare('SELECT x FROM t').get();
    if (row.x === 'ok') {
      sqliteOk = true;
      console.log('better-sqlite3: OK');
    } else {
      console.error('better-sqlite3: FAIL — unexpected value');
    }
    db.close();
  } catch (err) {
    console.error('better-sqlite3: FAIL —', (err as Error).message);
  }

  // SharedArrayBuffer + sandbox:true check
  // Note: SharedArrayBuffer in renderer requires proper isolation headers;
  // here we just confirm the main process can allocate one.
  try {
    const sab = new SharedArrayBuffer(1024);
    const view = new Int32Array(sab);
    view[0] = 42;
    console.log('SharedArrayBuffer: OK (main process allocation)');
  } catch (err) {
    console.error('SharedArrayBuffer: FAIL —', (err as Error).message);
  }

  console.log(`\nSummary:\n  naudiodon: ${naudiodonOk ? 'OK' : 'FAIL'}\n  better-sqlite3: ${sqliteOk ? 'OK' : 'FAIL'}`);
  app.quit();
});
