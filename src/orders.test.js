import { describe, expect, it } from "vitest";
import { buildMarketBuyOrder, formatApiError } from "./orders.js";
import { createAsset } from "./config.js";

describe("buildMarketBuyOrder", () => {
    it("uses kebab-case keys so nested legs survive SDK dasherize gaps", () => {
        const asset = createAsset({
            symbol: "BTCI",
            type: "Equity",
            target: 6000,
            buyUnits: 13,
        });
        // createAsset does not take buyUnits in the same way for target - check createAsset
        asset.buyUnits = 13;

        const order = buildMarketBuyOrder(asset);

        expect(order).toEqual({
            "time-in-force": "Day",
            "order-type": "Market",
            legs: [
                {
                    "instrument-type": "Equity",
                    symbol: "BTCI",
                    action: "Buy to Open",
                    quantity: 13,
                },
            ],
        });
        // Critical: leg keys must not be camelCase
        expect(order.legs[0]).not.toHaveProperty("instrumentType");
        expect(order.legs[0]).toHaveProperty("instrument-type", "Equity");
    });
});

describe("formatApiError", () => {
    it("formats tastytrade-style axios errors", () => {
        const err = {
            message: "Request failed with status code 400",
            response: {
                status: 400,
                data: {
                    error: {
                        code: "invalid_request",
                        message: "legs[0].instrument-type is required",
                    },
                },
            },
        };
        expect(formatApiError(err)).toContain("HTTP 400");
        expect(formatApiError(err)).toContain("instrument-type is required");
    });
});
