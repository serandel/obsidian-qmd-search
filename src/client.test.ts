import { createServer, type Server } from "http";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
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

let server: Server;
let port: number;
let lastRequest: { method: string; path: string; body: string };
let serverResponse: { status: number; body: string };

beforeAll(
	() =>
		new Promise<void>((resolve) => {
			server = createServer((req, res) => {
				let body = "";
				req.on("data", (chunk) => (body += chunk));
				req.on("end", () => {
					lastRequest = {
						method: req.method ?? "",
						path: req.url ?? "",
						body,
					};
					res.writeHead(serverResponse.status, {
						"Content-Type": "application/json",
					});
					res.end(serverResponse.body);
				});
			});
			server.listen(0, "127.0.0.1", () => {
				const addr = server.address();
				port = typeof addr === "object" && addr ? addr.port : 0;
				resolve();
			});
		})
);

afterAll(
	() =>
		new Promise<void>((resolve) => {
			server.close(() => resolve());
		})
);

afterEach(() => {
	serverResponse = { status: 200, body: "[]" };
});

describe("QmdClient", () => {
	function client() {
		return new QmdClient("127.0.0.1", port);
	}

	describe("searchLex", () => {
		it("sends correct query body", async () => {
			serverResponse = { status: 200, body: JSON.stringify(mockResults) };

			await client().searchLex("hello world", "obsidian", 20);

			const body = JSON.parse(lastRequest.body);
			expect(body).toEqual({
				searches: [{ type: "lex", query: "hello world" }],
				collections: ["obsidian"],
				limit: 20,
			});
			expect(lastRequest.method).toBe("POST");
			expect(lastRequest.path).toBe("/query");
		});

		it("returns parsed results", async () => {
			serverResponse = { status: 200, body: JSON.stringify(mockResults) };

			const results = await client().searchLex("test", "obsidian", 10);

			expect(results).toEqual(mockResults);
			expect(results[0]!.title).toBe("Test Note");
		});

		it("throws on non-ok response", async () => {
			serverResponse = { status: 500, body: "{}" };

			await expect(
				client().searchLex("test", "obsidian", 10)
			).rejects.toThrow("QMD query failed: 500");
		});

		it("respects abort signal", async () => {
			serverResponse = { status: 200, body: JSON.stringify(mockResults) };
			const controller = new AbortController();
			controller.abort();

			await expect(
				client().searchLex("test", "obsidian", 10, controller.signal)
			).rejects.toThrow("aborted");
		});
	});

	describe("searchSemantic", () => {
		it("sends vec type in query", async () => {
			serverResponse = { status: 200, body: JSON.stringify(mockResults) };

			await client().searchSemantic("semantic query", "my-collection", 5);

			const body = JSON.parse(lastRequest.body);
			expect(body).toEqual({
				searches: [{ type: "vec", query: "semantic query" }],
				collections: ["my-collection"],
				limit: 5,
			});
		});

		it("returns parsed results", async () => {
			serverResponse = { status: 200, body: JSON.stringify(mockResults) };

			const results = await client().searchSemantic("test", "obsidian", 10);
			expect(results).toEqual(mockResults);
		});
	});

	describe("healthCheck", () => {
		it("returns true when server responds ok", async () => {
			serverResponse = { status: 200, body: "{}" };
			expect(await client().healthCheck()).toBe(true);
		});

		it("returns false when server responds not ok", async () => {
			serverResponse = { status: 500, body: "{}" };
			expect(await client().healthCheck()).toBe(false);
		});

		it("returns false when server unreachable", async () => {
			const unreachable = new QmdClient("127.0.0.1", 1);
			expect(await unreachable.healthCheck()).toBe(false);
		});

		it("hits /status endpoint", async () => {
			serverResponse = { status: 200, body: "{}" };
			await client().healthCheck();
			expect(lastRequest.path).toBe("/status");
		});
	});

	describe("updateBaseUrl", () => {
		it("uses updated host and port", async () => {
			serverResponse = { status: 200, body: JSON.stringify(mockResults) };
			const c = new QmdClient("127.0.0.1", 1);
			c.updateBaseUrl("127.0.0.1", port);

			const results = await c.searchLex("test", "obsidian", 10);
			expect(results).toEqual(mockResults);
		});
	});
});
