import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

test("project declares a supported Node version and a GitHub test workflow", async () => {
  const packageJson = JSON.parse(await fs.readFile("package.json", "utf8"));
  assert.equal(packageJson.engines.node, ">=18");
  const workflow = await fs.readFile(".github/workflows/test.yml", "utf8");
  assert.match(workflow, /npm ci/);
  assert.match(workflow, /npm test/);
});
