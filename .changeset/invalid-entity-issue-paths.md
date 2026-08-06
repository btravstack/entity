---
"@btravstack/entity": minor
---

`InvalidEntity.issues` now prefixes each schema issue with the failing field's
dotted path (`"secret: Too small: …"`, `"tags.0: …"`); `invariants` messages
stay unprefixed.
