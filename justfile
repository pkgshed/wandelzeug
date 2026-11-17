# List the recipes.
_default:
    @just --list

# Run everything the CI pipelines run.
ci: quality checks

# Check the formatting and the types.
quality:
    bun run prettier --check .
    bun run tsc --project tsconfig.json

# Run the tests, then build the bundle and check the changes of wandelzeug with it.
checks: test build
    bun dist/wlz.js check

# Run the test suite.
test:
    bun test

# Bundle the modules into the single executable file dist/wlz.js.
build:
    bun build src/cli.ts --target=bun --outfile=dist/wlz.js
    chmod +x dist/wlz.js

# Format every file that Prettier covers.
format:
    bun run prettier --write .
