/** Extract vault-relative path from qmd:// URI. */
export function extractVaultPath(qmdFile: string): string | null {
	// qmd://obsidian/path/to/note.md → path/to/note.md
	const match = qmdFile.match(/^qmd:\/\/[^/]+\/(.+)$/);
	return match?.[1] ?? null;
}

/** Extract 0-indexed line number from a diff-style snippet header. */
export function extractLineFromSnippet(snippet: string): number | null {
	// @@ -6,4 @@ (5 before, 2 after) → line 6
	const match = snippet.match(/^@@ -(\d+)/);
	if (match) {
		return parseInt(match[1]!, 10) - 1; // 0-indexed
	}
	return null;
}

/** Remove the @@ header line from a snippet. */
export function cleanSnippet(snippet: string): string {
	return snippet.replace(/^@@[^\n]*\n/, "").trim();
}

/** Extract a readable filename (without .md) from a path. */
export function extractFilename(file: string): string {
	return file.split("/").pop()?.replace(/\.md$/, "") ?? file;
}

/** Extract the directory portion of a qmd:// URI. */
export function extractPath(file: string): string {
	const vaultPath = extractVaultPath(file);
	if (!vaultPath) return file;
	const parts = vaultPath.split("/");
	parts.pop();
	return parts.join("/") || "/";
}
