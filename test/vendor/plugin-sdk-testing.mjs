// Vendored from Firefly-0423/Firefly-Agent (@firefly_wu/plugin-sdk@1.2.0)
// Source commit: f046ac9ae74c684fcf1bdf7dfa5cc6c08ded5739 (f046ac9)
// Source SHA-256 (plugin-sdk/src/testing/index.ts): cf8b0fcd3f08e046af50455656c1e4098bf67d4ff06cd8a0865d837f3360737c
// Source SHA-256 (plugin-sdk/src/index.ts): c8c045e3f07e72ecff0ee23ecb205f14c1fc915183d9219728ee44282f2a7ed8
// Source SHA-256 (src/shared/plugin-protocol.ts): 4a5b5f977c621f2b82a076a3862dfc983c747c64c53840e2a146b6f19924dd50
// Upstream bundle SHA-256 (plugin-sdk/dist/esm/testing/index.mjs): 7c91d34449496a70906f7fb4504d9fadc6b744f941384bc5a1873ea510f790fc
// Companion index SHA-256 (test/vendor/plugin-sdk-index.mjs): 22ddbbcfdfdab375316386374a73bea3cb0f67f95459057e05282cb5bd241c47
// Vendored body SHA-256 (below provenance marker, ./plugin-sdk-index.mjs import): ce5258f453a306c7a681782d7fadf916566ee4dc1e8d1e3549e92866b5443284
// Generation command: node scripts/plugin-sdk/build-sdk.mjs (then copy dist/esm/index.mjs -> test/vendor/plugin-sdk-index.mjs and dist/esm/testing/index.mjs -> test/vendor/plugin-sdk-testing.mjs with "../index.mjs" rewritten to "./plugin-sdk-index.mjs", UTF-8 LF without BOM)
// TODO(post-npm-publish): replace test/vendor/* with version-pinned @firefly_wu/plugin-sdk/testing once 1.2.0 is published on npm.
// --- END VENDOR PROVENANCE ---
// plugin-sdk/src/testing/index.ts
import Ajv from "ajv";
import { PluginError } from "./plugin-sdk-index.mjs";
var AjvCtor = Ajv.default ?? Ajv;
var VERDICT_RANK = { allow: 0, ask: 1, deny: 2 };
function evaluateToolPermission(level, risks) {
  if (level === "full") return "allow";
  if (level === "per-action") return "ask";
  let strictest = "allow";
  for (const risk of risks) {
    let verdict;
    if (risk === "fs-read" || risk === "network") {
      verdict = "allow";
    } else if (risk === "shell") {
      verdict = "ask";
    } else {
      verdict = "deny";
    }
    if (VERDICT_RANK[verdict] > VERDICT_RANK[strictest]) {
      strictest = verdict;
    }
  }
  return strictest;
}
function createTestHost(options) {
  const ajv = new AjvCtor({ strict: false });
  const manifest = options.manifest;
  const declaredPermissions = new Set(manifest.permissions ?? []);
  const revokedPermissions = new Set(options.revokedPermissions ?? []);
  let currentMode = options.mode ?? "work";
  let currentLevel = options.level ?? "per-action";
  let currentStatus = "idle";
  let currentPlugin;
  let currentWorkspace = options.workspace ?? null;
  let contextAbort = new AbortController();
  let callCounter = 0;
  let taskCounter = 0;
  const modelCallTimes = [];
  const calls = [];
  const registeredTools = /* @__PURE__ */ new Map();
  const registeredProviders = /* @__PURE__ */ new Map();
  const registeredChannels = /* @__PURE__ */ new Map();
  const channelControllers = /* @__PURE__ */ new Map();
  const channelStates = /* @__PURE__ */ new Map();
  const deliveredMessages = [];
  const uiMessages = [];
  const openWindows = /* @__PURE__ */ new Map();
  const eventListeners = /* @__PURE__ */ new Map();
  const workspaceListeners = /* @__PURE__ */ new Set();
  const scheduleTriggerListeners = /* @__PURE__ */ new Set();
  const uiMessageListeners = /* @__PURE__ */ new Set();
  const secrets = new Map(Object.entries(options.secrets ?? {}));
  const schedules = /* @__PURE__ */ new Map();
  const pendingScheduleUpdates = /* @__PURE__ */ new Map();
  const inflightTools = /* @__PURE__ */ new Map();
  const clearRegistrations = () => {
    registeredTools.clear();
    registeredProviders.clear();
    registeredChannels.clear();
  };
  const clearTransient = () => {
    clearRegistrations();
    eventListeners.clear();
    workspaceListeners.clear();
    scheduleTriggerListeners.clear();
    uiMessageListeners.clear();
    openWindows.clear();
  };
  const record = (method, params) => {
    calls.push({ method, params, at: Date.now() });
  };
  const ensureActive = () => {
    if (currentStatus === "crashed" || currentStatus === "deactivated") {
      throw new PluginError("ERR_UNAVAILABLE", "Plugin host is not active", true);
    }
  };
  const requirePermission = (permission) => {
    ensureActive();
    if (!declaredPermissions.has(permission)) {
      throw new PluginError("ERR_UNDECLARED", `Permission "${permission}" is not declared in manifest`);
    }
    if (revokedPermissions.has(permission)) {
      throw new PluginError("ERR_PERMISSION", `Permission "${permission}" has been revoked`);
    }
  };
  const checkModelRateLimit = () => {
    if (options.rateLimitPerMinute === void 0) return;
    const now = Date.now();
    while (modelCallTimes.length > 0 && now - modelCallTimes[0] >= 6e4) modelCallTimes.shift();
    if (modelCallTimes.length >= options.rateLimitPerMinute) {
      throw new PluginError("ERR_RATE_LIMITED", "Plugin model call rate limit exceeded", true);
    }
    modelCallTimes.push(now);
  };
  const toolsApi = {
    register(tool) {
      record("tools.register", { name: tool.name, description: tool.description, parameters: tool.parameters });
      ensureActive();
      const declared = manifest.tools?.find((t) => t.name === tool.name);
      if (!declared) {
        throw new PluginError("ERR_UNDECLARED", `Tool "${tool.name}" is not declared in manifest`);
      }
      const validate = ajv.compile(tool.parameters);
      const entry = { def: tool, validate };
      registeredTools.set(tool.name, entry);
      let disposed = false;
      return {
        dispose() {
          if (disposed) return;
          disposed = true;
          if (registeredTools.get(tool.name) === entry) {
            registeredTools.delete(tool.name);
            record("tools.unregister", { name: tool.name });
          }
        }
      };
    }
  };
  const contextApi = {
    register(provider) {
      record("context.register", { id: provider.id, modes: provider.modes, sources: provider.sources });
      ensureActive();
      const declared = manifest.context?.find((c) => c.id === provider.id);
      if (!declared) {
        throw new PluginError("ERR_UNDECLARED", `Context provider "${provider.id}" is not declared in manifest`);
      }
      registeredProviders.set(provider.id, provider);
      let disposed = false;
      return {
        dispose() {
          if (disposed) return;
          disposed = true;
          if (registeredProviders.get(provider.id) === provider) {
            registeredProviders.delete(provider.id);
            record("context.unregister", { id: provider.id });
          }
        }
      };
    }
  };
  const channelsApi = {
    register(adapter) {
      record("channels.register", { id: adapter.id });
      ensureActive();
      const declared = manifest.channels?.find((c) => c.id === adapter.id);
      if (!declared) {
        throw new PluginError("ERR_UNDECLARED", `Channel "${adapter.id}" is not declared in manifest`);
      }
      registeredChannels.set(adapter.id, adapter);
      return {
        dispose() {
          if (registeredChannels.get(adapter.id) === adapter) {
            const running = channelControllers.get(adapter.id);
            if (running) {
              running.abort("disposed");
              channelControllers.delete(adapter.id);
              void Promise.resolve().then(() => adapter.stop()).catch(() => {
              });
            }
            registeredChannels.delete(adapter.id);
          }
        }
      };
    }
  };
  const linkSignals = (a, b) => {
    const controller = new AbortController();
    const onA = () => controller.abort(a.reason);
    const onB = () => controller.abort(b.reason);
    if (a.aborted) onA();
    else if (b.aborted) onB();
    a.addEventListener("abort", onA, { once: true });
    b.addEventListener("abort", onB, { once: true });
    return { signal: controller.signal, cleanup() {
      a.removeEventListener("abort", onA);
      b.removeEventListener("abort", onB);
    } };
  };
  const linkLifecycle = (requestSignal) => {
    const lifecycle = contextAbort.signal;
    const controller = new AbortController();
    const onLifecycle = () => controller.abort(lifecycle.reason);
    const onRequest = () => controller.abort(requestSignal?.reason);
    if (lifecycle.aborted) onLifecycle();
    else if (requestSignal?.aborted) onRequest();
    lifecycle.addEventListener("abort", onLifecycle, { once: true });
    requestSignal?.addEventListener("abort", onRequest, { once: true });
    return {
      signal: controller.signal,
      cleanup() {
        lifecycle.removeEventListener("abort", onLifecycle);
        requestSignal?.removeEventListener("abort", onRequest);
      }
    };
  };
  const modelApi = {
    async generate(req) {
      record("model.generate", {
        prompt: req.prompt,
        system: req.system,
        maxOutputTokens: req.maxOutputTokens,
        schema: req.schema
      });
      requirePermission("model.generate");
      if (req.signal?.aborted || contextAbort.signal.aborted) {
        throw new PluginError("ERR_CANCELLED", "Model request was cancelled");
      }
      checkModelRateLimit();
      if (!options.model?.generate) {
        return { text: "" };
      }
      const linked = linkLifecycle(req.signal);
      try {
        return await options.model.generate({ ...req, signal: linked.signal });
      } finally {
        linked.cleanup();
      }
    },
    async *generateStream(req) {
      record("model.generateStream", {
        prompt: req.prompt,
        system: req.system,
        maxOutputTokens: req.maxOutputTokens,
        schema: req.schema
      });
      requirePermission("model.generate");
      if (req.signal?.aborted || contextAbort.signal.aborted) {
        throw new PluginError("ERR_CANCELLED", "Model stream was cancelled");
      }
      checkModelRateLimit();
      if (!options.model?.generateStream) {
        return;
      }
      const linked = linkLifecycle(req.signal);
      try {
        for await (const chunk of options.model.generateStream({ ...req, signal: linked.signal })) {
          if (linked.signal.aborted) {
            throw new PluginError("ERR_CANCELLED", "Model stream was cancelled");
          }
          yield chunk;
        }
      } finally {
        linked.cleanup();
      }
    },
    run(req) {
      record("model.run", {
        objective: req.objective,
        mode: req.mode,
        sessionId: req.sessionId,
        allowPartners: req.allowPartners
      });
      requirePermission("model.run");
      if (req.signal?.aborted || contextAbort.signal.aborted) {
        const err = new PluginError("ERR_CANCELLED", "Model run was cancelled");
        const rejected = Promise.reject(err);
        rejected.catch(() => {
        });
        return {
          events: (async function* () {
            throw err;
          })(),
          result: rejected
        };
      }
      checkModelRateLimit();
      if (options.model?.run) {
        const linked = linkLifecycle(req.signal);
        const handle = options.model.run({ ...req, signal: linked.signal });
        void Promise.resolve(handle.result).finally(linked.cleanup).catch(() => {
        });
        return handle;
      }
      const emptyEvents = [
        { type: "run.started", runId: "test-run-1", sessionId: req.sessionId ?? "test-session", mode: req.mode, at: Date.now() },
        { type: "run.ended", runId: "test-run-1", sessionId: req.sessionId ?? "test-session", outcome: "completed", at: Date.now() }
      ];
      return {
        events: (async function* () {
          for (const event of emptyEvents) {
            yield event;
          }
        })(),
        result: Promise.resolve({
          runId: "test-run-1",
          sessionId: req.sessionId ?? "test-session",
          reply: ""
        })
      };
    }
  };
  const eventsApi = {
    on(type, fn) {
      record("events.subscribe", { type });
      requirePermission("events");
      let set = eventListeners.get(type);
      if (!set) {
        set = /* @__PURE__ */ new Set();
        eventListeners.set(type, set);
      }
      const listener = fn;
      set.add(listener);
      return {
        dispose() {
          set?.delete(listener);
        }
      };
    }
  };
  const sessionsApi = {
    async list(o) {
      record("sessions.list", o ?? {});
      requirePermission("sessions.read");
      if (options.sessions?.list) {
        return await options.sessions.list(o);
      }
      return { items: [] };
    },
    async messages(sessionId, o) {
      record("sessions.messages", { sessionId, ...o ?? {} });
      requirePermission("sessions.read");
      if (options.sessions?.messages) {
        return await options.sessions.messages(sessionId, o);
      }
      return { items: [] };
    }
  };
  const workspaceApi = {
    async current(sessionId) {
      record("workspace.info", sessionId !== void 0 ? { sessionId } : {});
      requirePermission("workspace.read");
      return currentWorkspace;
    },
    onChange(fn) {
      record("workspace.watch", {});
      requirePermission("workspace.read");
      workspaceListeners.add(fn);
      return {
        dispose() {
          workspaceListeners.delete(fn);
        }
      };
    }
  };
  const schedulesApi = {
    async propose(spec) {
      record("schedules.propose", spec);
      requirePermission("schedules");
      const taskId = `task-${++taskCounter}`;
      const now = (/* @__PURE__ */ new Date()).toISOString();
      schedules.set(taskId, {
        taskId,
        title: spec.title,
        schedule: spec.schedule,
        action: spec.action,
        status: "pending_approval",
        nextFireAt: null,
        createdAt: now,
        updatedAt: now
      });
      return { taskId, status: "pending_approval" };
    },
    async update(taskId, patch) {
      record("schedules.update", { taskId, patch });
      requirePermission("schedules");
      const existing = schedules.get(taskId);
      if (!existing) {
        throw new PluginError("ERR_INVALID_ARGUMENT", `Schedule task not found: ${taskId}`);
      }
      const changes = {
        ...patch.title !== void 0 ? { title: patch.title } : {},
        ...patch.schedule !== void 0 ? { schedule: patch.schedule } : {},
        ...patch.action !== void 0 ? { action: patch.action } : {}
      };
      if (existing.status === "pending_approval" && !pendingScheduleUpdates.has(taskId)) {
        schedules.set(taskId, { ...existing, ...changes, updatedAt: (/* @__PURE__ */ new Date()).toISOString() });
      } else {
        pendingScheduleUpdates.set(taskId, { ...pendingScheduleUpdates.get(taskId), ...changes });
      }
      return { status: "pending_approval" };
    },
    async remove(taskId) {
      record("schedules.remove", { taskId });
      requirePermission("schedules");
      pendingScheduleUpdates.delete(taskId);
      return schedules.delete(taskId);
    },
    async list() {
      record("schedules.list", {});
      requirePermission("schedules");
      return Array.from(schedules.values());
    },
    onTrigger(fn) {
      record("schedules.onTrigger", {});
      requirePermission("schedules");
      const subscription = new AbortController();
      const listener = async (event) => {
        const linked = linkSignals(event.signal, subscription.signal);
        try {
          await fn({ ...event, signal: linked.signal });
        } finally {
          linked.cleanup();
        }
      };
      scheduleTriggerListeners.add(listener);
      return {
        dispose() {
          subscription.abort("disposed");
          scheduleTriggerListeners.delete(listener);
        }
      };
    }
  };
  const secretsApi = {
    async set(key, value) {
      record("secrets.set", { key, value });
      requirePermission("secrets");
      secrets.set(key, value);
    },
    async get(key) {
      record("secrets.get", { key });
      requirePermission("secrets");
      return secrets.get(key) ?? null;
    },
    async delete(key) {
      record("secrets.delete", { key });
      requirePermission("secrets");
      return secrets.delete(key);
    },
    async keys() {
      record("secrets.keys", {});
      requirePermission("secrets");
      return Array.from(secrets.keys()).sort();
    }
  };
  const uiApi = {
    async openWindow(id, state) {
      record("ui.openWindow", { id, state });
      requirePermission("ui.windows");
      if (!manifest.ui?.windows?.some((w) => w.id === id)) {
        throw new PluginError("ERR_UNDECLARED", `UI window "${id}" is not declared in manifest`);
      }
      openWindows.set(id, state ?? null);
      const owner = contextAbort.signal;
      const ended = () => new PluginError("ERR_UNAVAILABLE", "This plugin activation has ended");
      return {
        close: async () => {
          if (owner.aborted) throw ended();
          record("ui.closeWindow", { id });
          openWindows.delete(id);
        },
        post: async (msg) => {
          if (owner.aborted) throw ended();
          await uiApi.post({ kind: "window", id }, msg);
        }
      };
    },
    onMessage(fn) {
      record("ui.onMessage", {});
      ensureActive();
      const hasUi = declaredPermissions.has("ui.windows") || Boolean(manifest.ui?.settings) || Boolean(manifest.ui?.windows?.length);
      if (!hasUi) {
        throw new PluginError("ERR_UNDECLARED", "UI capability is not declared in manifest");
      }
      if (declaredPermissions.has("ui.windows") && revokedPermissions.has("ui.windows")) {
        throw new PluginError("ERR_PERMISSION", 'Permission "ui.windows" has been revoked');
      }
      uiMessageListeners.add(fn);
      return {
        dispose() {
          uiMessageListeners.delete(fn);
        }
      };
    },
    async post(to, msg) {
      record("ui.post", { to, msg });
      ensureActive();
      if (to.kind === "window") {
        requirePermission("ui.windows");
        if (!manifest.ui?.windows?.some((w) => w.id === to.id)) {
          throw new PluginError("ERR_UNDECLARED", `UI window "${to.id}" is not declared in manifest`);
        }
      } else if (!manifest.ui?.settings) {
        throw new PluginError("ERR_UNDECLARED", "UI settings panel is not declared in manifest");
      }
      uiMessages.push({ to, msg });
    }
  };
  const bindToActivation = (api, owner) => {
    const bound = {};
    for (const [key, value] of Object.entries(api)) {
      if (typeof value !== "function") {
        bound[key] = value;
        continue;
      }
      const kind = value.constructor?.name;
      bound[key] = (...args) => {
        const ended = () => new PluginError("ERR_UNAVAILABLE", "This plugin activation has ended");
        if (kind === "AsyncGeneratorFunction") {
          return (async function* () {
            if (owner.aborted) throw ended();
            for await (const chunk of value.apply(api, args)) {
              if (owner.aborted) throw ended();
              yield chunk;
            }
          })();
        }
        if (!owner.aborted) return value.apply(api, args);
        if (kind === "AsyncFunction") return Promise.reject(ended());
        throw ended();
      };
    }
    return bound;
  };
  const createContext = () => {
    const owner = contextAbort.signal;
    return {
      id: manifest.id,
      version: manifest.version ?? "1.0.0",
      dataDir: options.dataDir ?? `/mock/plugin-data/${manifest.id}`,
      signal: owner,
      has: (permission) => declaredPermissions.has(permission) && !revokedPermissions.has(permission),
      tools: bindToActivation(toolsApi, owner),
      context: bindToActivation(contextApi, owner),
      channels: bindToActivation(channelsApi, owner),
      model: bindToActivation(modelApi, owner),
      events: bindToActivation(eventsApi, owner),
      sessions: bindToActivation(sessionsApi, owner),
      workspace: bindToActivation(workspaceApi, owner),
      schedules: bindToActivation(schedulesApi, owner),
      secrets: bindToActivation(secretsApi, owner),
      ui: bindToActivation(uiApi, owner)
    };
  };
  const host = {
    manifest,
    calls,
    get contextSignal() {
      return contextAbort.signal;
    },
    get status() {
      return currentStatus;
    },
    get mode() {
      return currentMode;
    },
    get level() {
      return currentLevel;
    },
    secrets,
    schedules,
    channelStates,
    deliveredMessages,
    uiMessages,
    openWindows,
    setMode(mode) {
      currentMode = mode;
    },
    setLevel(level) {
      currentLevel = level;
    },
    grantPermission(permission) {
      revokedPermissions.delete(permission);
    },
    revokePermission(permission) {
      revokedPermissions.add(permission);
    },
    async activate(plugin) {
      if (currentStatus === "active") {
        throw new PluginError("ERR_INTERNAL", "Plugin is already active");
      }
      clearRegistrations();
      const activation = new AbortController();
      contextAbort = activation;
      currentPlugin = plugin;
      currentStatus = "active";
      try {
        await plugin.activate(createContext());
      } catch (error) {
        activation.abort("fault");
        if (contextAbort !== activation) throw error;
        currentStatus = "deactivated";
        for (const controller of channelControllers.values()) controller.abort("fault");
        channelControllers.clear();
        clearTransient();
        throw error;
      }
    },
    async deactivate(reason = "disabled") {
      if (currentStatus === "deactivated" || currentStatus === "idle") return;
      currentStatus = "deactivated";
      contextAbort.abort(reason);
      for (const controller of channelControllers.values()) {
        controller.abort(reason);
      }
      channelControllers.clear();
      try {
        await currentPlugin?.deactivate?.(reason);
      } finally {
        clearTransient();
      }
    },
    async crash() {
      if (currentStatus === "crashed") return;
      currentStatus = "crashed";
      contextAbort.abort("fault");
      for (const controller of channelControllers.values()) {
        controller.abort("fault");
      }
      channelControllers.clear();
      for (const inflight of Array.from(inflightTools.values())) {
        inflight.controller.abort("fault");
        inflight.onCrash();
      }
      inflightTools.clear();
      clearTransient();
    },
    async callTool(name, args, opts = {}) {
      if (currentStatus !== "active") {
        return { status: "not_executed", reason: `Plugin host is ${currentStatus}` };
      }
      const registered = registeredTools.get(name);
      const declared = manifest.tools?.find((t) => t.name === name);
      if (!registered || !declared) {
        throw new PluginError("ERR_UNDECLARED", `Tool "${name}" is not registered or declared`);
      }
      const effectiveMode = opts.mode ?? currentMode;
      if (effectiveMode === "chat" || !declared.modes.includes(effectiveMode)) {
        return { status: "not_executed", reason: `Tool "${name}" is unavailable in ${effectiveMode} mode` };
      }
      if (!registered.validate(args)) {
        return { status: "not_executed", reason: "ERR_INVALID_ARGUMENT: Tool arguments failed schema validation" };
      }
      const lifecycleSignal = contextAbort.signal;
      const verdict = evaluateToolPermission(currentLevel, declared.risk);
      if (verdict === "deny") {
        return { status: "not_executed", reason: `ERR_PERMISSION: Tool "${name}" denied under ${currentLevel} permission level` };
      }
      if (verdict === "ask") {
        const caller = opts.caller ?? "firefly";
        const approval = registered.def.describeApproval?.(args);
        const decision = typeof options.approvalDecision === "function" ? await options.approvalDecision({ tool: name, risks: declared.risk, args, mode: effectiveMode, caller, approval }) : options.approvalDecision ?? "allow";
        if (decision === "reject") {
          return { status: "not_executed", reason: "ERR_REJECTED: Tool approval was rejected" };
        }
      }
      if (opts.signal?.aborted) {
        return { status: "not_executed", reason: "ERR_CANCELLED: Tool call was cancelled before execution" };
      }
      if (lifecycleSignal.aborted || lifecycleSignal !== contextAbort.signal) {
        return { status: "not_executed", reason: "ERR_CANCELLED: Plugin was stopped before the tool could run" };
      }
      const callId = opts.callId ?? `call-${++callCounter}`;
      const toolAbort = new AbortController();
      const onExternalAbort = () => toolAbort.abort(opts.signal?.reason ?? "cancelled");
      opts.signal?.addEventListener("abort", onExternalAbort, { once: true });
      const onLifecycleAbort = () => toolAbort.abort(lifecycleSignal.reason ?? "deactivated");
      lifecycleSignal.addEventListener("abort", onLifecycleAbort, { once: true });
      const call = {
        callId,
        sessionId: opts.sessionId ?? "test-session",
        mode: effectiveMode,
        caller: opts.caller ?? "firefly",
        signal: toolAbort.signal,
        progress: (message, percent) => {
          record("tool.progress", { callId, name, message, percent });
        }
      };
      return await new Promise((resolve, reject) => {
        let settled = false;
        const cleanup = () => {
          inflightTools.delete(callId);
          opts.signal?.removeEventListener("abort", onExternalAbort);
          lifecycleSignal.removeEventListener("abort", onLifecycleAbort);
        };
        inflightTools.set(callId, {
          controller: toolAbort,
          onCrash: () => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve({ status: "unknown", reason: "Plugin process crashed during tool execution" });
          }
        });
        try {
          Promise.resolve(registered.def.execute(args, call)).then(
            (res) => {
              if (settled) return;
              settled = true;
              cleanup();
              resolve(res);
            },
            (err) => {
              if (settled) return;
              settled = true;
              cleanup();
              reject(err);
            }
          );
        } catch (err) {
          if (!settled) {
            settled = true;
            cleanup();
            reject(err);
          }
        }
      });
    },
    cancelTool(callId) {
      const inflight = inflightTools.get(callId);
      if (!inflight) return false;
      inflight.controller.abort("cancelled");
      return true;
    },
    async provideContext(id, opts = {}) {
      ensureActive();
      const provider = registeredProviders.get(id);
      const declared = manifest.context?.find((c) => c.id === id);
      if (!provider || !declared) {
        throw new PluginError("ERR_UNDECLARED", `Context provider "${id}" is not registered or declared`);
      }
      const mode = opts.mode ?? currentMode;
      const source = opts.source ?? "user";
      if (!provider.modes.includes(mode) || !provider.sources.includes(source)) {
        return null;
      }
      const controller = new AbortController();
      const onContextAbort = () => controller.abort(contextAbort.signal.reason);
      const onOptAbort = () => controller.abort(opts.signal?.reason);
      if (contextAbort.signal.aborted) controller.abort(contextAbort.signal.reason);
      if (opts.signal?.aborted) controller.abort(opts.signal.reason);
      contextAbort.signal.addEventListener("abort", onContextAbort, { once: true });
      opts.signal?.addEventListener("abort", onOptAbort, { once: true });
      try {
        return await provider.provide({
          sessionId: opts.sessionId ?? "test-session",
          mode,
          source,
          signal: controller.signal
        });
      } finally {
        contextAbort.signal.removeEventListener("abort", onContextAbort);
        opts.signal?.removeEventListener("abort", onOptAbort);
      }
    },
    emitEvent(event) {
      const set = eventListeners.get(event.type);
      if (!set) return;
      for (const listener of set) {
        listener(event);
      }
    },
    async triggerSchedule(taskId, payload, signal) {
      ensureActive();
      const linked = linkLifecycle(signal);
      try {
        for (const listener of scheduleTriggerListeners) {
          await listener({ taskId, payload, signal: linked.signal });
        }
      } finally {
        linked.cleanup();
      }
    },
    approveSchedule(taskId) {
      const existing = schedules.get(taskId);
      if (!existing) return false;
      const update = pendingScheduleUpdates.get(taskId);
      pendingScheduleUpdates.delete(taskId);
      schedules.set(taskId, {
        ...existing,
        ...update,
        status: "active",
        updatedAt: (/* @__PURE__ */ new Date()).toISOString()
      });
      return true;
    },
    emitWorkspaceChange(info) {
      currentWorkspace = info;
      for (const listener of workspaceListeners) {
        listener(info);
      }
    },
    async sendUiMessage(event) {
      ensureActive();
      let result;
      for (const listener of uiMessageListeners) {
        result = await listener(event);
      }
      return result;
    },
    async startChannel(id) {
      ensureActive();
      const adapter = registeredChannels.get(id);
      if (!adapter) {
        throw new PluginError("ERR_UNDECLARED", `Channel "${id}" is not registered`);
      }
      channelControllers.get(id)?.abort("restarted");
      const controller = new AbortController();
      channelControllers.set(id, controller);
      await adapter.start(
        {
          reportState: (s) => {
            record("channels.reportState", { id, state: s });
            const list = channelStates.get(id) ?? [];
            list.push(s);
            channelStates.set(id, list);
          },
          deliver: async (message) => {
            record("channels.deliver", { id, message });
            deliveredMessages.push({ channelId: id, message });
            return { accepted: true, sessionId: `channel:${id}:${message.chat.id}` };
          }
        },
        controller.signal
      );
    },
    async stopChannel(id) {
      const adapter = registeredChannels.get(id);
      if (!adapter) {
        throw new PluginError("ERR_UNDECLARED", `Channel "${id}" is not registered`);
      }
      channelControllers.get(id)?.abort("stopped");
      channelControllers.delete(id);
      await adapter.stop();
    },
    async sendChannel(id, msg, signal) {
      ensureActive();
      const adapter = registeredChannels.get(id);
      if (!adapter) {
        throw new PluginError("ERR_UNDECLARED", `Channel "${id}" is not registered`);
      }
      const linked = linkLifecycle(signal);
      try {
        return await adapter.send(msg, linked.signal);
      } finally {
        linked.cleanup();
      }
    }
  };
  return host;
}
export {
  createTestHost,
  evaluateToolPermission
};
