---
kind: Changed
---
* Data blocks write their hash without the `==` padding, as `hash=h1:` and 22 characters. Hashes with the padding stay valid, and `wlz render` shortens them. wlz 0.2.1 and older cannot read the short form.
