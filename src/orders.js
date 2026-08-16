/**
 * Order placement helpers.
 */

import { pick } from "./config.js";

/**
 * Extract a readable message from a tastytrade/axios error response.
 * @param {unknown} err
 * @returns {string}
 */
export function formatApiError(err) {
    if (!err || typeof err !== "object") {
        return String(err);
    }
    const axiosErr = /** @type {any} */ (err);
    const status = axiosErr.response?.status;
    const data = axiosErr.response?.data;
    const parts = [];

    if (status != null) {
        parts.push(`HTTP ${status}`);
    }

    // tastytrade error shapes: { error: { code, message } } or { error: { errors: [...] } }
    const errorBody = data?.error ?? data;
    if (errorBody?.message) {
        parts.push(errorBody.message);
    }
    if (errorBody?.code) {
        parts.push(`code=${errorBody.code}`);
    }
    if (Array.isArray(errorBody?.errors)) {
        for (const e of errorBody.errors) {
            const msg = e?.message ?? e?.code ?? JSON.stringify(e);
            parts.push(String(msg));
        }
    } else if (data && !errorBody?.message) {
        try {
            parts.push(JSON.stringify(data));
        } catch {
            parts.push(String(data));
        }
    }

    if (parts.length === 0) {
        return axiosErr.message ?? String(err);
    }
    return parts.join(" | ");
}

/**
 * Build a market buy order payload using kebab-case keys.
 *
 * NOTE: @tastytrade/api's recursiveDasherizeKeys only dasherizes plain objects,
 * not objects nested inside arrays. Leg fields must already be kebab-case or
 * the API returns HTTP 400.
 *
 * @param {import('./config.js').Asset} asset
 * @returns {Record<string, unknown>}
 */
export function buildMarketBuyOrder(asset) {
    return {
        "time-in-force": "Day",
        "order-type": "Market",
        legs: [
            {
                "instrument-type": asset.type,
                symbol: asset.symbol,
                action: "Buy to Open",
                quantity: asset.buyUnits,
            },
        ],
    };
}

/**
 * Place a market buy for the planned units on `asset`.
 *
 * @param {import('@tastytrade/api').default} client
 * @param {string} accountNumber
 * @param {import('./config.js').Asset} asset
 * @param {{ dryRun?: boolean, logger: import('./logger.js').Logger }} options
 * @returns {Promise<void>}
 */
export async function buy(client, accountNumber, asset, { dryRun = true, logger }) {
    const order = buildMarketBuyOrder(asset);

    logger.debug(
        `Submitting ${dryRun ? "dry-run" : "live"} order: ${JSON.stringify(order)}`,
    );

    let response;
    try {
        response = dryRun
            ? await client.orderService.postOrderDryRun(accountNumber, order)
            : await client.orderService.createOrder(accountNumber, order);
    } catch (err) {
        logger.error(`Order failed for ${asset.symbol}: ${formatApiError(err)}`);
        throw err;
    }

    const payload = response?.order ? response : (response?.data ?? response);
    const orderBody = pick(payload, "order") ?? payload;
    const bp = pick(payload, "buying-power-effect", "buyingPowerEffect") ?? {};

    const cost = Number(
        pick(bp, "change-in-buying-power", "changeInBuyingPower") ?? 0,
    );
    const cashRemaining = Number(
        pick(bp, "new-buying-power", "newBuyingPower") ?? 0,
    );
    const size = Number(pick(orderBody, "size", "quantity") ?? asset.buyUnits);

    const denominator = asset.totalUnits + asset.buyUnits;
    const newWeight =
        denominator > 0 ? (asset.buyUnits + asset.units) / denominator : 0;

    logger.info("=".repeat(50));
    logger.info(dryRun ? "BUY ORDER (dry-run)" : "BUY ORDER");
    logger.info("+".repeat(50));
    logger.info(`Symbol                : ${asset.symbol}`);
    logger.info(`Instrument Type       : ${asset.type}`);
    logger.info(`Size                  : ${size.toFixed(2)}`);
    logger.info(`Cost                  : $${cost.toFixed(2)}`);
    logger.info(`Cash Remaining        : $${cashRemaining.toFixed(2)}`);
    logger.info(`New Weight            : ${(newWeight * 100).toFixed(2)}%`);
    logger.info("=".repeat(50));
}
