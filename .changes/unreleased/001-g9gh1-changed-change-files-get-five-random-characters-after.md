---
kind: Changed
---
* Change files get five random characters after their number, as in `001-k7m2q-added-support-for-toml-config.md`, so branches that pick the same number at the same time merge without a conflict. The characters come from Crockford's base32 alphabet in lower case. wlz reads file names with and without them.
