import { describe, expect, it } from "vitest";
import { delimiter } from "path";
import { resolveBinaryPath, getBinDir, buildQmdEnv } from "./resolve-binary";

describe("resolveBinaryPath", () => {
	it("returns absolute Unix paths unchanged", () => {
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

	it("returns root for root-level binary", () => {
		expect(getBinDir("/qmd")).toBe("/");
	});
});

describe("buildQmdEnv", () => {
	it("prepends binary directory to PATH using platform delimiter", () => {
		const env = buildQmdEnv("/usr/local/bin/qmd");
		expect(env.PATH).toMatch(new RegExp(`^/usr/local/bin\\${delimiter}`));
	});

	it("strips XDG overrides on non-Windows platforms", () => {
		const origCache = process.env.XDG_CACHE_HOME;
		const origConfig = process.env.XDG_CONFIG_HOME;
		process.env.XDG_CACHE_HOME = "/tmp/cache";
		process.env.XDG_CONFIG_HOME = "/tmp/config";
		try {
			const env = buildQmdEnv("/usr/local/bin/qmd");
			if (process.platform !== "win32") {
				expect(env.XDG_CACHE_HOME).toBeUndefined();
				expect(env.XDG_CONFIG_HOME).toBeUndefined();
			}
		} finally {
			if (origCache === undefined) delete process.env.XDG_CACHE_HOME;
			else process.env.XDG_CACHE_HOME = origCache;
			if (origConfig === undefined) delete process.env.XDG_CONFIG_HOME;
			else process.env.XDG_CONFIG_HOME = origConfig;
		}
	});
});
