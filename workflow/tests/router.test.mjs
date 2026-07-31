import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("router requires role standard and ledger before candidate work", async () => {
  const content = await readFile("workflow/AGENTS.md", "utf8");
  assert.match(content, /ROLE_STANDARD\.md/);
  assert.match(content, /candidate-ledger\.xlsx/);
  assert.match(content, /人工确认/);
});

test("recruiting rules require explicit age and experience configuration", async () => {
  const content = await readFile("workflow/00-招聘规则.md", "utf8");
  assert.match(content, /年龄/);
  assert.match(content, /硬性标准/);
  assert.match(content, /对口岗位年限/);
  assert.match(content, /对口项目年限/);
  assert.match(content, /不自动拒绝/);
});
