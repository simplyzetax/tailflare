import { env } from "cloudflare:workers";

export type LogLevel = "debug" | "info" | "warn" | "error" | "fatal";

export interface LogContext {
    [key: string]: any;
}

// Distinct log level colors
const LEVEL_COLORS = {
    debug: "\x1b[38;5;39m",
    info: "\x1b[38;5;34m",
    warn: "\x1b[38;5;214m",
    error: "\x1b[38;5;203m",
    fatal: "\x1b[38;5;197m",
};

const ANSI = {
    reset: "\x1b[0m",
    dim: "\x1b[2m",
    bold: "\x1b[1m",
};

/**
 * Generate a stable color for each prefix based on hash of prefix name.
 * Uses 256-color ANSI palette.
 */
function colorForPrefix(prefix: string) {
    let hash = 0;
    for (let i = 0; i < prefix.length; i++) {
        hash = (hash + prefix.charCodeAt(i) * 17) % 255;
    }

    // Avoid reserved grayscale or unreadable ranges
    const safeColor = 17 + (hash % 200);

    return `\x1b[38;5;${safeColor}m`;
}

export class Logger {
    private prefix: string;
    private pretty: boolean;
    private prefixColor: string;

    constructor(prefix: string = "APP", pretty: boolean = true) {
        this.prefix = prefix.toUpperCase();
        this.pretty = pretty;
        this.prefixColor = colorForPrefix(this.prefix);
    }

    private format(level: LogLevel, msg: string, ctx: LogContext = {}) {
        return {
            timestamp: new Date().toISOString(),
            level,
            prefix: this.prefix,
            message: msg,
            ...ctx,
        };
    }

    private print(level: LogLevel, msg: string, ctx?: LogContext) {
        const obj = this.format(level, msg, ctx);
        const json = JSON.stringify(obj);

        // Always emit structured log for Cloudflare analytics/export
        console.log(json);

        if (!this.pretty) return;

        const lvl = level.toUpperCase();
        const lvlColor = LEVEL_COLORS[level];
        const prefixTag =
            `${this.prefixColor}${ANSI.bold}${this.prefix}${ANSI.reset}`;

        const line =
            `${lvlColor}${ANSI.bold}[${lvl}]${ANSI.reset} ` +
            `${ANSI.dim}${obj.timestamp}${ANSI.reset} ` +
            `${prefixTag} ` +
            `${msg}` +
            (ctx ? ` ${ANSI.dim}${JSON.stringify(ctx)}${ANSI.reset}` : "");

        console.log(line);
    }

    debug(msg: string, ctx?: LogContext) { this.print("debug", msg, ctx); }
    info(msg: string, ctx?: LogContext) { this.print("info", msg, ctx); }
    warn(msg: string, ctx?: LogContext) { this.print("warn", msg, ctx); }
    error(msg: string, ctx?: LogContext) { this.print("error", msg, ctx); }
    fatal(msg: string, ctx?: LogContext) { this.print("fatal", msg, ctx); }
}

const pretty = env.NODE_ENV === "production" ? false : true;

// Example logger instances
export const workerLogger = new Logger("WORKER", pretty);
export const durableObjectLogger = new Logger("DO", pretty);
export const wasmLogger = new Logger("WASM", pretty);
export const proxyLogger = new Logger("PROXY", pretty);
export const tailscaleLogger = new Logger("TAILSCALE", pretty);