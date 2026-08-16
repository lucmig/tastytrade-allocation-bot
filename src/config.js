/**
 * Configuration, strategy loading, and tastytrade client factory.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import TastytradeClient from "@tastytrade/api";
import "dotenv/config";

/**
 * Valid instrument types for tastytrade `GET /market-data/{type}/{symbol}`
 * (and order leg `instrument-type`). Values match the API enum.
 *
 * @see https://developer.tastytrade.com/
 * @type {readonly string[]}
 */
export const INSTRUMENT_TYPES = Object.freeze([
    "Bond",
    "Cryptocurrency",
    "Currency Pair",
    "Equity",
    "Equity Offering",
    "Equity Option",
    "Event Contract",
    "Fixed Income Security",
    "Future",
    "Future Option",
    "Index",
    "Liquidity Pool",
    "Unknown",
    "Warrant",
]);

const INSTRUMENT_TYPE_SET = new Set(INSTRUMENT_TYPES);

/**
 * @typedef {typeof INSTRUMENT_TYPES[number]} InstrumentType
 */

/**
 * @typedef {object} Asset
 * @property {string} symbol
 * @property {InstrumentType} type
 * @property {number} target
 * @property {number} step
 * @property {number} units
 * @property {number} targetWeight
 * @property {number} currentWeight
 * @property {number} currentPrice
 * @property {number} buyUnits
 * @property {number} totalUnits
 */

/**
 * @typedef {object} Settings
 * @property {boolean} sandbox
 * @property {boolean} paperTrade
 * @property {number} step
 * @property {Asset[]} assets
 * @property {boolean} dryRun
 * @property {() => { clientSecret: string | undefined, refreshToken: string | undefined, accountNumber: string | undefined }} credentials
 */

/**
 * Validate and normalize a strategy instrument type.
 * Used as the path segment in `/market-data/{type}/{symbol}`.
 *
 * @param {unknown} type
 * @param {{ symbol?: string, step?: number, index?: number }} [context]
 * @returns {InstrumentType}
 */
export function validateInstrumentType(type, context = {}) {
    const label = context.symbol
        ? `symbol ${context.symbol}`
        : context.index != null
            ? `asset index ${context.index}`
            : "asset";
    const stepHint = context.step != null ? ` (step ${context.step})` : "";

    if (type == null || type === "") {
        throw new Error(
            `Missing instrument type for ${label}${stepHint}. ` +
            `Required field "type" must be one of: ${INSTRUMENT_TYPES.join(", ")}`,
        );
    }

    const normalized = String(type).trim();
    if (!INSTRUMENT_TYPE_SET.has(normalized)) {
        throw new Error(
            `Invalid instrument type "${type}" for ${label}${stepHint}. ` +
            `Must be one of: ${INSTRUMENT_TYPES.join(", ")}`,
        );
    }
    return /** @type {InstrumentType} */ (normalized);
}

/**
 * @param {Partial<Asset> & { symbol: string, target: number, type?: string, step?: number }} input
 * @returns {Asset}
 */
export function createAsset({
    symbol,
    target,
    type = "Equity",
    step = 1,
    units = 0,
    targetWeight = 0,
    currentWeight = 0,
    currentPrice = 0,
    buyUnits = 0,
    totalUnits = 0,
}) {
    return {
        symbol,
        type: validateInstrumentType(type, { symbol, step }),
        target: Number(target),
        step: Number(step),
        units: Number(units),
        targetWeight: Number(targetWeight),
        currentWeight: Number(currentWeight),
        currentPrice: Number(currentPrice),
        buyUnits: Number(buyUnits),
        totalUnits: Number(totalUnits),
    };
}

/**
 * Load portfolio sleeves from a strategy JSON file.
 *
 * Expected shape:
 * ```json
 * [
 *   {
 *     "step": 1,
 *     "assets": [
 *       { "symbol": "BTCI", "type": "Equity", "target": 6000 }
 *     ]
 *   }
 * ]
 * ```
 *
 * @param {string} filePath
 * @returns {Asset[]}
 */
export function loadStrategy(filePath) {
    const absolute = resolve(filePath);
    const raw = JSON.parse(readFileSync(absolute, "utf8"));

    if (!Array.isArray(raw)) {
        throw new Error(`Strategy file must be a JSON array: ${absolute}`);
    }

    /** @type {Asset[]} */
    const assets = [];
    for (const group of raw) {
        const step = Number(group.step ?? 1);
        const items = Array.isArray(group.assets) ? group.assets : [];
        items.forEach((item, index) => {
            if (!item?.symbol) {
                throw new Error(
                    `Strategy asset at step ${step}, index ${index} is missing "symbol" (${absolute})`,
                );
            }
            if (item.target == null || Number.isNaN(Number(item.target))) {
                throw new Error(
                    `Strategy asset ${item.symbol} at step ${step} has invalid "target" (${absolute})`,
                );
            }
            const type = validateInstrumentType(item.type, {
                symbol: item.symbol,
                step,
                index,
            });
            assets.push(
                createAsset({
                    symbol: item.symbol,
                    type,
                    target: item.target,
                    step: item.step ?? step,
                }),
            );
        });
    }
    return assets;
}

/**
 * @param {string} [value]
 * @returns {boolean}
 */
function envBool(value) {
    return ["1", "true", "yes"].includes(String(value ?? "").toLowerCase());
}

/**
 * Build settings for a bot run.
 *
 * Env overrides:
 *   ALLOCATION_SANDBOX=true|false
 *   ALLOCATION_PAPER_TRADE=true|false
 *   ALLOCATION_STEP=1
 *
 * @param {{ strategyPath?: string }} [options]
 * @returns {Settings}
 */
export function getSettings({ strategyPath } = {}) {
    const sandbox = envBool(process.env.ALLOCATION_SANDBOX);
    const paperTrade = process.env.ALLOCATION_PAPER_TRADE === undefined
        ? true
        : envBool(process.env.ALLOCATION_PAPER_TRADE);
    const step = Number.parseInt(process.env.ALLOCATION_STEP ?? "1", 10);

    /** @type {Asset[]} */
    let assets = [];
    if (strategyPath) {
        assets = loadStrategy(strategyPath);
    }

    return {
        sandbox,
        paperTrade,
        step,
        assets,
        get dryRun() {
            return this.paperTrade;
        },
        credentials() {
            if (this.sandbox) {
                return {
                    clientSecret: process.env.TASTY_CLIENT_SECRET_SANDBOX,
                    refreshToken: process.env.TASTY_REFRESH_TOKEN_SANDBOX,
                    accountNumber: process.env.TASTY_ACCOUNT_NUMBER_SANDBOX,
                };
            }
            return {
                clientSecret: process.env.TASTY_CLIENT_SECRET,
                refreshToken: process.env.TASTY_REFRESH_TOKEN,
                accountNumber: process.env.TASTY_ACCOUNT_NUMBER,
            };
        },
    };
}

/**
 * @param {Settings} settings
 * @returns {import('@tastytrade/api').default}
 */
export function createClient(settings) {
    const { clientSecret, refreshToken } = settings.credentials();
    if (!clientSecret || !refreshToken) {
        throw new Error("Missing credentials (client secret / refresh token)");
    }

    const base = settings.sandbox
        ? TastytradeClient.SandboxConfig
        : TastytradeClient.ProdConfig;

    return new TastytradeClient({
        ...base,
        clientSecret,
        refreshToken,
        oauthScopes: ["read", "trade"],
    });
}

/**
 * Normalize API response payloads from @tastytrade/api / axios.
 * @param {any} response
 * @returns {any}
 */
export function unwrap(response) {
    if (response?.data?.data?.items !== undefined) {
        return response.data.data.items;
    }
    if (response?.data?.data !== undefined) {
        return response.data.data;
    }
    if (response?.data !== undefined) {
        return response.data;
    }
    return response;
}

/**
 * Read a field that may be camelCase or kebab-case.
 * @param {Record<string, any> | null | undefined} obj
 * @param {...string} keys
 * @returns {any}
 */
export function pick(obj, ...keys) {
    if (!obj) return undefined;
    for (const key of keys) {
        if (obj[key] !== undefined && obj[key] !== null) return obj[key];
    }
    return undefined;
}
