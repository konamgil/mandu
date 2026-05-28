---
"@mandujs/core": patch
---

More DevTools (dev-only) correctness fixes from the audit:

- **Unbounded memory growth**: the persistence manager never trimmed `pendingEvents` when a flush failed with a non-quota storage error, so a repeatedly-failing flush grew the buffer without bound. It now caps `pendingEvents` to the most recent `maxPersistEvents` on failure.
- **Keyboard shortcut hijack**: the error overlay listened for bare `i`/`c` keys on `document` and fired its Ignore/Copy actions even while the user was typing in an input/textarea or holding a modifier (e.g. real Ctrl/Cmd+C). It now ignores those shortcuts when the event target is an editable element or a modifier is held.
