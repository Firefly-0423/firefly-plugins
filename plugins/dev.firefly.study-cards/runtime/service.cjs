'use strict';
const { Worker } = require('node:worker_threads');
const { join } = require('node:path');

function stopped(effectState = 'not_applied') {
  return Object.assign(new Error('学习数据服务已停止'), { code: 'SERVICE_CLOSED', effectState });
}

function createService({ rootDir, now = Date.now }) {
  const worker = new Worker(join(__dirname, 'worker.cjs'), { workerData: { rootDir } });
  const pending = new Map();
  let next = 0;
  let closed = false;
  let ended = false;
  let disposal;

  function rejectPending(error) {
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  }
  function send(action, args, timestamp) {
    return new Promise((resolve, reject) => {
      const id = ++next;
      pending.set(id, { resolve, reject });
      try {
        worker.postMessage({ id, action, args, now: timestamp });
      } catch (error) {
        pending.delete(id);
        error.effectState = 'not_applied';
        reject(error);
      }
    });
  }
  worker.on('message', message => {
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) {
      request.reject(Object.assign(new Error(message.error.message), {
        code: message.error.code,
        effectState: message.error.effectState,
      }));
    } else request.resolve(message.data);
  });
  worker.on('error', error => {
    closed = true;
    ended = true;
    error.effectState = 'unknown';
    rejectPending(error);
  });
  worker.on('exit', () => {
    closed = true;
    ended = true;
    rejectPending(stopped('unknown'));
  });

  return {
    call(action, args = {}) {
      if (closed) return Promise.reject(stopped());
      let timestamp;
      try { timestamp = now(); }
      catch (error) { return Promise.reject(error); }
      return send(action, args, timestamp);
    },
    dispose() {
      if (disposal) return disposal;
      closed = true;
      rejectPending(stopped('unknown'));
      disposal = (async () => {
        try {
          if (!ended) {
            // Cancellation bypasses the queue; disposal follows the import rollback.
            worker.postMessage({ id: ++next, action: 'dictionaryCancel', args: {} });
            await send('__dispose', {}, 0);
          }
        } finally {
          await worker.terminate();
        }
      })();
      return disposal;
    },
  };
}
module.exports = { createService };
