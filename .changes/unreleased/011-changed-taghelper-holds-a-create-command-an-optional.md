---
kind: Changed
---
* `tagHelper` holds a `create` command, an optional `check` command, and `env` variables. Each argument is a Mustache template, and the commands run without a shell. `wlz release` tags with `git tag` by default instead of semverkzeug, and checks by itself that the release files hold no uncommitted changes and that the tag is new.
