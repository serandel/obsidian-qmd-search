import { spawn } from "child_process";
import { resolveBinaryPath, buildQmdEnv } from "./resolve-binary";

export type CollectionInfo = {
	name: string;
	path: string;
};

export type PrerequisiteResult =
	| { status: "ready"; collection: string }
	| { status: "binary-missing" }
	| { status: "no-collection"; candidates: CollectionInfo[] }
	| { status: "pick-collection"; candidates: CollectionInfo[] }
	| { status: "needs-indexing"; collection: string };

/**
 * Check whether QMD prerequisites are met for a given vault.
 *
 * @param qmdBinaryPath - configured binary path (may be bare name like "qmd")
 * @param vaultPath     - absolute path to the Obsidian vault
 * @param mcpConnected  - whether the MCP connection succeeded
 */
export async function checkPrerequisites(
	qmdBinaryPath: string,
	vaultPath: string,
	mcpConnected: boolean,
): Promise<PrerequisiteResult> {
	if (!mcpConnected) {
		return { status: "binary-missing" };
	}

	const resolvedPath = resolveBinaryPath(qmdBinaryPath);
	const env = buildQmdEnv(resolvedPath);

	const collections = await listCollections(resolvedPath, env);
	const exact = collections.filter((c) => pathsMatch(c.path, vaultPath));
	const related = collections.filter((c) => !pathsMatch(c.path, vaultPath) && pathsOverlap(c.path, vaultPath));

	if (exact.length === 1) {
		return { status: "ready", collection: exact[0]!.name };
	}

	if (exact.length > 1) {
		return { status: "pick-collection", candidates: exact };
	}

	// No exact match — include related collections (subfolder/parent)
	// so the modal can offer them as alternatives
	return { status: "no-collection", candidates: related };
}

/** Run `qmd collection list` and parse the output to extract collection names. */
export async function listCollections(
	resolvedPath: string,
	env: Record<string, string>,
): Promise<CollectionInfo[]> {
	const names = await parseCollectionList(resolvedPath, env);
	const results: CollectionInfo[] = [];

	for (const name of names) {
		const path = await getCollectionPath(resolvedPath, env, name);
		if (path) {
			results.push({ name, path });
		}
	}

	return results;
}

/** Parse collection names from `qmd collection list` output. */
async function parseCollectionList(
	resolvedPath: string,
	env: Record<string, string>,
): Promise<string[]> {
	const output = await runQmdCommand(resolvedPath, env, ["collection", "list"]);
	return parseCollectionListOutput(output);
}

/**
 * Extract collection names from the text output of `qmd collection list`.
 * Exported for testing.
 */
export function parseCollectionListOutput(output: string): string[] {
	const names: string[] = [];
	for (const line of output.split("\n")) {
		const match = line.match(/^(\S+)\s+\(qmd:\/\//);
		if (match) {
			names.push(match[1]!);
		}
	}
	return names;
}

/** Run `qmd collection show <name>` and extract the Path field. */
async function getCollectionPath(
	resolvedPath: string,
	env: Record<string, string>,
	name: string,
): Promise<string | null> {
	const output = await runQmdCommand(resolvedPath, env, ["collection", "show", name]);
	return parseCollectionShowPath(output);
}

/**
 * Extract the path from `qmd collection show` output.
 * Exported for testing.
 */
export function parseCollectionShowPath(output: string): string | null {
	for (const line of output.split("\n")) {
		const match = line.match(/^\s*Path:\s+(.+)/);
		if (match) {
			return match[1]!.trim();
		}
	}
	return null;
}

/** Normalize a path for comparison: remove trailing slashes. */
function normalizePath(p: string): string {
	return p.replace(/[/\\]+$/, "");
}

/** Check if two paths are equal after normalization. */
function pathsMatch(a: string, b: string): boolean {
	return normalizePath(a) === normalizePath(b);
}

/**
 * Check if one path is a parent or child of the other.
 * e.g. "/home/user/vault" overlaps with "/home/user/vault/notes"
 * and with "/home/user".
 * Exported for testing.
 */
export function pathsOverlap(a: string, b: string): boolean {
	const na = normalizePath(a) + "/";
	const nb = normalizePath(b) + "/";
	return na.startsWith(nb) || nb.startsWith(na);
}

/** Spawn a qmd subprocess and collect stdout. */
function runQmdCommand(
	resolvedPath: string,
	env: Record<string, string>,
	args: string[],
): Promise<string> {
	return new Promise((resolve, reject) => {
		const proc = spawn(resolvedPath, args, {
			stdio: ["ignore", "pipe", "pipe"],
			env,
		});

		let stdout = "";
		let stderr = "";
		proc.stdout?.on("data", (chunk: Buffer) => {
			stdout += chunk.toString();
		});
		proc.stderr?.on("data", (chunk: Buffer) => {
			stderr += chunk.toString();
		});

		proc.on("error", (err) => reject(err));
		proc.on("exit", (code) => {
			if (code !== 0) {
				reject(new Error(stderr.trim() || `qmd exited with code ${code}`));
			} else {
				resolve(stdout);
			}
		});
	});
}

/**
 * Run `qmd collection add <path> --name <name>` to create a new collection.
 * Returns the CLI output on success, throws on failure.
 */
export async function createCollection(
	qmdBinaryPath: string,
	vaultPath: string,
	collectionName: string,
): Promise<string> {
	const resolvedPath = resolveBinaryPath(qmdBinaryPath);
	const env = buildQmdEnv(resolvedPath);
	try {
		return await runQmdCommand(resolvedPath, env, ["collection", "add", vaultPath, "--name", collectionName]);
	} catch (err) {
		// CLI errors may include usage hints (e.g. "Use --name <name>") that
		// don't make sense in the plugin context. Keep only the first line.
		const msg = (err as Error).message.split("\n")[0]!.trim();
		throw new Error(msg);
	}
}

/** Derive a suggested collection name from a vault folder name. */
export function suggestCollectionName(vaultPath: string): string {
	const folderName = vaultPath.split(/[/\\]/).filter(Boolean).pop() || "vault";
	return folderName.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
}
