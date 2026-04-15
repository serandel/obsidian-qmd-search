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

/** Extract the first content line from a snippet (after the @@ header). */
export function extractSnippetFirstLine(snippet: string): string | null {
	const cleaned = snippet.replace(/^\d+: /gm, "").replace(/^@@[^\n]*\n/, "");
	// Skip blank lines, return the first non-empty line
	for (const line of cleaned.split("\n")) {
		const trimmed = line.trim();
		if (trimmed) return trimmed;
	}
	return null;
}

/** Find the 0-indexed line number of a snippet's content within file content. */
export function findLineInContent(content: string, snippet: string): number | null {
	let needle = extractSnippetFirstLine(snippet);
	if (!needle) return null;
	// QMD truncates long lines with " ..." — strip it so we can match the real content
	needle = needle.replace(/\s*\.{3,}$/, "");
	if (!needle) return null;
	const lines = content.split("\n");
	for (let i = 0; i < lines.length; i++) {
		if (lines[i]!.includes(needle)) return i;
	}
	return null;
}

/** Remove line-number prefixes and the @@ header line from a snippet. */
export function cleanSnippet(snippet: string): string {
	return snippet
		.replace(/^\d+: /gm, "")
		.replace(/^@@[^\n]*\n/, "")
		.trim();
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
