import { execFileSync } from "child_process";
import { existsSync } from "fs";
import { delimiter, dirname, join } from "path";

const isWindows = process.platform === "win32";

/**
 * Resolve a binary name to its absolute path.
 * Electron (especially Flatpak) strips the shell PATH, so bare command
 * names like "qmd" won't be found by spawn(). We try multiple strategies
 * depending on the platform.
 */
export function resolveBinaryPath(binary: string): string {
	// Already absolute — return as-is
	if (isWindows ? /^[A-Za-z]:\\/.test(binary) : binary.startsWith("/")) return binary;

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
	for (const shell of shells) {
		if (!existsSync(shell)) continue;
		try {
			const resolved = execFileSync(shell, ["-l", "-c", `which ${binary}`], {
				encoding: "utf-8",
				timeout: 5000,
			}).trim();
			if (resolved && existsSync(resolved)) {
				console.log(`[QMD] Resolved '${binary}' → '${resolved}' (via ${shell})`);
				return resolved;
			}
		} catch {
			// Try next shell
		}
	}
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
