'use strict';
const { parentPort, workerData } = require('node:worker_threads');
(async () => { try {
    const { processDiagram } = await import('./engine.mjs');
    parentPort.postMessage({ ok: true, value: await processDiagram(workerData) });
}
catch (e) {
    parentPort.postMessage({ ok: false, error: { code: e.code || 'E_DIAGRAM', message: String(e.message).slice(0, 500) } });
} })();
