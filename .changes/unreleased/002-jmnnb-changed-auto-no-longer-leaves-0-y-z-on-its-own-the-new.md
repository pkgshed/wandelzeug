---
kind: Changed
---
* `auto` no longer leaves 0.y.z on its own. The new `bumpStrategy` setting decides how it bumps while the latest release is 0.y.z: `minor-capped`, the default, turns a major change into a minor bump, `shifted` moves every bump one level lower, and `literal` keeps the bumps of the kinds as they are. An explicit bump, as in `wlz release major`, always applies as given.
