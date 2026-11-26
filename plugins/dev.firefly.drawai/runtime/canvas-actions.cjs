"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { error } = require("./paths.cjs");
const { validateExport } = require("./export-validation.cjs");

function createSettingsStore(dataDir) {
  const file = path.join(dataDir, "settings.json");

  function readAll() {
    try {
      const info = fs.lstatSync(file);
      if (info.isSymbolicLink() || !info.isFile()) return {};
      const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  return {
    get(key) {
      return readAll()[key];
    },
    set(key, value) {
      const next = { ...readAll(), [key]: value };
      fs.mkdirSync(dataDir, { recursive: true });
      const temp = path.join(dataDir, `.settings.${randomUUID()}.tmp`);
      fs.writeFileSync(temp, `${JSON.stringify(next, null, 2)}\n`, "utf8");
      fs.renameSync(temp, file);
    },
  };
}

function createCanvasActions({ service, dataDir }) {
  const settings = createSettingsStore(dataDir);
  let handle = null;

  const actions = {
    async initial() {
      return {
        theme: settings.get("theme") || "firefly-dark",
        state: handle ? await service.state(handle) : null,
        recovery: await service.listRecovery(),
      };
    },
    async newDocument() {
      const state = await service.newNative();
      handle = state.handle;
      return state;
    },
    async editDocument(args) {
      if (!args || Object.keys(args).some((k) => !["revision", "ops", "layout"].includes(k))) {
        throw error("E_ARGUMENT", "编辑参数无效");
      }
      return await service.edit(handle, args);
    },
    async undo() {
      return await service.undo(handle);
    },
    async redo() {
      return await service.redo(handle);
    },
    async changePage(args) {
      return await service.page(handle, args?.page);
    },
    async getState() {
      return handle ? await service.state(handle) : null;
    },
    async select(args) {
      return await service.select(handle, args?.ids);
    },
    async validateExport(args) {
      const buffer = validateExport(args?.kind, args?.data);
      return { kind: args?.kind, bytes: buffer.length };
    },
    async listRecovery() {
      return await service.listRecovery();
    },
    async recoverDocument(args) {
      const state = await service.recover(args?.key);
      handle = state.handle;
      return state;
    },
    async setTheme(args) {
      if (!["firefly-dark", "pearl-white"].includes(args?.theme)) {
        throw error("E_ARGUMENT", "主题无效");
      }
      settings.set("theme", args.theme);
      return { theme: args.theme };
    },
  };

  return {
    async dispatch(method, params) {
      if (typeof method !== "string" || !Object.hasOwn(actions, method)) {
        throw error("E_ARGUMENT", `未知画布方法: ${String(method)}`);
      }
      return await actions[method](params);
    },
  };
}

module.exports = { createCanvasActions, createSettingsStore };
