# Development

This guide is for working on wandelzeug itself.

## Set up and check

The development tools are pinned in `package.json`, and [just](https://just.systems) runs the same recipes locally and in CI. To install the tools and run every check, run the following commands:

```sh
bun install
just ci
```

`just ci` checks the formatting with Prettier, checks the types with TypeScript, runs the tests, and builds `dist/wlz.js`. It then runs the bundle as `wlz check` on the change files of wandelzeug. To format the code, run `just format`.

To run `wlz` from a checkout, run `bun link` in it. `wlz` then runs the code of the checkout until you run `bun unlink`.

## Record your changes

wandelzeug keeps its own changelog with wandelzeug. To record a change that users notice, run `bun src/cli.ts new` in the checkout, and commit the change file together with the change.

## Source layout

The source lives in TypeScript modules below `src/`, grouped by concern, with each module's tests next to it:

- `src/cli.ts` is the entry point and runs the commands.
- `src/cli/` holds the command line grammar, its help text and colour theme, and the value parsers for options and arguments, built with [Optique](https://optique.dev).
- `src/shared/` holds helpers, templates, slugs, and versions.
- `src/project/` holds the configuration, project roots, `init`, `check`, `release`, and the replacements.
- `src/changes/` holds change files, extra fields, and the input of `new`, including its questions and drafts.
- `src/changelog/` holds the changelog markers and releases.

`just build` bundles the modules with `bun build` into the single file `dist/wlz.js`, which git ignores.
