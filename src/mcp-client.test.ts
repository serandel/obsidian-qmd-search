import { beforeEach, describe, expect, it, vi } from "vitest";
import { QmdMcpClient } from "./mcp-client";
import type { QmdSearchResult } from "./types";

// Mock resolve-binary
vi.mock("./resolve-binary", () => ({
	resolveBinaryPath: vi.fn((p: string) => `/usr/bin/${p}`),
	buildQmdEnv: vi.fn(() => ({ PATH: "/usr/bin", HOME: "/home/test" })),
}));

// Mock MCP SDK
const mockCallTool = vi.fn();
const mockConnect = vi.fn();
const mockClose = vi.fn();

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => {
	return {
		Client: class MockClient {
			connect = mockConnect;
			callTool = mockCallTool;
			close = mockClose;
		},
	};
});

let mockTransportOnClose: (() => void) | null = null;
const mockTransportPid = 12345;

vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => {
	return {
		StdioClientTransport: class MockTransport {
			pid = mockTransportPid;
			set onclose(cb: (() => void) | undefined) { mockTransportOnClose = cb ?? null; }
			get onclose(): (() => void) | undefined { return mockTransportOnClose ?? undefined; }
		},
	};
});

// Mock os.setPriority
vi.mock("os", () => ({
	setPriority: vi.fn(),
}));

import { setPriority } from "os";

const mockResults: QmdSearchResult[] = [
	{
		docid: "#abc123",
		score: 0.95,
		file: "obsidian/notes/test.md",
		title: "Test Note",
		context: "test context",
		snippet: "@@ -1,3 @@\nsome content",
	},
];

describe("QmdMcpClient", () => {
	let client: QmdMcpClient;

	beforeEach(() => {
		vi.clearAllMocks();
		mockTransportOnClose = null;
		client = new QmdMcpClient("qmd", 10);
	});

	describe("connect", () => {
		it("creates transport and connects client", async () => {
			await client.connect();

			expect(mockConnect).toHaveBeenCalledOnce();
			expect(client.isConnected()).toBe(true);
		});

		it("applies nice level after connection", async () => {
			await client.connect();

			expect(setPriority).toHaveBeenCalledWith(mockTransportPid, 10);
		});

		it("skips nice level when set to 0", async () => {
			client = new QmdMcpClient("qmd", 0);
			await client.connect();

			expect(setPriority).not.toHaveBeenCalled();
		});

		it("fires close callback when transport closes", async () => {
			const closeCb = vi.fn();
			client.onClose(closeCb);
			await client.connect();

			mockTransportOnClose?.();
			expect(closeCb).toHaveBeenCalledOnce();
			expect(client.isConnected()).toBe(false);
		});
	});

	describe("searchLex", () => {
		it("calls query tool with lex search", async () => {
			mockCallTool.mockResolvedValueOnce({
				isError: false,
				structuredContent: { results: mockResults },
			});

			await client.connect();
			const results = await client.searchLex("test query", "obsidian", 20);

			expect(mockCallTool).toHaveBeenCalledWith({
				name: "query",
				arguments: {
					searches: [{ type: "lex", query: "test query" }],
					collections: ["obsidian"],
					limit: 20,
				},
			});
			expect(results).toEqual(mockResults);
		});
	});

	describe("searchHybrid", () => {
		it("calls query tool with lex and vec searches", async () => {
			mockCallTool.mockResolvedValueOnce({
				isError: false,
				structuredContent: { results: mockResults },
			});

			await client.connect();
			const results = await client.searchHybrid("test query", "my-collection", 5);

			expect(mockCallTool).toHaveBeenCalledWith({
				name: "query",
				arguments: {
					searches: [
						{ type: "lex", query: "test query" },
						{ type: "vec", query: "test query" },
					],
					collections: ["my-collection"],
					limit: 5,
				},
			});
			expect(results).toEqual(mockResults);
		});
	});

	describe("callQuery error handling", () => {
		it("throws when not connected", async () => {
			await expect(
				client.searchLex("test", "obsidian", 10)
			).rejects.toThrow("QMD is not connected");
		});

		it("throws on tool error", async () => {
			mockCallTool.mockResolvedValueOnce({
				isError: true,
				content: [{ type: "text", text: "query failed" }],
			});

			await client.connect();
			await expect(
				client.searchLex("test", "obsidian", 10)
			).rejects.toThrow("QMD query failed");
		});

		it("returns empty array when no structuredContent", async () => {
			mockCallTool.mockResolvedValueOnce({
				isError: false,
				content: [{ type: "text", text: "no results" }],
			});

			await client.connect();
			const results = await client.searchLex("test", "obsidian", 10);
			expect(results).toEqual([]);
		});
	});

	describe("checkPending", () => {
		it("returns needsEmbedding from status tool", async () => {
			mockCallTool.mockResolvedValueOnce({
				isError: false,
				structuredContent: { needsEmbedding: 42 },
			});

			await client.connect();
			const pending = await client.checkPending();

			expect(mockCallTool).toHaveBeenCalledWith({
				name: "status",
				arguments: {},
			});
			expect(pending).toBe(42);
		});

		it("returns 0 when not connected", async () => {
			const pending = await client.checkPending();
			expect(pending).toBe(0);
		});

		it("returns 0 on error", async () => {
			mockCallTool.mockRejectedValueOnce(new Error("connection lost"));

			await client.connect();
			const pending = await client.checkPending();
			expect(pending).toBe(0);
		});
	});

	describe("close", () => {
		it("closes client and clears state", async () => {
			await client.connect();
			await client.close();

			expect(mockClose).toHaveBeenCalledOnce();
			expect(client.isConnected()).toBe(false);
		});

		it("handles close when already disconnected", async () => {
			await client.close(); // Should not throw
			expect(client.isConnected()).toBe(false);
		});
	});

	describe("applyNiceLevel", () => {
		it("updates nice level on running process", async () => {
			await client.connect();
			vi.mocked(setPriority).mockClear();

			client.applyNiceLevel(15);
			expect(setPriority).toHaveBeenCalledWith(mockTransportPid, 15);
		});
	});
});
