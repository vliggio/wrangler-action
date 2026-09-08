import * as exec from "@actions/exec";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	getCacheKey,
	getWranglerBinPath,
	getWranglerInstallDir,
	resolveExactVersion,
} from "./wranglerInstallCache";

function mockExecOutput(exitCode: number, stdout: string) {
	vi.spyOn(exec, "getExecOutput").mockResolvedValue({
		exitCode,
		stdout,
		stderr: "",
	});
}

describe("getWranglerInstallDir", () => {
	const originalRunnerTemp = process.env.RUNNER_TEMP;

	beforeEach(() => {
		process.env.RUNNER_TEMP = "/runner/temp";
	});

	afterEach(() => {
		if (originalRunnerTemp === undefined) {
			delete process.env.RUNNER_TEMP;
		} else {
			process.env.RUNNER_TEMP = originalRunnerTemp;
		}
	});

	it("installs under RUNNER_TEMP, not the user's project", () => {
		expect(getWranglerInstallDir("4.18.1")).toBe(
			// path.join normalises separators per platform
			["/runner/temp", "wrangler-action", "npm-4.18.1"].join(
				process.platform === "win32" ? "\\" : "/",
			),
		);
	});

	it("gives each version its own directory", () => {
		expect(getWranglerInstallDir("4.18.1")).not.toBe(
			getWranglerInstallDir("4.18.2"),
		);
	});
});

describe("getCacheKey", () => {
	it("pins the exact version so a range picks up new releases", () => {
		expect(getCacheKey("4.18.1")).not.toBe(getCacheKey("4.18.2"));
	});

	it("is scoped to platform and arch", () => {
		const key = getCacheKey("4.18.1");
		expect(key).toContain(process.platform);
		expect(key).toContain(process.arch);
		expect(key).toContain("4.18.1");
	});
});

describe("getWranglerBinPath", () => {
	it("uses the .cmd shim on Windows and the bare name elsewhere", () => {
		const binPath = getWranglerBinPath("/install/dir");
		expect(binPath).toContain("node_modules");
		expect(
			binPath.endsWith(process.platform === "win32" ? ".cmd" : "wrangler"),
		).toBe(true);
	});
});

describe("resolveExactVersion", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("takes the highest match when a range resolves to many versions", async () => {
		mockExecOutput(0, JSON.stringify(["4.18.0", "4.18.1", "4.20.0"]));
		expect(await resolveExactVersion("4")).toBe("4.20.0");
	});

	it("passes through a single version for a dist-tag", async () => {
		mockExecOutput(0, JSON.stringify("4.20.0"));
		expect(await resolveExactVersion("latest")).toBe("4.20.0");
	});

	it("returns null for an unresolvable spec rather than throwing", async () => {
		mockExecOutput(1, "npm error code E404");
		expect(await resolveExactVersion("99")).toBeNull();
	});

	it("returns null when the output is not valid JSON", async () => {
		mockExecOutput(0, "not json");
		expect(await resolveExactVersion("4")).toBeNull();
	});

	it("returns null when npm cannot be run at all", async () => {
		vi.spyOn(exec, "getExecOutput").mockRejectedValue(
			new Error("command not found"),
		);
		expect(await resolveExactVersion("4")).toBeNull();
	});

	it("returns null for an empty array of matches", async () => {
		mockExecOutput(0, JSON.stringify([]));
		expect(await resolveExactVersion("4")).toBeNull();
	});
});
