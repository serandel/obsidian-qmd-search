import { type ChildProcess, execFileSync, spawn } from "child_process";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import { type QmdClient } from "./client";

/**
 * Resolve a binary name to its absolute path.
 * Electron (especially Flatpak) strips the shell PATH, so bare command
 * names like "qmd" won't be found by spawn(). We try multiple strategies:
 * 1. Try common login shells (zsh, bash, sh) with -l -c which
 * 2. Check well-known binary locations
 */
function resolveBinaryPath(binary: string): string {
	if (binary.startsWith("/")) return binary;

	// Try each shell as a login shell to resolve the binary
	const shells = ["/bin/zsh", "/bin/bash", "/bin/sh"];
	for (const shell of shells) {
		if (!existsSync(shell)) continue;
		try {
			const resolved = execFileSync(shell, ["-l", "-c", `which ${binary}`], {
				encoding: "utf-8",
				timeout: 5000,
			}).trim();
			if (resolved && existsSync(resolved)) {
				console.log(`[QMD] Resolved '${binary}' → '${resolved}' (via ${shell})`);
				return resolved;
			}
		} catch {
			// Try next shell
		}
	}

	// Check well-known locations
	const knownPaths = [
		`/home/linuxbrew/.linuxbrew/bin/${binary}`,
		`/usr/local/bin/${binary}`,
		`/opt/homebrew/bin/${binary}`,
		`${process.env.HOME}/.local/bin/${binary}`,
	];
	for (const p of knownPaths) {
		if (existsSync(p)) {
			console.log(`[QMD] Found '${binary}' at '${p}'`);
			return p;
		}
	}

	console.warn(`[QMD] Could not resolve '${binary}', using as-is`);
	return binary;
}

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
			const resolvedPath = resolveBinaryPath(this.qmdBinaryPath);

			// Prepend the binary's directory to PATH so shell wrappers
			// (e.g. qmd calling node) can find sibling binaries.
			const binDir = resolvedPath.substring(0, resolvedPath.lastIndexOf("/"));
			const env = {
				...process.env,
				PATH: binDir + ":" + (process.env.PATH || ""),
			};

			const proc = spawn(resolvedPath, ["mcp", "--http"], {
				stdio: ["ignore", "pipe", "pipe"],
				env,
			});

			this.process = proc;

			let output = "";

			const parsePort = (data: Buffer) => {
				output += data.toString();
				const portMatch = output.match(/localhost:(\d+)/);
				if (portMatch && this.port === 0) {
					this.port = parseInt(portMatch[1]!, 10);
					this.writePidFile(proc.pid!);
					resolve(this.port);
				}
			};

			proc.stdout?.on("data", parsePort);
			proc.stderr?.on("data", (data: Buffer) => {
				parsePort(data);
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
