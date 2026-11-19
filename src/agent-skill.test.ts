import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import packageJson from "../package.json" with { type: "json" };
import { splitFrontMatter } from "./changes/fragments.ts";

/**
 * The skill for coding agents ships as a Claude Code plugin from the
 * marketplace in this repository, and aska installs its directory
 * straight from git. These tests keep the three in step.
 */
describe("agent skill", () => {
  const repository = join(import.meta.dir, "..");
  const readJson = async (path: string): Promise<Record<string, unknown>> =>
    JSON.parse(await readFile(join(repository, path), "utf8"));

  const marketplacePath = ".claude-plugin/marketplace.json";
  const pluginDirectory = "plugins/wandelzeug";
  const skillDirectory = `${pluginDirectory}/skills/wandelzeug`;

  test("the skill names its directory and describes when to use it", async () => {
    const text = await readFile(
      join(repository, skillDirectory, "SKILL.md"),
      "utf8",
    );
    const { name, description } = Bun.YAML.parse(
      splitFrontMatter(text).frontMatter,
    ) as { name?: unknown; description?: unknown };
    expect(name).toBe(basename(skillDirectory));
    expect(typeof description).toBe("string");
    const length = String(description).length;
    expect(length).toBeGreaterThan(0);
    expect(length).toBeLessThanOrEqual(1024);
  });

  test("the marketplace lists the plugin by the name of its manifest", async () => {
    const marketplace = await readJson(marketplacePath);
    const plugin = await readJson(
      `${pluginDirectory}/.claude-plugin/plugin.json`,
    );
    expect(marketplace.plugins).toEqual([
      expect.objectContaining({
        name: plugin.name,
        source: `./${pluginDirectory}`,
      }),
    ]);
  });

  test("the plugin carries the version of wandelzeug", async () => {
    const plugin = await readJson(
      `${pluginDirectory}/.claude-plugin/plugin.json`,
    );
    expect(plugin.version).toBe(packageJson.version);
  });
});
