# Coding agents

wandelzeug ships a skill for coding agents such as Claude Code, Codex, OpenCode, and pi. It tells an agent how to record change files with `wlz`, when a change is notable, which kind and breaking flag fit, and how to word the entry for the readers of the changelog. It also keeps the agent from editing the changelog by hand and from releasing without being asked. The skill lives in [`plugins/wandelzeug/skills/wandelzeug`](../plugins/wandelzeug/skills/wandelzeug/SKILL.md).

## Install in Claude Code

The repository is a plugin marketplace for Claude Code. To install the plugin with the skill, run the following command in a Claude Code session:

```text
/plugin install wandelzeug --marketplace pkgshed/wandelzeug
```

From a shell, or with Claude Code before version 2.1.275, add the marketplace and install the plugin in two steps:

```sh
claude plugin marketplace add pkgshed/wandelzeug
claude plugin install wandelzeug@wandelzeug
```

The version of the plugin follows the releases of wandelzeug, so an update of the plugin brings the skill of the newest release.

## Install with aska

[aska](https://github.com/pkgshed/aska) installs skills from git repositories into the directories that Codex, Claude Code, OpenCode, and pi read. To install the skill in the repository that you work on, run the following command in it:

```sh
aska add github.com/pkgshed/wandelzeug/plugins/wandelzeug/skills/wandelzeug
```

Without a version, aska picks the newest release of wandelzeug, so the skill matches the `wlz` that the release ships, and `aska update` follows later releases within the same major version. To choose the agents, add `--agent`, as in `--agent codex,claude`. To install the skill for yourself instead of the repository, add `--global`.

## Point agents to wandelzeug

An agent loads a skill when a task matches the skill's description. A task such as "fix the crash on start" doesn't mention the changelog, so the agent might not think of a change file. A line in the instructions that your repository gives its agents, such as `AGENTS.md` or `CLAUDE.md`, makes the habit reliable:

```md
Record every change that users notice with `wlz new`, and commit the change file together with the change.
```
