/**
 * Core allocation bot: rebalance portfolio sleeves toward target weights.
 */

import { createClient, pick } from "./config.js";
import { getMarketDataAsk, isMarketOpen, sleep } from "./market.js";
import { buy } from "./orders.js";

/**
 * Run one allocation cycle against tastytrade.
 *
 * @param {import('./config.js').Settings} settings
 * @param {import('./logger.js').Logger} logger
 * @returns {Promise<void>}
 */
export async function runBot(settings, logger) {
    const dryRun = settings.dryRun;

    try {
        const { clientSecret, refreshToken, accountNumber } = settings.credentials();
        if (!clientSecret || !refreshToken) {
            logger.error("Missing credentials!");
            return;
        }
        if (!accountNumber) {
            logger.error("Missing account number!");
            return;
        }

        logger.info(`=====  ${new Date().toISOString()}  =====`);
        const client = createClient(settings);
        // Force token generation so we fail fast on bad credentials.
        await client.httpClient.generateAccessToken();
        logger.info("Successfully connected to tastytrade!");

        // if (!(await isMarketOpen(client, logger))) {
        //     logger.error("Market is closed. Exiting bot cycle.\n");
        //     return;
        // }

        const account = await client.accountsAndCustomersService.getFullCustomerAccountResource(
            accountNumber,
        );
        const balances = await client.balancesAndPositionsService.getAccountBalanceValues(
            accountNumber,
        );
        const positionsRaw =
            await client.balancesAndPositionsService.getPositionsList(accountNumber);
        const positions = Array.isArray(positionsRaw)
            ? positionsRaw
            : Array.isArray(positionsRaw?.items)
                ? positionsRaw.items
                : [];

        const accountType =
            pick(account, "account-type-name", "accountTypeName", "account-type", "accountType") ??
            "N/A";
        const nlv = Number(
            pick(balances, "net-liquidating-value", "netLiquidatingValue") ?? 0,
        );
        const cash = pick(balances, "cash-balance", "cashBalance", "cash");
        const availableCash = Math.min(
            balances?.["equity-buying-power"] ?? 0,
            balances?.["cash-settle-balance"] ?? 0,
        );

        logger.info(`Account               : ${accountNumber}`);
        logger.info(`Account Type          : ${accountType}`);
        logger.info(`Net Liquidating Value : $${nlv.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

        if (cash != null) {
            logger.info(
                `Cash Balance          : $${Number(cash).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
            );
        } else {
            logger.info("Cash Balance          : N/A");
        }
        if (availableCash != null) {
            logger.info(
                `Cash Settled          : $${Number(availableCash).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
            );
        } else {
            logger.info("Cash Settled          : N/A");
        }
        logger.info("-".repeat(50));

        if (availableCash == null) {
            logger.error("Unable to read settled cash. Aborting cycle.");
            return;
        }

        const stepAssets = settings.assets.filter((a) => a.step === settings.step);
        if (stepAssets.length === 0) {
            logger.warn(`No assets configured for step=${settings.step}`);
            return;
        }

        const targetUnits = stepAssets.reduce((acc, a) => acc + a.target, 0);

        for (const asset of stepAssets) {
            asset.targetWeight = targetUnits ? asset.target / targetUnits : 0;

            const pos = positions.find(
                (p) => pick(p, "symbol") === asset.symbol,
            );
            asset.units = pos ? Number(pick(pos, "quantity") ?? 0) : 0;

            asset.currentPrice = await getMarketDataAsk(
                client,
                asset.symbol,
                asset.type,
            );
            await sleep(500); // avoid rate limits
        }

        const totalUnits = stepAssets.reduce((acc, a) => acc + a.units, 0);
        for (const asset of stepAssets) {
            asset.totalUnits = totalUnits;
        }

        planBuys(stepAssets, totalUnits, Number(availableCash), logger);
        await executeBuys(client, accountNumber, stepAssets, dryRun, logger);
    } catch (err) {
        logger.exception("Bot cycle failed", err);
    } finally {
        logger.info("-".repeat(50));
        logger.info("\n");
    }
}

/**
 * Greedily allocate settled cash to underweight sleeves one unit at a time.
 *
 * @param {import('./config.js').Asset[]} stepAssets
 * @param {number} totalUnits
 * @param {number} availableCash
 * @param {import('./logger.js').Logger} logger
 */
export function planBuys(stepAssets, totalUnits, availableCash, logger) {
    let outOfFunds = false;
    let cash = availableCash;

    while (!outOfFunds) {
        let madeProgress = false;
        for (const asset of stepAssets) {
            const weight = totalUnits > 0 ? (asset.units + asset.buyUnits) / totalUnits : 0;
            asset.currentWeight = weight;

            if (weight < asset.targetWeight && cash > asset.currentPrice) {
                asset.buyUnits += 1;
                cash -= Number(asset.currentPrice);
                madeProgress = true;
            } else if (weight < asset.targetWeight && cash <= asset.currentPrice) {
                if (asset.buyUnits === 0) {
                    logger.info(`Not enough cash to buy ${asset.symbol}`);
                }
                outOfFunds = true;
            }
        }

        if (!madeProgress) break;
    }
}

/**
 * @param {import('@tastytrade/api').default} client
 * @param {string} accountNumber
 * @param {import('./config.js').Asset[]} stepAssets
 * @param {boolean} dryRun
 * @param {import('./logger.js').Logger} logger
 */
async function executeBuys(client, accountNumber, stepAssets, dryRun, logger) {
    for (const asset of stepAssets) {
        logger.info(asset.symbol);
        logger.info("-".repeat(50));

        if (asset.buyUnits > 0) {
            logger.info(`Current Weight        : ${(asset.currentWeight * 100).toFixed(2)}%`);
            logger.info(`Current Position      : ${asset.units}`);
            logger.info(`Target Position       : ${asset.target}`);
            logger.info(`Current Price         : $${Number(asset.currentPrice).toFixed(2)}`);
            logger.info(`Target Weight         : ${(asset.targetWeight * 100).toFixed(2)}%`);
            logger.info(`Buy Units             : ${asset.buyUnits}`);
            await buy(client, accountNumber, asset, { dryRun, logger });
        } else {
            logger.info("No BUY order");
            logger.info("-".repeat(50));
        }
    }
}
