---
"wrangler-action": patch
---

Skip `npm audit` and funding messages when installing Wrangler.

`npm i wrangler@<version>` triggers a blocking `npm audit` registry round-trip that is pure overhead for a single-purpose CI install. Passing `--no-audit --no-fund` cuts a measured ~19% off a cold-cache install (9.5s to 7.7s locally) with no change in what gets installed.

Only npm is affected: yarn, pnpm, and bun do not audit on add.
