/**
 * Logging setup for the allocation bot.
 */

import { createWriteStream, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const LEVELS = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40,
};

/**
 * @typedef {object} Logger
 * @property {(msg: string, ...args: unknown[]) => void} debug
 * @property {(msg: string, ...args: unknown[]) => void} info
 * @property {(msg: string, ...args: unknown[]) => void} warn
 * @property {(msg: string, ...args: unknown[]) => void} error
 * @property {(msg: string, err?: unknown) => void} exception
 */

/**
 * Configure and return the package logger (idempotent-ish: returns a fresh logger).
 *
 * Log path resolution order:
 *   1. Explicit `logFile` argument
 *   2. `ALLOCATION_LOG_FILE` environment variable
 *   3. `allocation.log` in the current working directory
 *
 * @param {{ name?: string, logFile?: string | null, level?: keyof typeof LEVELS }} [options]
 * @returns {Logger}
 */
export function setupLogging({
    name = "allocation",
    logFile = null,
    level = "debug",
} = {}) {
    const minLevel = LEVELS[level] ?? LEVELS.debug;
    const resolvedLogFile = logFile ?? process.env.ALLOCATION_LOG_FILE ?? "allocation.log";

    /** @type {import('node:fs').WriteStream | null} */
    let fileStream = null;
    if (resolvedLogFile) {
        mkdirSync(dirname(resolvedLogFile) === "." ? process.cwd() : dirname(resolvedLogFile), {
            recursive: true,
        });
        fileStream = createWriteStream(resolvedLogFile, { flags: "a" });
    }

    /**
     * @param {keyof typeof LEVELS} lvl
     * @param {string} msg
     * @param {unknown[]} args
     */
    function write(lvl, msg, args) {
        if ((LEVELS[lvl] ?? 0) < minLevel) return;
        const ts = new Date().toISOString().replace("T", " ").replace("Z", "");
        const extra =
            args.length === 0
                ? ""
                : " " +
                args
                    .map((a) => (typeof a === "string" ? a : safeStringify(a)))
                    .join(" ");
        const line = `${ts} - ${name} - ${lvl.toUpperCase()} - ${msg}${extra}`;
        const out = lvl === "error" ? process.stderr : process.stdout;
        out.write(line + "\n");
        fileStream?.write(line + "\n");
    }

    return {
        debug: (msg, ...args) => write("debug", msg, args),
        info: (msg, ...args) => write("info", msg, args),
        warn: (msg, ...args) => write("warn", msg, args),
        error: (msg, ...args) => write("error", msg, args),
        exception(msg, err) {
            write("error", msg, []);
            if (err instanceof Error) {
                write("error", err.stack ?? err.message, []);
            } else if (err !== undefined) {
                write("error", safeStringify(err), []);
            }
        },
    };
}

/** @param {unknown} value */
function safeStringify(value) {
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}
