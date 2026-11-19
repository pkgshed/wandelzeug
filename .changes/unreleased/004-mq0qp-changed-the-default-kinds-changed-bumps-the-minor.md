---
kind: Changed
breaking: true
---
* The default kinds: `Changed` bumps the minor version and asks whether a change breaks, and so does `Fixed` with a patch bump. `Removed` always breaks. A kind with `bump: major` keeps working and always breaks. `breaking` and `kindBreaks` are now reserved front matter keys, so extra fields with these names need new names.
