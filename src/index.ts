import { DurableObject } from "cloudflare:workers";
import { createIPN } from "./ipn";

export class TailscaleDO extends DurableObject<Env> {
    ipn: any | null = null;
    loginURL: string | null = null;
    initialized: boolean = false;

    constructor(ctx: DurableObjectState, env: Env) {
        super(ctx, env);
    }

    async initialize() {
        if (this.initialized) return;
        this.initialized = true;

        // interactive login requires empty authKey
        this.ipn = await createIPN({
            authKey: "",
            panicHandler: (msg) => console.error("TAILSCALE PANIC:", msg),
        });

        // register event callbacks from Tailscale WASM
        this.ipn.run({
            notifyState: (state: string) => {
                console.log("TS state:", state);
            },

            notifyNetMap: (nmJSON: string) => {
                console.log("TS netmap:", nmJSON);
            },

            notifyBrowseToURL: (url: string) => {
                console.log("TS LOGIN URL:", url); // important!
                this.loginURL = url;
                // persist it so next fetch sees it
                this.ctx.storage.put("loginURL", url).catch(console.error);
            },

            notifyPanicRecover: (err: string) => {
                console.log("TS panic recovered:", err);
            },
        });

        // restore login URL if stored previously
        const stored = await this.ctx.storage.get("loginURL");
        if (stored) this.loginURL = stored as string;
    }

    // call ipn.login() to trigger interactive auth
    triggerLogin() {
        console.log("Triggering interactive login...");
        this.ipn.login();
    }

    // proxy an HTTP request through Tailscale netstack
    async fetchRemote(url: string): Promise<string> {
        const res = await this.ipn.fetch(url);
        return await res.text();
    }

    async fetch(request: Request): Promise<Response> {
        await this.initialize();

        const url = new URL(request.url);

        // just report engine state
        if (url.pathname === "/state") {
            return new Response("OK: tailscale initialized");
        }

        // trigger tailscale interactive login
        if (url.pathname === "/login") {
            this.triggerLogin();
            return new Response("Login started. Use /login-url to retrieve the login link.");
        }

        // return last login URL
        if (url.pathname === "/login-url") {
            if (this.loginURL) {
                return new Response(this.loginURL);
            } else {
                return new Response("No login URL yet — call /login first.", { status: 404 });
            }
        }

        // proxy request into tailnet
        if (url.pathname === "/proxy") {
            const target = url.searchParams.get("url");
            if (!target) return new Response("Missing ?url=", { status: 400 });

            const body = await this.fetchRemote(target);
            return new Response(body, { status: 200 });
        }

        return new Response("Tailscale DO ready — use /state, /login, /login-url, /proxy");
    }
}

export default {
    async fetch(request, env, ctx) {
        const stub = env.TAILSCALE_DO.getByName("singleton");
        return stub.fetch(request);
    },
} satisfies ExportedHandler<Env>;
