---
"@btravstack/entity": patch
---

A synchronous generator that throws no longer escapes `factory(...)`'s returned
function: the factory now returns a `Defect` carrying the original cause, the
same channel a rejecting generator already takes under `factoryAsync`.
