/**
 * Market session and quote helpers.
 */

import { pick, unwrap } from "./config.js";

/**
 * Return true if the NYSE equity session is currently open for regular trading.
 *
 * Prefer the API `state`/`status` field. Fall back to open/close timestamps when
 * present (`open-at` is often null on weekends and holidays).
 *
 * @param {import('@tastytrade/api').default} client
 * @param {import('./logger.js').Logger} logger
 * @returns {Promise<boolean>}
 */
export async function isMarketOpen(client, logger) {
    const response = await client.httpClient.getData(
        "/market-time/sessions/current",
        {},
        { "instrument-collections": ["Equity"] },
    );
    const sessions = unwrap(response);
    const list = Array.isArray(sessions) ? sessions : sessions ? [sessions] : [];

    if (list.length === 0) {
        logger.warn("No market session data returned for NYSE");
        return false;
    }

    const market = list[0];
    const status = pick(market, "state", "status");
    const openAt = pick(market, "open-at", "openAt");
    const closeAt = pick(market, "close-at", "closeAt");

    logger.debug(
        `Market session: status=${status} open_at=${openAt} close_at=${closeAt}`,
    );

    if (status != null) {
        return String(status).toLowerCase() === "open";
    }

    if (openAt == null || closeAt == null) {
        logger.warn(
            "Market session missing status and open/close times; treating as closed",
        );
        return false;
    }

    const open = new Date(openAt);
    const close = new Date(closeAt);
    const now = new Date();
    return open <= now && now <= close;
}

/**
 * Fetch ask (fallback to mark/last) via `GET /market-data/{type}/{symbol}`.
 *
 * @param {import('@tastytrade/api').default} client
 * @param {string} symbol
 * @param {import('./config.js').InstrumentType} type
 * @returns {Promise<number>}
 */
export async function getMarketDataAsk(client, symbol, type) {
    // Type values may contain spaces (e.g. "Equity Option"); encode path segments.
    const pathType = encodeURIComponent(type);
    const pathSymbol = encodeURIComponent(symbol);
    const response = await client.httpClient.getData(
        `/market-data/${pathType}/${pathSymbol}`,
    );
    const data = unwrap(response);
    const price = pick(data, "ask", "mark", "last", "mid");
    if (price == null || Number.isNaN(Number(price))) {
        throw new Error(`No usable price for ${type} ${symbol}`);
    }
    return Number(price);
}

/**
 * @deprecated Prefer {@link getMarketDataAsk} with an instrument type.
 * @param {import('@tastytrade/api').default} client
 * @param {string} symbol
 * @returns {Promise<number>}
 */
export async function getEquityAsk(client, symbol) {
    return getMarketDataAsk(client, symbol, "Equity");
}

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
export function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
