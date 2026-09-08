import { existsSync } from "node:fs";
import * as path from "node:path";

export interface PackageManager {
	install: string;
	/**
	 * Extra flags appended to the install command.
	 *
	 * Used to skip work that is pure overhead for a single-purpose CI install,
	 * such as npm's blocking `audit` registry round-trip.
	 */
	installArgs: readonly string[];
	exec: string;
	execNoInstall: string;
}

const PACKAGE_MANAGERS = {
	npm: {
		install: "npm i",
		installArgs: ["--no-audit", "--no-fund"],
		exec: "npx",
		execNoInstall: "npx --no-install",
	},
	yarn: {
		install: "yarn add",
		installArgs: [],
		exec: "yarn",
		execNoInstall: "yarn",
	},
	pnpm: {
		install: "pnpm add",
		installArgs: [],
		exec: "pnpm exec",
		execNoInstall: "pnpm exec",
	},
	bun: {
		install: "bun i",
		installArgs: [],
		exec: "bunx",
		execNoInstall: "bun run",
	},
} as const satisfies Readonly<Record<string, PackageManager>>;

type PackageManagerValue = keyof typeof PACKAGE_MANAGERS;

function detectPackageManager(
	workingDirectory = ".",
): PackageManagerValue | null {
	if (existsSync(path.join(workingDirectory, "package-lock.json"))) {
		return "npm";
	}
	if (existsSync(path.join(workingDirectory, "yarn.lock"))) {
		return "yarn";
	}
	if (existsSync(path.join(workingDirectory, "pnpm-lock.yaml"))) {
		return "pnpm";
	}
	if (
		existsSync(path.join(workingDirectory, "bun.lockb")) ||
		existsSync(path.join(workingDirectory, "bun.lock"))
	) {
		return "bun";
	}
	return null;
}

function assertValidPackageManagerValue(
	name: string,
): asserts name is PackageManagerValue | "" {
	if (name && !Object.keys(PACKAGE_MANAGERS).includes(name)) {
		throw new TypeError(
			`invalid value provided for "packageManager": ${name}
	Value must be one of: [${Object.keys(PACKAGE_MANAGERS).join(", ")}]`,
		);
	}
}

export function getPackageManager(
	name: string,
	{ workingDirectory = "." }: { workingDirectory?: string } = {},
) {
	assertValidPackageManagerValue(name);

	return PACKAGE_MANAGERS[
		name || detectPackageManager(workingDirectory) || "npm"
	];
}
