'use strict';
const path = require('node:path');
const { Worker } = require('node:worker_threads');
function runEngine(input, { signal, timeoutMs = 10000 } = {}) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted)
            return reject(Object.assign(new Error('操作已取消'), { code: 'E_CANCELLED' }));
        const worker = new Worker(path.join(__dirname, 'worker.cjs'), { workerData: input, resourceLimits: { maxOldGenerationSizeMb: 128 } });
        let done = false;
        const finish = (error, value) => { if (done)
            return; done = true; clearTimeout(timer); signal?.removeEventListener('abort', cancel); void worker.terminate(); error ? reject(error) : resolve(value); };
        const cancel = () => finish(Object.assign(new Error('操作已取消'), { code: 'E_CANCELLED' }));
        const timer = setTimeout(() => finish(Object.assign(new Error('图处理超时'), { code: 'E_TIMEOUT' })), timeoutMs);
        signal?.addEventListener('abort', cancel, { once: true });
        worker.once('message', r => r.ok ? finish(null, r.value) : finish(Object.assign(new Error(r.error.message), { code: r.error.code })));
        worker.once('error', e => finish(e));
        worker.once('exit', code => { if (!done)
            finish(Object.assign(new Error('图处理进程退出: ' + code), { code: 'E_WORKER' })); });
    });
}
module.exports = { runEngine };
