import * as G from '../upstream/geometry.mjs';
import * as S from '../upstream/style-kernel.mjs';
const $ = id => document.getElementById(id), api = window.DrawAI, NS = 'http://www.w3.org/2000/svg';
const SHAPES = [['rect', '矩形'], ['rounded', '圆角矩形'], ['ellipse', '椭圆'], ['diamond', '判断'], ['cylinder', '数据库'], ['document', '文档'], ['text', '文字']];
let state = null, selected = [], mode = 'select', view = { x: -120, y: -80, w: 1000, h: 720 }, gesture = null, space = false, busy = 0, connecting = null, theme = 'firefly-dark', lastClick = { id: null, time: 0 };
const canvas = $('canvas'), stage = $('stage');
const uid = () => crypto.randomUUID().replaceAll('-', '').slice(0, 12);
function el(tag, attrs = {}, text) { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs))
    if (v !== undefined && v !== null)
        n.setAttribute(k, String(v)); if (text !== undefined)
    n.textContent = text; return n; }
function html(tag, text, attrs = {}) { const n = document.createElement(tag); if (text !== undefined)
    n.textContent = text; for (const [k, v] of Object.entries(attrs))
    n[k] = v; return n; }
function status(message, isError = false) { $('status').textContent = message; $('status').classList.toggle('error', isError); }
function color(value, fallback) { return typeof value === 'string' && /^(#[a-f0-9]{3,8}|none|transparent|black|white|red|blue|green|grey|gray|yellow)$/i.test(value) ? value : fallback; }
function point(event) { const p = canvas.createSVGPoint(); p.x = event.clientX; p.y = event.clientY; const m = canvas.getScreenCTM(); return m ? p.matrixTransform(m.inverse()) : { x: 0, y: 0 }; }
function available() { return !!state && !busy; }
function isMedia(node) { return /(?:^|;)image=/.test(node?.style || '') || !!node?.data?.mediaKind; }
function editable(ids) { if (!state)
    return []; const accepted = G.filterEditableIds(state.doc, ids); return accepted.filter(id => !isMedia(state.doc.nodes.find(n => n.id === id))); }
function accept(next) { if (!next || next.canceled)
    return; state = next; selected = selected.filter(id => [...state.doc.nodes, ...state.doc.edges].some(c => c.id === id)); connecting = null; render(); }
async function action(fn, message) { if (busy) return null; busy++; updateButtons(); try {
    const result = await fn();
    if (result?.handle)
        accept(result);
    if (message && !result?.canceled)
        status(message);
    return result;
}
catch (e) {
    status((e.code ? e.code + ' · ' : '') + e.message, true);
    throw e;
}
finally {
    busy--;
    updateButtons();
} }
function run(fn, message) { return action(fn, message).catch(() => null); }
function updateButtons() { for (const id of ['new', 'open', 'empty-new']) $(id).disabled = busy > 0;
    for (const button of document.querySelectorAll('.shape')) button.disabled = !state || busy > 0;
    for (const id of ['save', 'save-as', 'export-svg', 'export-png', 'fit', 'layout-tb', 'layout-lr', 'layout-grid', 'mode-connect'])
    $(id).disabled = !state || busy > 0; $('undo').disabled = !state?.canUndo || busy > 0; $('redo').disabled = !state?.canRedo || busy > 0; $('save-state').textContent = state ? (state.dirty ? '未保存' : '已保存') : '本地文件'; $('save-state').classList.toggle('dirty', !!state?.dirty); }
async function mutate(ops, layout) { if (!available())
    return; const revision = state.revision; return run(() => api.editDocument({ revision, ops, layout }), '画布已修改 · Ctrl+S 保存'); }
function selection(ids) { selected = [...new Set(ids)]; if (state)
    void api.select({ ids: selected }).catch(e => status(e.message, true)); render(); }
function fit() { if (!state)
    return; const b = G.buildGeometry(state.doc).bounds; view = G.computeFitView(b, Math.max(.2, stage.clientHeight / stage.clientWidth)); render(); }
function setMode(value) { mode = value; connecting = null; for (const k of ['select', 'connect', 'pan'])
    $('mode-' + k).classList.toggle('active', k === mode); canvas.style.cursor = mode === 'pan' ? 'grab' : mode === 'connect' ? 'crosshair' : 'default'; }
function drawShape(group, shape, x, y, w, h, attrs) {
    if (shape === 'ellipse')
        group.append(el('ellipse', { cx: x + w / 2, cy: y + h / 2, rx: w / 2, ry: h / 2, ...attrs }));
    else if (shape === 'diamond')
        group.append(el('polygon', { points: [x + w / 2, y, x + w, y + h / 2, x + w / 2, y + h, x, y + h / 2].join(' '), ...attrs }));
    else if (shape === 'cylinder') {
        const ry = Math.min(12, h / 5);
        group.append(el('path', { d: 'M ' + x + ' ' + (y + ry) + ' C ' + x + ' ' + (y - ry / 2) + ' ' + (x + w) + ' ' + (y - ry / 2) + ' ' + (x + w) + ' ' + (y + ry) + ' V ' + (y + h - ry) + ' C ' + (x + w) + ' ' + (y + h + ry / 2) + ' ' + x + ' ' + (y + h + ry / 2) + ' ' + x + ' ' + (y + h - ry) + ' Z', ...attrs }));
        group.append(el('ellipse', { cx: x + w / 2, cy: y + ry, rx: w / 2, ry, ...attrs, fill: 'none' }));
    }
    else if (shape === 'document')
        group.append(el('path', { d: 'M ' + x + ' ' + y + ' H ' + (x + w) + ' V ' + (y + h - 10) + ' C ' + (x + w * .65) + ' ' + (y + h + 15) + ' ' + (x + w * .35) + ' ' + (y + h - 20) + ' ' + x + ' ' + (y + h - 2) + ' Z', ...attrs }));
    else
        group.append(el('rect', { x, y, width: w, height: h, rx: shape === 'rounded' ? 12 : 0, ...attrs, fill: shape === 'text' ? 'none' : attrs.fill, stroke: shape === 'text' ? 'none' : attrs.stroke }));
}
function render() {
    canvas.replaceChildren();
    canvas.setAttribute('viewBox', [view.x, view.y, view.w, view.h].join(' '));
    const dark = theme === 'firefly-dark', paper = dark ? '#14202b' : '#ffffff', defaultStroke = dark ? '#b1c2d3' : '#596d80', defaultFill = dark ? '#243747' : '#f2f7fa', defaultText = dark ? '#ecf2f8' : '#253747', accent = dark ? '#80dbc8' : '#227c6c';
    const defs = el('defs'), pattern = el('pattern', { id: 'grid', width: 20, height: 20, patternUnits: 'userSpaceOnUse' });
    pattern.append(el('circle', { cx: 1, cy: 1, r: .65, fill: dark ? '#3d5061' : '#cad6de' }));
    defs.append(pattern);
    canvas.append(defs);
    canvas.append(el('rect', { x: view.x, y: view.y, width: view.w, height: view.h, fill: 'url(#grid)', 'data-background': '1' }));
    $('empty').hidden = !!state;
    $('file-name').textContent = state?.name || '尚未打开图文件';
    if (!state) {
        updateButtons();
        inspector();
        return;
    }
    const geometry = G.buildGeometry(state.doc), hidden = G.hiddenLayerIds(state.doc), scale = view.w / Math.max(1, stage.clientWidth);
    for (const edge of state.doc.edges) {
        if (G.isHiddenCell(hidden, edge))
            continue;
        const from = geometry.byId[edge.from], to = geometry.byId[edge.to];
        let points;
        try {
            points = from && to ? G.routeEdgeStyled(from, to, geometry.boxes, geometry.bounds, edge) : [edge.sourcePoint || { x: 0, y: 0 }, edge.targetPoint || { x: 100, y: 100 }];
        }
        catch {
            points = from && to ? [{ x: from.geo.x + from.geo.w / 2, y: from.geo.y + from.geo.h / 2 }, { x: to.geo.x + to.geo.w / 2, y: to.geo.y + to.geo.h / 2 }] : [];
        }
        if (points.length < 2 || points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y)))
            continue;
        const raw = S.parseStyle(edge.style || ''), stroke = color(raw.strokeColor, defaultStroke), marker = 'arrow-' + edge.id.replace(/[^a-z0-9_-]/gi, '');
        const mark = el('marker', { id: marker, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' });
        mark.append(el('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: stroke }));
        defs.append(mark);
        const arrow = S.arrowFromStyle(edge.style || ''), kind = S.lineKindFromStyle(edge.style || ''), d = G.pathOf(points, kind === 'rounded' ? 8 : 0, kind === 'curved');
        const group = el('g', { 'data-edge-id': edge.id });
        group.append(el('path', { d, stroke, fill: 'none', 'stroke-width': selected.includes(edge.id) ? 3 : 1.6, 'stroke-dasharray': raw.dashed === '1' ? raw.dashPattern || '6 5' : undefined, 'marker-end': ['end', 'both'].includes(arrow) ? 'url(#' + marker + ')' : undefined, 'marker-start': ['start', 'both'].includes(arrow) ? 'url(#' + marker + ')' : undefined }));
        group.append(el('path', { d, class: 'edge-hit', 'data-edge-id': edge.id }));
        if (edge.label) {
            const p = G.edgeLabelPosition(points, edge);
            group.append(el('text', { x: p.x, y: p.y - 7, 'text-anchor': 'middle', 'font-size': Number(raw.fontSize) || 12, fill: color(raw.fontColor, defaultText), stroke: paper, 'stroke-width': 4, 'paint-order': 'stroke', class: 'edge-label' }, edge.label));
        }
        if (selected.includes(edge.id)) {
            for (const [end, p] of [['from', points[0]], ['to', points.at(-1)]])
                group.append(el('circle', { cx: p.x, cy: p.y, r: 5 * scale, fill: paper, stroke: accent, 'stroke-width': 1.5, class: 'edge-endpoint', 'data-reconnect': end, 'data-edge-id': edge.id }));
        }
        canvas.append(group);
    }
    const handles = [];
    for (const box of geometry.boxes) {
        const n = box.node;
        if (G.isHiddenCell(hidden, n))
            continue;
        const { x, y, w, h } = box.geo, shape = S.nodeShapeFromStyle(n.style || ''), raw = S.parseStyle(n.style || ''), media = isMedia(n), locked = !editable([n.id]).length;
        const group = el('g', { 'data-node-id': n.id, class: 'node-group' + (locked ? ' locked' : '') });
        drawShape(group, media ? 'rect' : shape, x, y, w, h, { fill: color(raw.fillColor, defaultFill), stroke: color(raw.strokeColor, defaultStroke), 'stroke-width': 1.5 });
        const label = media ? '[媒体内容 · 原样保留]' : n.label || '', size = Math.min(72, Math.max(8, Number(raw.fontSize) || 12)), chars = Math.max(4, Math.floor((w - 18) / size)), lines = [];
        for (const paragraph of String(label).split('\n')) {
            const a = Array.from(paragraph);
            if (!a.length)
                lines.push('');
            for (let i = 0; i < a.length; i += chars)
                lines.push(a.slice(i, i + chars).join(''));
        }
        const textFallback = raw.fillColor && !['none', 'transparent'].includes(raw.fillColor) ? '#24313d' : defaultText;
        const text = el('text', { x: x + w / 2, y: y + h / 2 - (Math.min(lines.length, 20) - 1) * size * .65, 'text-anchor': 'middle', 'dominant-baseline': 'middle', 'font-size': size, fill: color(raw.fontColor, textFallback), class: 'node-label' });
        lines.slice(0, 20).forEach((line, i) => text.append(el('tspan', { x: x + w / 2, dy: i ? size * 1.3 : 0 }, line)));
        group.append(text);
        if (selected.includes(n.id)) {
            group.append(el('rect', { x: x - 4, y: y - 4, width: w + 8, height: h + 8, class: 'selection-box' }));
            if (!locked)
                handles.push(el('rect', { x: x + w - 4 * scale, y: y + h - 4 * scale, width: 8 * scale, height: 8 * scale, fill: accent, stroke: paper, class: 'handle', 'data-resize': n.id }));
        }
        canvas.append(group);
    }
    canvas.append(...handles);
    if (gesture?.kind === 'marquee')
        canvas.append(el('rect', { x: Math.min(gesture.start.x, gesture.end.x), y: Math.min(gesture.start.y, gesture.end.y), width: Math.abs(gesture.end.x - gesture.start.x), height: Math.abs(gesture.end.y - gesture.start.y), class: 'marquee' }));
    if (connecting) {
        const n = state.doc.nodes.find(x => x.id === connecting);
        if (n)
            canvas.append(el('circle', { cx: (n.x || 0) + (n.w || 130) / 2, cy: (n.y || 0) + (n.h || 60) / 2, r: 12, fill: 'none', stroke: accent, 'stroke-width': 3 }));
    }
    $('zoom-label').textContent = Math.round(stage.clientWidth / view.w * 100) + '%';
    updateButtons();
    inspector();
    layers();
    pages();
    $('notes').textContent = (state.notes || []).join('\n');
}
function option(select, value, text) { select.append(html('option', text, { value })); }
function pages() { const select = $('pages'); select.replaceChildren(); (state.pageNames || ['Page-1']).forEach((name, i) => option(select, i, name)); select.value = String(state.page); }
function layers() { const box = $('layers'); box.replaceChildren(); for (const layer of state.doc.layers || []) {
    const row = html('div', undefined, { className: 'layer' }), name = html('span', layer.name || layer.id), eye = html('button', layer.visible === false ? '隐藏' : '显示', { title: '切换图层显示' }), lock = html('button', layer.locked ? '锁定' : '可改', { title: '切换图层锁定' });
    eye.onclick = () => mutate([{ op: 'setLayerProps', layer: layer.id, visible: layer.visible === false }]);
    lock.onclick = () => mutate([{ op: 'setLayerProps', layer: layer.id, locked: !layer.locked }]);
    row.append(name, eye, lock);
    box.append(row);
} }
function inspector() {
    const one = state && selected.length === 1 ? [...state.doc.nodes, ...state.doc.edges].find(c => c.id === selected[0]) : null;
    $('properties').hidden = !one;
    $('no-selection').hidden = !!one;
    $('selection-actions').hidden = !selected.length;
    if (!one)
        return;
    const edge = state.doc.edges.includes(one), style = S.parseStyle(one.style || '');
    $('label').value = one.label || '';
    $('width').value = one.w || 130;
    $('height').value = one.h || 60;
    $('width').disabled = edge;
    $('height').disabled = edge;
    $('node-shape').disabled = edge;
    $('node-shape').value = S.nodeShapeFromStyle(one.style || '');
    $('font-size').value = style.fontSize || 12;
    $('color').value = S.colorNameFromStyle(one.style || '') || 'plain';
    $('edge-properties').hidden = !edge;
    const layer = $('cell-layer');
    layer.replaceChildren();
    for (const l of state.doc.layers || [])
        option(layer, l.id, l.name || l.id);
    layer.value = one.layer || state.doc.layers?.[0]?.id || '1';
    for (const id of ['edge-from', 'edge-to']) {
        $(id).replaceChildren();
        for (const n of state.doc.nodes)
            option($(id), n.id, n.label || n.id);
    }
    if (edge) {
        $('edge-from').value = one.from || '';
        $('edge-to').value = one.to || '';
        $('line').value = S.lineKindFromStyle(one.style || '');
        $('arrow').value = S.arrowFromStyle(one.style || '');
        $('dash').value = S.dashFromStyle(one.style || '');
    }
    const enabled = editable([one.id]).length > 0;
    for (const node of $('properties').elements)
        if (!['width', 'height', 'node-shape'].includes(node.id) || !edge)
            node.disabled = !enabled;
}
$('properties').onsubmit = event => {
    event.preventDefault();
    if (!available() || selected.length !== 1)
        return;
    const id = selected[0], edge = state.doc.edges.some(e => e.id === id), ops = [{ op: 'setLabel', id, label: $('label').value }, { op: 'setStyle', id, style: $('color').value, fontSize: Number($('font-size').value) }, { op: 'setLayer', id, layer: $('cell-layer').value }];
    if (edge) {
        ops.push({ op: 'setStyle', id, line: $('line').value, arrow: $('arrow').value, dash: $('dash').value });
        ops.push({ op: 'setEdge', id, from: $('edge-from').value, to: $('edge-to').value });
    }
    else {
        ops[1].shape = $('node-shape').value;
        ops.push({ op: 'move', id, w: Number($('width').value), h: Number($('height').value) });
    }
    void mutate(ops);
};
function addNode(shape) { if (!available())
    return; const id = 'n' + uid(); void mutate([{ op: 'addNode', id, shape, label: SHAPES.find(x => x[0] === shape)[1], x: G.snapTo(view.x + view.w / 2 - 65, 10), y: G.snapTo(view.y + view.h / 2 - 30, 10), w: 130, h: 60, style: 'blue' }]).then(() => selection([id])); }
for (const [shape, name] of SHAPES) {
    const button = html('button', undefined, { className: 'shape', title: '添加' + name });
    button.dataset.shape = shape;
    const icon = el('svg', { viewBox: '0 0 50 34' });
    drawShape(icon, shape, 5, 4, 40, 25, { fill: 'none', stroke: 'currentColor' });
    button.append(icon, html('span', name));
    button.onclick = () => addNode(shape);
    $('shapes').append(button);
    option($('node-shape'), shape, name);
}
$('new').onclick = $('empty-new').onclick = () => run(async () => { const result = await api.newDocument(); if (result?.handle) {
    accept(result);
    fit();
} return result; }, '新画布 · 尚未保存');
$('open').onclick = () => run(async () => { const result = await api.openDocument(); if (result?.handle) {
    accept(result);
    selected = [];
    fit();
} return result; }, '图文件已打开');
$('save').onclick = () => run(() => api.saveDocument({}), '已保存到本机');
$('save-as').onclick = () => run(() => api.saveDocument({ as: true }), '已另存为');
$('undo').onclick = () => run(() => api.undo(), '已撤销 · 请保存');
$('redo').onclick = () => run(() => api.redo(), '已重做 · 请保存');
for (const value of ['select', 'connect', 'pan'])
    $('mode-' + value).onclick = () => setMode(value);
$('fit').onclick = fit;
$('pages').onchange = () => run(() => api.changePage({ page: Number($('pages').value) }), '已切换图页').then(result => { if (result?.handle) fit(); });
$('delete').onclick = () => { const ids = editable(selected); if (ids.length)
    void mutate([{ op: 'remove', ids }]).then(() => selection([])); };
for (const button of document.querySelectorAll('[data-align]'))
    button.onclick = () => { if (!available())
        return; const moves = G.computeAlignMoves(state.doc, editable(selected), button.dataset.align, 10); const ops = Object.entries(moves).map(([id, m]) => ({ op: 'move', id, [m.axis]: m.value })); if (ops.length)
        void mutate(ops); };
for (const [id, layout] of [['layout-tb', 'dagre-tb'], ['layout-lr', 'dagre-lr'], ['layout-grid', 'grid']])
    $(id).onclick = () => { if (!available())
        return; const editableNodes = editable(state.doc.nodes.map(n => n.id)); if (!editableNodes.length)
        return; void mutate([], layout).then(result => { if (result)
        fit(); }); };
$('add-layer').onclick = () => { if (!available())
    return; const name = '图层 ' + ((state.doc.layers?.length || 0) + 1); void mutate([{ op: 'addLayer', name }]); };
function zoom(factor) { const center = { x: view.x + view.w / 2, y: view.y + view.h / 2 }; view = G.zoomViewAt(view, center, factor, stage.clientHeight / stage.clientWidth); render(); }
$('zoom-out').onclick = () => zoom(1.2);
$('zoom-in').onclick = () => zoom(1 / 1.2);
$('theme').onchange = () => { theme = $('theme').value; document.documentElement.dataset.theme = theme; render(); void api.setTheme({ theme }).catch(e => status(e.message, true)); };
canvas.addEventListener('wheel', event => { event.preventDefault(); const anchor = point(event); view = G.zoomViewAt(view, anchor, event.deltaY > 0 ? 1.1 : 1 / 1.1, stage.clientHeight / stage.clientWidth); render(); }, { passive: false });
canvas.addEventListener('pointerdown', event => {
    if (!available())
        return;
    canvas.focus();
    const start = point(event), node = event.target.closest('[data-node-id]')?.dataset.nodeId, edge = event.target.closest('[data-edge-id]')?.dataset.edgeId;
    if (event.button === 1 || space || mode === 'pan') {
        gesture = { kind: 'pan', start, view: { ...view } };
        canvas.setPointerCapture(event.pointerId);
        event.preventDefault();
        return;
    }
    if (event.button !== 0)
        return;
    const clicked = node || edge, now = performance.now();
    if (mode === 'select' && clicked && lastClick.id === clicked && now - lastClick.time < 400 && !event.target.dataset.resize && !event.target.dataset.reconnect) {
        lastClick = { id: null, time: 0 };
        openLabel(clicked);
        event.preventDefault();
        return;
    }
    lastClick = { id: clicked, time: now };
    const resize = event.target.dataset.resize, reconnect = event.target.dataset.reconnect;
    if (reconnect && edge) {
        gesture = { kind: 'reconnect', edge, end: reconnect, start };
        canvas.setPointerCapture(event.pointerId);
        return;
    }
    if (mode === 'connect' && node) {
        if (!editable([node]).length)
            return;
        if (!connecting) {
            connecting = node;
            status('选择目标节点');
            render();
        }
        else {
            const from = connecting;
            connecting = null;
            void mutate([{ op: 'addEdge', id: 'e' + uid(), from, to: node }]);
        }
        return;
    }
    if (resize && editable([resize]).length) {
        const n = state.doc.nodes.find(x => x.id === resize);
        gesture = { kind: 'resize', id: resize, start, base: structuredClone(n), doc: structuredClone(state.doc) };
    }
    else if (node) {
        const ids = event.shiftKey ? (selected.includes(node) ? selected.filter(x => x !== node) : [...selected, node]) : selected.includes(node) ? selected : [node];
        selection(ids);
        const movable = editable(ids).filter(id => state.doc.nodes.some(n => n.id === id));
        if (movable.length)
            gesture = { kind: 'move', ids: movable, start, doc: structuredClone(state.doc) };
    }
    else if (edge)
        selection(event.shiftKey ? [...selected, edge] : [edge]);
    else {
        if (!event.shiftKey)
            selection([]);
        gesture = { kind: 'marquee', start, end: start, previous: selected.slice() };
    }
    if (gesture)
        canvas.setPointerCapture(event.pointerId);
    event.preventDefault();
});
canvas.addEventListener('pointermove', event => {
    if (!gesture || !state)
        return;
    const p = point(event), dx = p.x - gesture.start.x, dy = p.y - gesture.start.y;
    if (gesture.kind === 'pan') {
        const bounds = canvas.getBoundingClientRect();
        view = { ...gesture.view, x: gesture.view.x - (event.movementX / bounds.width) * gesture.view.w, y: gesture.view.y - (event.movementY / bounds.height) * gesture.view.h };
        gesture.view = { ...view };
        gesture.start = point(event);
    }
    if (gesture.kind === 'move' && (Math.abs(dx) > 2 || Math.abs(dy) > 2)) {
        gesture.moved = true;
        for (const id of gesture.ids) {
            const base = gesture.doc.nodes.find(n => n.id === id), node = state.doc.nodes.find(n => n.id === id);
            node.x = G.snapTo((base.x || 0) + dx, 10);
            node.y = G.snapTo((base.y || 0) + dy, 10);
        }
    }
    if (gesture.kind === 'resize' && (Math.abs(dx) > 2 || Math.abs(dy) > 2)) {
        gesture.moved = true;
        const n = state.doc.nodes.find(n => n.id === gesture.id), box = G.resizeBox(gesture.base, 'se', dx, dy);
        Object.assign(n, box);
    }
    if (gesture.kind === 'marquee')
        gesture.end = p;
    render();
});
canvas.addEventListener('pointerup', event => {
    if (!gesture || !state)
        return;
    const g = gesture;
    gesture = null;
    if (canvas.hasPointerCapture(event.pointerId))
        canvas.releasePointerCapture(event.pointerId);
    if ((g.kind === 'move' || g.kind === 'resize') && g.moved) {
        const ids = g.kind === 'move' ? g.ids : [g.id], ops = ids.map(id => { const n = state.doc.nodes.find(c => c.id === id); return { op: 'move', id, x: n.x, y: n.y, w: n.w, h: n.h }; });
        state.doc = g.doc;
        void mutate(ops);
    }
    if (g.kind === 'marquee') {
        const rect = { x: Math.min(g.start.x, g.end.x), y: Math.min(g.start.y, g.end.y), w: Math.abs(g.end.x - g.start.x), h: Math.abs(g.end.y - g.start.y) };
        selection([...g.previous, ...G.marqueeHits(state.doc, rect)]);
    }
    if (g.kind === 'reconnect') {
        const p = point(event), geometry = G.buildGeometry(state.doc), target = G.hitNodeAt(state.doc, geometry, p.x, p.y, 8);
        if (target?.id)
            void mutate([{ op: 'setEdge', id: g.edge, [g.end]: target.id }]);
    }
    render();
});
canvas.addEventListener('pointercancel', () => { if (gesture?.doc && state)
    state.doc = gesture.doc; gesture = null; render(); });
let editingId = null;
function openLabel(id) { if (!available() || $('label-dialog').open || !id || !editable([id]).length)
    return; editingId = id; const c = [...state.doc.nodes, ...state.doc.edges].find(x => x.id === id); $('dialog-label').value = c.label || ''; $('label-dialog').showModal(); $('dialog-label').focus(); }
canvas.addEventListener('dblclick', event => openLabel(event.target.closest('[data-node-id]')?.dataset.nodeId || event.target.closest('[data-edge-id]')?.dataset.edgeId));
$('label-dialog').addEventListener('close', () => { if ($('label-dialog').returnValue === 'confirm' && editingId)
    void mutate([{ op: 'setLabel', id: editingId, label: $('dialog-label').value }]); editingId = null; });
document.addEventListener('keydown', event => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) || $('label-dialog').open;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (state)
            void run(() => api.saveDocument({}), '已保存');
        return;
    }
    if (typing)
        return;
    if (event.code === 'Space') {
        event.preventDefault();
        space = true;
        canvas.style.cursor = 'grab';
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        void run(() => event.shiftKey ? api.redo() : api.undo(), '历史已更新');
    }
    else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a' && state) {
        event.preventDefault();
        selection(editable([...state.doc.nodes, ...state.doc.edges].map(n => n.id)));
    }
    else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd' && selected.length) {
        event.preventDefault();
        void mutate([{ op: 'duplicate', ids: editable(selected), dx: 30, dy: 30 }]);
    }
    else if (['Delete', 'Backspace'].includes(event.key) && state) {
        event.preventDefault();
        $('delete').click();
    }
    else if (event.key === 'Escape') {
        connecting = null;
        gesture = null;
        selection([]);
        setMode('select');
    }
    else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key) && selected.length) {
        event.preventDefault();
        const amount = event.shiftKey ? 50 : 10;
        void mutate([{ op: 'move', ids: editable(selected), dx: event.key === 'ArrowLeft' ? -amount : event.key === 'ArrowRight' ? amount : 0, dy: event.key === 'ArrowUp' ? -amount : event.key === 'ArrowDown' ? amount : 0 }]);
    }
});
document.addEventListener('keyup', event => { if (event.code === 'Space') {
    space = false;
    setMode(mode);
} });
async function exportCurrent(kind) {
    if (!state)
        return;
    const originalSelected = selected;
    selected = [];
    render();
    const clone = canvas.cloneNode(true);
    selected = originalSelected;
    render();
    for (const node of clone.querySelectorAll('.edge-hit,.selection-box,.handle,.edge-endpoint,.marquee,[data-background]'))
        node.remove();
    clone.removeAttribute('style');
    for (const node of clone.querySelectorAll('*')) {
        node.removeAttribute('class');
        node.removeAttribute('style');
        for (const a of [...node.attributes])
            if (a.name.startsWith('data-'))
                node.removeAttribute(a.name);
    }
    const b = G.buildGeometry(state.doc).bounds, w = Math.max(100, b.maxX - b.minX + 80), h = Math.max(100, b.maxY - b.minY + 80);
    clone.setAttribute('viewBox', [b.minX - 40, b.minY - 40, w, h].join(' '));
    clone.setAttribute('width', String(Math.ceil(w)));
    clone.setAttribute('height', String(Math.ceil(h)));
    clone.removeAttribute('id');
    clone.removeAttribute('tabindex');
    clone.removeAttribute('aria-label');
    const xml = new XMLSerializer().serializeToString(clone);
    let data = xml;
    if (kind === 'png') {
        const image = new Image();
        image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
        await image.decode();
        const raster = document.createElement('canvas'), scale = Math.min(2, 4096 / w, 4096 / h);
        raster.width = Math.ceil(w * scale);
        raster.height = Math.ceil(h * scale);
        const context = raster.getContext('2d');
        context.fillStyle = theme === 'firefly-dark' ? '#14202b' : '#fff';
        context.fillRect(0, 0, raster.width, raster.height);
        context.drawImage(image, 0, 0, raster.width, raster.height);
        data = raster.toDataURL('image/png').split(',')[1];
    }
    return api.exportFile({ kind, data });
}
$('export-svg').onclick = () => run(() => exportCurrent('svg'), '当前页面 SVG 已导出');
$('export-png').onclick = () => run(() => exportCurrent('png'), '当前页面 PNG 已导出');
new ResizeObserver(() => { view.h = view.w * stage.clientHeight / Math.max(1, stage.clientWidth); render(); }).observe(stage);
async function initialize() { if (!api) {
    status('需要从 Firefly 插件窗口打开', true);
    return;
} try {
    const initial = await api.initial();
    theme = initial.theme;
    document.documentElement.dataset.theme = theme;
    $('theme').value = theme;
    if (initial.state)
        accept(initial.state);
    if (initial.recovery?.length) {
        $('recovery-box').hidden = false;
        for (const draft of initial.recovery) {
            const button = html('button', draft.name);
            button.onclick = () => run(async () => { const r = await api.recoverDocument({ key: draft.key }); if (r?.handle) {
                accept(r);
                fit();
            } return r; }, '恢复为未保存草稿');
            $('recovery').append(button);
        }
    }
    render();
}
catch (e) {
    status(e.message, true);
} }
setInterval(async () => { if (!api || busy || gesture || $('label-dialog').open)
    return; try {
    const next = await api.getState();
    if (next && (!state || next.revision !== state.revision || next.dirty !== state.dirty))
        accept(next);
}
catch (e) {
    status(e.message, true);
} }, 1000);
void initialize();
