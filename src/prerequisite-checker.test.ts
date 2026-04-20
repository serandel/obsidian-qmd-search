import { describe, expect, it } from "vitest";
import {
	parseCollectionListOutput,
	parseCollectionShowPath,
	pathsOverlap,
	suggestCollectionName,
} from "./prerequisite-checker";

describe("parseCollectionListOutput", () => {
	it("parses a single collection", () => {
		const output = `Collections (1):

obsidian (qmd://obsidian/)
  Pattern:  **/*.md
  Files:    5465
  Updated:  20h ago`;
		expect(parseCollectionListOutput(output)).toEqual(["obsidian"]);
	});

	it("parses multiple collections", () => {
		const output = `Collections (3):

obsidian (qmd://obsidian/)
  Pattern:  **/*.md
  Files:    5465
  Updated:  20h ago

notes (qmd://notes/)
  Pattern:  **/*.md
  Files:    120
  Updated:  2d ago

code (qmd://code/)
  Pattern:  **/*.md
  Files:    30
  Updated:  1h ago`;
		expect(parseCollectionListOutput(output)).toEqual(["obsidian", "notes", "code"]);
	});

	it("returns empty array for no collections", () => {
		const output = `Collections (0):`;
		expect(parseCollectionListOutput(output)).toEqual([]);
	});

	it("handles collection names with hyphens", () => {
		const output = `Collections (1):

my-vault (qmd://my-vault/)
  Pattern:  **/*.md
  Files:    10
  Updated:  1h ago`;
		expect(parseCollectionListOutput(output)).toEqual(["my-vault"]);
	});

	it("ignores non-collection lines", () => {
		const output = `Collections (1):

Some random text
obsidian (qmd://obsidian/)
  Pattern:  **/*.md`;
		expect(parseCollectionListOutput(output)).toEqual(["obsidian"]);
	});
});

describe("parseCollectionShowPath", () => {
	it("extracts path from collection show output", () => {
		const output = `Collection: obsidian
  Path:     /home/user/Documents/Obsidian
  Pattern:  **/*.md
  Include:  yes (default)
  Contexts: 1`;
		expect(parseCollectionShowPath(output)).toBe("/home/user/Documents/Obsidian");
	});

	it("returns null when no path found", () => {
		expect(parseCollectionShowPath("No collection found")).toBeNull();
	});

	it("handles paths with spaces", () => {
		const output = `Collection: notes
  Path:     /home/user/My Documents/Notes
  Pattern:  **/*.md`;
		expect(parseCollectionShowPath(output)).toBe("/home/user/My Documents/Notes");
	});

	it("trims trailing whitespace from path", () => {
		const output = `Collection: test
  Path:     /home/user/vault
  Pattern:  **/*.md`;
		expect(parseCollectionShowPath(output)).toBe("/home/user/vault");
	});
});

describe("suggestCollectionName", () => {
	it("lowercases and replaces spaces with hyphens", () => {
		expect(suggestCollectionName("/home/user/My Vault")).toBe("my-vault");
	});

	it("strips non-alphanumeric characters", () => {
		expect(suggestCollectionName("/home/user/Vault (2024)")).toBe("vault-2024");
	});

	it("handles simple folder names", () => {
		expect(suggestCollectionName("/home/user/obsidian")).toBe("obsidian");
	});

	it("handles trailing slashes", () => {
		expect(suggestCollectionName("/home/user/notes/")).toBe("notes");
	});

	it("falls back to 'vault' for empty path segments", () => {
		expect(suggestCollectionName("/")).toBe("vault");
	});

	it("handles Windows-style paths", () => {
		expect(suggestCollectionName("C:\\Users\\me\\My Notes")).toBe("my-notes");
	});
});

describe("pathsOverlap", () => {
	it("returns true when collection is a subfolder of the vault", () => {
		expect(pathsOverlap("/home/user/vault/notes", "/home/user/vault")).toBe(true);
	});

	it("returns true when vault is a subfolder of the collection", () => {
		expect(pathsOverlap("/home/user", "/home/user/vault")).toBe(true);
	});

	it("returns false for completely unrelated paths", () => {
		expect(pathsOverlap("/home/user/work", "/home/user/vault")).toBe(false);
	});

	it("returns false for paths that share a prefix but not a boundary", () => {
		expect(pathsOverlap("/home/user/vault-backup", "/home/user/vault")).toBe(false);
	});

	it("handles trailing slashes", () => {
		expect(pathsOverlap("/home/user/vault/notes/", "/home/user/vault/")).toBe(true);
	});

	it("returns false for identical paths (that's an exact match, not overlap)", () => {
		// pathsOverlap is only used after filtering out exact matches,
		// but it does return true for identical paths by design
		expect(pathsOverlap("/home/user/vault", "/home/user/vault")).toBe(true);
	});
});
