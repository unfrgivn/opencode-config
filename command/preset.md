---
description: List or select Fellowship runtime presets
---
Manage Fellowship runtime presets.

Instructions:
1. If the user supplied no arguments, call `fellowship_preset` with `action="list"`.
2. If the user supplied `default`, `none`, `off`, or `clear`, call `fellowship_preset` with `action="clear"`.
3. Otherwise call `fellowship_preset` with `action="set"` and `preset` set to the exact argument text: `{{$arguments}}`.
4. Present the tool output directly.
5. Remind the user that preset changes apply after restarting OpenCode.
