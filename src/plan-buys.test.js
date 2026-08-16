/**
 * Vitest coverage for greedy buy-planning (`planBuys`).
 *
 * The planner walks assets in order, adding one share at a time while
 * `(units + buyUnits) / totalUnits < targetWeight` and cash > price.
 * When totalUnits is 0, weight is treated as 0 so every underweight sleeve
 * is funded round-robin until cash runs out.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { planBuys } from "./bot.js";
import { createAsset } from "./config.js";

/** @returns {import('./logger.js').Logger} */
function createLogger() {
    return {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        exception: vi.fn(),
    };
}

/**
 * @param {Array<{ symbol: string, target: number, units?: number, currentPrice: number, targetWeight: number }>} specs
 */
function assetsFrom(specs) {
    return specs.map((s) =>
        createAsset({
            symbol: s.symbol,
            target: s.target,
            units: s.units ?? 0,
            currentPrice: s.currentPrice,
            targetWeight: s.targetWeight,
        }),
    );
}

/**
 * @param {import('./config.js').Asset[]} assets
 * @returns {number}
 */
function totalUnitsOf(assets) {
    return assets.reduce((sum, a) => sum + a.units, 0);
}

/**
 * @param {import('./config.js').Asset[]} assets
 * @returns {Record<string, number>}
 */
function buyMap(assets) {
    return Object.fromEntries(assets.map((a) => [a.symbol, a.buyUnits]));
}

/**
 * @param {import('./config.js').Asset[]} assets
 * @returns {number}
 */
function totalSpend(assets) {
    return assets.reduce((sum, a) => sum + a.buyUnits * a.currentPrice, 0);
}

describe("planBuys", () => {
    /** @type {ReturnType<typeof createLogger>} */
    let logger;

    beforeEach(() => {
        logger = createLogger();
    });

    describe("single asset", () => {
        it("buys nothing when cash is zero", () => {
            const assets = assetsFrom([
                { symbol: "A", target: 100, units: 0, currentPrice: 10, targetWeight: 1 },
            ]);

            planBuys(assets, totalUnitsOf(assets), 0, logger);

            expect(buyMap(assets)).toEqual({ A: 0 });
            expect(totalSpend(assets)).toBe(0);
        });

        it("buys nothing when cash is exactly the price (strict > required)", () => {
            const assets = assetsFrom([
                { symbol: "A", target: 100, units: 0, currentPrice: 25, targetWeight: 1 },
            ]);

            planBuys(assets, totalUnitsOf(assets), 25, logger);

            expect(buyMap(assets)).toEqual({ A: 0 });
            expect(logger.info).toHaveBeenCalledWith("Not enough cash to buy A");
        });

        it("buys nothing when cash is below the price", () => {
            const assets = assetsFrom([
                { symbol: "A", target: 100, units: 0, currentPrice: 50, targetWeight: 1 },
            ]);

            planBuys(assets, totalUnitsOf(assets), 10, logger);

            expect(buyMap(assets)).toEqual({ A: 0 });
        });

        it("with empty portfolio (totalUnits=0) spends until cash is exhausted", () => {
            // weight stays 0 forever when totalUnits is 0, so buys continue while cash > price
            const assets = assetsFrom([
                { symbol: "A", target: 100, units: 0, currentPrice: 10, targetWeight: 1 },
            ]);
            const cash = 45;

            planBuys(assets, 0, cash, logger);

            // 4 shares * $10 = $40; remaining $5 cannot buy another share
            expect(buyMap(assets)).toEqual({ A: 4 });
            expect(totalSpend(assets)).toBe(40);
            expect(totalSpend(assets)).toBeLessThanOrEqual(cash);
        });

        it("with holdings, buys only until target weight is reached", () => {
            // Portfolio totalUnits=10 (other sleeves held outside this step list).
            // targetWeight=0.5, units=2 → need buyUnits so (2+buy)/10 >= 0.5 → buyUnits >= 3
            const assets = assetsFrom([
                { symbol: "A", target: 50, units: 2, currentPrice: 10, targetWeight: 0.5 },
            ]);
            const totalUnits = 10;

            planBuys(assets, totalUnits, 10_000, logger);

            expect(buyMap(assets)).toEqual({ A: 3 });
            expect((2 + assets[0].buyUnits) / totalUnits).toBeGreaterThanOrEqual(0.5);
        });

        it("does not buy when already at target weight", () => {
            const assets = assetsFrom([
                { symbol: "A", target: 50, units: 5, currentPrice: 10, targetWeight: 0.5 },
            ]);
            const totalUnits = 10;

            planBuys(assets, totalUnits, 10_000, logger);

            expect(buyMap(assets)).toEqual({ A: 0 });
        });

        it("does not buy when overweight", () => {
            const assets = assetsFrom([
                { symbol: "A", target: 50, units: 8, currentPrice: 10, targetWeight: 0.5 },
            ]);

            planBuys(assets, 10, 10_000, logger);

            expect(buyMap(assets)).toEqual({ A: 0 });
        });
    });

    describe("two assets", () => {
        it("funds only the underweight sleeve when the other is at target", () => {
            // totalUnits=10; A units=0 target 50%; B units=10 target 50%
            const assets = assetsFrom([
                { symbol: "A", target: 50, units: 0, currentPrice: 10, targetWeight: 0.5 },
                { symbol: "B", target: 50, units: 10, currentPrice: 10, targetWeight: 0.5 },
            ]);
            const totalUnits = totalUnitsOf(assets);

            planBuys(assets, totalUnits, 25, logger);

            // need buyUnits so buyUnits/10 >= 0.5 → 5 shares, but cash 25 only buys 2
            expect(assets[0].buyUnits).toBeGreaterThanOrEqual(1);
            expect(assets[0].buyUnits).toBe(2);
            expect(assets[1].buyUnits).toBe(0);
            expect(totalSpend(assets)).toBeLessThanOrEqual(25);
        });

        it("splits cash round-robin across two empty underweight sleeves", () => {
            const assets = assetsFrom([
                { symbol: "A", target: 50, units: 0, currentPrice: 10, targetWeight: 0.5 },
                { symbol: "B", target: 50, units: 0, currentPrice: 10, targetWeight: 0.5 },
            ]);
            // totalUnits=0 → weight always 0 → spend while cash > price (strict)
            // cash 50 → buys while cash is 50,40,30,20 then stops at 10 (10 > 10 is false)
            const cash = 50;

            planBuys(assets, 0, cash, logger);

            // A,B,A,B → 4 shares * $10 = $40; leftover equals one share price
            expect(assets[0].buyUnits + assets[1].buyUnits).toBe(4);
            expect(buyMap(assets)).toEqual({ A: 2, B: 2 });
            expect(totalSpend(assets)).toBe(40);
            expect(cash - totalSpend(assets)).toBeLessThanOrEqual(10);
        });

        it("prefers the first affordable underweight asset when cash is tight", () => {
            const assets = assetsFrom([
                { symbol: "CHEAP", target: 50, units: 0, currentPrice: 5, targetWeight: 0.5 },
                { symbol: "PRICEY", target: 50, units: 0, currentPrice: 40, targetWeight: 0.5 },
            ]);
            const cash = 20;

            planBuys(assets, 0, cash, logger);

            expect(assets[0].buyUnits).toBeGreaterThanOrEqual(1);
            expect(totalSpend(assets)).toBeLessThanOrEqual(cash);
            expect(
                assets[0].buyUnits * 5 + assets[1].buyUnits * 40,
            ).toBeLessThanOrEqual(cash);
        });

        it("stops without buying either when both prices exceed cash", () => {
            const assets = assetsFrom([
                { symbol: "A", target: 50, units: 0, currentPrice: 100, targetWeight: 0.5 },
                { symbol: "B", target: 50, units: 0, currentPrice: 100, targetWeight: 0.5 },
            ]);

            planBuys(assets, 0, 50, logger);

            expect(buyMap(assets)).toEqual({ A: 0, B: 0 });
        });

        it("with large cash and fixed totalUnits, fills both to target weight", () => {
            // totalUnits=100; A 30→ need 20 more for 50%; B 40→ need 10 more for 50%
            const assets = assetsFrom([
                { symbol: "A", target: 50, units: 30, currentPrice: 1, targetWeight: 0.5 },
                { symbol: "B", target: 50, units: 40, currentPrice: 1, targetWeight: 0.5 },
            ]);
            const totalUnits = 100;

            planBuys(assets, totalUnits, 10_000, logger);

            expect(assets[0].buyUnits).toBe(20);
            expect(assets[1].buyUnits).toBe(10);
            expect((30 + assets[0].buyUnits) / totalUnits).toBeGreaterThanOrEqual(0.5);
            expect((40 + assets[1].buyUnits) / totalUnits).toBeGreaterThanOrEqual(0.5);
        });
    });

    describe("three assets", () => {
        it("allocates round-robin with empty portfolio and modest cash", () => {
            const assets = assetsFrom([
                { symbol: "A", target: 40, units: 0, currentPrice: 10, targetWeight: 0.4 },
                { symbol: "B", target: 30, units: 0, currentPrice: 10, targetWeight: 0.3 },
                { symbol: "C", target: 30, units: 0, currentPrice: 10, targetWeight: 0.3 },
            ]);
            // cash 70, price 10: buy while cash > 10 → 6 shares, leftover 10
            const cash = 70;

            planBuys(assets, 0, cash, logger);

            // Order: A B C A B C
            expect(buyMap(assets)).toEqual({ A: 2, B: 2, C: 2 });
            expect(totalSpend(assets)).toBe(60);
        });

        it("skips sleeves already at weight and funds only underweight ones", () => {
            // totalUnits=100
            // A: 40 units, target 40% → at target
            // B: 20 units, target 30% → needs 10
            // C: 10 units, target 30% → needs 20
            const assets = assetsFrom([
                { symbol: "A", target: 40, units: 40, currentPrice: 1, targetWeight: 0.4 },
                { symbol: "B", target: 30, units: 20, currentPrice: 1, targetWeight: 0.3 },
                { symbol: "C", target: 30, units: 10, currentPrice: 1, targetWeight: 0.3 },
            ]);
            const totalUnits = 100;

            planBuys(assets, totalUnits, 10_000, logger);

            expect(buyMap(assets)).toEqual({ A: 0, B: 10, C: 20 });
        });

        it("with limited cash only partially funds the first underweight sleeves", () => {
            const assets = assetsFrom([
                { symbol: "A", target: 40, units: 0, currentPrice: 20, targetWeight: 0.4 },
                { symbol: "B", target: 30, units: 0, currentPrice: 20, targetWeight: 0.3 },
                { symbol: "C", target: 30, units: 0, currentPrice: 20, targetWeight: 0.3 },
            ]);
            const cash = 50; // only two shares

            planBuys(assets, 0, cash, logger);

            expect(
                assets[0].buyUnits + assets[1].buyUnits + assets[2].buyUnits,
            ).toBe(2);
            expect(buyMap(assets)).toEqual({ A: 1, B: 1, C: 0 });
            expect(totalSpend(assets)).toBe(40);
        });

        it("handles mixed prices without overspending", () => {
            const assets = assetsFrom([
                { symbol: "A", target: 50, units: 0, currentPrice: 7, targetWeight: 0.5 },
                { symbol: "B", target: 30, units: 0, currentPrice: 13, targetWeight: 0.3 },
                { symbol: "C", target: 20, units: 0, currentPrice: 3, targetWeight: 0.2 },
            ]);
            const cash = 100;

            planBuys(assets, 0, cash, logger);

            expect(totalSpend(assets)).toBeLessThanOrEqual(cash);
            expect(totalSpend(assets)).toBeGreaterThan(0);
            // leftover cash must be <= min price among underweight (all are underweight)
            const minPrice = Math.min(...assets.map((a) => a.currentPrice));
            expect(cash - totalSpend(assets)).toBeLessThanOrEqual(minPrice);
        });
    });

    describe("many assets", () => {
        it("scales to five equal sleeves with empty book", () => {
            const assets = assetsFrom(
                ["A", "B", "C", "D", "E"].map((symbol) => ({
                    symbol,
                    target: 20,
                    units: 0,
                    currentPrice: 10,
                    targetWeight: 0.2,
                })),
            );
            // cash 100, price 10: buy while cash > 10 → 9 shares (leftover 10)
            // Round 1: all five; round 2: A B C D then E sees cash=10 and stops
            const cash = 100;

            planBuys(assets, 0, cash, logger);

            expect(buyMap(assets)).toEqual({ A: 2, B: 2, C: 2, D: 2, E: 1 });
            expect(totalSpend(assets)).toBe(90);
        });

        it("funds a subset of underweight sleeves among five holdings", () => {
            // totalUnits=100; equal 20% targets
            // holdings: 25, 25, 20, 15, 15 → underweight D and E (need 5 each)
            const holdings = [25, 25, 20, 15, 15];
            const assets = assetsFrom(
                holdings.map((units, i) => ({
                    symbol: `S${i}`,
                    target: 20,
                    units,
                    currentPrice: 1,
                    targetWeight: 0.2,
                })),
            );
            const totalUnits = 100;

            planBuys(assets, totalUnits, 10_000, logger);

            expect(buyMap(assets)).toEqual({
                S0: 0,
                S1: 0,
                S2: 0,
                S3: 5,
                S4: 5,
            });
        });

        it("with tiny cash relative to many assets buys at most one of the first affordable", () => {
            const assets = assetsFrom(
                Array.from({ length: 8 }, (_, i) => ({
                    symbol: `S${i}`,
                    target: 1,
                    units: 0,
                    currentPrice: 15,
                    targetWeight: 1 / 8,
                })),
            );
            const cash = 20; // only one share

            planBuys(assets, 0, cash, logger);

            const buys = assets.map((a) => a.buyUnits);
            expect(buys.reduce((a, b) => a + b, 0)).toBe(1);
            expect(buys[0]).toBe(1);
            expect(buys.slice(1).every((b) => b === 0)).toBe(true);
        });
    });

    describe("cash edge cases", () => {
        it("handles fractional leftover cash", () => {
            const assets = assetsFrom([
                { symbol: "A", target: 100, units: 0, currentPrice: 10.5, targetWeight: 1 },
            ]);
            const cash = 32; // 3 * 10.5 = 31.5

            planBuys(assets, 0, cash, logger);

            expect(assets[0].buyUnits).toBe(3);
            expect(totalSpend(assets)).toBeCloseTo(31.5);
            expect(cash - totalSpend(assets)).toBeLessThanOrEqual(10.5);
        });

        it("never spends more than available cash across multi-asset rounds", () => {
            const scenarios = [
                {
                    cash: 1,
                    assets: assetsFrom([
                        { symbol: "A", target: 50, units: 0, currentPrice: 10, targetWeight: 0.5 },
                        { symbol: "B", target: 50, units: 0, currentPrice: 10, targetWeight: 0.5 },
                    ]),
                },
                {
                    cash: 33,
                    assets: assetsFrom([
                        { symbol: "A", target: 40, units: 0, currentPrice: 7, targetWeight: 0.4 },
                        { symbol: "B", target: 30, units: 0, currentPrice: 11, targetWeight: 0.3 },
                        { symbol: "C", target: 30, units: 0, currentPrice: 5, targetWeight: 0.3 },
                    ]),
                },
                {
                    cash: 999,
                    assets: assetsFrom(
                        Array.from({ length: 6 }, (_, i) => ({
                            symbol: `X${i}`,
                            target: 10,
                            units: 0,
                            currentPrice: 12 + i,
                            targetWeight: 1 / 6,
                        })),
                    ),
                },
            ];

            for (const { cash, assets } of scenarios) {
                planBuys(assets, 0, cash, createLogger());
                expect(totalSpend(assets)).toBeLessThanOrEqual(cash);
            }
        });

        it("leaves buyUnits at zero for all assets when list is empty", () => {
            const assets = [];
            planBuys(assets, 0, 1000, logger);
            expect(assets).toEqual([]);
        });
    });

    describe("weight progress with holdings", () => {
        it("updates currentWeight on each asset during planning", () => {
            const assets = assetsFrom([
                { symbol: "A", target: 50, units: 0, currentPrice: 1, targetWeight: 0.5 },
                { symbol: "B", target: 50, units: 10, currentPrice: 1, targetWeight: 0.5 },
            ]);
            const totalUnits = 10;

            planBuys(assets, totalUnits, 100, logger);

            // After filling A to 5 buys: weight for A ends at (0+5)/10 = 0.5
            expect(assets[0].buyUnits).toBe(5);
            expect(assets[0].currentWeight).toBeCloseTo(0.5);
            expect(assets[1].buyUnits).toBe(0);
            expect(assets[1].currentWeight).toBeCloseTo(1);
        });
    });
});
