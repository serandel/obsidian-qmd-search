import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QmdClient } from "./client";
import type { QmdSearchResult } from "./types";

const mockResults: QmdSearchResult[] = [
	{
		docid: "doc1",
		score: 0.95,
		file: "qmd://obsidian/notes/test.md",
		title: "Test Note",
		context: "test context",
		snippet: "@@ -1,3 @@\nsome content",
	},
];

function mockFetchOk(body: unknown) {
	return vi.fn().mockResolvedValue({
		ok: true,
		json: () => Promise.resolve(body),
	});
}

function mockFetchError(status: number, statusText: string) {
	return vi.fn().mockResolvedValue({
		ok: false,
		status,
		statusText,
		json: () => Promise.resolve({}),
	});
}

describe("QmdClient", () => {
	let client: QmdClient;

	beforeEach(() => {
		client = new QmdClient("localhost", 8080);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("constructor and updateBaseUrl", () => {
		it("constructs with host and port", () => {
			// Verify by making a request and checking the URL
			const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(mockFetchOk(mockResults));
			client.searchLex("test", "obsidian", 10);
			expect(fetchSpy).toHaveBeenCalledWith(
				"http://localhost:8080/query",
				expect.any(Object)
			);
		});

		it("updates base URL", () => {
			client.updateBaseUrl("example.com", 9090);
			const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(mockFetchOk(mockResults));
			client.searchLex("test", "obsidian", 10);
			expect(fetchSpy).toHaveBeenCalledWith(
				"http://example.com:9090/query",
				expect.any(Object)
			);
		});
	});

	describe("searchLex", () => {
		it("sends correct query body", async () => {
			const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(mockFetchOk(mockResults));

			await client.searchLex("hello world", "obsidian", 20);

			const call = fetchSpy.mock.calls[0]!;
			const body = JSON.parse(call[1]!.body as string);
			expect(body).toEqual({
				searches: [{ type: "lex", query: "hello world" }],
				collections: ["obsidian"],
				limit: 20,
			});
		});

		it("returns parsed results", async () => {
			vi.spyOn(globalThis, "fetch").mockImplementation(mockFetchOk(mockResults));

			const results = await client.searchLex("test", "obsidian", 10);

			expect(results).toEqual(mockResults);
			expect(results[0]!.title).toBe("Test Note");
		});

		it("throws on non-ok response", async () => {
			vi.spyOn(globalThis, "fetch").mockImplementation(mockFetchError(500, "Internal Server Error"));

			await expect(client.searchLex("test", "obsidian", 10)).rejects.toThrow(
				"QMD query failed: 500 Internal Server Error"
			);
		});

		it("respects abort signal", async () => {
			const controller = new AbortController();
			controller.abort();

			vi.spyOn(globalThis, "fetch").mockImplementation(() => {
				throw new DOMException("The operation was aborted", "AbortError");
			});

			await expect(
				client.searchLex("test", "obsidian", 10, controller.signal)
			).rejects.toThrow("The operation was aborted");
		});
	});

	describe("searchHybrid", () => {
		it("sends expand type in query", async () => {
			const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(mockFetchOk(mockResults));

			await client.searchHybrid("semantic query", "my-collection", 5);

			const call = fetchSpy.mock.calls[0]!;
			const body = JSON.parse(call[1]!.body as string);
			expect(body).toEqual({
				searches: [{ type: "expand", query: "semantic query" }],
				collections: ["my-collection"],
				limit: 5,
			});
		});

		it("returns parsed results", async () => {
			vi.spyOn(globalThis, "fetch").mockImplementation(mockFetchOk(mockResults));

			const results = await client.searchHybrid("test", "obsidian", 10);
			expect(results).toEqual(mockResults);
		});
	});

	describe("healthCheck", () => {
		it("returns true when server responds ok", async () => {
			vi.spyOn(globalThis, "fetch").mockResolvedValue({
				ok: true,
			} as Response);

			expect(await client.healthCheck()).toBe(true);
		});

		it("returns false when server responds not ok", async () => {
			vi.spyOn(globalThis, "fetch").mockResolvedValue({
				ok: false,
			} as Response);

			expect(await client.healthCheck()).toBe(false);
		});

		it("returns false when fetch throws", async () => {
			vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("connection refused"));

			expect(await client.healthCheck()).toBe(false);
		});

		it("calls /status endpoint", async () => {
			const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
				ok: true,
			} as Response);

			await client.healthCheck();

			expect(fetchSpy).toHaveBeenCalledWith(
				"http://localhost:8080/status",
				expect.objectContaining({ signal: expect.any(AbortSignal) })
			);
		});
	});
});
