---
kind: Added
---
* `wlz render` renders every release again from the data block in its `BEGIN` marker, so a changed template applies to past releases too. `wlz check` reports releases whose notes were edited by hand, and `wlz render --force` renders over them.
