import { DurableObject } from "cloudflare:workers";
import { createIPN } from "../wasm/ipn";
import { durableObjectLogger } from "../utils/logger";

const HEX_RE = /^[0-9a-fA-F]*$/;

export class Tailscale extends DurableObject<Env> {
    private ipn: IPN | null = null;
    private loginURL: string | null = null;
    private initialized = false;
    private currentState: IPNState = "NoState";

    public get isReady() {
        return this.currentState === "Running";
    }

    private async initialize() {
        if (this.initialized) return;
        this.initialized = true;

        this.ipn = await createIPN({
            stateStorage: {
                getState: (key: string): string => {
                    const v = this.ctx.storage.kv.get(key);
                    return (typeof v === "string" && HEX_RE.test(v)) ? v : "";
                },
                setState: (key: string, value: string): void => {
                    if (HEX_RE.test(value)) {
                        this.ctx.storage.kv.put(key, value);
                    }
                },
            },
            panicHandler: (msg) => durableObjectLogger.error("TS panic:", { msg }),
        });

        this.ipn.run({
            notifyState: (state: IPNState) => {
                this.currentState = state;
                durableObjectLogger.info("TS state:", { state });
            },
            notifyNetMap: (nmJSON: string) => {
                durableObjectLogger.info("TS netmap:", { nmJSON });
            },
            notifyBrowseToURL: (url: string) => {
                this.loginURL = url;
                this.ctx.storage.kv.put("loginURL", url);
            },
            notifyPanicRecover: (err: string) => {
                durableObjectLogger.info("TS panic recovered:", { err });
            },
        });
    }

    private async waitUntilReady() {
        if (this.isReady) return;

        // Retry loop instead of fixed timeout
        for (let i = 0; i < 50; i++) {
            if (this.isReady) return;
            if (this.currentState === "NeedsLogin") return;
            await new Promise(res => setTimeout(res, 100));
        }
    }


    async login(): Promise<string> {
        await this.initialize();
        this.ipn?.login();

        while (!this.loginURL) {
            await new Promise((resolve) => setTimeout(resolve, 100));
        }

        return this.loginURL;
    }

    async warm(): Promise<void> {
        await this.initialize();
        while (!this.isReady) {
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
        return;
    }

    async proxy(request: Request): Promise<Response | undefined> {
        await this.initialize();

        if (this.currentState === "NeedsLogin") {
            return undefined;
        }

        if (!this.isReady) {
            await this.waitUntilReady();
        }

        const res = await this.ipn?.fetch(request);
        if (!res) {
            return undefined;
        }

        if (!res.ok) {
            return undefined;
        }

        const jsResponse = new Response(res.body, {
            status: res.status,
            statusText: res.statusText,
            headers: res.headers,
        });

        return jsResponse;
    }

    async getPeers(): Promise<IPNNetMapPeerNode[]> {
        await this.initialize();
        await this.waitUntilReady();
        return this.ipn?.getPeers() ?? [];
    }

    async destroy(): Promise<void> {
        this.ipn?.logout();
        this.ipn = null;
        this.loginURL = null;
        this.initialized = false;
        this.currentState = "NoState";
        await this.ctx.storage.deleteAll();
        const keys = this.ctx.storage.kv.list();
        for (const [key] of keys) {
            this.ctx.storage.kv.delete(key);
        }

        durableObjectLogger.info("TS destroyed");
    }

}
