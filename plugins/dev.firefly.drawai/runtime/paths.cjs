'use strict';
const fs = require('node:fs/promises'), path = require('node:path');
const LIMIT = 8 * 1024 * 1024;
function error(code, message) { return Object.assign(new Error(message), { code }); }
function validName(value) {
    if (typeof value !== 'string' || !value || value.length > 1024 || /[\0-\x1f]/.test(value) || value.includes('\\') || value.includes(':') || value.startsWith('/') || value.split('/').some(p => !p || p === '.' || p === '..' || /[. ]$/.test(p) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)))
        throw error('E_PATH', '需要工作区内的相对 .drawio 路径');
    if (!value.toLowerCase().endsWith('.drawio'))
        throw error('E_PATH', '仅支持 .drawio 文件');
    return value;
}
async function assertPlain(file, missing = false) {
    try {
        const s = await fs.lstat(file);
        if (s.isSymbolicLink() || !s.isFile() || s.nlink > 1)
            throw error('E_PATH', '拒绝链接或非普通文件');
        return s;
    }
    catch (e) {
        if (missing && e.code === 'ENOENT')
            return null;
        throw e;
    }
}
async function checkAbsolute(file, { missing = false, extensions = ['.drawio'] } = {}) {
    if (typeof file !== 'string' || !path.isAbsolute(file) || file.startsWith('\\\\') || file.includes('\0'))
        throw error('E_PATH', '文件路径无效');
    const absolute = path.resolve(file), parsed = path.parse(absolute);
    for (const p of absolute.slice(parsed.root.length).split(path.sep)) {
        if (p.includes(':') || /[. ]$/.test(p) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p))
            throw error('E_PATH', '文件路径无效');
    }
    if (!extensions.includes(path.extname(absolute).toLowerCase()))
        throw error('E_PATH', '不支持该文件类型');
    let cursor = path.dirname(absolute);
    while (cursor !== path.parse(cursor).root) {
        const s = await fs.lstat(cursor);
        if (s.isSymbolicLink() || !s.isDirectory())
            throw error('E_PATH', '路径经过链接');
        cursor = path.dirname(cursor);
    }
    const existing = await assertPlain(absolute, missing);
    return existing ? await fs.realpath(absolute) : path.join(await fs.realpath(path.dirname(absolute)), path.basename(absolute));
}
async function workspacePath(context, relative, { missing = false } = {}) {
    if (!context || typeof context.resolvedWorkspaceRoot !== 'string' || !path.isAbsolute(context.resolvedWorkspaceRoot))
        throw error('E_WORKSPACE', '请先绑定工作区');
    validName(relative);
    const root = path.resolve(context.resolvedWorkspaceRoot), meta = await fs.lstat(root);
    if (meta.isSymbolicLink() || !meta.isDirectory())
        throw error('E_PATH', '工作区路径无效');
    const file = path.resolve(root, ...relative.split('/')), rel = path.relative(root, file);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel))
        throw error('E_PATH', '文件越出工作区');
    return checkAbsolute(file, { missing });
}
async function readBounded(file) {
    const before = await assertPlain(file), handle = await fs.open(file, 'r');
    try {
        const s = await handle.stat();
        if (!s.isFile() || s.nlink > 1 || s.ino !== before.ino || s.dev !== before.dev)
            throw error('E_PATH', '文件身份已变化');
        if (s.size > LIMIT)
            throw error('E_LIMIT', '图文件超过 8 MiB');
        const bytes = Buffer.alloc(Math.min(LIMIT + 1, s.size + 1));
        let offset = 0;
        while (offset < bytes.length) {
            const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
            if (!bytesRead)
                break;
            offset += bytesRead;
        }
        if (offset > LIMIT || offset > s.size)
            throw error('E_LIMIT', '图文件在读取中变大');
        const after = await handle.stat(), now = await assertPlain(file);
        if (now.ino !== s.ino || now.dev !== s.dev || after.size !== s.size || after.mtimeMs !== s.mtimeMs)
            throw error('E_CONFLICT', '文件在读取中改变');
        try {
            return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes.subarray(0, offset));
        }
        catch {
            throw error('E_XML', '需要 UTF-8 图文件');
        }
    }
    finally {
        await handle.close();
    }
}
module.exports = { workspacePath, checkAbsolute, assertPlain, readBounded, error, LIMIT };
