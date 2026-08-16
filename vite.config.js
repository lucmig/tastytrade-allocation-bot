import { chmodSync } from "node:fs";
import { builtinModules } from "node:module";
import { resolve } from "node:path";
import { defineConfig } from "vite";

const nodeBuiltins = [
    ...builtinModules,
    ...builtinModules.map((m) => `node:${m}`),
];

/** Runtime deps stay external — installers resolve them from package.json. */
const externalDeps = [
    "@tastytrade/api",
    "commander",
    "dotenv",
    "dotenv/config",
];

/**
 * Vite library build for the Node CLI + library surface.
 * Output: dist/index.js (bin), dist/bot.js, dist/config.js, …
 */
export default defineConfig({
    build: {
        target: "node20",
        outDir: "dist",
        emptyOutDir: true,
        sourcemap: true,
        minify: false,
        reportCompressedSize: false,
        lib: {
            entry: {
                index: resolve(__dirname, "src/index.js"),
                bot: resolve(__dirname, "src/bot.js"),
                config: resolve(__dirname, "src/config.js"),
                market: resolve(__dirname, "src/market.js"),
                orders: resolve(__dirname, "src/orders.js"),
                logger: resolve(__dirname, "src/logger.js"),
            },
            formats: ["es"],
        },
        rollupOptions: {
            external: [...nodeBuiltins, ...externalDeps],
            output: {
                entryFileNames: "[name].js",
                // Preserve CLI shebang on the bin entry.
                banner(chunk) {
                    return chunk.name === "index" || chunk.fileName === "index.js"
                        ? "#!/usr/bin/env node\n"
                        : "";
                },
            },
        },
    },
    plugins: [
        {
            name: "chmod-cli-bin",
            closeBundle() {
                try {
                    chmodSync(resolve(__dirname, "dist/index.js"), 0o755);
                } catch {
                    // dist may not exist on dry config load
                }
            },
        },
    ],
    // Vitest reuses this config when present; keep test settings here too.
    test: {
        include: ["src/**/*.{test,spec}.js"],
        environment: "node",
    },
});
