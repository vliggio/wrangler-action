---
"wrangler-action": minor
---

Add an opt-in `cache` input that caches the Wrangler install between runs.

When `cache: true` and the package manager is npm, Wrangler is installed into a directory owned by the action and cached via `@actions/cache`, keyed on the exact resolved Wrangler version, platform and architecture. A side effect of installing outside the project is that your `package.json`, lockfile and `node_modules` are no longer modified by the action.

Measured on a `ubuntu-latest` runner: 10s without caching, 12s on a cold cached run, 5s on a warm one. A warm run is about twice as fast, but a cold run is ~2s slower because saving the ~52MB entry is on the critical path, so the default is `false` — repos that deploy less often than GitHub's 7-day cache eviction would pay the cold cost without ever collecting the saving.

Caching is skipped for yarn, pnpm and bun, and when Wrangler is already installed in the project. A cache miss, an unavailable cache service, or a run that cannot write to the cache falls back to installing normally, so caching can never be the reason a deployment fails.
