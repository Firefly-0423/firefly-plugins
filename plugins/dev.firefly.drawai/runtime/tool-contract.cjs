'use strict';
// This is the public Firefly tool schema the host passes to its model adapter.
// Keep operation examples/field names here rather than relying on repo README.
const operations = ['addNode', 'addEdge', 'duplicate', 'move', 'order', 'setEdge', 'setLabelPos', 'addLayer', 'setLayer', 'setLayerProps', 'setLabel', 'setStyle', 'remove'];
function operationSchema() {
    const string = description => ({ type: 'string', description });
    const number = description => ({ type: 'number', description });
    const point = { type: 'object', properties: { x: number('横坐标'), y: number('纵坐标') }, required: ['x', 'y'] };
    return {
        type: 'object',
        required: ['op'],
        properties: {
            op: { type: 'string', enum: operations, description: '结构化改图操作；首版不支持媒体、代码或外部 URL' },
            id: string('目标单元 id；新建时可指定，省略则自动生成'),
            ids: { type: 'array', items: { type: 'string' }, description: '批量目标 id；与 id 二选一' },
            as: string('本批次新建单元别名，后续 from/to 可引用'),
            label: string('节点或连线文字，最多 4096 字符'),
            shape: { type: 'string', enum: ['rect', 'rounded', 'ellipse', 'diamond', 'cylinder', 'document', 'text'], description: 'addNode/setStyle 的节点形状' },
            x: number('节点绝对横坐标；setLabelPos 时为标签位置'),
            y: number('节点绝对纵坐标；setLabelPos 时为标签位置'),
            w: number('节点宽度，必须大于 0；move 可调整尺寸'),
            h: number('节点高度，必须大于 0；move 可调整尺寸'),
            dx: number('相对横向位移；批量 move 使用 dx/dy'),
            dy: number('相对纵向位移；批量 move 使用 dx/dy'),
            from: string('addEdge/setEdge 的起点节点 id 或本批次别名'),
            to: string('addEdge/setEdge 的终点节点 id；order 时为 front/back/up/down'),
            fromPoint: { ...point, description: '没有起点节点时的自由端坐标' },
            toPoint: { ...point, description: '没有终点节点时的自由端坐标' },
            sourcePoint: { ...point, description: 'fromPoint 的等价字段' },
            targetPoint: { ...point, description: 'toPoint 的等价字段' },
            style: string('配色名 plain/blue/green/orange/yellow/red/purple/grey，或不含媒体的 draw.io 样式串'),
            color: string('连线颜色'),
            fontColor: string('文字颜色'),
            fontSize: number('文字字号'),
            line: { type: 'string', enum: ['straight', 'sharp', 'rounded', 'curved'], description: '连线画法' },
            arrow: { type: 'string', enum: ['end', 'both', 'none', 'start'], description: '箭头方向' },
            dash: { type: 'string', enum: ['solid', 'dashed', 'dotted'], description: '线型' },
            layer: string('图层 id 或名称；setLayerProps 必须用 layer 指定目标图层'),
            name: string('addLayer/setLayerProps 的图层名称'),
            visible: { type: 'boolean', description: '图层是否可见' },
            locked: { type: 'boolean', description: '图层是否锁定' },
            withEdges: { type: 'boolean', description: 'duplicate 时是否复制所选节点之间的连线' },
            offsetX: number('标签横向偏移'),
            offsetY: number('标签纵向偏移'),
        },
    };
}
const applyDescription = [
    '在 Firefly 当前绑定工作区创建或修改可编辑的 .drawio 流程图；这是原生插件工具。',
    '已有文件先调用 drawai_read，传回 expectRevision；新建用 create:true 且目标必须不存在。',
    '新建示例：{"path":"flow.drawio","create":true,"layout":"dagre-tb","ops":[{"op":"addNode","id":"start","label":"开始","shape":"rounded"},{"op":"addNode","id":"end","label":"结束"},{"op":"addEdge","from":"start","to":"end"}]}。',
    '修改示例：ops:[{"op":"setLabel","id":"start","label":"收到请求"},{"op":"move","id":"start","w":180,"h":70}]。',
    '手工草稿未保存或 revision 不匹配时停止并说明冲突，不覆盖。文件保存后，Firefly 打开的同文件画布会刷新。',
    '插件复用宿主模型工具链，不启动外部服务，不调用额外模型，不接收任意代码或媒体处理请求。',
].join('\n');
module.exports = { operationSchema, applyDescription };

