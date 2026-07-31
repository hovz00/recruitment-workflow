import assert from "node:assert/strict";
import test from "node:test";
import { normalizePipeline } from "../scripts/pipeline-config.mjs";

test("pipeline stage ids are continuous so the formal dashboard has one unambiguous order", () => {
  assert.throws(
    () => normalizePipeline({ stages: [{ id: 0, name: "简历" }, { id: 2, name: "面试" }] }),
    /连续编号/,
  );
});
