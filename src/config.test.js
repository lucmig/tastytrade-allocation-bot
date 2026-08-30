/**
 * Strategy instrument-type validation for /market-data/{type}/{symbol}.
 */

import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
    INSTRUMENT_TYPES,
    createAsset,
    loadStrategy,
    validateInstrumentType,
} from "./config.js";

/** @type {string[]} */
const tempDirs = [];

afterEach(() => {
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop();
        if (dir) rmSync(dir, { recursive: true, force: true });
    }
});

/**
 * @param {unknown} data
 * @returns {string}
 */
function writeStrategy(data) {
    const dir = mkdtempSync(join(tmpdir(), "allocation-strategy-"));
    tempDirs.push(dir);
    const path = join(dir, "strategy.json");
    writeFileSync(path, JSON.stringify(data), "utf8");
    return path;
}

describe("validateInstrumentType", () => {
    it("accepts every documented tastytrade instrument type", () => {
        for (const type of INSTRUMENT_TYPES) {
            expect(validateInstrumentType(type)).toBe(type);
        }
    });

    it("trims whitespace", () => {
        expect(validateInstrumentType("  Equity  ")).toBe("Equity");
    });

    it("rejects unknown types with a helpful message", () => {
        expect(() =>
            validateInstrumentType("Stock", { symbol: "AAPL", step: 1 }),
        ).toThrow(/Invalid instrument type "Stock".*AAPL.*step 1/);
        expect(() => validateInstrumentType("Stock")).toThrow(
            /Must be one of:.*Equity/,
        );
    });

    it("rejects missing type", () => {
        expect(() =>
            validateInstrumentType(undefined, { symbol: "BTCI" }),
        ).toThrow(/Missing instrument type/);
        expect(() => validateInstrumentType("", { symbol: "BTCI" })).toThrow(
            /Missing instrument type/,
        );
    });
});

describe("createAsset", () => {
    it("defaults type to Equity when omitted", () => {
        const asset = createAsset({ symbol: "SPY", target: 100 });
        expect(asset.type).toBe("Equity");
    });

    it("stores a validated type", () => {
        const asset = createAsset({
            symbol: "BTC/USD",
            type: "Cryptocurrency",
            target: 1,
        });
        expect(asset.type).toBe("Cryptocurrency");
    });

    it("throws on invalid type", () => {
        expect(() =>
            createAsset({ symbol: "X", target: 1, type: "NotAType" }),
        ).toThrow(/Invalid instrument type/);
    });
});

describe("loadStrategy", () => {
    it("loads types from strategy JSON", () => {
        const path = writeStrategy({
            steps: [
                {
                    step: 1,
                    assets: [
                        { symbol: "BTCI", type: "Equity", target: 6000 },
                        { symbol: "BTC/USD", type: "Cryptocurrency", target: 1 },
                    ],
                },
            ],
        });

        const assets = loadStrategy(path);
        expect(assets).toHaveLength(2);
        expect(assets[0]).toMatchObject({
            symbol: "BTCI",
            type: "Equity",
            target: 6000,
            step: 1,
        });
        expect(assets[1]).toMatchObject({
            symbol: "BTC/USD",
            type: "Cryptocurrency",
            step: 1,
        });
    });

    it("rejects strategy assets without type", () => {
        const path = writeStrategy({
            steps: [
                {
                    step: 1,
                    assets: [{ symbol: "BTCI", target: 6000 }],
                },
            ],
        });

        expect(() => loadStrategy(path)).toThrow(/Missing instrument type.*BTCI/);
    });

    it("rejects invalid type values in strategy", () => {
        const path = writeStrategy({
            steps: [
                {
                    step: 2,
                    assets: [{ symbol: "DIVO", type: "ETF", target: 5000 }],
                },
            ],
        });

        expect(() => loadStrategy(path)).toThrow(
            /Invalid instrument type "ETF".*DIVO.*step 2/,
        );
    });

    it("rejects a top-level array", () => {
        const path = writeStrategy([
            { step: 1, assets: [{ symbol: "BTCI", type: "Equity", target: 1 }] },
        ]);
        expect(() => loadStrategy(path)).toThrow(/must be a JSON object/);
    });

    it("rejects an object without steps", () => {
        const path = writeStrategy({ name: "planA" });
        expect(() => loadStrategy(path)).toThrow(/must have a "steps" array/);
    });

    it("loads the repo planA strategy successfully", () => {
        const planA = fileURLToPath(
            new URL("../strategies/planA.json", import.meta.url),
        );
        const assets = loadStrategy(planA);
        expect(assets.length).toBeGreaterThan(0);
        for (const asset of assets) {
            expect(INSTRUMENT_TYPES).toContain(asset.type);
        }
    });
});
