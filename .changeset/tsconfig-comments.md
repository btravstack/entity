---
"@btravstack/entity": patch
---

Documentation only: the build and publishing rationale that lived as comments
in `packages/entity/tsconfig.json` moves into CONTRIBUTING, matching the plain
JSON of `tsconfig.consumer.json`. A stale block describing a consumer-side
TS4020 hazard — fixed by the exported `ConstructionKey` seal — is dropped.
