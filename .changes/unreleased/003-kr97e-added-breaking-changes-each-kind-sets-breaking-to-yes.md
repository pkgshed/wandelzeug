---
kind: Added
---
* Breaking changes: each kind sets `breaking` to `yes`, `no` or `ask`. A breaking change bumps the major version, gets `breaking: true` in its file and in the data block, and the default `changeFormat` labels it as **Breaking:**. For a kind that asks, `wlz new` asks "Breaking change?", and `--breaking` and `--no-breaking` answer without a question.
