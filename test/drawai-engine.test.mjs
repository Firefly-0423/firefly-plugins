import test from 'node:test';
import assert from 'node:assert/strict';
test('no-op save keeps non-default compression bytes exactly', async () => {
    const { deflateRawSync } = await import('node:zlib');
    const made = await engine({ action: 'apply', text: null, ops: [{ op: 'addNode', id: 'a', label: '原样保留' }] });
    const model = made.text.match(/<mxGraphModel[\s\S]*<\/mxGraphModel>/)[0];
    const compressed = deflateRawSync(Buffer.from(encodeURIComponent(model)), { level: 0 }).toString('base64');
    const text = '<mxfile>\r\n<diagram>' + compressed + '</diagram>\r\n</mxfile>';
    const read = await engine({ action: 'read', text });
    assert.equal((await engine({ action: 'save', text, doc: read.doc })).text, text);
});
test('unsupported media stays unchanged and locked layers are excluded from layout', async () => {
    const made = await engine({ action: 'apply', text: null, ops: [{ op: 'addNode', id: 'a', label: 'media', x: 30, y: 40 }, { op: 'addNode', id: 'b', label: 'plain', x: 100, y: 40 }] });
    const text = made.text.replace('<mxCell id="a"', '<mxCell style="shape=image;image=https://example.com/image.png" id="a"');
    const read = await engine({ action: 'read', text });
    assert.ok(read.doc.nodes.find(n => n.id === 'a').style.includes('image='));
    await assert.rejects(engine({ action: 'apply', text, ops: [{ op: 'setLabel', id: 'a', label: 'must not change' }] }), { code: 'E_READONLY' });
    const layout = await engine({ action: 'apply', text, ops: [], layout: 'grid' });
    assert.equal(layout.doc.nodes.find(n => n.id === 'a').x, 30);
    assert.ok(layout.text.includes('image=https://example.com/image.png'));
});
test('expanded page budget includes both plain and compressed pages', async () => {
    const { deflateRawSync } = await import('node:zlib');
    const model = size => '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><!--' + 'x'.repeat(size) + '--></root></mxGraphModel>';
    const plain = model(5 * 1024 * 1024), packed = deflateRawSync(Buffer.from(encodeURIComponent(model(12 * 1024 * 1024)))).toString('base64');
    await assert.rejects(engine({ action: 'read', text: '<mxfile><diagram>' + plain + '</diagram><diagram>' + packed + '</diagram></mxfile>' }), { code: 'E_LIMIT' });
});
test('resize, layout and layer properties use their real editor contracts', async () => {
    let result = await engine({ action: 'apply', text: null, ops: [{ op: 'addNode', id: 'a', label: 'A', x: 0, y: 0 }, { op: 'addNode', id: 'b', label: 'B', x: 0, y: 0 }] });
    result = await engine({ action: 'apply', text: result.text, ops: [{ op: 'setLabel', id: 'a', label: '属性修改' }, { op: 'move', id: 'a', w: 300, h: 200 }] });
    assert.equal(result.doc.nodes[0].w, 300);
    assert.equal(result.doc.nodes[0].h, 200);
    result = await engine({ action: 'apply', text: result.text, ops: [], layout: 'grid' });
    assert.notEqual(result.doc.nodes[0].x, result.doc.nodes[1].x);
    assert.ok(result.doc.nodes[1].x >= result.doc.nodes[0].x + result.doc.nodes[0].w + 40, 'layout must leave room for resized nodes');
    result = await engine({ action: 'apply', text: result.text, ops: [{ op: 'setLayerProps', layer: '1', visible: false, locked: true }] });
    assert.equal(result.doc.layers[0].visible, false);
    assert.equal(result.doc.layers[0].locked, true);
});
import { existsSync } from 'node:fs';
import { mkdtemp, writeFile, readFile, symlink, link, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const engine = createRequire(import.meta.url)('../plugins/drawai/runtime/worker-client.cjs').runEngine;
test('multi-page compressed and unknown XML survives no-op and localized edits', async () => {
    const made = await engine({ action: 'apply', text: null, ops: [{ op: 'addNode', id: 'a', label: '甲', x: 20, y: 30 }] });
    const { deflateRawSync } = await import('node:zlib');
    const model = made.text.match(/<mxGraphModel[\s\S]*<\/mxGraphModel>/)[0].replace('</root>', '<mxCell id="unknown" parent="1" strange="保留"/>\n</root>');
    const second = '<diagram id="p2" name="第二页"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram>';
    const text = '<mxfile custom="keep"><diagram id="p1">' + deflateRawSync(Buffer.from(encodeURIComponent(model))).toString('base64') + '</diagram>' + second + '</mxfile>';
    const read = await engine({ action: 'read', text });
    assert.equal(read.pages, 2);
    assert.equal((await engine({ action: 'save', text, doc: read.doc })).text, text);
    const edit = await engine({ action: 'apply', text, ops: [{ op: 'setLabel', id: 'a', label: '改后' }] });
    assert.ok(edit.text.includes(second));
    assert.equal(edit.doc.nodes[0].label, '改后');
    const expanded = await engine({ action: 'read', text: edit.text });
    assert.equal(expanded.doc.nodes[0].label, '改后');
});
test('engine rejects malformed, dangerous and excessive inputs; batch stays atomic', async () => {
    for (const text of ['<mxfile>', '<!DOCTYPE mxfile><mxfile/>', '<mxfile><diagram>bad!</diagram></mxfile>'])
        await assert.rejects(engine({ action: 'read', text }));
    await assert.rejects(engine({ action: 'read', text: 'x'.repeat(8 * 1024 * 1024 + 1) }), { code: 'E_LIMIT' });
    const abort = new AbortController();
    abort.abort();
    await assert.rejects(engine({ action: 'read', text: 'x' }, { signal: abort.signal }), { code: 'E_CANCELLED' });
    const made = await engine({ action: 'apply', text: null, ops: [{ op: 'addNode', id: 'a', label: 'original' }] });
    await assert.rejects(engine({ action: 'apply', text: made.text, ops: [{ op: 'setLabel', id: 'a', label: 'changed' }, { op: 'addEdge', from: 'a', to: 'missing' }] }));
    assert.equal((await engine({ action: 'read', text: made.text })).doc.nodes[0].label, 'original');
    for (const ops of [[{ op: 'traceImage' }], [{ op: 'addNode', shape: 'svg', svg: '<svg/>' }], [{ op: 'addNode', style: 'image=https://evil' }]])
        await assert.rejects(engine({ action: 'apply', text: null, ops }));
});
test('DrawAI ships an isolated worker engine', async () => {
    assert.ok(existsSync(new URL('../plugins/drawai/runtime/worker-client.cjs', import.meta.url)), 'worker client is missing');
    const { runEngine } = await import('../plugins/drawai/runtime/worker-client.cjs');
    const made = await runEngine({ action: 'apply', text: null, ops: [{ op: 'addNode', id: 'a', label: '开始', x: 10, y: 20 }, { op: 'addNode', id: 'b', label: '结束', x: 250, y: 20 }, { op: 'addEdge', id: 'e', from: 'a', to: 'b' }] });
    assert.match(made.text, /<mxfile/);
    assert.equal(made.doc.nodes.length, 2);
    assert.equal(made.doc.edges[0].from, 'a');
    const read = await runEngine({ action: 'read', text: made.text });
    assert.equal(read.revision, made.revision);
    assert.equal((await runEngine({ action: 'save', text: made.text, doc: read.doc })).text, made.text);
});
