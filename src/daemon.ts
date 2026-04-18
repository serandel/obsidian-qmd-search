import { type ChildProcess, execFileSync, spawn } from "child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import { setPriority } from "os";
import { request as httpRequest } from "http";
import { type QmdClient } from "./client";
import { buildQmdEnv, resolveBinaryPath } from "./resolve-binary";

export class QmdDaemonManager {
	private process: ChildProcess | null = null;
	private watchdog: ChildProcess | null = null;
	private port: number = 0;
	private adopted = false;
	private pidFilePath: string;
	private qmdBinaryPath: string;
	private niceLevel: number;
	private exitCallback: (() => void) | null = null;

	constructor(pluginDir: string, qmdBinaryPath: string, niceLevel: number) {
		this.pidFilePath = join(pluginDir, "qmd.pid");
		this.qmdBinaryPath = qmdBinaryPath;
		this.niceLevel = niceLevel;
	}

	async start(): Promise<number> {
		try {
			return await this.spawnDaemon();
		} catch (err) {
			// If port is already in use, try to adopt the existing daemon
			const portMatch = (err as Error).message?.match(/Port (\d+) already in use/);
			if (portMatch) {
				const existingPort = parseInt(portMatch[1]!, 10);
				const alive = await this.healthCheck(existingPort);
				if (alive) {
					console.log(`[QMD] Adopted existing daemon on port ${existingPort}`);
					this.port = existingPort;
					this.adopted = true;
					return existingPort;
				}
				// Not responding — clean up and retry
				this.cleanupOrphan();
				this.killQmdDaemons();
				await new Promise(r => setTimeout(r, 1000));
				return await this.spawnDaemon();
			}
			throw err;
		}
	}

	private spawnDaemon(): Promise<number> {
		return new Promise((resolve, reject) => {
			const resolvedPath = resolveBinaryPath(this.qmdBinaryPath);
			const env = buildQmdEnv(resolvedPath);

			const proc = spawn(resolvedPath, ["mcp", "--http"], {
				stdio: ["ignore", "pipe", "pipe"],
				env,
			});

			if (proc.pid && this.niceLevel > 0) {
				try { setPriority(proc.pid, this.niceLevel); } catch { /* ignore on Windows */ }
			}

			this.process = proc;

			let output = "";
			let stderrOutput = "";

			const parsePort = (data: Buffer) => {
				output += data.toString();
				const portMatch = output.match(/localhost:(\d+)/);
				if (portMatch && this.port === 0) {
					this.port = parseInt(portMatch[1]!, 10);
					this.writePidFile(proc.pid!);
					this.spawnWatchdog(proc.pid!);
					resolve(this.port);
				}
			};

			proc.stdout?.on("data", parsePort);
			proc.stderr?.on("data", (data: Buffer) => {
				const text = data.toString();
				stderrOutput += text;
				parsePort(data);
				console.error("[QMD daemon]", text);
			});

			proc.on("error", (err) => {
				reject(new Error(`Failed to start QMD daemon: ${err.message}`));
			});

			proc.on("exit", (code) => {
				if (this.port === 0) {
					// Include stderr in error so caller can detect port conflicts
					const portInUse = stderrOutput.match(/Port (\d+) already in use/);
					if (portInUse) {
						reject(new Error(`Port ${portInUse[1]} already in use`));
					} else {
						reject(new Error(`QMD daemon exited before reporting port (code: ${code})`));
					}
				}
				this.process = null;
				this.removePidFile();
				this.exitCallback?.();
			});

			setTimeout(() => {
				if (this.port === 0) {
					proc.kill();
					reject(new Error("QMD daemon did not report port within 30 seconds"));
				}
			}, 30000);
		});
	}

	private healthCheck(port: number): Promise<boolean> {
		return new Promise((resolve) => {
			const timeout = setTimeout(() => resolve(false), 2000);
			const req = httpRequest(
				{ hostname: "localhost", port, path: "/", method: "GET" },
				(res) => {
					clearTimeout(timeout);
					// Any HTTP response means a server is listening
					resolve(true);
					res.resume();
				}
			);
			req.on("error", () => {
				clearTimeout(timeout);
				resolve(false);
			});
			req.end();
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
		if (this.watchdog) {
			this.watchdog.kill();
			this.watchdog = null;
		}
		if (this.process) {
			this.process.kill("SIGTERM");
			this.process = null;
		} else if (this.adopted) {
			this.killQmdDaemons();
		}
		this.adopted = false;
		this.port = 0;
		this.removePidFile();
	}

	private spawnWatchdog(daemonPid: number): void {
		const parentPid = process.pid;
		let cmd: string;
		let args: string[];

		if (process.platform === "win32") {
			cmd = "powershell";
			args = ["-WindowStyle", "Hidden", "-Command",
				`while (Get-Process -Id ${parentPid} -ErrorAction SilentlyContinue) { Start-Sleep -Seconds 1 }; Stop-Process -Id ${daemonPid} -ErrorAction SilentlyContinue`];
		} else {
			cmd = "sh";
			args = ["-c",
				`while kill -0 ${parentPid} 2>/dev/null; do sleep 1; done; kill ${daemonPid} 2>/dev/null`];
		}

		const wd = spawn(cmd, args, { stdio: "ignore", detached: true });
		wd.unref();
		this.watchdog = wd;
	}

	getPort(): number {
		return this.port;
	}

	isRunning(): boolean {
		if (this.adopted) return true;
		return this.process !== null && this.process.exitCode === null;
	}

	applyNiceLevel(level: number): void {
		this.niceLevel = level;
		if (this.process?.pid && level > 0) {
			try { setPriority(this.process.pid, level); } catch { /* ignore */ }
		}
	}

	onExit(callback: () => void): void {
		this.exitCallback = callback;
	}

	private cleanupOrphan(): void {
		if (existsSync(this.pidFilePath)) {
			try {
				const pid = parseInt(readFileSync(this.pidFilePath, "utf-8").trim(), 10);
				if (!isNaN(pid) && isQmdProcess(pid)) {
					process.kill(pid, "SIGTERM");
					console.log(`[QMD] Killed orphaned daemon (PID ${pid})`);
				}
			} catch {
				// Process doesn't exist or can't be killed
			}
			this.removePidFile();
		} else {
			// No PID file — scan for orphaned qmd daemon processes
			this.killQmdDaemons();
		}
	}

	private killQmdDaemons(): void {
		try {
			if (process.platform === "linux") {
				for (const entry of readdirSync("/proc")) {
					if (!/^\d+$/.test(entry)) continue;
					const pid = parseInt(entry, 10);
					try {
						const cmdline = readFileSync(`/proc/${pid}/cmdline`, "utf-8");
						if (cmdline.includes("qmd") && cmdline.includes("mcp")) {
							process.kill(pid, "SIGTERM");
							console.log(`[QMD] Killed orphaned qmd daemon (PID ${pid})`);
						}
					} catch { /* process gone */ }
				}
			} else if (process.platform === "darwin") {
				const output = execFileSync("ps", ["-eo", "pid,command"], {
					encoding: "utf-8",
					timeout: 5000,
				});
				for (const line of output.split("\n")) {
					if (line.includes("qmd") && line.includes("mcp")) {
						const pid = parseInt(line.trim(), 10);
						if (!isNaN(pid)) {
							process.kill(pid, "SIGTERM");
							console.log(`[QMD] Killed orphaned qmd daemon (PID ${pid})`);
						}
					}
				}
			} else {
				// Windows: use wmic to filter by full command line
				const output = execFileSync(
					"wmic",
					["process", "where", "commandline like '%qmd%mcp%'", "get", "processid", "/format:csv"],
					{ encoding: "utf-8", timeout: 5000 }
				);
				for (const line of output.split("\n")) {
					const fields = line.trim().split(",");
					const pidStr = fields[fields.length - 1];
					if (pidStr) {
						const pid = parseInt(pidStr, 10);
						if (!isNaN(pid) && pid > 0) {
							process.kill(pid, "SIGTERM");
							console.log(`[QMD] Killed orphaned qmd daemon (PID ${pid})`);
						}
					}
				}
			}
		} catch {
			// Scan failed — best effort
		}
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

/**
 * Check whether a given PID corresponds to a QMD process.
 * Uses platform-specific mechanisms to read the process command line.
 */
function isQmdProcess(pid: number): boolean {
	try {
		if (process.platform === "win32") {
			const output = execFileSync(
				"tasklist",
				["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"],
				{ encoding: "utf-8", timeout: 5000 }
			);
			return output.toLowerCase().includes("qmd");
		} else if (process.platform === "linux") {
			const cmdline = readFileSync(`/proc/${pid}/cmdline`, "utf-8");
			return cmdline.includes("qmd");
		} else {
			// macOS and other Unix
			const output = execFileSync("ps", ["-p", String(pid), "-o", "comm="], {
				encoding: "utf-8",
				timeout: 5000,
			});
			return output.toLowerCase().includes("qmd");
		}
	} catch {
		return false;
	}
}
