import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QmdIndexer } from "./indexer";
import type { QmdMcpClient } from "./mcp-client";
import type { IndexerState } from "./types";
import { EventEmitter } from "events";

// Mock child_process
vi.mock("child_process", () => ({
	spawn: vi.fn(),
}));

// Mock resolve-binary
vi.mock("./resolve-binary", () => ({
	resolveBinaryPath: vi.fn((p: string) => `/usr/bin/${p}`),
	buildQmdEnv: vi.fn(() => ({ PATH: "/usr/bin", HOME: "/home/test" })),
}));

import { spawn } from "child_process";

function createMockProcess(): EventEmitter & { kill: ReturnType<typeof vi.fn>; stderr: EventEmitter; stdout: EventEmitter } {
	const proc = new EventEmitter() as any;
	proc.stderr = new EventEmitter();
	proc.stdout = new EventEmitter();
	proc.kill = vi.fn();
	return proc;
}

function createMockMcpClient(pendingCounts: number[] = [0]): QmdMcpClient {
	let callIndex = 0;
	return {
		checkPending: vi.fn(async () => {
			const val = pendingCounts[callIndex] ?? 0;
			callIndex++;
			return val;
		}),
	} as unknown as QmdMcpClient;
}

describe("QmdIndexer", () => {
	let indexer: QmdIndexer;
	let states: IndexerState[];
	let mcpClient: QmdMcpClient;

	beforeEach(() => {
		vi.clearAllMocks();
		mcpClient = createMockMcpClient();
		indexer = new QmdIndexer("qmd", 10, mcpClient);
		states = [];
		indexer.onStateChange((s) => states.push(structuredClone(s)));
	});

	afterEach(() => {
		indexer.cancel();
	});

	describe("requestUpdate", () => {
		it("transitions idle → updating → embedding → idle on full pipeline", async () => {
			const updateProc = createMockProcess();
			const embedProc = createMockProcess();
			vi.mocked(spawn)
				.mockReturnValueOnce(updateProc as any)
				.mockReturnValueOnce(embedProc as any);

			indexer.requestUpdate();
			expect(states).toEqual([{ phase: "updating" }]);

			// Complete update
			updateProc.emit("exit", 0);
			expect(states[1]).toEqual({ phase: "embedding", pending: -1 });

			// Complete embed
			embedProc.emit("exit", 0);
			// Wait for async checkPending
			await vi.waitFor(() => {
				expect(states[states.length - 1]).toEqual({ phase: "idle" });
			});
		});

		it("transitions to error on update failure", () => {
			const proc = createMockProcess();
			vi.mocked(spawn).mockReturnValueOnce(proc as any);

			indexer.requestUpdate();
			proc.stderr.emit("data", Buffer.from("index corrupt"));
			proc.emit("exit", 1);

			expect(states[states.length - 1]).toEqual({
				phase: "error",
				message: "index corrupt",
			});
		});

		it("transitions to error on spawn error", () => {
			const proc = createMockProcess();
			vi.mocked(spawn).mockReturnValueOnce(proc as any);

			indexer.requestUpdate();
			proc.emit("error", new Error("ENOENT"));

			expect(states[states.length - 1]).toEqual({
				phase: "error",
				message: "Update failed: ENOENT",
			});
		});
	});

	describe("coalescing", () => {
		it("coalesces requestUpdate during active pipeline", async () => {
			const updateProc1 = createMockProcess();
			const embedProc = createMockProcess();
			const updateProc2 = createMockProcess();
			vi.mocked(spawn)
				.mockReturnValueOnce(updateProc1 as any)
				.mockReturnValueOnce(embedProc as any)
				.mockReturnValueOnce(updateProc2 as any);

			indexer.requestUpdate();
			// Request another update while first is running
			indexer.requestUpdate();

			// Complete first pipeline
			updateProc1.emit("exit", 0);
			embedProc.emit("exit", 0);

			// Wait for async checkPending to trigger coalesced update
			await vi.waitFor(() => {
				expect(spawn).toHaveBeenCalledTimes(3); // update1, embed, update2
			});
		});
	});

	describe("embeddings retry", () => {
		it("retries embeddings when pending > 0", async () => {
			mcpClient = createMockMcpClient([20, 0]);
			indexer.setMcpClient(mcpClient);

			const updateProc = createMockProcess();
			const embedProc1 = createMockProcess();
			const embedProc2 = createMockProcess();
			vi.mocked(spawn)
				.mockReturnValueOnce(updateProc as any)
				.mockReturnValueOnce(embedProc1 as any)
				.mockReturnValueOnce(embedProc2 as any);

			indexer.requestUpdate();
			updateProc.emit("exit", 0);
			embedProc1.emit("exit", 0);

			// Wait for async retry
			await vi.waitFor(() => {
				expect(spawn).toHaveBeenCalledTimes(3);
			});

			embedProc2.emit("exit", 0);
			await vi.waitFor(() => {
				expect(states[states.length - 1]).toEqual({ phase: "idle" });
			});
		});
	});

	describe("cancel", () => {
		it("kills running process and resets to idle", () => {
			const proc = createMockProcess();
			vi.mocked(spawn).mockReturnValueOnce(proc as any);

			indexer.requestUpdate();
			indexer.cancel();

			expect(proc.kill).toHaveBeenCalled();
			expect(indexer.getState()).toEqual({ phase: "idle" });
		});

		it("prevents further state transitions after cancel", () => {
			const proc = createMockProcess();
			vi.mocked(spawn).mockReturnValueOnce(proc as any);

			indexer.requestUpdate();
			indexer.cancel();

			// Simulate delayed exit after cancel
			proc.emit("exit", 0);

			// Should still be idle, not embedding
			expect(indexer.getState()).toEqual({ phase: "idle" });
		});
	});

	describe("requestEmbeddings", () => {
		it("runs embeddings directly when idle", async () => {
			const proc = createMockProcess();
			vi.mocked(spawn).mockReturnValueOnce(proc as any);

			indexer.requestEmbeddings();
			expect(states[0]).toEqual({ phase: "embedding", pending: -1 });

			proc.emit("exit", 0);
			await vi.waitFor(() => {
				expect(states[states.length - 1]).toEqual({ phase: "idle" });
			});
		});

		it("does nothing when already busy", () => {
			const proc = createMockProcess();
			vi.mocked(spawn).mockReturnValueOnce(proc as any);

			indexer.requestUpdate();
			indexer.requestEmbeddings(); // should be ignored

			expect(spawn).toHaveBeenCalledTimes(1); // only update
		});
	});

	describe("setMcpClient", () => {
		it("uses updated MCP client for pending checks", async () => {
			const newClient = createMockMcpClient([5, 0]);
			indexer.setMcpClient(newClient);

			const updateProc = createMockProcess();
			const embedProc1 = createMockProcess();
			const embedProc2 = createMockProcess();
			vi.mocked(spawn)
				.mockReturnValueOnce(updateProc as any)
				.mockReturnValueOnce(embedProc1 as any)
				.mockReturnValueOnce(embedProc2 as any);

			indexer.requestUpdate();
			updateProc.emit("exit", 0);
			embedProc1.emit("exit", 0);

			await vi.waitFor(() => {
				expect(newClient.checkPending).toHaveBeenCalled();
			});
		});
	});
});
