import { execFileSync } from "child_process";
import { existsSync } from "fs";

/**
 * Resolve a binary name to its absolute path.
 * Electron (especially Flatpak) strips the shell PATH, so bare command
 * names like "qmd" won't be found by spawn(). We try multiple strategies:
 * 1. Try common login shells (zsh, bash, sh) with -l -c which
 * 2. Check well-known binary locations
 */
export function resolveBinaryPath(binary: string): string {
	if (binary.startsWith("/")) return binary;

	// Try each shell as a login shell to resolve the binary
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

	// Check well-known locations
	const knownPaths = [
		`/home/linuxbrew/.linuxbrew/bin/${binary}`,
		`/usr/local/bin/${binary}`,
		`/opt/homebrew/bin/${binary}`,
		`${process.env.HOME}/.local/bin/${binary}`,
	];
	for (const p of knownPaths) {
		if (existsSync(p)) {
			console.log(`[QMD] Found '${binary}' at '${p}'`);
			return p;
		}
	}

	console.warn(`[QMD] Could not resolve '${binary}', using as-is`);
	return binary;
}

/** Get the directory containing the resolved binary, for PATH augmentation. */
export function getBinDir(resolvedPath: string): string {
	return resolvedPath.substring(0, resolvedPath.lastIndexOf("/"));
}
