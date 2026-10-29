import { createRequire } from 'node:module';
import { isDeepStrictEqual } from 'node:util';
import { inflateRawSync, inflateSync } from 'node:zlib';
import { parseMxfile, buildMxfile, applyDocToMxfile, contentHash } from '../upstream/mxfile.mjs';
import { applyOps } from '../upstream/operations.mjs';
const { SaxesParser } = createRequire(import.meta.url)('../vendor/saxes.cjs');
const INPUT = 8 * 1024 * 1024, EXPANDED = 16 * 1024 * 1024;
function fail(code, message) { throw Object.assign(new Error(message), { code }); }
export function validateXml(text) {
    if (typeof text !== 'string' || Buffer.byteLength(text) > INPUT)
        fail('E_LIMIT', '图文件超过 8 MiB');
    if (/<!DOCTYPE|<!ENTITY/i.test(text) || text.includes('\0'))
        fail('E_XML', '不支持 DTD、实体声明或非 UTF-8 XML');
    let depth = 0, count = 0, diagram = null, pages = 0, expanded = 0, root;
    const parser = new SaxesParser({ xmlns: false });
    parser.on('error', () => fail('E_XML', '图文件 XML 无效'));
    parser.on('opentag', node => {
        root ??= node.name;
        if (++depth > 128 || ++count > 25000)
            fail('E_LIMIT', 'XML 结构超过限制');
        if (Object.keys(node.attributes).length > 128 || Object.values(node.attributes).some(v => String(v).length > 65536))
            fail('E_LIMIT', 'XML 属性超过限制');
        if (node.name === 'diagram') {
            if (++pages > 25)
                fail('E_LIMIT', '最多支持 25 页');
            diagram = { depth, body: '', nested: false, start: parser.position };
        }
        else if (diagram)
            diagram.nested = true;
    });
    const textEvent = s => { if (diagram && depth === diagram.depth)
        diagram.body += s; };
    parser.on('text', textEvent);
    parser.on('cdata', textEvent);
    parser.on('closetag', node => {
        if (node.name === 'diagram' && diagram) {
            if (!diagram.nested && diagram.body.trim()) {
                const body = diagram.body.trim();
                let decoded = body;
                if (!body.startsWith('<')) {
                    if (!/^[A-Za-z0-9+/=\s]+$/.test(body))
                        fail('E_XML', '图页压缩数据无效');
                    const b = Buffer.from(body, 'base64');
                    let raw;
                    try {
                        raw = inflateRawSync(b, { maxOutputLength: EXPANDED - expanded });
                    }
                    catch (e) {
                        if (e.code === 'ERR_BUFFER_TOO_LARGE')
                            fail('E_LIMIT', '图页解压超过限制');
                        try {
                            raw = inflateSync(b, { maxOutputLength: EXPANDED - expanded });
                        }
                        catch {
                            fail('E_XML', '图页无法解压');
                        }
                    }
                    try {
                        decoded = decodeURIComponent(raw.toString('utf8'));
                    }
                    catch {
                        fail('E_XML', '图页编码无效');
                    }
                }
                expanded += Buffer.byteLength(decoded);
                if (expanded > EXPANDED)
                    fail('E_LIMIT', '展开图页超过 16 MiB');
                validateModel(decoded);
            }
            else
                expanded += Buffer.byteLength(text.slice(diagram.start, parser.position));
            if (expanded > EXPANDED)
                fail('E_LIMIT', '展开图页超过 16 MiB');
            diagram = null;
        }
        depth--;
    });
    parser.write(text).close();
    if (!['mxfile', 'mxGraphModel'].includes(root))
        fail('E_XML', '需要 draw.io XML');
    if (root === 'mxfile' && !pages)
        fail('E_XML', '缺少图页');
    return pages || 1;
}
function validateModel(text) {
    if (/<!DOCTYPE|<!ENTITY/i.test(text))
        fail('E_XML', '不支持实体');
    let depth = 0, count = 0, root;
    const p = new SaxesParser();
    p.on('error', () => fail('E_XML', '图页 XML 无效'));
    p.on('opentag', n => { root ??= n.name; if (++depth > 128 || ++count > 25000)
        fail('E_LIMIT', '图页结构超过限制'); if (Object.values(n.attributes).some(v => String(v).length > 65536))
        fail('E_LIMIT', '图页属性超过限制'); });
    p.on('closetag', () => depth--);
    p.write(text).close();
    if (root !== 'mxGraphModel')
        fail('E_XML', '图页缺少 mxGraphModel');
}
const allowed = new Set(['addNode', 'addEdge', 'duplicate', 'move', 'order', 'setEdge', 'setLabelPos', 'addLayer', 'setLayer', 'setLayerProps', 'setLabel', 'setStyle', 'remove']);
const keys = new Set(['op', 'id', 'ids', 'as', 'label', 'shape', 'x', 'y', 'w', 'h', 'dx', 'dy', 'from', 'to', 'fromPoint', 'toPoint', 'sourcePoint', 'targetPoint', 'style', 'color', 'fontColor', 'fontSize', 'dash', 'arrow', 'line', 'layer', 'name', 'visible', 'locked', 'order', 'withEdges', 'position', 'index', 'points', 'side', 'fromSide', 'toSide', 'startArrow', 'endArrow', 'align', 'labelX', 'labelY', 'offsetX', 'offsetY', 'fillColor', 'strokeColor']);
const shapes = new Set(['rect', 'rounded', 'ellipse', 'diamond', 'cylinder', 'document', 'text']);
function validateOps(ops) {
    if (!Array.isArray(ops) || !ops.length || ops.length > 100)
        fail('E_ARGUMENT', '需要 1–100 个操作');
    for (const op of ops) {
        if (!op || typeof op !== 'object' || Array.isArray(op) || !allowed.has(op.op))
            fail('E_ARGUMENT', '不支持该改图操作');
        for (const [key, value] of Object.entries(op)) {
            if (!keys.has(key))
                fail('E_ARGUMENT', '未知操作字段: ' + key);
            if (typeof value === 'number' && (!Number.isFinite(value) || Math.abs(value) > 1000000))
                fail('E_ARGUMENT', '坐标超出范围');
            if (typeof value === 'string' && value.length > (key === 'label' ? 4096 : 8192))
                fail('E_LIMIT', '操作文本过长');
            if (['style', 'color', 'fontColor', 'fillColor', 'strokeColor'].includes(key) && typeof value === 'string' && /image|url\(|javascript|data:|<|html=1/i.test(value))
                fail('E_ARGUMENT', '首版仅支持固定形状与纯文本样式');
        }
        if (op.shape && !shapes.has(op.shape))
            fail('E_ARGUMENT', '不支持该节点形状');
    }
}
function checkDoc(doc) {
    if (!doc || !Array.isArray(doc.nodes) || !Array.isArray(doc.edges) || doc.nodes.length + doc.edges.length > 1000)
        fail('E_LIMIT', '当前页最多 1000 个节点和连线');
    const ids = new Set();
    for (const c of [...doc.nodes, ...doc.edges]) {
        if (typeof c.id !== 'string' || !c.id || c.id.length > 256 || ids.has(c.id) || ['__proto__', 'constructor', 'prototype'].includes(c.id))
            fail('E_ARGUMENT', '单元 id 无效或重复');
        ids.add(c.id);
        if (typeof c.label === 'string' && c.label.length > 4096)
            fail('E_LIMIT', '标签超过 4096 字符');
        for (const key of ['x', 'y', 'w', 'h'])
            if (c[key] !== undefined && (!Number.isFinite(c[key]) || Math.abs(c[key]) > 1000000 || (key === 'w' || key === 'h') && c[key] <= 0))
                fail('E_ARGUMENT', '节点几何无效');
    }
    const nodes = new Set(doc.nodes.map(n => n.id));
    for (const e of doc.edges)
        for (const k of ['from', 'to'])
            if (e[k] && !nodes.has(e[k]))
                fail('E_ARGUMENT', '连线指向不存在的节点');
}
function isReadOnly(doc, cell) { return /(?:^|;)image=/.test(cell.style || '') || !!cell.data?.mediaKind || (doc.layers || []).some(l => l.id === cell.layer && l.locked); }
function layout(doc, kind) {
    if (!kind || kind === 'none')
        return;
    if (!['grid', 'dagre-tb', 'dagre-lr'].includes(kind))
        fail('E_ARGUMENT', '布局无效');
    const nodes = doc.nodes.filter(n => !isReadOnly(doc, n)), horizontal = kind === 'dagre-lr', level = new Map(nodes.map(n => [n.id, 0]));
    for (let i = 0; i < nodes.length; i++) {
        let changed = false;
        for (const e of doc.edges) {
            if (e.from === e.to || !level.has(e.from) || !level.has(e.to))
                continue;
            const next = Math.min(nodes.length - 1, (level.get(e.from) || 0) + 1);
            if (next > (level.get(e.to) || 0)) {
                level.set(e.to, next);
                changed = true;
            }
        }
        if (!changed)
            break;
    }
    const pitchX = Math.max(130, ...nodes.map(n => n.w || 130)) + 80, pitchY = Math.max(60, ...nodes.map(n => n.h || 60)) + 70;
    const rows = new Map();
    nodes.forEach((n, i) => { const row = kind === 'grid' ? Math.floor(i / 4) : Math.min(level.get(n.id) || 0, 20); const col = kind === 'grid' ? i % 4 : (rows.get(row) || 0); rows.set(row, col + 1); n.x = 60 + (horizontal ? row : col) * pitchX; n.y = 60 + (horizontal ? col : row) * pitchY; });
}
export async function processDiagram(input) {
    const { action, page = 0 } = input;
    if (!Number.isInteger(page) || page < 0 || page >= 25)
        fail('E_ARGUMENT', '页索引无效');
    let text = input.text, parsed;
    if (text !== null && text !== undefined) {
        validateXml(text);
        parsed = parseMxfile(text, { page });
        if (page >= parsed.pageCount)
            fail('E_ARGUMENT', '该页不存在');
    }
    else {
        if (action !== 'apply' && action !== 'new')
            fail('E_ARGUMENT', '缺少图文件');
        parsed = { doc: { nodes: [], edges: [], layers: [{ id: '1', name: '默认图层', visible: true, locked: false }], meta: {} }, notes: [], pageCount: 1, pageNames: ['Page-1'], pageIndex: 0 };
    }
    let doc = structuredClone(parsed.doc);
    checkDoc(doc);
    const changes = {};
    if (action === 'apply') {
        if (!(Array.isArray(input.ops) && input.ops.length === 0 && input.layout && input.layout !== 'none')) {
            validateOps(input.ops);
            for (const op of input.ops) {
                const ids = op.ids || [op.id];
                for (const cell of [...doc.nodes, ...doc.edges])
                    if (ids.includes(cell.id) && isReadOnly(doc, cell))
                        fail('E_READONLY', '媒体内容或锁定图层不能修改');
            }
            await applyOps(doc, input.ops, changes);
        }
        layout(doc, input.layout);
        checkDoc(doc);
    }
    else if (action === 'save') {
        if (!input.doc)
            fail('E_ARGUMENT', '缺少文档');
        doc = input.doc;
        checkDoc(doc);
    }
    else if (action !== 'read' && action !== 'new')
        fail('E_ARGUMENT', '未知文档操作');
    if (action !== 'read') {
        // An unchanged compressed page must retain its original compression
        // bytes too, rather than being recompressed with our default options.
        const written = text == null ? buildMxfile(doc) : isDeepStrictEqual(doc, parsed.doc) ? { text, dropped: [] } : applyDocToMxfile(text, doc, { page });
        text = written.text;
        if (written.dropped?.length)
            fail('E_ARGUMENT', '改图会丢弃连线，已取消');
        validateXml(text);
        parsed = parseMxfile(text, { page });
        doc = parsed.doc;
        checkDoc(doc);
    }
    return { text, doc, revision: contentHash(text), notes: parsed.notes || [], pages: parsed.pageCount, pageNames: parsed.pageNames, page, changes };
}
