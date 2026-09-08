---
"wrangler-action": minor
---

Cache the Wrangler install between runs.

When installing with npm, Wrangler is now installed into a directory owned by the action and cached via `@actions/cache`, keyed on the exact resolved Wrangler version, platform and architecture. Repeat runs restore the install instead of re-downloading Wrangler's dependency tree from the registry on every job.

A side effect of installing outside the project is that your `package.json`, lockfile and `node_modules` are no longer modified by the action.

Caching is on by default and can be disabled with the new `cache` input. It is skipped for yarn, pnpm and bun, and when Wrangler is already installed in the project. A cache miss, an unavailable cache service, or a run that cannot write to the cache falls back to installing normally, so caching can never be the reason a deployment fails.
