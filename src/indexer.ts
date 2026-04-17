import { type ChildProcess, spawn, execFile } from "child_process";
import { buildQmdEnv, resolveBinaryPath } from "./resolve-binary";
import type { IndexerState } from "./types";

export class QmdIndexer {
	private state: IndexerState = { phase: "idle" };
	private process: ChildProcess | null = null;
	private updateRequested = false;
	private cancelled = false;
	private stateCallback: ((state: IndexerState) => void) | null = null;

	private resolvedPath: string;
	private env: Record<string, string>;

	constructor(qmdBinaryPath: string) {
		this.resolvedPath = resolveBinaryPath(qmdBinaryPath);
		this.env = buildQmdEnv(this.resolvedPath);
	}

	onStateChange(callback: (state: IndexerState) => void): void {
		this.stateCallback = callback;
	}

	getState(): IndexerState {
		return this.state;
	}

	requestUpdate(): void {
		if (this.state.phase === "idle" || this.state.phase === "error") {
			this.runUpdate();
		} else {
			// Coalesce: mark that another update is needed after current pipeline
			this.updateRequested = true;
		}
	}

	requestEmbeddings(): void {
		if (this.state.phase === "idle" || this.state.phase === "error") {
			this.runEmbeddings();
		}
	}

	cancel(): void {
		this.cancelled = true;
		this.updateRequested = false;
		if (this.process) {
			this.process.kill();
			this.process = null;
		}
		this.setState({ phase: "idle" });
	}

	private setState(state: IndexerState): void {
		this.state = state;
		this.stateCallback?.(state);
	}

	private runUpdate(): void {
		this.cancelled = false;
		console.log("[QMD] Starting index update");
		this.setState({ phase: "updating" });

		const proc = spawn(this.resolvedPath, ["update"], {
			stdio: ["ignore", "pipe", "pipe"],
			env: this.env,
		});
		this.process = proc;

		let stderr = "";
		proc.stderr?.on("data", (chunk: Buffer) => {
			stderr += chunk.toString();
		});

		proc.on("error", (err) => {
			this.process = null;
			if (!this.cancelled) {
				this.setState({ phase: "error", message: `Update failed: ${err.message}` });
			}
		});

		proc.on("exit", (code) => {
			this.process = null;
			if (this.cancelled) return;

			if (code !== 0) {
				const msg = stderr.trim() || `Update exited with code ${code}`;
				console.error("[QMD] Update failed:", msg);
				this.setState({ phase: "error", message: msg });
				return;
			}

			console.log("[QMD] Update complete, starting embeddings");
			this.runEmbeddings();
		});
	}

	private runEmbeddings(): void {
		if (this.cancelled) return;
		console.log("[QMD] Starting embeddings");
		this.setState({ phase: "embedding", pending: -1 }); // -1 = unknown

		const proc = spawn(this.resolvedPath, ["embed"], {
			stdio: ["ignore", "pipe", "pipe"],
			env: this.env,
		});
		this.process = proc;

		let stderr = "";
		proc.stderr?.on("data", (chunk: Buffer) => {
			stderr += chunk.toString();
		});

		proc.on("error", (err) => {
			this.process = null;
			if (!this.cancelled) {
				this.setState({ phase: "error", message: `Embed failed: ${err.message}` });
			}
		});

		proc.on("exit", (code) => {
			this.process = null;
			if (this.cancelled) return;

			if (code !== 0 && code !== null) {
				const msg = stderr.trim() || `Embed exited with code ${code}`;
				this.setState({ phase: "error", message: msg });
				return;
			}

			// Check if there are pending embeddings
			this.checkPendingAndRetry();
		});
	}

	private checkPendingAndRetry(): void {
		if (this.cancelled) return;

		this.checkPending((pending) => {
			if (this.cancelled) return;

			if (pending > 0) {
				console.log(`[QMD] ${pending} embeddings pending, retrying`);
				this.setState({ phase: "embedding", pending });
				this.runEmbeddings();
			} else {
				console.log("[QMD] Indexer pipeline complete");
				this.onPipelineComplete();
			}
		});
	}

	private checkPending(callback: (pending: number) => void): void {
		execFile(this.resolvedPath, ["status"], { env: this.env, timeout: 10000 }, (err, stdout) => {
			if (err) {
				callback(0); // Can't determine — assume done
				return;
			}
			const pending = parsePendingFromStatus(stdout);
			callback(pending);
		});
	}

	private onPipelineComplete(): void {
		if (this.updateRequested) {
			this.updateRequested = false;
			this.runUpdate();
		} else {
			this.setState({ phase: "idle" });
		}
	}
}

/**
 * Parse the number of pending (unembedded) documents from `qmd status` output.
 * Looks for a line like "Pending:  42 unembedded" or similar.
 * Returns 0 if no pending indicator is found (all embeddings complete).
 */
export function parsePendingFromStatus(output: string): number {
	// Look for "Pending:" or "unembedded" patterns
	const pendingMatch = output.match(/Pending:\s*(\d+)/i);
	if (pendingMatch) return parseInt(pendingMatch[1]!, 10);

	const unembeddedMatch = output.match(/(\d+)\s*unembedded/i);
	if (unembeddedMatch) return parseInt(unembeddedMatch[1]!, 10);

	return 0;
}
