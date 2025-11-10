import { DurableObject } from "cloudflare:workers";
import { createIPN } from "../ipn";

const HEX_RE = /^[0-9a-fA-F]*$/;

export class Tailscale extends DurableObject<Env> {
    private ipn: any | null = null;
    private loginURL: string | null = null;
    private initialized = false;
    private readyPromise: Promise<void> | null = null;
    private resolveReady!: () => void;
    private isReady = false;
    private currentState: string = "NoState";

    private hydratedMap = new Map<string, string>();

    private hydrate() {
        // load ALL keys
        for (const [key, value] of this.ctx.storage.kv.list()) {
            if (typeof value === "string" && HEX_RE.test(value)) {
                this.hydratedMap.set(key, value);
            }
        }
        const lu = this.hydratedMap.get("loginURL");
        if (typeof lu === "string") this.loginURL = lu;
    }

    private getStateStorage() {
        return {
            getState: (key: string): string => {
                // ✅ always read from memory, not storage
                const v = this.hydratedMap.get(key);
                return (typeof v === "string" && HEX_RE.test(v)) ? v : "";
            },
            setState: (key: string, value: string): void => {
                if (HEX_RE.test(value)) {
                    // update memory first
                    this.hydratedMap.set(key, value);
                    // persist asynchronously
                    this.ctx.storage.kv.put(key, value);
                }
            },
        };
    }

    private async initialize() {
        if (this.initialized) return;
        this.initialized = true;

        this.readyPromise = new Promise((resolve) => {
            this.resolveReady = resolve;
        });

        // ✅ MUST hydrate before creating IPN
        this.hydrate();

        this.ipn = await createIPN({
            stateStorage: this.getStateStorage(),
            panicHandler: (msg) => console.error("TAILSCALE PANIC:", msg),
        });

        this.ipn.run({
            notifyState: (state: string) => {
                this.currentState = state;
                console.log("TS state:", state);

                if (state === "Running" && !this.isReady) {
                    this.isReady = true;
                    this.resolveReady();
                }
            },
            notifyNetMap: (nmJSON: string) => {
                console.log("TS netmap:", nmJSON);
            },
            notifyBrowseToURL: (url: string) => {
                // store login URL in both caches
                this.loginURL = url;
                this.hydratedMap.set("loginURL", url);
                this.ctx.storage.kv.put("loginURL", url);
            },
            notifyPanicRecover: (err: string) => {
                console.log("TS panic recovered:", err);
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
        this.ipn.login();

        while (!this.loginURL) {
            await new Promise((resolve) => setTimeout(resolve, 100));
        }

        return this.loginURL;
    }

    async proxy(url: string): Promise<string | undefined> {
        await this.initialize();

        // ✅ If login needed → return proper message
        if (this.currentState === "NeedsLogin") {
            return undefined;
        }

        // ✅ If starting → wait
        if (!this.isReady) {
            await this.waitUntilReady();
        }

        const res = await this.ipn.fetch(url);
        console.log(res);
        console.log(res.constructor.name);
        return await res.text();
    }

}
