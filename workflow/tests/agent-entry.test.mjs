import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

test("tool entry files route recruitment work to the single agent protocol", async () => {
  const protocol = await fs.readFile("workflow/AGENT_PROTOCOL.md", "utf8");
  for (const file of ["AGENTS.md", "CLAUDE.md", ".cursor/rules/recruitment-agent.mdc"]) {
    const text = await fs.readFile(file, "utf8");
    assert.match(text, /workflow\/AGENT_PROTOCOL\.md/);
  }
  for (const term of ["当前岗位", "变更预览", "确认", "ACTION_LOG.md", "进行中", "通过", "终止", "一面通过"]) {
    assert.match(protocol, new RegExp(term));
  }
});

test("agent CLI help is handled by the invoked script, not an imported dependency", async () => {
  const { stdout } = await execFileAsync(process.execPath, ["workflow/scripts/initialize-role-workspace.mjs", "--help"]);
  assert.match(stdout, /已确认流程的岗位工作区/);
  assert.doesNotMatch(stdout, /按岗位流程创建候选人台账/);
});
