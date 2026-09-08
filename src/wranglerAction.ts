import {
	debug,
	getMultilineInput,
	endGroup as originalEndGroup,
	startGroup as originalStartGroup,
	setFailed,
	setOutput,
} from "@actions/core";
import { getExecOutput } from "@actions/exec";
import semverSatisfies from "semver/functions/satisfies";
import semverValid from "semver/functions/valid";
import { z } from "zod";
import { restoreCache, saveCache } from "@actions/cache";
import { exec, execShell } from "./exec";
import { PackageManager } from "./packageManagers";
import {
	getCacheKey,
	getWranglerBinPath,
	getWranglerInstallDir,
	isWranglerInstalledAt,
	resolveExactVersion,
} from "./wranglerInstallCache";
import { error, info, semverCompare } from "./utils";
import { handleCommandOutputParsing } from "./commandOutputParsing";
import semverLt from "semver/functions/lt";

export type WranglerActionConfig = z.infer<typeof wranglerActionConfig>;
export const wranglerActionConfig = z.object({
	WRANGLER_VERSION: z.string(),
	didUserProvideWranglerVersion: z.boolean(),
	secrets: z.array(z.string()),
	workingDirectory: z.string(),
	CLOUDFLARE_API_TOKEN: z.string(),
	CLOUDFLARE_ACCOUNT_ID: z.string(),
	ENVIRONMENT: z.string(),
	VARS: z.array(z.string()),
	COMMANDS: z.array(z.string()),
	QUIET_MODE: z.boolean(),
	PACKAGE_MANAGER: z.string(),
	WRANGLER_OUTPUT_DIR: z.string(),
	GITHUB_TOKEN: z.string(),
	CACHE_ENABLED: z.boolean(),
});

/**
 * How Wrangler should be invoked for the rest of the run.
 *
 * Either a package-manager runner such as `npx wrangler`, or an absolute path
 * to a binary in an install directory owned by the action.
 */
export interface WranglerInstall {
	version: string;
	command: string;
}

function quoteCommand(command: string): string {
	return /\s/.test(command) ? `"${command}"` : command;
}

function startGroup(config: WranglerActionConfig, name: string): void {
	if (!config.QUIET_MODE) {
		originalStartGroup(name);
	}
}

function endGroup(config: WranglerActionConfig): void {
	if (!config.QUIET_MODE) {
		originalEndGroup();
	}
}

async function main(
	config: WranglerActionConfig,
	packageManager: PackageManager,
) {
	try {
		wranglerActionConfig.parse(config);
		authenticationSetup(config);
		const install = await installWrangler(config, packageManager);
		const resolvedConfig = { ...config, WRANGLER_VERSION: install.version };

		await execCommands(
			resolvedConfig,
			install.command,
			getMultilineInput("preCommands"),
			"pre",
		);
		await uploadSecrets(resolvedConfig, install.command);
		await wranglerCommands(resolvedConfig, install.command);
		await execCommands(
			resolvedConfig,
			install.command,
			getMultilineInput("postCommands"),
			"post",
		);
		info(resolvedConfig, "🏁 Wrangler Action completed", true);
	} catch (err: unknown) {
		err instanceof Error && error(config, err.message);
		setFailed("🚨 Action failed");
	}
}

function parseWranglerVersion(stdout: string): string {
	const match =
		stdout.match(/wrangler (\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?)/) ??
		stdout.match(/^(\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?)/m);
	return match ? match[1] : "";
}

function isExactSemver(version: string): boolean {
	return semverValid(version) !== null;
}

async function resolveInstalledVersion(
	config: WranglerActionConfig,
	packageManager: PackageManager,
): Promise<string> {
	const { stdout } = await getExecOutput(
		packageManager.execNoInstall,
		["wrangler", "--version"],
		{
			cwd: config["workingDirectory"],
			silent: config.QUIET_MODE,
		},
	);
	return parseWranglerVersion(stdout);
}

/**
 * Installs Wrangler into a directory owned by the action, restoring it from
 * the GitHub Actions cache when a previous run already built the same version.
 *
 * Returns null if anything at all goes wrong. Caching is an optimisation, so a
 * miss, a cold cache service or an unresolvable version spec must degrade to
 * the ordinary install rather than failing the deployment.
 */
async function installWranglerCached(
	config: WranglerActionConfig,
	packageManager: PackageManager,
): Promise<WranglerInstall | null> {
	// The isolated install is spelled with `npm --prefix`; the other package
	// managers express this differently, so they keep the uncached path.
	if (!config.CACHE_ENABLED || packageManager.name !== "npm") {
		return null;
	}

	const versionSpec = config["WRANGLER_VERSION"];

	// The cache key must pin an exact version, otherwise a range like `4` would
	// be frozen at whatever release happened to be cached first.
	const exactVersion = isExactSemver(versionSpec)
		? versionSpec
		: await resolveExactVersion(versionSpec, { silent: config.QUIET_MODE });

	if (!exactVersion) {
		debug(`Could not resolve wrangler@${versionSpec} to an exact version`);
		return null;
	}

	const installDir = getWranglerInstallDir(exactVersion);
	const cacheKey = getCacheKey(exactVersion);
	const command = quoteCommand(getWranglerBinPath(installDir));

	try {
		// An earlier step in the same job may have already populated this
		// directory, in which case there is nothing to restore or install.
		if (isWranglerInstalledAt(installDir)) {
			info(config, `✅ Using Wrangler ${exactVersion}`, true);
			return { version: exactVersion, command };
		}

		try {
			const hit = await restoreCache([installDir], cacheKey);
			if (hit && isWranglerInstalledAt(installDir)) {
				info(config, `✅ Restored Wrangler ${exactVersion} from cache`, true);
				return { version: exactVersion, command };
			}
		} catch (err) {
			debug(`Error restoring Wrangler from cache: ${err}`);
		}

		await exec(
			"npm",
			[
				"i",
				"--prefix",
				installDir,
				"--no-save",
				`wrangler@${exactVersion}`,
				...packageManager.installArgs,
			],
			{ silent: config["QUIET_MODE"] },
		);

		if (!isWranglerInstalledAt(installDir)) {
			debug(`Wrangler binary missing from ${installDir} after install`);
			return null;
		}

		try {
			await saveCache([installDir], cacheKey);
		} catch (err) {
			// Expected on pull requests from forks, and when a parallel job has
			// already reserved this key.
			debug(`Error saving Wrangler to cache: ${err}`);
		}

		info(config, `✅ Wrangler installed`, true);
		return { version: exactVersion, command };
	} catch (err) {
		debug(`Error installing Wrangler into ${installDir}: ${err}`);
		return null;
	}
}

async function installWrangler(
	config: WranglerActionConfig,
	packageManager: PackageManager,
): Promise<WranglerInstall> {
	const projectCommand = `${packageManager.exec} wrangler`;

	if (config["WRANGLER_VERSION"].startsWith("1")) {
		throw new Error(
			`Wrangler v1 is no longer supported by this action. Please use major version 2 or greater`,
		);
	}

	startGroup(config, "🔍 Checking for existing Wrangler installation");
	let installedVersion = "";
	let versionSatisfied = false;
	try {
		installedVersion = await resolveInstalledVersion(config, packageManager);

		if (config.didUserProvideWranglerVersion && installedVersion) {
			if (isExactSemver(config["WRANGLER_VERSION"])) {
				versionSatisfied = installedVersion === config["WRANGLER_VERSION"];
			} else {
				// semverSatisfies handles ranges like "4", "^4.0.0", "4.x".
				// Returns false for dist-tags like "latest", falling through to reinstall.
				try {
					versionSatisfied = semverSatisfies(
						installedVersion,
						config["WRANGLER_VERSION"],
					);
				} catch {
					versionSatisfied = false;
				}
			}
		}
		if (!config.didUserProvideWranglerVersion && installedVersion) {
			info(
				config,
				`✅ No wrangler version specified, using pre-installed wrangler version ${installedVersion}`,
				true,
			);
			endGroup(config);
			return { version: installedVersion, command: projectCommand };
		}
		if (config.didUserProvideWranglerVersion && versionSatisfied) {
			info(config, `✅ Using Wrangler ${installedVersion}`, true);
			endGroup(config);
			return { version: installedVersion, command: projectCommand };
		}
		info(
			config,
			"⚠️ Wrangler not found or version is incompatible. Installing...",
			true,
		);
	} catch (error) {
		debug(`Error checking Wrangler version: ${error}`);
		info(
			config,
			"⚠️ Wrangler not found or version is incompatible. Installing...",
			true,
		);
	} finally {
		endGroup(config);
	}

	startGroup(config, "📥 Installing Wrangler");
	try {
		const cached = await installWranglerCached(config, packageManager);
		if (cached) {
			return cached;
		}

		await exec(
			packageManager.install,
			[`wrangler@${config["WRANGLER_VERSION"]}`, ...packageManager.installArgs],
			{
				cwd: config["workingDirectory"],
				silent: config["QUIET_MODE"],
			},
		);

		info(config, `✅ Wrangler installed`, true);
	} finally {
		endGroup(config);
	}

	let resolvedVersion = "";
	try {
		resolvedVersion = await resolveInstalledVersion(config, packageManager);
	} catch (err) {
		debug(`Error resolving installed Wrangler version: ${err}`);
	}

	if (resolvedVersion) {
		return { version: resolvedVersion, command: projectCommand };
	}

	// Fall back to the raw version string if it's already valid semver.
	// This preserves pre-existing behavior for exact version inputs.
	if (isExactSemver(config["WRANGLER_VERSION"])) {
		return { version: config["WRANGLER_VERSION"], command: projectCommand };
	}

	throw new Error(
		`Failed to determine installed Wrangler version after installing wrangler@${config["WRANGLER_VERSION"]}`,
	);
}

function authenticationSetup(config: WranglerActionConfig) {
	process.env.CLOUDFLARE_API_TOKEN = config["CLOUDFLARE_API_TOKEN"];
	process.env.CLOUDFLARE_ACCOUNT_ID = config["CLOUDFLARE_ACCOUNT_ID"];
}

async function execCommands(
	config: WranglerActionConfig,
	wranglerCommand: string,
	commands: string[],
	cmdType: string,
) {
	if (!commands.length) {
		return;
	}

	startGroup(config, `🚀 Running ${cmdType}Commands`);
	try {
		for (const command of commands) {
			// Swap the leading `wrangler` token for however Wrangler is actually
			// invoked for this run, leaving any other command untouched.
			const cmd = command.startsWith("wrangler")
				? `${wranglerCommand}${command.slice("wrangler".length)}`
				: command;

			await execShell(cmd, {
				cwd: config["workingDirectory"],
				silent: config["QUIET_MODE"],
			});
		}
	} finally {
		endGroup(config);
	}
}

function getSecret(secret: string) {
	if (!secret) {
		throw new Error("Secret name cannot be blank.");
	}

	const value = process.env[secret];
	if (!value) {
		throw new Error(`Value for secret ${secret} not found in environment.`);
	}

	return value;
}

function getEnvVar(envVar: string) {
	if (!envVar) {
		throw new Error("Var name cannot be blank.");
	}

	const value = process.env[envVar];
	if (!value) {
		throw new Error(`Value for var ${envVar} not found in environment.`);
	}

	return value;
}

async function legacyUploadSecrets(
	config: WranglerActionConfig,
	wranglerCommand: string,
	secrets: string[],
	environment?: string,
	workingDirectory?: string,
) {
	for (const secret of secrets) {
		const args = ["secret", "put", secret];
		if (environment) {
			args.push("--env", environment);
		}
		await exec(wranglerCommand, args, {
			cwd: workingDirectory,
			silent: config["QUIET_MODE"],
			input: Buffer.from(getSecret(secret)),
		});
	}
}

async function uploadSecrets(
	config: WranglerActionConfig,
	wranglerCommand: string,
) {
	const secrets: string[] = config["secrets"];
	const environment = config["ENVIRONMENT"];
	const workingDirectory = config["workingDirectory"];

	if (!secrets.length) {
		return;
	}

	startGroup(config, "🔑 Uploading secrets...");

	try {
		if (semverCompare(config["WRANGLER_VERSION"], "3.4.0")) {
			return legacyUploadSecrets(
				config,
				wranglerCommand,
				secrets,
				environment,
				workingDirectory,
			);
		}

		let args = ["secret", "bulk"];
		// if we're on a WRANGLER_VERSION prior to 3.60.0 use wrangler secret:bulk
		if (semverLt(config["WRANGLER_VERSION"], "3.60.0")) {
			args = ["secret:bulk"];
		}

		if (environment) {
			args.push("--env", environment);
		}

		await exec(wranglerCommand, args, {
			cwd: workingDirectory,
			silent: config["QUIET_MODE"],
			input: Buffer.from(
				JSON.stringify(
					Object.fromEntries(
						secrets.map((secret) => [secret, getSecret(secret)]),
					),
				),
			),
		});
	} catch (err: unknown) {
		if (err instanceof Error) {
			error(config, err.message);
			err.stack && debug(err.stack);
		}
		throw new Error(`Failed to upload secrets.`);
	} finally {
		endGroup(config);
	}
}

async function wranglerCommands(
	config: WranglerActionConfig,
	wranglerCommand: string,
) {
	startGroup(config, "🚀 Running Wrangler Commands");
	try {
		const commands = config["COMMANDS"];
		const environment = config["ENVIRONMENT"];

		if (!commands.length) {
			const wranglerVersion = config["WRANGLER_VERSION"];
			const deployCommand = semverCompare("2.20.0", wranglerVersion)
				? "deploy"
				: "publish";
			commands.push(deployCommand);
		}

		for (let command of commands) {
			const args = [];

			if (environment && !command.includes("--env")) {
				args.push("--env", environment);
			}

			if (
				config["VARS"].length &&
				(command.startsWith("deploy") || command.startsWith("publish")) &&
				!command.includes("--var")
			) {
				args.push("--var");
				for (const v of config["VARS"]) {
					args.push(`${v}:${getEnvVar(v)}`);
				}
			}

			// Used for saving the wrangler output
			let stdOut = "";
			let stdErr = "";

			// set WRANGLER_OUTPUT_FILE_DIRECTORY env for exec
			process.env.WRANGLER_OUTPUT_FILE_DIRECTORY = config.WRANGLER_OUTPUT_DIR;

			const options = {
				cwd: config["workingDirectory"],
				silent: config["QUIET_MODE"],
				listeners: {
					stdout: (data: Buffer) => {
						stdOut += data.toString();
					},
					stderr: (data: Buffer) => {
						stdErr += data.toString();
					},
				},
			};

			// Execute the wrangler command
			try {
				await exec(`${wranglerCommand} ${command}`, args, options);
			} catch (err: unknown) {
				if (stdErr) {
					error(config, stdErr);
				}
				throw err;
			}

			// Set the outputs for the command
			setOutput("command-output", stdOut);
			setOutput("command-stderr", stdErr);

			// Handles setting github action outputs and creating github deployment and job summary
			await handleCommandOutputParsing(config, command, stdOut);
		}
	} finally {
		endGroup(config);
	}
}

export {
	authenticationSetup,
	execCommands,
	info,
	installWrangler,
	isExactSemver,
	main,
	parseWranglerVersion,
	uploadSecrets,
	wranglerCommands,
};
