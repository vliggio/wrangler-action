import { existsSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { getExecOutput } from "@actions/exec";

/**
 * Bumped whenever the on-disk layout of a cached install changes, so that
 * previously saved entries are ignored rather than restored into a shape the
 * action no longer understands.
 */
const CACHE_VERSION = "v1";

/**
 * Wrangler is installed into a directory owned by the action rather than into
 * the user's project. This keeps the user's `package.json`, lockfile and
 * `node_modules` untouched, and means the cached entry only ever contains
 * Wrangler and its dependencies.
 */
export function getWranglerInstallDir(exactVersion: string): string {
	const base = process.env.RUNNER_TEMP || os.tmpdir();
	return path.join(base, "wrangler-action", `npm-${exactVersion}`);
}

/**
 * The cache key pins the exact resolved version, so a range like `4` picks up
 * new releases instead of being frozen at whatever was cached first.
 */
export function getCacheKey(exactVersion: string): string {
	return [
		"wrangler-action",
		CACHE_VERSION,
		process.platform,
		process.arch,
		"npm",
		exactVersion,
	].join("-");
}

export function getWranglerBinPath(installDir: string): string {
	// npm writes a `.cmd` shim on Windows; the extensionless file there is a
	// shell script that cmd.exe cannot execute.
	const binName = process.platform === "win32" ? "wrangler.cmd" : "wrangler";
	return path.join(installDir, "node_modules", ".bin", binName);
}

export function isWranglerInstalledAt(installDir: string): boolean {
	return existsSync(getWranglerBinPath(installDir));
}

/**
 * Resolves a version spec (`4`, `^4.1.0`, `latest`) to a single exact version.
 *
 * Returns null if the spec cannot be resolved, in which case the caller should
 * fall back to an uncached install rather than failing: caching is an
 * optimisation and must never be the reason a deployment breaks.
 */
export async function resolveExactVersion(
	versionSpec: string,
	{ silent = false }: { silent?: boolean } = {},
): Promise<string | null> {
	try {
		const { exitCode, stdout } = await getExecOutput(
			"npm",
			["view", `wrangler@${versionSpec}`, "version", "--json"],
			{ silent, ignoreReturnCode: true },
		);

		if (exitCode !== 0) {
			return null;
		}

		const parsed: unknown = JSON.parse(stdout);

		// A range matches many versions and yields an array in ascending order;
		// an exact version or dist-tag yields a bare string.
		if (Array.isArray(parsed)) {
			const latest = parsed.at(-1);
			return typeof latest === "string" ? latest : null;
		}

		return typeof parsed === "string" ? parsed : null;
	} catch {
		return null;
	}
}
