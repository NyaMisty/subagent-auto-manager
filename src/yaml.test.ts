import assert from "node:assert/strict";
import { test } from "node:test";
import { toYaml } from "./yaml.js";

test("formats nested JSON-compatible values as YAML", () => {
  assert.equal(
    toYaml({
      summary: {
        sessionId: "session-yaml",
        running: 1,
        stopped: 0,
        closed: 0,
        total: 1
      },
      runs: [
        {
          subagentId: "agent-1",
          agentType: "general",
          state: "running",
          prompt: "inspect package.json",
          stopTime: null
        }
      ]
    }),
    [
      "summary:",
      "  sessionId: \"session-yaml\"",
      "  running: 1",
      "  stopped: 0",
      "  closed: 0",
      "  total: 1",
      "runs:",
      "  -",
      "    subagentId: \"agent-1\"",
      "    agentType: \"general\"",
      "    state: \"running\"",
      "    prompt: \"inspect package.json\"",
      "    stopTime: null",
      ""
    ].join("\n")
  );
});
