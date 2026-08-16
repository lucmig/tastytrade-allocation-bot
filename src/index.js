/**
 * CLI entry for the allocation bot (commander).
 *
 * Shebang is injected by the Vite build into dist/index.js for the npm bin.
 */

import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Command, InvalidArgumentError } from "commander";

import { runBot } from "./bot.js";
import { getSettings } from "./config.js";
import { setupLogging } from "./logger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_STRATEGY = resolve(__dirname, "../strategies/planA.json");

/**
 * @param {string} value
 * @returns {number}
 */
function parseIntervalHours(value) {
    const n = Number.parseInt(value, 10);
    if (!Number.isInteger(n) || n < 1) {
        throw new InvalidArgumentError("interval must be an integer >= 1");
    }
    return n;
}

/**
 * Parse `--forever` / `--forever true|false`.
 * Commander sets the value to `true` when the flag is present with no argument.
 *
 * @param {string | boolean | undefined} value
 * @returns {boolean}
 */
function parseForever(value) {
    if (value === undefined || value === true || value === "") {
        return true;
    }
    if (value === false) {
        return false;
    }
    const s = String(value).toLowerCase();
    if (["1", "true", "yes", "on"].includes(s)) return true;
    if (["0", "false", "no", "off"].includes(s)) return false;
    throw new InvalidArgumentError("forever must be true or false");
}

/**
 * Run a single allocation cycle.
 * @param {import('./config.js').Settings} settings
 * @param {import('./logger.js').Logger} logger
 */
async function runOnce(settings, logger) {
    await runBot(settings, logger);
}

/**
 * Run forever, executing the bot every `hours` hours.
 * Next fire is after the interval (caller runs once immediately before this).
 *
 * @param {string} strategyPath
 * @param {number} hours
 * @param {import('./logger.js').Logger} logger
 */
async function runContinuously(strategyPath, hours, logger) {
    let running = false;
    const intervalMs = hours * 60 * 60 * 1000;

    logger.info(
        `Scheduler started: running every ${hours} hour(s). Press Ctrl+C to exit.`,
    );

    const timer = setInterval(() => {
        if (running) {
            logger.warn("Previous cycle still running; skipping this interval.");
            return;
        }
        running = true;
        // Fresh settings each cycle so buyUnits reset and env is re-read.
        const cycleSettings = getSettings({ strategyPath });
        runBot(cycleSettings, logger)
            .catch((err) => logger.exception("Scheduled cycle failed", err))
            .finally(() => {
                running = false;
            });
    }, intervalMs);

    // Keep the process alive until interrupted.
    await new Promise((resolve) => {
        const shutdown = () => {
            clearInterval(timer);
            logger.info("Shutting down.");
            resolve(undefined);
        };
        process.once("SIGINT", shutdown);
        process.once("SIGTERM", shutdown);
    });
}

/**
 * @param {{ strategy: string, forever: boolean, interval: number }} options
 */
async function main({ strategy, forever, interval }) {
    const logger = setupLogging();
    logger.info(`strategy=${strategy} forever=${forever} interval=${interval}`);

    if (!existsSync(strategy)) {
        logger.error(`Strategy file not found: ${strategy}`);
        process.exitCode = 1;
        return;
    }

    const settings = getSettings({ strategyPath: strategy });

    logger.info(
        `Using strategy file: ${strategy} (${settings.assets.length} assets, step=${settings.step})`,
    );

    if (forever) {
        // Run once immediately, then on the schedule.
        await runBot(settings, logger);
        await runContinuously(strategy, interval, logger);
    } else {
        await runOnce(settings, logger);
    }
}

const program = new Command();

program
    .name("allocation")
    .description("Portfolio allocation bot for tastytrade")
    .option(
        "-s, --strategy <path>",
        "Strategy JSON file to run",
        process.env.STRATEGY ?? DEFAULT_STRATEGY,
    )
    .option(
        "-f, --forever [enabled]",
        "Run perpetually on an interval (omit value or pass true/false)",
        parseForever,
        false,
    )
    .option(
        "-i, --interval <hours>",
        "Hours between cycles when running with --forever",
        parseIntervalHours,
        1,
    )
    .action(async (opts) => {
        try {
            await main({
                strategy: resolve(opts.strategy),
                forever: Boolean(opts.forever),
                interval: opts.interval,
            });
        } catch (err) {
            console.error(err);
            process.exitCode = 1;
        }
    });

await program.parseAsync(process.argv);
