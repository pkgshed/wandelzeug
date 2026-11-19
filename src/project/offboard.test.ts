import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeConfig } from "../test-helpers.ts";
import { applyOffboarding, planOffboarding } from "./offboard.ts";
import { loadProject } from "./root.ts";

describe("offboarding", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "wandelzeug-offboard-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test("it leaves an unreleased directory outside .changes alone", async () => {
    await writeConfig(root, "unreleasedDir: ../notes\n");
    const outside = join(root, "notes");
    await mkdir(outside);
    await writeFile(
      join(outside, "001-fixed.md"),
      "---\nkind: Fixed\n---\n* A\n",
    );

    const plan = await planOffboarding(await loadProject(root), {
      stripMarkers: false,
    });
    expect(plan.outsideUnreleased).toBe(outside);
    expect(plan.pending.changes).toEqual([]);

    await applyOffboarding(plan);
    expect(await Bun.file(join(root, ".changes/config.yaml")).exists()).toBe(
      false,
    );
    expect(await Bun.file(join(outside, "001-fixed.md")).exists()).toBe(true);
  });
});
