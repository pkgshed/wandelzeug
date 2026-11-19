---
kind: Added
---
* `wlz offboard` removes wandelzeug from a project: it deletes the `.changes` directory and keeps the changelog. With `--strip-markers`, it also removes the markers and data blocks from the changelog, and keeps the notes and link definitions. Unreleased changes and a kept draft stop it unless you pass `--force`, and `--dry-run` lists what it would do.
