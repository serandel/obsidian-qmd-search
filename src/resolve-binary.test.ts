import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { resolveBinaryPath, getBinDir } from "./resolve-binary";

describe("resolveBinaryPath", () => {
	it("returns absolute paths unchanged", () => {
		expect(resolveBinaryPath("/usr/bin/qmd")).toBe("/usr/bin/qmd");
	});

	it("returns absolute paths unchanged even if file does not exist", () => {
		expect(resolveBinaryPath("/nonexistent/path/qmd")).toBe(
			"/nonexistent/path/qmd"
		);
	});

	it("resolves a bare binary name via shell or known paths", () => {
		// This test depends on the real system having at least one of the
		// resolution strategies work for common binaries like "ls"
		const resolved = resolveBinaryPath("ls");
		expect(resolved).toMatch(/^\/.*ls$/);
	});

	it("returns the binary name as-is when it cannot be resolved", () => {
		const result = resolveBinaryPath("nonexistent-binary-xyz-123");
		expect(result).toBe("nonexistent-binary-xyz-123");
	});
});

describe("getBinDir", () => {
	it("extracts directory from absolute path", () => {
		expect(getBinDir("/home/linuxbrew/.linuxbrew/bin/qmd")).toBe(
			"/home/linuxbrew/.linuxbrew/bin"
		);
	});

	it("extracts directory from nested path", () => {
		expect(getBinDir("/usr/local/bin/node")).toBe("/usr/local/bin");
	});

	it("returns empty string for root-level binary", () => {
		expect(getBinDir("/qmd")).toBe("");
	});
});
