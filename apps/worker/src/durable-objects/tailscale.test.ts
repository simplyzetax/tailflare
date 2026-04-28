import { env } from 'cloudflare:workers';
import { abortAllDurableObjects, runInDurableObject } from 'cloudflare:test';
import * as jose from 'jose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tailflare/tailscale-wasm', () => ({ createIPN: vi.fn() }));

import { createIPN } from '@tailflare/tailscale-wasm';
import { Tailscale } from './tailscale';

const peer: IPNNetMapPeerNode = {
	name: 'device.tailnet.ts.net',
	addresses: ['100.64.0.2', 'fd7a:115c:a1e0::2'],
	machineKey: 'mkey:peer',
	nodeKey: 'nodekey:peer',
	tailscaleSSHEnabled: false,
};

const self: IPNNetMapSelfNode = {
	name: 'tailflare.tailnet.ts.net',
	addresses: ['100.64.0.1', 'fd7a:115c:a1e0::1'],
	machineKey: 'mkey:self',
	nodeKey: 'nodekey:self',
	machineStatus: 'MachineAuthorized',
};

type CreateIPNConfig = Parameters<typeof createIPN>[0];
type TailscalePrivateFields = {
	currentState: IPNState;
	ipn: IPN | null;
	loginURL: string | null;
	loginURLPromise: Promise<string> | null;
	loginURLResolver: ((url: string) => void) | null;
};
type FakeIPNOptions = {
	peers?: IPNNetMapPeerNode[];
	self?: IPNNetMapSelfNode | null;
	state?: IPNState;
};
type FakeIPN = IPN & {
	callbacks: IPNCallbacks | null;
	config: CreateIPNConfig;
	fetch: ReturnType<typeof vi.fn<(request: Request) => Promise<IPNResponse>>>;
	getPeers: ReturnType<typeof vi.fn<() => IPNNetMapPeerNode[]>>;
	getSelf: ReturnType<typeof vi.fn<() => IPNNetMapSelfNode | null>>;
	login: ReturnType<typeof vi.fn<() => void>>;
	logout: ReturnType<typeof vi.fn<() => void>>;
	route: ReturnType<typeof vi.fn<(path: string, handler: IPNRouteHandler) => void>>;
	routes: Map<string, IPNRouteHandler>;
	run: ReturnType<typeof vi.fn<(callbacks: IPNCallbacks) => void>>;
	ssh: ReturnType<typeof vi.fn<() => IPNSSHSession>>;
};

const createIPNMock = vi.mocked(createIPN);
let createdIPNs: FakeIPN[] = [];
let nextIPNOptions: FakeIPNOptions = {};
let consoleLog: ReturnType<typeof vi.spyOn> | null = null;

function asIPNResponse(response: Response): IPNResponse {
	return response as unknown as IPNResponse;
}

function createFakeIPN(config: CreateIPNConfig, options: FakeIPNOptions): FakeIPN {
	const routes = new Map<string, IPNRouteHandler>();
	const fake = {
		callbacks: null,
		config,
		fetch: vi.fn(async () => asIPNResponse(new Response('upstream'))),
		getPeers: vi.fn(() => options.peers ?? [peer]),
		getSelf: vi.fn(() => ('self' in options ? options.self : self) ?? null),
		login: vi.fn(() => fake.callbacks?.notifyBrowseToURL('https://login.tailscale.com/a/test')),
		logout: vi.fn(),
		route: vi.fn((path: string, handler: IPNRouteHandler) => routes.set(path, handler)),
		routes,
		run: vi.fn((callbacks: IPNCallbacks) => {
			fake.callbacks = callbacks;
			callbacks.notifyState(options.state ?? 'Running');
		}),
		ssh: vi.fn(() => ({ close: vi.fn(() => true), resize: vi.fn(() => true) })),
	} as unknown as FakeIPN;

	return fake;
}

function getStub() {
	return env.TAILSCALE.get(env.TAILSCALE.newUniqueId());
}

function useNextIPN(options: FakeIPNOptions) {
	nextIPNOptions = options;
}

async function readError(response: Response | IPNResponse | undefined) {
	return response?.json() as Promise<{ errorCode: string; errorMessage: string }>;
}

beforeEach(() => {
	createdIPNs = [];
	nextIPNOptions = {};
	consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);
	createIPNMock.mockImplementation(async (config) => {
		const ipn = createFakeIPN(config, nextIPNOptions);
		createdIPNs.push(ipn);
		return ipn;
	});
});

afterEach(async () => {
	consoleLog?.mockRestore();
	await abortAllDurableObjects();
});

describe('Tailscale durable object', () => {
	it('initializes the IPN runtime with Durable Object storage and route callbacks', async () => {
		const result = await runInDurableObject<Tailscale, Record<string, unknown>>(getStub(), async (instance, state) => {
			const fake = createdIPNs[0];
			fake.config.stateStorage.setState('valid', 'deadBEEF');
			fake.config.stateStorage.setState('invalid', 'not-hex');

			return {
				createIPNCalls: createIPNMock.mock.calls.length,
				currentState: (instance as unknown as TailscalePrivateFields).currentState,
				invalidState: fake.config.stateStorage.getState('invalid'),
				invalidStored: state.storage.kv.get('invalid') ?? null,
				routePaths: [...fake.routes.keys()],
				runCalls: fake.run.mock.calls.length,
				validState: fake.config.stateStorage.getState('valid'),
			};
		});

		expect(result).toEqual({
			createIPNCalls: 1,
			currentState: 'Running',
			invalidState: '',
			invalidStored: null,
			routePaths: ['/api/v1/notouchlogin'],
			runCalls: 1,
			validState: 'deadBEEF',
		});
	});

	it('maps the self node into the public self shape', async () => {
		const result = await runInDurableObject(getStub(), (instance: Tailscale) => instance.getSelf());

		expect(result).toEqual({
			name: 'tailflare.tailnet.ts.net',
			magicDNSName: 'tailflare.tailnet.ts.net',
			host: 'tailflare',
			addresses: ['100.64.0.1', 'fd7a:115c:a1e0::1'],
			ipv4: '100.64.0.1',
			ipv6: 'fd7a:115c:a1e0::1',
			machineKey: 'mkey:self',
			machineStatus: 'MachineAuthorized',
			nodeKey: 'nodekey:self',
		});
	});

	it('returns null self fields before IPN has a self node', async () => {
		useNextIPN({ self: null });

		const result = await runInDurableObject(getStub(), (instance: Tailscale) => instance.getSelf());

		expect(result).toEqual({
			name: null,
			magicDNSName: null,
			host: null,
			addresses: [],
			ipv4: null,
			ipv6: null,
			machineKey: null,
			machineStatus: null,
			nodeKey: null,
		});
	});

	it('finds peers by Tailscale address', async () => {
		const result = await runInDurableObject(getStub(), (instance: Tailscale) => ({
			missing: instance.getPeerByAddress('100.64.0.99'),
			peer: instance.getPeerByAddress('fd7a:115c:a1e0::2'),
			peers: instance.getPeers(),
		}));

		expect(result).toEqual({
			missing: undefined,
			peer,
			peers: [peer],
		});
	});

	it('starts login through IPN and caches the received login URL', async () => {
		const result = await runInDurableObject(getStub(), async (instance: Tailscale) => {
			const firstURL = await instance.login();
			const secondURL = await instance.login();
			const fake = createdIPNs[0];

			return {
				firstURL,
				loginCalls: fake.login.mock.calls.length,
				secondURL,
			};
		});

		expect(result).toEqual({
			firstURL: 'https://login.tailscale.com/a/test',
			loginCalls: 1,
			secondURL: 'https://login.tailscale.com/a/test',
		});
	});

	it('creates a signed token for a Tailscale node', async () => {
		const token = await runInDurableObject(getStub(), async (instance: Tailscale) => {
			return instance.createToken(peer);
		});

		const { payload } = await jose.jwtVerify(token, new TextEncoder().encode(env.AUTH_SECRET));
		expect(payload).toMatchObject({
			addresses: peer.addresses,
			machineKey: peer.machineKey,
			name: peer.name,
			nodeKey: peer.nodeKey,
			sub: peer.name,
		});
		expect(payload.exp).toBeGreaterThan(payload.iat as number);
	});

	it('serves the no-touch login IPN route for a known source peer', async () => {
		const result = await runInDurableObject(getStub(), async () => {
			const fake = createdIPNs[0];
			const handler = fake.routes.get('/api/v1/notouchlogin');
			if (!handler) throw new Error('Route was not registered');

			const response = await handler({
				destinationIP: '100.64.0.1',
				destinationPort: 80,
				headers: {},
				method: 'GET',
				path: '/api/v1/notouchlogin',
				sourceIP: '100.64.0.2',
				sourcePort: 443,
				url: 'http://tailflare/api/v1/notouchlogin',
			});

			const workerResponse = response as Response;

			return {
				cors: workerResponse.headers.get('Access-Control-Allow-Origin'),
				contentType: workerResponse.headers.get('Content-Type'),
				status: workerResponse.status,
				token: await workerResponse.text(),
			};
		});

		const { payload } = await jose.jwtVerify(result.token, new TextEncoder().encode(env.AUTH_SECRET));
		expect(result).toMatchObject({
			cors: '*',
			contentType: 'text/plain; charset=utf-8',
			status: 200,
		});
		expect(payload.sub).toBe(peer.name);
	});

	it('rejects the no-touch login IPN route for an unknown source peer', async () => {
		const result = await runInDurableObject(getStub(), async () => {
			const fake = createdIPNs[0];
			const handler = fake.routes.get('/api/v1/notouchlogin');
			if (!handler) throw new Error('Route was not registered');
			const response = await handler({
				destinationIP: '100.64.0.1',
				destinationPort: 80,
				headers: {},
				method: 'GET',
				path: '/api/v1/notouchlogin',
				sourceIP: '100.64.0.99',
				sourcePort: 443,
				url: 'http://tailflare/api/v1/notouchlogin',
			});

			return { body: await readError(response), status: response.status };
		});

		expect(result).toEqual({
			body: {
				errorCode: 'errors.tailflare.tailscale.peerNotFound',
				errorMessage: 'Peer not found',
				intent: 'unknown',
				numericErrorCode: 3000,
				originatingService: 'tailflare',
			},
			status: 404,
		});
	});

	it('rejects proxy requests when the target peer cannot be found', async () => {
		const result = await runInDurableObject(getStub(), async (instance: Tailscale) => {
			const response = await instance.proxy(new Request('https://missing'));
			return { body: await readError(response), status: response?.status };
		});

		expect(result.status).toBe(404);
		expect(result.body).toMatchObject({ errorCode: 'errors.tailflare.tailscale.peerNotFound' });
	});

	it('rejects proxy requests while Tailscale needs login', async () => {
		const result = await runInDurableObject(getStub(), async (instance: Tailscale, state) => {
			createdIPNs[0].callbacks?.notifyState('NeedsLogin');
			const response = await instance.proxy(new Request('https://device'));

			return {
				body: await readError(response),
				requests: state.storage.kv.get('requests'),
				status: response?.status,
			};
		});

		expect(result).toMatchObject({
			body: { errorCode: 'errors.tailflare.tailscale.notAuthenticated' },
			requests: 1,
			status: 401,
		});
	});

	it('rejects proxy requests while Tailscale is not running', async () => {
		const result = await runInDurableObject(getStub(), async (instance: Tailscale) => {
			createdIPNs[0].callbacks?.notifyState('Starting');
			const response = await instance.proxy(new Request('https://device'));

			return { body: await readError(response), status: response?.status };
		});

		expect(result).toMatchObject({
			body: {
				errorCode: 'errors.tailflare.tailscale.networkUnavailable',
				errorMessage: 'Tailscale is not initialized, its curent state is: Starting',
			},
			status: 503,
		});
	});

	it('returns an error when the upstream proxy response is not ok', async () => {
		const result = await runInDurableObject(getStub(), async (instance: Tailscale) => {
			createdIPNs[0].fetch.mockResolvedValue(asIPNResponse(new Response('bad gateway', { status: 502 })));
			const response = await instance.proxy(new Request('https://device'));

			return { body: await readError(response), status: response?.status };
		});

		expect(result).toMatchObject({
			body: {
				errorCode: 'errors.tailflare.tailscale.proxyFailed',
				errorMessage: 'Failed to proxy request, got status: 502',
			},
			status: 500,
		});
	});

	it('proxies successful upstream responses', async () => {
		const result = await runInDurableObject(getStub(), async (instance: Tailscale, state) => {
			const request = new Request('https://device/api', { method: 'POST' });
			createdIPNs[0].fetch.mockResolvedValue(
				asIPNResponse(new Response('upstream body', { headers: { 'X-Upstream': 'yes' }, status: 202 })),
			);

			const response = await instance.proxy(request);

			return {
				body: await response?.text(),
				fetchURL: createdIPNs[0].fetch.mock.calls[0]?.[0].url,
				header: response?.headers.get('X-Upstream'),
				requests: state.storage.kv.get('requests'),
				status: response?.status,
			};
		});

		expect(result).toEqual({
			body: 'upstream body',
			fetchURL: 'https://device/api',
			header: 'yes',
			requests: 1,
			status: 202,
		});
	});

	it('logs out, clears transient state, and deletes persisted keys on destroy', async () => {
		const result = await runInDurableObject(getStub(), async (instance: Tailscale, state) => {
			const harness = instance as unknown as TailscalePrivateFields;
			const fake = createdIPNs[0];
			state.storage.kv.put('state', 'abcd');
			harness.loginURL = 'https://login.tailscale.com/a/cached';
			harness.loginURLPromise = Promise.resolve('https://login.tailscale.com/a/cached');
			harness.loginURLResolver = vi.fn();

			await instance.destroy();

			return {
				currentState: harness.currentState,
				ipn: harness.ipn,
				loginURL: harness.loginURL,
				loginURLPromise: harness.loginURLPromise,
				loginURLResolver: harness.loginURLResolver,
				logoutCalls: fake.logout.mock.calls.length,
				remainingKeys: [...state.storage.kv.list()].map(([key]) => key),
			};
		});

		expect(result).toEqual({
			currentState: 'NoState',
			ipn: null,
			loginURL: null,
			loginURLPromise: null,
			loginURLResolver: null,
			logoutCalls: 1,
			remainingKeys: [],
		});
	});
});
