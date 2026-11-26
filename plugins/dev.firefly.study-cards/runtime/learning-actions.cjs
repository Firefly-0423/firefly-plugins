"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const THEMES = new Set(["pearl-white", "firefly-dark"]);
const MAX_RPC_BYTES = 2 * 1024 * 1024;

const ALLOWED_FIELDS = {
  getTheme: [],
  setTheme: ["theme"],
  dashboard: [],
  lookup: ["language", "term", "limit"],
  collect: ["language", "term", "reading", "meaning", "context", "dictionaryId", "operationId"],
  vocabulary: ["language", "query", "offset", "limit", "dictionaryId", "deck", "status"],
  vocabularyUpdate: ["cardId", "expectedRevision", "meaning", "context"],
  vocabularyDelete: ["cardId", "expectedRevision"],
  new: ["limit", "deck"],
  due: ["limit", "deck"],
  review: ["cardId", "rating", "expectedRevision"],
  dictionaryList: [],
  dictionarySet: ["id", "enabled", "priority"],
  dictionaryDelete: ["id"],
  demoInstall: [],
  articleSave: ["id", "title", "language", "text", "position"],
  articleList: [],
  articleGet: ["id"],
};

function rpcError(code, message) {
  return Object.assign(new Error(message), { code });
}

function checkArgs(args, fields) {
  if (args === undefined) return {};
  if (!args || typeof args !== "object" || Array.isArray(args) || Object.keys(args).some((k) => !fields.includes(k))) {
    throw rpcError("E_ARGUMENT", "请求参数无效");
  }
  if (Buffer.byteLength(JSON.stringify(args)) > MAX_RPC_BYTES) {
    throw rpcError("E_ARGUMENT", "请求内容过大");
  }
  return args;
}

function normalizeTheme(value) {
  return typeof value === "string" && THEMES.has(value) ? value : "pearl-white";
}

function createSettingsStore(dataDir) {
  const file = path.join(dataDir, "settings.json");

  function readAll() {
    try {
      const info = fs.lstatSync(file);
      if (info.isSymbolicLink() || !info.isFile() || info.nlink > 1) return {};
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
      if (typeof dataDir !== "string" || !dataDir) {
        throw rpcError("E_STORAGE", "插件数据目录不可用");
      }
      const next = { ...readAll(), [key]: value };
      fs.mkdirSync(dataDir, { recursive: true });
      const dirStat = fs.lstatSync(dataDir);
      if (dirStat.isSymbolicLink() || !dirStat.isDirectory()) {
        throw rpcError("E_STORAGE", "插件数据目录无效");
      }
      const temp = path.join(dataDir, `.settings.${randomUUID()}.tmp`);
      let fd;
      try {
        fd = fs.openSync(temp, "wx", 0o600);
        fs.writeFileSync(fd, `${JSON.stringify(next, null, 2)}\n`, "utf8");
        fs.fsyncSync(fd);
        fs.closeSync(fd);
        fd = undefined;
        fs.renameSync(temp, file);
      } catch (cause) {
        if (fd !== undefined) {
          try { fs.closeSync(fd); } catch {}
        }
        try { fs.unlinkSync(temp); } catch {}
        throw rpcError("E_STORAGE", `保存设置失败: ${cause?.message ?? cause}`);
      }
    },
  };
}

function createLearningActions({ service, dataDir }) {
  const settings = createSettingsStore(dataDir);

  const actions = {};
  for (const [method, fields] of Object.entries(ALLOWED_FIELDS)) {
    if (method === "getTheme" || method === "setTheme") continue;
    actions[method] = (args) => service.call(method, checkArgs(args, fields));
  }

  actions.getTheme = (args) => {
    checkArgs(args, []);
    return { theme: normalizeTheme(settings.get("ui-theme")) };
  };

  actions.setTheme = (args) => {
    const { theme } = checkArgs(args, ["theme"]);
    if (typeof theme !== "string" || !THEMES.has(theme)) {
      throw rpcError("E_ARGUMENT", "外观必须为浅色或深色");
    }
    settings.set("ui-theme", theme);
    return { theme };
  };

  return {
    async dispatch(method, params) {
      if (typeof method !== "string" || !Object.hasOwn(actions, method)) {
        throw rpcError("E_ARGUMENT", `未知学习操作: ${String(method)}`);
      }
      return await actions[method](params);
    },
  };
}

module.exports = { createLearningActions, createSettingsStore, normalizeTheme };
