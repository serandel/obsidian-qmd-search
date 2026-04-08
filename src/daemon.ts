import { type ChildProcess, spawn } from "child_process";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import { type QmdClient } from "./client";

export class QmdDaemonManager {
	private process: ChildProcess | null = null;
	private port: number = 0;
	private pidFilePath: string;
	private qmdBinaryPath: string;
	private exitCallback: (() => void) | null = null;

	constructor(pluginDir: string, qmdBinaryPath: string) {
		this.pidFilePath = join(pluginDir, "qmd.pid");
		this.qmdBinaryPath = qmdBinaryPath;
	}

	async start(): Promise<number> {
		this.cleanupOrphan();

		return new Promise((resolve, reject) => {
			const proc = spawn(this.qmdBinaryPath, ["mcp", "--http", "--daemon"], {
				stdio: ["ignore", "pipe", "pipe"],
			});

			this.process = proc;

			let stdout = "";

			proc.stdout?.on("data", (data: Buffer) => {
				stdout += data.toString();
				const portMatch = stdout.match(/port[:\s]+(\d+)/i);
				if (portMatch) {
					this.port = parseInt(portMatch[1]!, 10);
					this.writePidFile(proc.pid!);
					resolve(this.port);
				}
			});

			proc.stderr?.on("data", (data: Buffer) => {
				console.error("[QMD daemon]", data.toString());
			});

			proc.on("error", (err) => {
				reject(new Error(`Failed to start QMD daemon: ${err.message}`));
			});

			proc.on("exit", (code) => {
				if (this.port === 0) {
					reject(new Error(`QMD daemon exited before reporting port (code: ${code})`));
				}
				this.process = null;
				this.removePidFile();
				this.exitCallback?.();
			});

			setTimeout(() => {
				if (this.port === 0) {
					proc.kill();
					reject(new Error("QMD daemon did not report port within 10 seconds"));
				}
			}, 10000);
		});
	}

	async warmup(client: QmdClient, collection: string): Promise<void> {
		try {
			await client.searchHybrid("warmup", collection, 1);
		} catch {
			console.warn("[QMD] Warmup query failed — models may load on first real query");
		}
	}

	stop(): void {
		if (this.process) {
			this.process.kill("SIGTERM");
			this.process = null;
		}
		this.removePidFile();
	}

	getPort(): number {
		return this.port;
	}

	isRunning(): boolean {
		return this.process !== null && this.process.exitCode === null;
	}

	onExit(callback: () => void): void {
		this.exitCallback = callback;
	}

	private cleanupOrphan(): void {
		if (!existsSync(this.pidFilePath)) return;

		try {
			const pid = parseInt(readFileSync(this.pidFilePath, "utf-8").trim(), 10);
			if (isNaN(pid)) {
				this.removePidFile();
				return;
			}

			let cmdline = "";
			try {
				cmdline = readFileSync(`/proc/${pid}/cmdline`, "utf-8");
			} catch {
				this.removePidFile();
				return;
			}

			if (cmdline.includes("qmd")) {
				process.kill(pid, "SIGTERM");
				console.log(`[QMD] Killed orphaned daemon (PID ${pid})`);
			}
		} catch {
			// Process doesn't exist or can't be killed
		}
		this.removePidFile();
	}

	private writePidFile(pid: number): void {
		try {
			writeFileSync(this.pidFilePath, String(pid), "utf-8");
		} catch {
			console.warn("[QMD] Could not write PID file");
		}
	}

	private removePidFile(): void {
		try {
			if (existsSync(this.pidFilePath)) {
				unlinkSync(this.pidFilePath);
			}
		} catch {
			// Ignore
		}
	}
}
