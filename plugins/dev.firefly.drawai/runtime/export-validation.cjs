"use strict";

const { SaxesParser } = require("../vendor/saxes.cjs");
const { error } = require("./paths.cjs");

const MAX_EXPORT_BYTES = 16 * 1024 * 1024;
const ALLOWED_SVG_TAGS = new Set([
  "svg", "g", "defs", "marker", "pattern", "path", "polygon",
  "rect", "ellipse", "circle", "line", "polyline", "text", "tspan", "title", "desc",
]);

/** Pure validation for PNG (base64) and sanitized SVG export payloads. */
function validateExport(kind, data) {
  if (kind === "png") {
    if (typeof data !== "string" || !data) {
      throw error("E_EXPORT", "PNG 无效或过大");
    }
    const buffer = Buffer.from(data, "base64");
    if (
      buffer.length > MAX_EXPORT_BYTES
      || buffer.length < 24
      || buffer.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a"
      || buffer.readUInt32BE(16) > 4096
      || buffer.readUInt32BE(20) > 4096
    ) {
      throw error("E_EXPORT", "PNG 无效或过大");
    }
    return buffer;
  }

  if (
    kind !== "svg"
    || typeof data !== "string"
    || Buffer.byteLength(data) > MAX_EXPORT_BYTES
    || /<!DOCTYPE|<!ENTITY/i.test(data)
  ) {
    throw error("E_EXPORT", "SVG 无效或过大");
  }

  let count = 0;
  const parser = new SaxesParser();
  parser.on("error", () => {
    throw error("E_EXPORT", "SVG XML 无效");
  });
  parser.on("opentag", (node) => {
    if (!ALLOWED_SVG_TAGS.has(node.name) || ++count > 25000) {
      throw error("E_EXPORT", "SVG 包含不支持的元素");
    }
    for (const [key, value] of Object.entries(node.attributes)) {
      if (/^on/i.test(key) || /href|^style$/i.test(key) || (/url\(/i.test(value) && !/^url\(#[a-z0-9_-]+\)$/i.test(value))) {
        throw error("E_EXPORT", "SVG 包含外部内容");
      }
    }
  });
  parser.write(data).close();
  return Buffer.from(data, "utf8");
}

module.exports = { validateExport };
