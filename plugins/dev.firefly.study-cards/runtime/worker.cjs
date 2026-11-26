'use strict';

const {
  parentPort,
  workerData
} = require('node:worker_threads');
const {
  createStore
} = require('./store.cjs');
let store, initError;
try {
  store = createStore(workerData.rootDir);
} catch (e) {
  initError = e;
}
let queue = Promise.resolve();
parentPort.on('message', m => {
  if (m.action === 'dictionaryCancel' && store) {
    try {
      parentPort.postMessage({
        id: m.id,
        data: store.cancelImport(m.args)
      });
    } catch (e) {
      parentPort.postMessage({
        id: m.id,
        error: {
          message: e.message,
          effectState: 'not_applied'
        }
      });
    }
    return;
  }
  queue = queue.then(async () => {
    try {
      if (m.action === '__dispose') {
        if (store) store.dispose();
        parentPort.postMessage({
          id: m.id,
          data: null
        });
        return;
      }
      if (initError) throw initError;
      const data = await store.call(m.action, m.args, m.now);
      parentPort.postMessage({
        id: m.id,
        data
      });
    } catch (e) {
      parentPort.postMessage({
        id: m.id,
        error: {
          message: String(e.message),
          code: e.code || 'INVALID_REQUEST',
          effectState: e.effectState || 'not_applied'
        }
      });
    }
  });
});
