import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { prepareMarketplace, REPO_ROOT } from '../scripts/build.mjs';
import { readFile } from 'node:fs/promises';
import { sourceFixture } from './build-fixture.mjs';
import { cp, writeFile } from 'node:fs/promises';
import path from 'node:path';
test('asset descriptors reject traversal, duplicate paths, omitted files and non-UTF8 bytes', async (t) => {
    const root = await sourceFixture(t);
    await cp(path.join(REPO_ROOT, 'plugins/drawai'), path.join(root, 'plugins/drawai'), { recursive: true });
    const desc = path.join(root, 'plugins/drawai/package-files.json');
    for (const files of [['../README.md'], ['/absolute.js'], ['ui\\index.html'], ['ui/index.html', 'ui/index.html'], ['ui/con.txt']]) {
        await writeFile(desc, JSON.stringify({ files }));
        await assert.rejects(prepareMarketplace({ root }));
    }
    await writeFile(desc, JSON.stringify({ files: ['ui/missing.js'] }));
    await assert.rejects(prepareMarketplace({ root }));
    await writeFile(path.join(root, 'plugins/drawai/ui/binary.js'), Buffer.from([0xfe, 0xff]));
    await writeFile(desc, JSON.stringify({ files: ['ui/binary.js'] }));
    await assert.rejects(prepareMarketplace({ root }));
});
test('DrawAI ZIP is self-contained, disabled and retains five immutable packages', async () => {
    const a = await prepareMarketplace(), b = await prepareMarketplace(), p = a.plugins.find(x => x.id === 'drawai');
    assert.ok(p, 'drawai package missing');
    const Zip = createRequire(import.meta.url)('jszip'), zip = await Zip.loadAsync(p.zipBytes);
    assert.ok(zip.file('ui/editor.mjs'), 'editor missing from package');
    assert.ok(zip.file('runtime/worker.cjs'));
    assert.ok(zip.file('vendor/saxes.cjs'));
    const manifest = JSON.parse(await zip.file('manifest.json').async('string'));
    assert.equal(manifest.defaultEnabled, false);
    assert.deepEqual(manifest.deps, []);
    assert.equal(p.sha256, b.plugins.find(x => x.id === 'drawai').sha256);
    const registry = JSON.parse(await readFile(new URL('../registry.json', import.meta.url), 'utf8'));
    for (const item of a.plugins.filter(x => x.id !== 'drawai'))
        assert.equal(item.sha256, registry.plugins.find(x => x.id === item.id).sha256);
});
