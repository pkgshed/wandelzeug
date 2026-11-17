import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { planReplacements } from "./replacements.ts";
import { createProject } from "./root.ts";

describe("replacements", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "wandelzeug-replacements-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const view = { version: "1.2.0", tag: "v1.2.0" };

  /** Compiles the given replacements the way a project configuration does. */
  const compiled = (replacements: Record<string, unknown>[]) =>
    createProject(root, { replacements }).replacements;

  const PACKAGE_VERSION = {
    path: "package.json",
    find: '"version": "[^"]*"',
    replace: '"version": "{{version}}"',
  };

  test("every match takes the rendered template", async () => {
    await writeFile(
      join(root, "versions.txt"),
      "version = 1.1.0\nname = demo\nversion = 1.1.0\n",
    );
    const updates = await planReplacements(
      compiled([
        {
          path: "versions.txt",
          find: "^version = .*$",
          replace: "version = {{version}}",
        },
      ]),
      view,
    );
    expect(updates).toEqual([
      {
        path: join(root, "versions.txt"),
        content: "version = 1.2.0\nname = demo\nversion = 1.2.0\n",
      },
    ]);
  });

  test("replacements of one file apply in order and yield one update", async () => {
    await writeFile(
      join(root, "package.json"),
      '{\n  "version": "1.1.0",\n  "tag": "v1.1.0"\n}\n',
    );
    const updates = await planReplacements(
      compiled([
        PACKAGE_VERSION,
        {
          path: "package.json",
          find: '"tag": "[^"]*"',
          replace: '"tag": "{{tag}}"',
        },
      ]),
      view,
    );
    expect(updates).toEqual([
      {
        path: join(root, "package.json"),
        content: '{\n  "version": "1.2.0",\n  "tag": "v1.2.0"\n}\n',
      },
    ]);
  });

  test("a dollar sign in the template stays literal", async () => {
    await writeFile(join(root, "price.txt"), "cost: 1\n");
    const [update] = await planReplacements(
      compiled([{ path: "price.txt", find: "1", replace: "$& {{version}}" }]),
      view,
    );
    expect(update?.content).toBe("cost: $& 1.2.0\n");
  });

  test("a pattern without a match stops the plan", async () => {
    await writeFile(join(root, "package.json"), '{\n  "name": "demo"\n}\n');
    const plan = planReplacements(compiled([PACKAGE_VERSION]), view);
    await expect(plan).rejects.toThrow(
      'package.json: replacements[0].find: no match for /"version": "[^"]*"/',
    );
  });

  test("a missing file stops the plan", async () => {
    const plan = planReplacements(compiled([PACKAGE_VERSION]), view);
    await expect(plan).rejects.toThrow("package.json: no such file");
  });
});
