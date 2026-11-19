import * as core from "@actions/core";
import mockfs from "mock-fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	handleCommandOutputParsing,
	sanitizeUrl,
} from "./commandOutputParsing";
import { getTestConfig } from "./test/test-utils";

afterEach(() => {
	mockfs.restore();
	vi.restoreAllMocks();
});

describe("handleCommandOutputParsing", () => {
	it("sets Workers Preview outputs from the artifact", async () => {
		mockfs({
			testOutputDir: {
				"wrangler-output-2024-10-17_18-48-40_463-2e6e83.json": `
        {"version": 1, "type":"preview", "worker_name":"example-worker", "preview_id":"preview-id", "preview_name":"feature-branch", "preview_slug":"feature-branch", "preview_urls":["https://feature-branch.example-worker.workers.dev"], "deployment_id":"deployment-id", "deployment_urls":["https://deployment-id.example-worker.workers.dev"]}`,
			},
		});
		const setOutput = vi
			.spyOn(core, "setOutput")
			.mockImplementation(() => undefined);
		const config = getTestConfig({
			config: {
				WRANGLER_OUTPUT_DIR: "./testOutputDir",
				GITHUB_TOKEN: "",
			},
		});

		await handleCommandOutputParsing(config, "preview", "");

		expect(setOutput).toHaveBeenCalledWith(
			"deployment-url",
			"https://feature-branch.example-worker.workers.dev",
		);
		expect(setOutput).toHaveBeenCalledWith(
			"preview-url",
			"https://feature-branch.example-worker.workers.dev",
		);
		expect(setOutput).toHaveBeenCalledWith(
			"preview-deployment-url",
			"https://deployment-id.example-worker.workers.dev",
		);
		expect(setOutput).toHaveBeenCalledWith("preview-name", "feature-branch");
		expect(setOutput).toHaveBeenCalledWith("preview-id", "preview-id");
		expect(setOutput).toHaveBeenCalledWith(
			"preview-deployment-id",
			"deployment-id",
		);
	});

	it("falls back to deployment-url stdout parsing for preview commands", async () => {
		mockfs({});
		const setOutput = vi
			.spyOn(core, "setOutput")
			.mockImplementation(() => undefined);
		const config = getTestConfig({
			config: {
				WRANGLER_OUTPUT_DIR: "./missing-output-dir",
				GITHUB_TOKEN: "",
			},
		});

		await handleCommandOutputParsing(
			config,
			"preview --name feature-branch",
			"Preview URL: https://feature-branch.example-worker.workers.dev",
		);

		expect(setOutput).toHaveBeenCalledOnce();
		expect(setOutput).toHaveBeenCalledWith(
			"deployment-url",
			"https://feature-branch.example-worker.workers.dev",
		);
	});

	it.each([
		"preview delete --name feature-branch --skip-confirmation",
		"preview secret list --name feature-branch",
		"preview base-config secret list",
		"preview future-command",
	])("does not use deployment fallback for `%s`", async (command) => {
		mockfs({});
		const setOutput = vi
			.spyOn(core, "setOutput")
			.mockImplementation(() => undefined);
		const config = getTestConfig({
			config: {
				WRANGLER_OUTPUT_DIR: "./missing-output-dir",
				GITHUB_TOKEN: "",
			},
		});

		await handleCommandOutputParsing(config, command, "");

		expect(setOutput).not.toHaveBeenCalled();
	});
});

describe("sanitizeUrl", () => {
	it("returns a well-formed https URL unchanged", () => {
		expect(sanitizeUrl("https://example.com")).toBe("https://example.com");
	});

	it("preserves http:// without double-prefixing", () => {
		expect(sanitizeUrl("http://example.com")).toBe("http://example.com");
	});

	it("strips a trailing ` (custom domain)` suffix", () => {
		expect(sanitizeUrl("https://example.com (custom domain)")).toBe(
			"https://example.com",
		);
	});

	it("prepends https:// when no protocol is present", () => {
		expect(sanitizeUrl("example.com")).toBe("https://example.com");
	});

	it("handles a bare domain with a trailing suffix", () => {
		expect(sanitizeUrl("example.com (custom domain)")).toBe(
			"https://example.com",
		);
	});

	it.each([undefined, ""])("passes through %o unchanged", (value) => {
		expect(sanitizeUrl(value)).toBe(value);
	});
});

describe("handleCommandOutputParsing URL sanitization", () => {
	const testConfig = getTestConfig({
		config: {
			WRANGLER_OUTPUT_DIR: "./testOutputDir",
			GITHUB_TOKEN: "",
		},
	});

	it("sanitizes pages deploy url and alias", async () => {
		mockfs({
			testOutputDir: {
				"wrangler-output-2024-10-17_18-48-40_463-2e6e83.json": `
{"version": 1, "type":"pages-deploy-detailed", "pages_project": "my-project", "environment":"production", "alias":"alias.example.com (custom domain)", "deployment_id": "abc-123", "url":"my-project.pages.dev (custom domain)"}`,
			},
		});
		const setOutput = vi
			.spyOn(core, "setOutput")
			.mockImplementation(() => undefined);

		await handleCommandOutputParsing(testConfig, "pages deploy", "");

		expect(setOutput).toHaveBeenCalledWith(
			"deployment-url",
			"https://my-project.pages.dev",
		);
		expect(setOutput).toHaveBeenCalledWith(
			"pages-deployment-alias-url",
			"https://alias.example.com",
		);
		expect(setOutput).toHaveBeenCalledWith(
			"deployment-alias-url",
			"https://alias.example.com",
		);
	});

	it("leaves a missing pages url and alias undefined", async () => {
		mockfs({
			testOutputDir: {
				"wrangler-output-2024-10-17_18-48-40_463-2e6e83.json": `
{"version": 1, "type":"pages-deploy-detailed", "pages_project": "my-project", "environment":"production", "deployment_id": "abc-123"}`,
			},
		});
		const setOutput = vi
			.spyOn(core, "setOutput")
			.mockImplementation(() => undefined);

		await handleCommandOutputParsing(testConfig, "pages deploy", "");

		expect(setOutput).toHaveBeenCalledWith("deployment-url", undefined);
		expect(setOutput).toHaveBeenCalledWith(
			"pages-deployment-alias-url",
			undefined,
		);
	});

	it("prepends https:// to a workers deploy target with no protocol", async () => {
		mockfs({
			testOutputDir: {
				"wrangler-output-2024-10-17_18-48-40_463-2e6e83.json": `
{"version": 1, "type":"deploy", "targets": ["my-worker.example.com"]}`,
			},
		});
		const setOutput = vi
			.spyOn(core, "setOutput")
			.mockImplementation(() => undefined);

		await handleCommandOutputParsing(testConfig, "deploy", "");

		expect(setOutput).toHaveBeenCalledWith(
			"deployment-url",
			"https://my-worker.example.com",
		);
	});
});
