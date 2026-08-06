---
"@btravstack/entity": patch
---

CI no longer attempts to test on Node 20. The matrix runs the development
toolchain, and pnpm 11 requires `node:sqlite`, so that row could never install
anything. The published `engines` floor is documented as declared-but-unproven
until a consumer-side check exists.
