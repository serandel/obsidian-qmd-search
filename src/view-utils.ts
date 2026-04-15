/** Extract vault-relative path from a QMD file reference.
 *  Handles both URI format (qmd://collection/path) and plain format (collection/path). */
export function extractVaultPath(qmdFile: string): string | null {
	// qmd://obsidian/path/to/note.md → path/to/note.md
	const uriMatch = qmdFile.match(/^qmd:\/\/[^/]+\/(.+)$/);
	if (uriMatch) return uriMatch[1]!;

	// obsidian/path/to/note.md → path/to/note.md
	// Require the first segment to be a simple name (no colons, slashes, or protocol markers)
	const plainMatch = qmdFile.match(/^[^/:]+\/(.+)$/);
	return plainMatch?.[1] ?? null;
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

/** Slugify a path the same way QMD does: lowercase, collapse non-alphanumeric runs to hyphens. */
export function slugifyPath(path: string): string {
	return path
		.split("/")
		.map((segment) =>
			segment
				.toLowerCase()
				.replace(/[^a-z0-9.]+/g, "-")
				.replace(/^-|-$/g, "")
		)
		.join("/");
}
