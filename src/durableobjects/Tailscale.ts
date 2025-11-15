import { DurableObject } from "cloudflare:workers";
import { createIPN } from "../wasm/ipn";
import { durableObjectLogger } from "../utils/logger";
import { errors } from "../utils/errors";

const HEX_RE = /^[0-9a-fA-F]*$/;

export class Tailscale extends DurableObject<Env> {
    private ipn: IPN | null = null;
    private loginURL: string | null = null;
    private currentState: IPNState = "NoState";

    // Initializing the Tailscale runtime in the constructor is EXPERIMENTAL and may be removed in the future.
    constructor(state: DurableObjectState, env: Env) {
        super(state, env);
        this.ctx.blockConcurrencyWhile(async () => {
            await this.initialize()
            while (this.currentState !== "Running" && this.currentState !== "NeedsLogin") {
                await new Promise((resolve) => setTimeout(resolve, 10));
            }
            durableObjectLogger.info("Tailscale initialized with state:", { state: this.currentState });
            this.ctx.storage.kv.put("peers", JSON.stringify(this.getPeers()));
        });
    }

    private async initialize() {
        if (this.currentState !== "NoState") return;

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
            notifyNetMap: (_nmJSON: string) => {
                /*durableObjectLogger.info("TS netmap:", { nmJSON });*/
            },
            notifyBrowseToURL: (url: string) => {
                this.loginURL = url;
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

        const peers = this.getPeers();
        const peer = peers.find((p) => p.name.startsWith(new URL(request.url).hostname + '.'));
        if (!peer) {
            return errors.tailscale.peerNotFound.toResponse();
        }

        const requests = this.ctx.storage.kv.get<number>("requests");
        this.ctx.storage.kv.put("requests", (requests ?? 0) + 1);

        switch (this.currentState) {
            case "NeedsLogin":
                return errors.tailscale.notAuthenticated.toResponse();
            case "Running":
                break;
            default:
                return errors.tailscale.networkUnavailable.withMessage(`Tailscale is not initialized, its curent state is: ${this.currentState}`).toResponse();
        }

        const res = await this.ipn?.fetch(request);
        if (!res?.ok) {
            return errors.tailscale.proxyFailed.withMessage(`Failed to proxy request, got status: ${res?.status}`).toResponse();
        }

        return new Response(res.body, res);
    }

    getPeers(): IPNNetMapPeerNode[] {
        const peers = this.ipn?.getPeers() ?? [];
        this.ctx.storage.kv.put("peers", JSON.stringify(peers));
        return peers;
    }

    async destroy(): Promise<void> {
        this.ipn?.logout();
        this.ipn = null;
        this.loginURL = null;
        this.currentState = "NoState";
        await this.ctx.storage.deleteAll();
        const keys = this.ctx.storage.kv.list();
        for (const [key] of keys) {
            this.ctx.storage.kv.delete(key);
        }

        durableObjectLogger.info("TS destroyed");
    }

}
