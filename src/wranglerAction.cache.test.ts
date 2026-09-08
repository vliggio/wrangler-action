import * as cache from "@actions/cache";
import * as exec from "@actions/exec";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTestConfig } from "./test/test-utils";
import { installWrangler } from "./wranglerAction";
import * as installCache from "./wranglerInstallCache";

vi.mock("@actions/cache", () => ({
	restoreCache: vi.fn(),
	saveCache: vi.fn(),
}));

vi.mock("./wranglerInstallCache", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("./wranglerInstallCache")>();
	return { ...actual, isWranglerInstalledAt: vi.fn(() => true) };
});

const npm = {
	name: "npm",
	install: "npm i",
	installArgs: ["--no-audit", "--no-fund"],
	exec: "npx",
	execNoInstall: "npx --no-install",
};

const pnpm = {
	name: "pnpm",
	install: "pnpm add",
	installArgs: [],
	exec: "pnpm exec",
	execNoInstall: "pnpm exec",
};

/** Config that forces installWrangler past the "already installed" check. */
function cacheTestConfig(overrides = {}) {
	return getTestConfig({
		config: {
			WRANGLER_VERSION: "4.18.1",
			didUserProvideWranglerVersion: true,
			CACHE_ENABLED: true,
			...overrides,
		},
	});
}

/** Pre-install probe reports an older version, so an install is required. */
function mockStaleInstalledVersion() {
	vi.spyOn(exec, "getExecOutput").mockResolvedValue({
		exitCode: 0,
		stdout: "wrangler 3.90.0",
		stderr: "",
	});
}

describe("installWrangler caching", () => {
	beforeEach(() => {
		process.env.RUNNER_TEMP = "/runner/temp";
		// Default to "not yet on disk" so tests exercise restore/install; the
		// on-disk fast path is covered by its own test below.
		vi.mocked(installCache.isWranglerInstalledAt).mockReturnValue(false);
		mockStaleInstalledVersion();
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.mocked(cache.restoreCache).mockReset();
		vi.mocked(cache.saveCache).mockReset();
	});

	it("uses an install already on disk without touching the cache", async () => {
		vi.mocked(installCache.isWranglerInstalledAt).mockReturnValue(true);
		const execSpy = vi.spyOn(exec, "exec").mockResolvedValue(0);

		const install = await installWrangler(cacheTestConfig(), npm);

		expect(install.version).toBe("4.18.1");
		expect(cache.restoreCache).not.toHaveBeenCalled();
		expect(execSpy).not.toHaveBeenCalled();
	});

	it("skips the install entirely on a cache hit", async () => {
		vi.mocked(installCache.isWranglerInstalledAt)
			.mockReturnValueOnce(false) // not on disk yet
			.mockReturnValue(true); // present after restore
		vi.mocked(cache.restoreCache).mockResolvedValue("some-key");
		const execSpy = vi.spyOn(exec, "exec").mockResolvedValue(0);

		const install = await installWrangler(cacheTestConfig(), npm);

		expect(install.version).toBe("4.18.1");
		expect(install.command).toContain("wrangler");
		// The whole point: nothing is installed when the cache already has it.
		expect(execSpy).not.toHaveBeenCalled();
		expect(cache.saveCache).not.toHaveBeenCalled();
	});

	it("installs into an action-owned directory and saves it on a miss", async () => {
		vi.mocked(installCache.isWranglerInstalledAt)
			.mockReturnValueOnce(false) // not on disk yet
			.mockReturnValue(true); // present after install
		vi.mocked(cache.restoreCache).mockResolvedValue(undefined);
		const execSpy = vi.spyOn(exec, "exec").mockResolvedValue(0);

		const install = await installWrangler(cacheTestConfig(), npm);

		expect(install.version).toBe("4.18.1");
		const [command, args] = execSpy.mock.calls[0];
		expect(command).toBe("npm");
		expect(args).toEqual([
			"i",
			"--prefix",
			installCache.getWranglerInstallDir("4.18.1"),
			"--no-save",
			"wrangler@4.18.1",
			"--no-audit",
			"--no-fund",
		]);
		expect(cache.saveCache).toHaveBeenCalledOnce();
	});

	it("invokes wrangler by absolute path, not through npx", async () => {
		vi.mocked(installCache.isWranglerInstalledAt)
			.mockReturnValueOnce(false)
			.mockReturnValue(true);
		vi.mocked(cache.restoreCache).mockResolvedValue("some-key");
		vi.spyOn(exec, "exec").mockResolvedValue(0);

		const install = await installWrangler(cacheTestConfig(), npm);

		expect(install.command).not.toContain("npx");
		expect(install.command).toContain("node_modules");
	});

	it("still installs when the cache cannot be read", async () => {
		vi.mocked(installCache.isWranglerInstalledAt)
			.mockReturnValueOnce(false)
			.mockReturnValue(true);
		vi.mocked(cache.restoreCache).mockRejectedValue(new Error("no cache"));
		const execSpy = vi.spyOn(exec, "exec").mockResolvedValue(0);

		const install = await installWrangler(cacheTestConfig(), npm);

		// A broken cache service must never break the deployment.
		expect(install.version).toBe("4.18.1");
		expect(execSpy).toHaveBeenCalled();
	});

	it("still succeeds when the cache cannot be written, as on fork PRs", async () => {
		vi.mocked(installCache.isWranglerInstalledAt)
			.mockReturnValueOnce(false)
			.mockReturnValue(true);
		vi.mocked(cache.restoreCache).mockResolvedValue(undefined);
		vi.mocked(cache.saveCache).mockRejectedValue(
			new Error("cache write not permitted"),
		);
		vi.spyOn(exec, "exec").mockResolvedValue(0);

		const install = await installWrangler(cacheTestConfig(), npm);

		expect(install.version).toBe("4.18.1");
		expect(install.command).toContain("node_modules");
	});

	it("leaves non-npm package managers on the uncached path", async () => {
		const execSpy = vi.spyOn(exec, "exec").mockResolvedValue(0);

		const install = await installWrangler(cacheTestConfig(), pnpm);

		expect(cache.restoreCache).not.toHaveBeenCalled();
		expect(execSpy).toHaveBeenCalledWith(
			"pnpm add",
			["wrangler@4.18.1"],
			expect.anything(),
		);
		expect(install.command).toBe("pnpm exec wrangler");
	});

	it("does not touch the cache when disabled", async () => {
		vi.spyOn(exec, "exec").mockResolvedValue(0);

		const install = await installWrangler(
			cacheTestConfig({ CACHE_ENABLED: false }),
			npm,
		);

		expect(cache.restoreCache).not.toHaveBeenCalled();
		expect(install.command).toBe("npx wrangler");
	});
});
