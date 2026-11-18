---
kind: Added
---
* String and int fields take a `url` and a `label`, which turn references such as `[FOO-1234]` or `[#42]` into links. wandelzeug finds them in the notes, whether the front matter or the text of a change holds them, and keeps their definitions between the `wlz:links` markers. `wlz show` and tag messages end with the definitions that their notes use.
