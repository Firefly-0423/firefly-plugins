"use strict";

// Pure computation through the Firefly 1.2.0 Plugin SDK contract. No runtime SDK dependency.
const TOOL_NAME = "count";
let registration;

module.exports = {
  activate(ctx) {
    if (registration) throw new Error("Text stats is already activated");
    registration = ctx.tools.register({
      name: TOOL_NAME,
      description: "统计给定文本的 Unicode 码点字符数、按空白分隔的词数和非空行数。字符数包含空白和换行；连续中文不做词语切分。全部离线处理，不保存原文。",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "要统计的完整文本，可为空字符串" },
        },
        required: ["text"],
        additionalProperties: false,
      },
      describeApproval() {
        return { summary: "离线统计文本字符数、词数与非空行数" };
      },
      async execute(args, call) {
        if (call && call.signal && call.signal.aborted) {
          return { status: "not_executed", reason: "统计已取消" };
        }
        if (!args || typeof args.text !== "string") {
          return { status: "not_executed", reason: "text must be a string" };
        }
        const text = args.text;
        let characters = 0;
        for (const _character of text) characters++;
        let words = 0;
        for (const _word of text.matchAll(/\S+/gu)) words++;
        const nonEmptyLines = text.split(/\r\n|[\n\r\u2028\u2029]/u)
          .filter(line => line.trim().length > 0).length;
        return {
          status: "succeeded",
          output: { characters, words, nonEmptyLines },
          summary: `${characters} 字符，${words} 词，${nonEmptyLines} 非空行`,
        };
      },
    });
  },
  deactivate() {
    if (!registration) return;
    const current = registration;
    registration = undefined;
    current.dispose();
  },
};
