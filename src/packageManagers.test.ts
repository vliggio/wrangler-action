import { describe, expect, test } from "vitest";
import { getPackageManager } from "./packageManagers";

describe("getPackageManager", () => {
	test("should use provided value instead of inferring from lockfile", () => {
		expect(
			getPackageManager("npm", { workingDirectory: "src/test/fixtures/npm" }),
		).toMatchInlineSnapshot(`
			{
			  "exec": "npx",
			  "execNoInstall": "npx --no-install",
			  "install": "npm i",
			  "installArgs": [
			    "--no-audit",
			    "--no-fund",
			  ],
			}
		`);

		expect(
			getPackageManager("yarn", { workingDirectory: "src/test/fixtures/npm" }),
		).toMatchInlineSnapshot(`
			{
			  "exec": "yarn",
			  "execNoInstall": "yarn",
			  "install": "yarn add",
			  "installArgs": [],
			}
		`);

		expect(
			getPackageManager("pnpm", { workingDirectory: "src/test/fixtures/npm" }),
		).toMatchInlineSnapshot(`
			{
			  "exec": "pnpm exec",
			  "execNoInstall": "pnpm exec",
			  "install": "pnpm add",
			  "installArgs": [],
			}
		`);

		expect(
			getPackageManager("bun", { workingDirectory: "src/test/fixtures/bun" }),
		).toMatchInlineSnapshot(`
			{
			  "exec": "bunx",
			  "execNoInstall": "bun run",
			  "install": "bun i",
			  "installArgs": [],
			}
		`);
	});

	test("should use npm if no value provided and package-lock.json exists", () => {
		expect(getPackageManager("", { workingDirectory: "src/test/fixtures/npm" }))
			.toMatchInlineSnapshot(`
				{
				  "exec": "npx",
				  "execNoInstall": "npx --no-install",
				  "install": "npm i",
				  "installArgs": [
				    "--no-audit",
				    "--no-fund",
				  ],
				}
			`);
	});

	test("should use yarn if no value provided and yarn.lock exists", () => {
		expect(
			getPackageManager("", { workingDirectory: "src/test/fixtures/yarn" }),
		).toMatchInlineSnapshot(`
			{
			  "exec": "yarn",
			  "execNoInstall": "yarn",
			  "install": "yarn add",
			  "installArgs": [],
			}
		`);
	});

	test("should use pnpm if no value provided and pnpm-lock.yaml exists", () => {
		expect(
			getPackageManager("", { workingDirectory: "src/test/fixtures/pnpm" }),
		).toMatchInlineSnapshot(`
			{
			  "exec": "pnpm exec",
			  "execNoInstall": "pnpm exec",
			  "install": "pnpm add",
			  "installArgs": [],
			}
		`);
	});

	test("should use bun if no value provided and bun.lockb exists", () => {
		expect(getPackageManager("", { workingDirectory: "src/test/fixtures/bun" }))
			.toMatchInlineSnapshot(`
				{
				  "exec": "bunx",
				  "execNoInstall": "bun run",
				  "install": "bun i",
				  "installArgs": [],
				}
			`);
	});

	test("should use npm if no value provided and no lockfile is present", () => {
		expect(
			getPackageManager("", { workingDirectory: "src/test/fixtures/empty" }),
		).toMatchInlineSnapshot(`
			{
			  "exec": "npx",
			  "execNoInstall": "npx --no-install",
			  "install": "npm i",
			  "installArgs": [
			    "--no-audit",
			    "--no-fund",
			  ],
			}
		`);
	});

	test("should throw if an invalid value is provided", () => {
		expect(() =>
			getPackageManager("cargo", { workingDirectory: "src/test/fixtures/npm" }),
		).toThrowError();
	});
});
