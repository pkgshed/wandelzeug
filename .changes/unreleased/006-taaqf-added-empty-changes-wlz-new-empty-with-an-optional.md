---
kind: Added
---
* Empty changes: `wlz new --empty`, with an optional `--reason`, records that a branch has nothing notable for the changelog, so `wlz check --since` passes. In a terminal, the list of kinds ends with "No notable change". The reason never shows in the changelog, and the next release deletes empty changes along with the changes that it releases.
