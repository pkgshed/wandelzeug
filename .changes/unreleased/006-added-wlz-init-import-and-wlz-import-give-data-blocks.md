---
kind: Added
---
* `wlz init --import` and `wlz import` give data blocks to the releases of an existing changelog, so `wlz render` renders them too. The import stops at the first release that does not fit, makes it the baseline, and explains why it stopped.
