import { DurableObject } from 'cloudflare:workers';
import { createIPN } from '@tailflare/tailscale-wasm';
import { durableObjectLogger } from '../utils/logger';
import { errors } from '../utils/errors';
import {
	getSigningKey,
	htmlPage,
	LOGIN_CODE_TTL_MS,
	NOTOUCH_PATH,
	randomToken,
	signSession,
	verifyLoginState,
} from '../auth/notouch';

const LOGIN_CODE_PREFIX = 'notouch:code:';

type StoredLoginCode = { token: string; nonce: string; expiresAt: number };

const HEX_RE = /^[0-9a-fA-F]*$/;

export class Tailscale extends DurableObject<Env> {
	private ipn: IPN | null = null;
	private loginURL: string | null = null;
	private loginURLPromise: Promise<string> | null = null;
	private loginURLResolver: ((url: string) => void) | null = null;
	private currentState: IPNState = 'NoState';
	private readonly bindings: Env;

	// Initializing the Tailscale runtime in the constructor is EXPERIMENTAL and may be removed in the future.
	constructor(state: DurableObjectState, env: Env) {
		super(state, env);
		this.bindings = env;
		this.ctx.blockConcurrencyWhile(async () => {
			await this.initialize();
			while (this.currentState !== 'Running' && this.currentState !== 'NeedsLogin') {
				await new Promise((resolve) => setTimeout(resolve, 10));
			}
			durableObjectLogger.info('Tailscale initialized with state:', { state: this.currentState });
		});
	}

	private async initialize() {
		if (this.currentState !== 'NoState') return;

		this.ipn = await createIPN({
			stateStorage: {
				getState: (key: string): string => {
					const v = this.ctx.storage.kv.get(key);
					return typeof v === 'string' && HEX_RE.test(v) ? v : '';
				},
				setState: (key: string, value: string): void => {
					if (HEX_RE.test(value)) {
						this.ctx.storage.kv.put(key, value);
					}
				},
			},
			panicHandler: (msg) => durableObjectLogger.error('TS panic:', { msg }),
		});

		this.ipn.run({
			notifyState: (state: IPNState) => {
				this.currentState = state;
				durableObjectLogger.info('TS state:', { state });
			},
			notifyNetMap: (_nmJSON: string) => {
				/*durableObjectLogger.info("TS netmap:", { nmJSON });*/
			},
			notifyBrowseToURL: (url: string) => {
				this.loginURL = url;
				if (this.loginURLResolver) {
					this.loginURLResolver(url);
					this.loginURLResolver = null;
					this.loginURLPromise = null;
				}
			},
			notifyPanicRecover: (err: string) => {
				durableObjectLogger.info('TS panic recovered:', { err });
			},
			notifyPacket: (packet: IPNPacket) => {
				// noop
				durableObjectLogger.info('TS packet:', { packet: JSON.stringify(packet) });
			},
		});

		this.ipn.route(NOTOUCH_PATH, (request) => this.handleNoTouchLogin(request));
	}

	/**
	 * Served on this node's tailnet address only. Reaching it proves the browser is on the tailnet:
	 * we identify the source peer, mint a single-use code bound to the login state, and bounce the
	 * browser back to the Worker callback that started the flow.
	 */
	private async handleNoTouchLogin(request: IPNRouteRequest): Promise<Response> {
		const key = getSigningKey(this.bindings.AUTH_SECRET);
		const stateToken = new URL(request.url).searchParams.get('state');
		const state = stateToken ? await verifyLoginState(stateToken, key) : null;
		if (!stateToken || !state) {
			return htmlPage('Login link expired', 'Start signing in again from the Tailflare site.', 400);
		}

		const sourcePeer = this.getPeerByAddress(request.sourceIP);
		if (!sourcePeer) {
			durableObjectLogger.info('No-touch login from unknown source', { sourceIP: request.sourceIP });
			return htmlPage('Device not recognised', 'This request did not come from a known device on the tailnet.', 403);
		}

		const token = await this.createToken(sourcePeer);
		const code = randomToken();
		this.pruneLoginCodes();
		this.ctx.storage.kv.put(`${LOGIN_CODE_PREFIX}${code}`, {
			token,
			nonce: state.nonce,
			expiresAt: Date.now() + LOGIN_CODE_TTL_MS,
		} satisfies StoredLoginCode);

		const callback = new URL(state.callback);
		callback.searchParams.set('code', code);
		callback.searchParams.set('state', stateToken);

		return new Response(null, {
			status: 303,
			headers: {
				Location: callback.toString(),
				'Cache-Control': 'no-store',
				'Referrer-Policy': 'no-referrer',
			},
		});
	}

	/** Exchanges a single-use login code for a session token. Returns null if unknown, expired or not bound to this nonce. */
	redeemLoginCode(code: string, nonce: string): string | null {
		const key = `${LOGIN_CODE_PREFIX}${code}`;
		const entry = this.ctx.storage.kv.get<StoredLoginCode>(key);
		if (!entry) return null;
		this.ctx.storage.kv.delete(key);
		if (entry.expiresAt < Date.now() || entry.nonce !== nonce) return null;
		return entry.token;
	}

	private pruneLoginCodes() {
		const now = Date.now();
		for (const [key, value] of this.ctx.storage.kv.list<StoredLoginCode>({ prefix: LOGIN_CODE_PREFIX })) {
			if (value.expiresAt < now) this.ctx.storage.kv.delete(key);
		}
	}

	async login(): Promise<string> {
		if (this.loginURL) {
			return this.loginURL;
		}

		if (!this.loginURLPromise) {
			this.loginURLPromise = new Promise<string>((resolve) => {
				this.loginURLResolver = resolve;
			});
		}

		const loginURLPromise = this.loginURLPromise;
		this.ipn?.login();
		return loginURLPromise;
	}

	needsLogin(): boolean {
		return this.currentState === 'NeedsLogin';
	}

	async proxy(request: Request): Promise<Response | undefined> {
		const peers = this.getPeers();
		const peer = peers.find((p) => p.name.startsWith(new URL(request.url).hostname + '.'));
		if (!peer) {
			return errors.tailscale.peerNotFound.toResponse();
		}

		const requests = this.ctx.storage.kv.get<number>('requests');
		this.ctx.storage.kv.put('requests', (requests ?? 0) + 1);

		switch (this.currentState) {
			case 'NeedsLogin':
				return errors.tailscale.notAuthenticated.toResponse();
			case 'Running':
				break;
			default:
				return errors.tailscale.networkUnavailable
					.withMessage(`Tailscale is not initialized, its curent state is: ${this.currentState}`)
					.toResponse();
		}

		const res = await this.ipn?.fetch(request);
		if (!res?.ok) {
			return errors.tailscale.proxyFailed.withMessage(`Failed to proxy request, got status: ${res?.status}`).toResponse();
		}

		return new Response(res.body, res);
	}

	getPeers(): IPNNetMapPeerNode[] {
		const peers = this.ipn?.getPeers() ?? [];
		return peers;
	}

	getPeerByAddress(address: string): IPNNetMapPeerNode | undefined {
		return this.getPeers().find((peer) => peer.addresses.includes(address));
	}

	getSelf(): TailscaleSelf {
		const self = this.ipn?.getSelf();

		return {
			name: self?.name ?? null,
			magicDNSName: self?.name ?? null,
			host: self?.name?.split('.')[0] ?? null,
			addresses: self?.addresses ?? [],
			ipv4: self?.addresses.find((address) => !address.includes(':')) ?? null,
			ipv6: self?.addresses.find((address) => address.includes(':')) ?? null,
			machineKey: self?.machineKey ?? null,
			nodeKey: self?.nodeKey ?? null,
			machineStatus: self?.machineStatus ?? null,
		};
	}

	async createToken(node: IPNNetMapNode): Promise<string> {
		return signSession(node, getSigningKey(this.bindings.AUTH_SECRET));
	}

	async destroy(): Promise<void> {
		this.ipn?.logout();
		this.ipn = null;
		this.loginURL = null;
		this.loginURLPromise = null;
		this.loginURLResolver = null;
		this.currentState = 'NoState';
		await this.ctx.storage.deleteAll();
		const keys = this.ctx.storage.kv.list();
		for (const [key] of keys) {
			this.ctx.storage.kv.delete(key);
		}

		durableObjectLogger.info('TS destroyed');
	}
}
