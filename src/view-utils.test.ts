import { describe, expect, it } from "vitest";
import {
	cleanSnippet,
	extractFilename,
	extractLineFromSnippet,
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

describe("extractLineFromSnippet", () => {
	it("extracts line number from standard diff header", () => {
		expect(extractLineFromSnippet("@@ -6,4 @@\nsome content")).toBe(5); // 0-indexed
	});

	it("extracts line 1 (returns 0)", () => {
		expect(extractLineFromSnippet("@@ -1,3 @@\nfirst line")).toBe(0);
	});

	it("handles large line numbers", () => {
		expect(extractLineFromSnippet("@@ -1234,10 @@\ncontent")).toBe(1233);
	});

	it("returns null when no @@ header present", () => {
		expect(extractLineFromSnippet("just some text")).toBeNull();
	});

	it("returns null for empty string", () => {
		expect(extractLineFromSnippet("")).toBeNull();
	});

	it("only matches @@ at the start of string", () => {
		expect(extractLineFromSnippet("text @@ -6,4 @@")).toBeNull();
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
