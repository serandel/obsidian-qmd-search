import { execFileSync } from "child_process";
import { existsSync, readdirSync } from "fs";
import { delimiter, dirname, join } from "path";

const isWindows = process.platform === "win32";

/**
 * Resolve a binary name to its absolute path.
 * Electron (especially Flatpak) strips the shell PATH, so bare command
 * names like "qmd" won't be found by spawn(). We try multiple strategies
 * depending on the platform.
 */
export function resolveBinaryPath(binary: string): string {
	console.log(`[QMD] resolveBinaryPath('${binary}') called`);

	// Already absolute — but check if it's a version-manager shim that
	// needs further resolution to the real binary.
	if (isWindows ? /^[A-Za-z]:\\/.test(binary) : binary.startsWith("/")) {
		const shimDirs = [".asdf/shims", ".local/share/mise/shims"];
		if (shimDirs.some((d) => binary.includes(d))) {
			console.log(`[QMD] Absolute path is a version manager shim: '${binary}'`);
			const real = scanVersionManagerInstalls(binary.split("/").pop()!);
			if (real) {
				console.log(`[QMD] Resolved shim to real binary: '${real}'`);
				return real;
			}
			console.warn(`[QMD] Could not resolve shim '${binary}', will try as-is`);
		}
		return binary;
	}

	// Platform-specific shell-based resolution
	const resolved = isWindows ? resolveViaWhere(binary) : resolveViaShell(binary);
	if (resolved) return resolved;

	// Check well-known locations
	for (const p of getKnownPaths(binary)) {
		if (existsSync(p)) {
			console.log(`[QMD] Found '${binary}' at '${p}'`);
			return p;
		}
	}

	console.warn(`[QMD] Could not resolve '${binary}', using as-is`);
	return binary;
}

/** Try each login shell to resolve the binary (Linux/macOS). */
function resolveViaShell(binary: string): string | null {
	const shells = ["/bin/zsh", "/bin/bash", "/bin/sh"];
	// Try login-only first (-l), then login+interactive (-li) to pick up
	// tools configured in .zshrc/.bashrc (e.g. asdf, nvm, mise).
	const flagSets: string[][] = [["-l", "-c"], ["-li", "-c"]];
	for (const flags of flagSets) {
		for (const shell of shells) {
			if (!existsSync(shell)) continue;
			try {
				const resolved = execFileSync(shell, [...flags, `which ${binary}`], {
					encoding: "utf-8",
					timeout: 5000,
				}).trim();
				if (resolved && existsSync(resolved)) {
					// asdf/mise shims are wrapper scripts that need the version
					// manager on PATH — resolve to the real binary instead.
					const real = resolveShim(shell, flags, binary, resolved);
					if (real) {
						console.log(`[QMD] Resolved '${binary}' → '${real}' (shim at ${resolved}, via ${shell} ${flags.join(" ")})`);
						return real;
					}
					console.log(`[QMD] Resolved '${binary}' → '${resolved}' (via ${shell} ${flags.join(" ")})`);
					return resolved;
				}
			} catch {
				// Try next combination
			}
		}
	}
	return null;
}

/**
 * If a resolved path is a version-manager shim (asdf, mise), resolve to the
 * real binary so we can spawn it directly without the version manager on PATH.
 * Falls back to scanning the installs directory when shell-based resolution
 * fails (e.g. when asdf is a shell function unavailable from Electron).
 */
function resolveShim(shell: string, flags: string[], binary: string, resolved: string): string | null {
	const shimDirs = [".asdf/shims", ".local/share/mise/shims"];
	const isShim = shimDirs.some((d) => resolved.includes(d));
	if (!isShim) return null;

	console.log(`[QMD] Detected version manager shim: ${resolved}`);

	// Try version-manager-specific resolution commands first
	const commands = [
		`asdf which ${binary}`,   // asdf
		`mise which ${binary}`,   // mise
	];
	for (const cmd of commands) {
		try {
			const real = execFileSync(shell, [...flags, cmd], {
				encoding: "utf-8",
				timeout: 5000,
			}).trim();
			console.log(`[QMD] '${cmd}' returned: '${real}', exists: ${existsSync(real)}`);
			if (real && existsSync(real)) {
				return real;
			}
		} catch (err) {
			console.log(`[QMD] '${cmd}' failed: ${(err as Error).message?.split("\n")[0]}`);
		}
	}

	console.log(`[QMD] Shell-based shim resolution failed, trying filesystem scan`);
	// Filesystem scan: look through version manager installs directories
	// for the actual binary (works even when the version manager itself
	// isn't available as a command).
	return scanVersionManagerInstalls(binary);
}

/**
 * Scan asdf/mise installs directories for a binary. This handles cases where
 * the binary is installed as a global npm/pip/etc. package under a managed
 * runtime (e.g. qmd installed via `npm install -g` under asdf's Node).
 */
function scanVersionManagerInstalls(binary: string): string | null {
	const home = process.env.HOME;
	if (!home) return null;

	const installRoots = [
		join(home, ".asdf", "installs"),
		join(home, ".local", "share", "mise", "installs"),
	];

	for (const root of installRoots) {
		if (!existsSync(root)) {
			console.log(`[QMD] Installs root not found: ${root}`);
			continue;
		}
		try {
			const tools = readdirSync(root);
			console.log(`[QMD] Scanning ${root}, tools: ${tools.join(", ")}`);
			for (const tool of tools) {
				const toolDir = join(root, tool);
				try {
					const versions = readdirSync(toolDir);
					for (const version of versions) {
						const versionDir = join(toolDir, version);
						// Check bin/ — covers direct installs and npm global
						// symlinks (existsSync follows symlinks)
						const directBin = join(versionDir, "bin", binary);
						const directExists = existsSync(directBin);
						console.log(`[QMD] Checking ${directBin}: ${directExists}`);
						if (directExists) {
							console.log(`[QMD] Found '${binary}' in version manager installs: ${directBin}`);
							return directBin;
						}
						// Check lib/node_modules/.bin/ (npm global packages)
						const npmDotBin = join(versionDir, "lib", "node_modules", ".bin", binary);
						if (existsSync(npmDotBin)) {
							console.log(`[QMD] Found '${binary}' in version manager installs: ${npmDotBin}`);
							return npmDotBin;
						}
					}
				} catch {
					// Can't read tool versions directory
				}
			}
		} catch {
			// Can't read installs directory
		}
	}
	console.log(`[QMD] Filesystem scan found nothing`);
	return null;
}

/** Use `where` to resolve the binary (Windows). */
function resolveViaWhere(binary: string): string | null {
	try {
		const output = execFileSync("cmd.exe", ["/c", "where", binary], {
			encoding: "utf-8",
			timeout: 5000,
		}).trim();
		// `where` may return multiple lines; take the first match
		const resolved = output.split(/\r?\n/)[0]?.trim();
		if (resolved && existsSync(resolved)) {
			console.log(`[QMD] Resolved '${binary}' → '${resolved}' (via where)`);
			return resolved;
		}
	} catch {
		// `where` failed — binary not on PATH
	}
	return null;
}

/** Return well-known binary locations for the current platform. */
function getKnownPaths(binary: string): string[] {
	if (isWindows) {
		const localAppData = process.env.LOCALAPPDATA || "";
		const programFiles = process.env.PROGRAMFILES || "C:\\Program Files";
		return [
			...(localAppData ? [join(localAppData, "Programs", binary, `${binary}.exe`)] : []),
			join(programFiles, binary, `${binary}.exe`),
			join("C:\\", binary, `${binary}.exe`),
		];
	}

	const home = process.env.HOME || "";
	return [
		"/opt/homebrew/bin/" + binary,
		"/home/linuxbrew/.linuxbrew/bin/" + binary,
		"/usr/local/bin/" + binary,
		...(home ? [join(home, ".local", "bin", binary)] : []),
	];
}

/** Get the directory containing the resolved binary, for PATH augmentation. */
export function getBinDir(resolvedPath: string): string {
	return dirname(resolvedPath);
}

/**
 * Build the environment for spawning QMD subprocesses.
 * Prepends the binary's directory to PATH so shell wrappers can find
 * sibling binaries, and on Linux strips XDG_CACHE_HOME and XDG_CONFIG_HOME
 * so the Flatpak sandbox overrides don't redirect qmd away from the host
 * cache and config directories.
 */
export function buildQmdEnv(resolvedPath: string): Record<string, string> {
	const binDir = getBinDir(resolvedPath);
	const baseEnv = { ...process.env } as Record<string, string>;

	// Strip Flatpak XDG overrides (only relevant on Linux)
	if (!isWindows) {
		delete baseEnv.XDG_CACHE_HOME;
		delete baseEnv.XDG_CONFIG_HOME;
	}

	return {
		...baseEnv,
		PATH: binDir + delimiter + (process.env.PATH || ""),
	};
}
