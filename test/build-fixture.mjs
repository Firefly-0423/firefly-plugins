import { realpathSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { REPO_ROOT, CATALOG_PLUGIN_IDS } from "../scripts/build.mjs";

export const json = async file => JSON.parse(await readFile(file, "utf8"));

export async function sourceFixture(t) {
  const root = await mkdtemp(path.join(REPO_ROOT, ".test-tmp-"));
  const owned = realpathSync(root);
  const parent = realpathSync(REPO_ROOT);
  t.after(async () => {
    if (path.dirname(owned) !== parent || realpathSync(root) !== owned) throw new Error("Unsafe test cleanup path");
    await rm(root, { recursive: true, force: true });
  });
  for (const name of ["scripts", "schema", "LICENSE"]) {
    await cp(path.join(REPO_ROOT, name), path.join(root, name), { recursive: true });
  }
  // This fixture exercises the original catalog; DrawAI's real package has a
  // separate extracted-artifact suite and asset-path cases.
  await mkdir(path.join(root, "plugins"));
  for (const id of CATALOG_PLUGIN_IDS) await cp(path.join(REPO_ROOT, "plugins", id), path.join(root, "plugins", id), { recursive: true });
  return root;
}
