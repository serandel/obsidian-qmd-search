import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QmdIndexer, parsePendingFromStatus } from "./indexer";
import type { IndexerState } from "./types";
import { EventEmitter } from "events";

// Mock child_process
vi.mock("child_process", () => ({
	spawn: vi.fn(),
	execFile: vi.fn(),
}));

// Mock resolve-binary
vi.mock("./resolve-binary", () => ({
	resolveBinaryPath: vi.fn((p: string) => `/usr/bin/${p}`),
	buildQmdEnv: vi.fn(() => ({ PATH: "/usr/bin", HOME: "/home/test" })),
}));

import { spawn, execFile } from "child_process";

function createMockProcess(): EventEmitter & { kill: ReturnType<typeof vi.fn>; stderr: EventEmitter; stdout: EventEmitter } {
	const proc = new EventEmitter() as any;
	proc.stderr = new EventEmitter();
	proc.stdout = new EventEmitter();
	proc.kill = vi.fn();
	return proc;
}

describe("QmdIndexer", () => {
	let indexer: QmdIndexer;
	let states: IndexerState[];

	beforeEach(() => {
		vi.clearAllMocks();
		indexer = new QmdIndexer("qmd");
		states = [];
		indexer.onStateChange((s) => states.push(structuredClone(s)));
	});

	afterEach(() => {
		indexer.cancel();
	});

	describe("requestUpdate", () => {
		it("transitions idle → updating → embedding → idle on full pipeline", () => {
			const updateProc = createMockProcess();
			const embedProc = createMockProcess();
			vi.mocked(spawn)
				.mockReturnValueOnce(updateProc as any)
				.mockReturnValueOnce(embedProc as any);

			// execFile for status check — return no pending
			vi.mocked(execFile).mockImplementation((_cmd, _args, _opts, cb: any) => {
				cb(null, "Vectors: 100 embedded\n", "");
				return {} as any;
			});

			indexer.requestUpdate();
			expect(states).toEqual([{ phase: "updating" }]);

			// Complete update
			updateProc.emit("exit", 0);
			expect(states[1]).toEqual({ phase: "embedding", pending: -1 });

			// Complete embed
			embedProc.emit("exit", 0);
			// After status check, should go idle
			expect(states[states.length - 1]).toEqual({ phase: "idle" });
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
		it("coalesces requestUpdate during active pipeline", () => {
			const updateProc1 = createMockProcess();
			const embedProc = createMockProcess();
			const updateProc2 = createMockProcess();
			vi.mocked(spawn)
				.mockReturnValueOnce(updateProc1 as any)
				.mockReturnValueOnce(embedProc as any)
				.mockReturnValueOnce(updateProc2 as any);

			vi.mocked(execFile).mockImplementation((_cmd, _args, _opts, cb: any) => {
				cb(null, "Vectors: 100 embedded\n", "");
				return {} as any;
			});

			indexer.requestUpdate();
			// Request another update while first is running
			indexer.requestUpdate();

			// Complete first pipeline
			updateProc1.emit("exit", 0);
			embedProc.emit("exit", 0);

			// Should re-enter updating (coalesced request)
			const phases = states.map((s) => s.phase);
			expect(phases).toContain("updating");
			// The last non-idle state before the second update
			expect(spawn).toHaveBeenCalledTimes(3); // update1, embed, update2
		});
	});

	describe("embeddings retry", () => {
		it("retries embeddings when pending > 0", () => {
			const updateProc = createMockProcess();
			const embedProc1 = createMockProcess();
			const embedProc2 = createMockProcess();
			vi.mocked(spawn)
				.mockReturnValueOnce(updateProc as any)
				.mockReturnValueOnce(embedProc1 as any)
				.mockReturnValueOnce(embedProc2 as any);

			let callCount = 0;
			vi.mocked(execFile).mockImplementation((_cmd, _args, _opts, cb: any) => {
				callCount++;
				if (callCount === 1) {
					cb(null, "Vectors: 80 embedded\nPending:  20 unembedded\n", "");
				} else {
					cb(null, "Vectors: 100 embedded\n", "");
				}
				return {} as any;
			});

			indexer.requestUpdate();
			updateProc.emit("exit", 0);
			embedProc1.emit("exit", 0);

			// Should have spawned a second embed process
			expect(spawn).toHaveBeenCalledTimes(3);

			embedProc2.emit("exit", 0);
			expect(states[states.length - 1]).toEqual({ phase: "idle" });
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
		it("runs embeddings directly when idle", () => {
			const proc = createMockProcess();
			vi.mocked(spawn).mockReturnValueOnce(proc as any);

			vi.mocked(execFile).mockImplementation((_cmd, _args, _opts, cb: any) => {
				cb(null, "Vectors: 100 embedded\n", "");
				return {} as any;
			});

			indexer.requestEmbeddings();
			expect(states[0]).toEqual({ phase: "embedding", pending: -1 });

			proc.emit("exit", 0);
			expect(states[states.length - 1]).toEqual({ phase: "idle" });
		});

		it("does nothing when already busy", () => {
			const proc = createMockProcess();
			vi.mocked(spawn).mockReturnValueOnce(proc as any);

			indexer.requestUpdate();
			indexer.requestEmbeddings(); // should be ignored

			expect(spawn).toHaveBeenCalledTimes(1); // only update
		});
	});
});

describe("parsePendingFromStatus", () => {
	it("returns 0 when no pending indicator", () => {
		const output = `QMD Status

Index: /home/user/.cache/qmd/index.sqlite
Size:  2.4 GB

Documents
  Total:    5431 files indexed
  Vectors:  179152 embedded
  Updated:  9d ago`;

		expect(parsePendingFromStatus(output)).toBe(0);
	});

	it("parses Pending: N format", () => {
		expect(parsePendingFromStatus("Pending:  42")).toBe(42);
		expect(parsePendingFromStatus("Pending: 1000")).toBe(1000);
	});

	it("parses N unembedded format", () => {
		expect(parsePendingFromStatus("123 unembedded")).toBe(123);
	});
});
