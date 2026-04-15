import { describe, expect, it } from "vitest";
import {
	cleanSnippet,
	extractFilename,
	extractSnippetFirstLine,
	findLineInContent,
	extractPath,
	extractVaultPath,
	slugifyPath,
} from "./view-utils";

describe("extractVaultPath", () => {
	it("extracts path from standard qmd:// URI", () => {
		expect(extractVaultPath("qmd://obsidian/notes/daily/2026-01-01.md")).toBe(
			"notes/daily/2026-01-01.md"
		);
	});

	it("extracts path from root-level file", () => {
		expect(extractVaultPath("qmd://obsidian/readme.md")).toBe("readme.md");
	});

	it("works with different collection names", () => {
		expect(extractVaultPath("qmd://my-vault/path/to/note.md")).toBe(
			"path/to/note.md"
		);
	});

	it("returns null for non-qmd URIs", () => {
		expect(extractVaultPath("https://example.com/file.md")).toBeNull();
	});

	it("returns null for empty string", () => {
		expect(extractVaultPath("")).toBeNull();
	});

	it("returns null for malformed qmd URI (no path)", () => {
		expect(extractVaultPath("qmd://obsidian")).toBeNull();
	});

	it("returns null for qmd URI with trailing slash only", () => {
		expect(extractVaultPath("qmd://obsidian/")).toBeNull();
	});

	it("extracts path from plain collection/path format", () => {
		expect(extractVaultPath("obsidian/notes/daily/2026-01-01.md")).toBe(
			"notes/daily/2026-01-01.md"
		);
	});

	it("extracts path from plain format with root-level file", () => {
		expect(extractVaultPath("obsidian/readme.md")).toBe("readme.md");
	});

	it("preserves spaces in paths", () => {
		expect(extractVaultPath("qmd://obsidian/my notes/file name.md")).toBe(
			"my notes/file name.md"
		);
	});
});

describe("extractSnippetFirstLine", () => {
	it("extracts first content line after @@ header", () => {
		expect(extractSnippetFirstLine("@@ -6,4 @@\nsome content")).toBe(
			"some content"
		);
	});

	it("skips blank lines after header", () => {
		expect(extractSnippetFirstLine("@@ -1,3 @@\n\nfirst real line")).toBe(
			"first real line"
		);
	});

	it("handles QMD line-number prefixes", () => {
		expect(
			extractSnippetFirstLine(
				"1: @@ -1,3 @@ (0 before, 34 after)\n2: # Title"
			)
		).toBe("# Title");
	});

	it("returns null for empty snippet", () => {
		expect(extractSnippetFirstLine("")).toBeNull();
	});

	it("returns null for header-only snippet", () => {
		expect(extractSnippetFirstLine("@@ -6,4 @@\n")).toBeNull();
	});

	it("returns content from snippet without header", () => {
		expect(extractSnippetFirstLine("just some text")).toBe("just some text");
	});
});

describe("findLineInContent", () => {
	const content = [
		"---",
		"title: My Note",
		"---",
		"",
		"# Heading",
		"",
		"Some paragraph text here.",
		"Another line.",
	].join("\n");

	it("finds the correct 0-indexed line for a snippet match", () => {
		expect(
			findLineInContent(content, "@@ -3,2 @@\nSome paragraph text here.")
		).toBe(6);
	});

	it("finds heading line", () => {
		expect(findLineInContent(content, "@@ -1,2 @@\n# Heading")).toBe(4);
	});

	it("returns null when snippet content not found", () => {
		expect(
			findLineInContent(content, "@@ -1,2 @@\nNot in the file")
		).toBeNull();
	});

	it("returns null for empty snippet", () => {
		expect(findLineInContent(content, "")).toBeNull();
	});

	it("handles QMD line-number prefixes in snippet", () => {
		expect(
			findLineInContent(
				content,
				"4: @@ -3,2 @@ (2 before, 5 after)\n5: Some paragraph text here."
			)
		).toBe(6);
	});

	it("matches when QMD truncates long lines with ...", () => {
		const longContent = [
			"---",
			"title: Test",
			"---",
			"",
			"This is a very long line that goes on and on with lots of words and content that QMD will truncate",
		].join("\n");
		expect(
			findLineInContent(
				longContent,
				"@@ -1,2 @@\nThis is a very long line that goes on and on ..."
			)
		).toBe(4);
	});
});

describe("cleanSnippet", () => {
	it("removes @@ header line and trims", () => {
		expect(cleanSnippet("@@ -6,4 @@\nThis is the content")).toBe(
			"This is the content"
		);
	});

	it("preserves multiple content lines", () => {
		expect(cleanSnippet("@@ -1,3 @@\nline one\nline two\nline three")).toBe(
			"line one\nline two\nline three"
		);
	});

	it("returns trimmed content when no @@ header", () => {
		expect(cleanSnippet("  just content  ")).toBe("just content");
	});

	it("returns empty string for header-only snippet", () => {
		expect(cleanSnippet("@@ -6,4 @@\n")).toBe("");
	});

	it("returns empty string for empty input", () => {
		expect(cleanSnippet("")).toBe("");
	});

	it("handles @@ with extra metadata", () => {
		expect(cleanSnippet("@@ -6,4 +8,6 @@ section header\ncontent")).toBe(
			"content"
		);
	});

	it("strips line-number prefixes from QMD output", () => {
		expect(
			cleanSnippet(
				"1: @@ -1,3 @@ (0 before, 34 after)\n2: # My Title\n3: \n4: Some content here"
			)
		).toBe("# My Title\n\nSome content here");
	});

	it("strips line-number prefixes with large numbers", () => {
		expect(
			cleanSnippet(
				"55: @@ -54,4 @@ (53 before, 46 after)\n56: First line\n57: Second line\n58: Third line"
			)
		).toBe("First line\nSecond line\nThird line");
	});
});

describe("extractFilename", () => {
	it("extracts filename without .md extension", () => {
		expect(extractFilename("qmd://obsidian/notes/daily/my-note.md")).toBe(
			"my-note"
		);
	});

	it("handles files without .md extension", () => {
		expect(extractFilename("path/to/file.txt")).toBe("file.txt");
	});

	it("handles root-level file", () => {
		expect(extractFilename("readme.md")).toBe("readme");
	});

	it("returns input for empty string", () => {
		expect(extractFilename("")).toBe("");
	});

	it("only removes .md at end, not in middle", () => {
		expect(extractFilename("path/my.md.backup")).toBe("my.md.backup");
	});
});

describe("extractPath", () => {
	it("extracts directory path from qmd URI", () => {
		expect(extractPath("qmd://obsidian/notes/daily/2026-01-01.md")).toBe(
			"notes/daily"
		);
	});

	it("returns / for root-level files", () => {
		expect(extractPath("qmd://obsidian/readme.md")).toBe("/");
	});

	it("returns original string for non-qmd URIs", () => {
		expect(extractPath("https://example.com/file.md")).toBe(
			"https://example.com/file.md"
		);
	});

	it("handles deeply nested paths", () => {
		expect(extractPath("qmd://obsidian/a/b/c/d/e.md")).toBe("a/b/c/d");
	});
});

describe("slugifyPath", () => {
	it("lowercases and replaces spaces with hyphens", () => {
		expect(slugifyPath("! OLD notes to import/Notion/Cacas")).toBe(
			"old-notes-to-import/notion/cacas"
		);
	});

	it("collapses multiple special characters into a single hyphen", () => {
		expect(slugifyPath("foo  --  bar/baz")).toBe("foo-bar/baz");
	});

	it("strips leading/trailing hyphens per segment", () => {
		expect(slugifyPath("! hello !/world")).toBe("hello/world");
	});

	it("preserves dots in filenames", () => {
		expect(slugifyPath("My Notes/2026-01-01.md")).toBe("my-notes/2026-01-01.md");
	});

	it("matches QMD slugification for real vault paths", () => {
		expect(
			slugifyPath(
				"! OLD notes to import/notion/Cacas/Trabajo/LDA/pap gestor documental antifraude.md"
			)
		).toBe(
			"old-notes-to-import/notion/cacas/trabajo/lda/pap-gestor-documental-antifraude.md"
		);
	});
});
