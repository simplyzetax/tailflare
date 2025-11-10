import { DurableObject } from "cloudflare:workers";
import { createIPN } from "./ipn";

const HEX_RE = /^[0-9a-fA-F]*$/;

export class TailscaleDO extends DurableObject<Env> {
    ipn: any | null = null;
    loginURL: string | null = null;
    initialized = false;

    // in-memory cache for sync stateStorage
    private stateCache = new Map<string, string>();

    constructor(ctx: DurableObjectState, env: Env) {
        super(ctx, env);
    }

    private async hydrateCache() {
        const list = await this.ctx.storage.list();
        for (const [key] of list) {
            const val = await this.ctx.storage.get<string>(key);
            if (typeof val === "string" && HEX_RE.test(val)) {
                this.stateCache.set(key, val);
            }
        }
        const lu = await this.ctx.storage.get<string>("loginURL");
        if (typeof lu === "string") this.loginURL = lu;
    }


    getStateStorage() {
        return {
            // MUST return "" (empty string) when key is missing or invalid.
            getState: (key: string): string => {
                const v = this.stateCache.get(key);
                if (typeof v !== "string") return "";        // not found
                if (!HEX_RE.test(v)) return "";              // reject garbage -> "not exist"
                return v;
            },
            setState: (key: string, value: string): void => {
                if (!HEX_RE.test(value)) return;             // never store non-hex
                this.stateCache.set(key, value);
                this.ctx.storage.put(key, value).catch(console.error);
            },
        };
    }

    async initialize() {
        if (this.initialized) return;
        this.initialized = true;

        // hydrate cache from persistent storage first
        await this.hydrateCache();

        this.ipn = await createIPN({
            stateStorage: this.getStateStorage(),
            panicHandler: (msg) => console.error("TAILSCALE PANIC:", msg),
            // interactive login / persistent identity mode -> usually no authKey
            authKey: "",
        });

        this.ipn.run({
            notifyState: (state: string) => {
                console.log("TS state:", state);
                if (state === "NeedsLogin") {
                    console.log("Tailscale requires login, visit /login to begin.");
                }
            },
            notifyNetMap: (nmJSON: string) => {
                console.log("TS netmap:", nmJSON);
            },
            notifyBrowseToURL: (url: string) => {
                console.log("TS LOGIN URL:", url);
                this.loginURL = url;
                this.ctx.storage.put("loginURL", url).catch(console.error);
            },
            notifyPanicRecover: (err: string) => {
                console.log("TS panic recovered:", err);
            },
        });
    }

    private triggerLogin() {
        console.log("Triggering interactive login...");
        this.ipn.login();
    }

    private async fetchRemote(url: string): Promise<string> {
        const res = await this.ipn.fetch(url);
        return await res.text();
    }

    async fetch(request: Request): Promise<Response> {
        const url = new URL(request.url);

        // wipe corrupted state (use if you ever see “invalid byte: '<'” again)
        if (url.pathname === "/wipe") {
            await this.ctx.storage.deleteAll();
            this.stateCache.clear();
            this.ipn = null;
            this.initialized = false;
            this.loginURL = null;
            return new Response("State wiped. Restart and /login again.");
        }

        await this.initialize();

        if (url.pathname === "/state") {
            // Optional: show cached keys for debugging
            const keys = Array.from(this.stateCache.keys()).join(", ");
            return new Response(`OK: tailscale initialized; keys: ${keys}`);
        }

        if (url.pathname === "/login") {
            this.triggerLogin();
            return new Response("Login started. Use /login-url to retrieve the login link.");
        }

        if (url.pathname === "/login-url") {
            if (this.loginURL) {
                return new Response(this.loginURL);
            } else {
                return new Response("No login URL yet — call /login first.", { status: 404 });
            }
        }

        if (url.pathname === "/proxy") {
            const target = url.searchParams.get("url");
            if (!target) return new Response("Missing ?url=", { status: 400 });
            const body = await this.fetchRemote(target);
            return new Response(body, { status: 200 });
        }

        return new Response("Tailscale DO ready — use /state, /login, /login-url, /proxy, /wipe");
    }
}

export default {
    async fetch(request, env, ctx) {
        const stub = env.TAILSCALE_DO.getByName("singleton");
        return stub.fetch(request);
    },
} satisfies ExportedHandler<Env>;
