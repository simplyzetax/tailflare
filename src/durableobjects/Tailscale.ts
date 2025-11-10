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

    // Initializing the Tailscale runtime in the constructor is EXPERIMENTAL and may be removed in the future.
    constructor(state: DurableObjectState, env: Env) {
        super(state, env);
        this.ctx.blockConcurrencyWhile(async () => {
            await this.initialize()
            while (!this.isReady && this.currentState !== "NeedsLogin") {
                await new Promise((resolve) => setTimeout(resolve, 10));
            }
            durableObjectLogger.info("Tailscale initialized with state:", { state: this.currentState });
        });
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
                /*durableObjectLogger.info("TS netmap:", { nmJSON });*/
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

    async login(): Promise<string> {
        this.ipn?.login();

        while (!this.loginURL) {
            await new Promise((resolve) => setTimeout(resolve, 100));
        }

        return this.loginURL;
    }

    async proxy(request: Request): Promise<Response | undefined> {

        if (this.currentState === "NeedsLogin") {
            return undefined;
        }

        const res = await this.ipn?.fetch(request);
        if (!res) {
            return undefined;
        }

        if (!res.ok) {
            return undefined;
        }

        const jsResponse = new Response(res.body, res.clone());

        return jsResponse;
    }

    async getPeers(): Promise<IPNNetMapPeerNode[]> {
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
