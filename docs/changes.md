# Change files

This guide covers the format of change files, how `wlz new` records them, extra fields, links to issues and pull requests, and how `wlz check` validates them in CI.

## The file format

Each change is a Markdown file with YAML front matter. The `kind` key is required and must match a configured kind, ignoring case. Any other key, such as `pr` or `mr`, is metadata that templates can use. The body is the Markdown that appears in the changelog:

```md
---
kind: Added
pr: 42
---
* Support for TOML config
```

Change files live in `.changes/unreleased/nnn-NAME.md`. The number `nnn` orders the changes in the changelog: `new` takes the highest existing number plus one, padded to three digits, so the numbering starts again at `001` after a release. `NAME` comes from the `fragmentName` template, see [Templates](changelog.md#templates).

## Record a change

`new` takes the kind, the body, and metadata from its options. When stdin is a terminal, it asks for whatever the options leave out: the kind, a one-line body, and each extra field. You pick the kind and the options of `enum` and `enums` fields from a list, and `new` checks each answer before it moves on. A body line without a list marker becomes a `* ` item. To cancel, press Ctrl+C, and nothing gets recorded.

To write a longer change, pass `--edit`. The command writes a draft to `.changes/.draft.md`, filled in from the options, with comments that list the kinds and the open extra fields, and opens it in `$VISUAL` or `$EDITOR`. After the editor closes, `new` checks the draft. When it has problems, the command asks whether to edit it again. An empty body cancels the change.

The draft stays until the change is recorded, so nothing you write in the editor gets lost. After a problem, a declined edit, or a failed editor, run `wlz new --resume` to reopen the draft. `new --edit` refuses to replace a kept draft. `init` adds a `.changes/.gitignore` that keeps the draft out of version control.

## Extra fields

The `extraFields` setting lists front matter entries besides `kind` that `new` asks for and `check` validates. Their values sit at the top level of the front matter, next to `kind`, and templates use them by key, such as `{{pr}}`. Each entry has a `key`, a `prompt` that defaults to the key, a `type` that defaults to `string`, and a `required` flag that defaults to `false`.

The types and their settings follow changie's custom choices:

| Type | Value | Settings |
|------|-------|----------|
| `string` | One line of text | `minLength`, `maxLength`, `pattern`, `url`, `label` |
| `block` | Several lines of text, written as a literal block | `minLength`, `maxLength` |
| `int` | A whole number. `#42` and `!42` count as `42`, the way GitHub and GitLab write pull and merge request numbers. | `minInt`, `maxInt`, `url`, `label` |
| `enum` | One of the options, matched without regard to case | `enumOptions` |
| `enums` | Any of the options, stored as one comma-separated string in the order of the options | `enumOptions` |

The following configuration makes every change carry a pull request number and lets it name an area:

```yaml
extraFields:
  - key: pr
    prompt: Pull request number
    type: int
    minInt: 1
    required: true
  - key: area
    type: enum
    enumOptions: [cli, docs, tests]
```

A `pattern` is a JavaScript regular expression that the whole value must match, such as `'FOO-\d{1,9}'` for a ticket of a Jira project. Write it in single quotes, because YAML reads a backslash in double quotes as an escape.

`new` checks the values after the questions or after the editor closes, and `check` checks them again. Without a terminal, `new` fails when a required field is missing. To leave an optional field empty without a question, pass the key with an empty value, such as `--meta area=`.

## Link issues and pull requests

An extra field with a `url` turns references to its values into links. A reference is a label in square brackets, such as `[FOO-1234]` or `[#42]`, and wandelzeug finds it in the rendered notes. The reference can come from the front matter, placed by `changeFormat`, or from the text of a change, as in "Fixes [FOO-1] and [FOO-2]". The following configuration links Jira tickets and GitHub pull requests:

```yaml
extraFields:
  - key: issue
    pattern: 'FOO-\d{1,9}'
    url: "https://jira.corp.com/browse/{{issue}}"
  - key: pr
    type: int
    label: "#{{pr}}"
    url: "{{repositoryUrl}}/pull/{{pr}}"
changeFormat: "{{marker}}{{#issue}}[{{issue}}] {{/issue}}{{text}}{{#pr}} ([#{{pr}}]){{/pr}}"
```

With this configuration, the following change renders as `* [FOO-1234] Added the thing. ([#42])`:

```md
---
kind: Added
issue: FOO-1234
pr: 42
---
* Added the thing.
```

The settings work together:

- `url` is a Mustache template for the web address of a value. It can use the value and `repositoryUrl`, so a GitLab merge request can link to `{{repositoryUrl}}/-/merge_requests/{{mr}}`.
- `label` is a Mustache template for the text in brackets, which places the value once between fixed text, such as `#{{pr}}` or `!{{mr}}`. It defaults to the value itself. A label with fixed text keeps ordinary brackets, such as `[1]`, from passing for references.
- A `string` field with a `url` needs a `pattern`, which tells wandelzeug which labels belong to the field. An `int` field matches digits.

`batch` adds a definition for each new reference between the `wlz:links` markers, and `render` rebuilds them. `wlz show` ends with every link definition that its notes use, so the links work outside the changelog too. The tag message of `wlz release` gets them through `tagTemplate`, see [Tag messages](releases.md#tag-messages). Brackets in code, escaped brackets, and links that have a target already don't count as references.

## Check changes in CI

`check` validates every unreleased change against the configured kinds and extra fields, and the markers and data blocks in the changelog. It reports each problem with its file, and for the changelog with its line. With `--since REF`, it also fails when the commits since the current branch forked from `REF` add or modify no change file. Uncommitted files don't count.

To require a changelog entry in every pull request, run the following command in CI:

```sh
wlz check --since origin/main
```

The check needs the history of `REF`. With `actions/checkout`, set `fetch-depth: 0`.
