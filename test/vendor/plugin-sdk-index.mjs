// src/shared/plugin-protocol.ts
var PLUGIN_ERROR_CODES = [
  "ERR_UNDECLARED",
  "ERR_PERMISSION",
  "ERR_REJECTED",
  "ERR_CANCELLED",
  "ERR_TIMEOUT",
  "ERR_INVALID_ARGUMENT",
  "ERR_RATE_LIMITED",
  "ERR_UNAVAILABLE",
  "ERR_INTERNAL"
];
var PluginError = class extends Error {
  constructor(code, message, retryableOrOptions = false, cause) {
    const retryable = typeof retryableOrOptions === "boolean" ? retryableOrOptions : retryableOrOptions?.retryable ?? false;
    const resolvedCause = typeof retryableOrOptions === "object" && retryableOrOptions !== null ? "cause" in retryableOrOptions ? retryableOrOptions.cause : cause : cause;
    super(message, resolvedCause !== void 0 ? { cause: resolvedCause } : void 0);
    this.code = code;
    this.name = "PluginError";
    this.retryable = retryable;
    if (resolvedCause !== void 0 && !("cause" in this)) {
      ;
      this.cause = resolvedCause;
    }
  }
  code;
  /**
   * The SDK bundle a plugin imports and the host runtime each carry their own copy of this class, so
   * a plain prototype check would fail across that boundary. Any Error named PluginError with a
   * known code counts, which keeps `instanceof` and RPC error replies working in both directions.
   */
  static [Symbol.hasInstance](value) {
    if (!(value instanceof Error) || value.name !== "PluginError") return false;
    const code = value.code;
    return typeof code === "string" && PLUGIN_ERROR_CODES.includes(code);
  }
  retryable;
};

// plugin-sdk/src/index.ts
function definePlugin(plugin) {
  return plugin;
}
export {
  PLUGIN_ERROR_CODES,
  PluginError,
  definePlugin
};
