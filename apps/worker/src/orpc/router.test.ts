import { env } from 'cloudflare:workers';
import { abortAllDurableObjects, runInDurableObject } from 'cloudflare:test';
import { call } from '@orpc/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tailflare/tailscale-wasm', () => ({ createIPN: vi.fn() }));

import { createIPN } from '@tailflare/tailscale-wasm';
import type { Tailscale } from '../durable-objects/tailscale';
import type { AppContext } from '../index';
import { router } from './router';

const self: IPNNetMapSelfNode = {
	name: 'tailflare.tailnet.ts.net',
	addresses: ['100.64.0.1', 'fd7a:115c:a1e0::1'],
	machineKey: 'mkey:self',
	nodeKey: 'nodekey:self',
	machineStatus: 'MachineAuthorized',
};

const peer: IPNNetMapPeerNode = {
	name: 'device.tailnet.ts.net',
	addresses: ['100.64.0.2'],
	machineKey: 'mkey:peer',
	nodeKey: 'nodekey:peer',
	tailscaleSSHEnabled: false,
};

type CreateIPNConfig = Parameters<typeof createIPN>[0];
type FakeIPN = IPN & {
	callbacks: IPNCallbacks | null;
	config: CreateIPNConfig;
	getPeers: ReturnType<typeof vi.fn<() => IPNNetMapPeerNode[]>>;
	getSelf: ReturnType<typeof vi.fn<() => IPNNetMapSelfNode | null>>;
	login: ReturnType<typeof vi.fn<() => void>>;
	logout: ReturnType<typeof vi.fn<() => void>>;
	route: ReturnType<typeof vi.fn<(path: string, handler: IPNRouteHandler) => void>>;
	run: ReturnType<typeof vi.fn<(callbacks: IPNCallbacks) => void>>;
};

const createIPNMock = vi.mocked(createIPN);
let consoleLog: ReturnType<typeof vi.spyOn> | null = null;

function asIPNResponse(response: Response): IPNResponse {
	return response as unknown as IPNResponse;
}

function createFakeIPN(config: CreateIPNConfig): FakeIPN {
	const fake = {
		callbacks: null,
		config,
		fetch: vi.fn(async () => asIPNResponse(new Response('upstream'))),
		getPeers: vi.fn(() => [peer]),
		getSelf: vi.fn(() => self),
		login: vi.fn(() => fake.callbacks?.notifyBrowseToURL('https://login.tailscale.com/a/test')),
		logout: vi.fn(),
		route: vi.fn(),
		run: vi.fn((callbacks: IPNCallbacks) => {
			fake.callbacks = callbacks;
			callbacks.notifyState('Running');
		}),
		ssh: vi.fn(() => ({ close: vi.fn(() => true), resize: vi.fn(() => true) })),
	} as unknown as FakeIPN;

	return fake;
}

function createContext(country: Iso3166Alpha2Code, request = new Request('https://tailflare.test/api/v1/me')) {
	return {
		base: {
			Bindings: env,
			Request: request,
			Variables: { country },
		} satisfies AppContext,
	};
}

async function createToken(country: Iso3166Alpha2Code) {
	return runInDurableObject<Tailscale, string>(env.TAILSCALE.getByName(country), (instance) => instance.createToken(peer));
}

beforeEach(() => {
	consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);
	createIPNMock.mockImplementation(async (config) => createFakeIPN(config));
});

afterEach(async () => {
	consoleLog?.mockRestore();
	await abortAllDurableObjects();
});

describe('oRPC router procedures', () => {
	it('returns the health payload', async () => {
		await expect(call(router.health, undefined, { context: createContext('DE') })).resolves.toEqual({ status: 'ok' });
	});

	it('returns the authenticated me response with live Tailscale context from the real env binding', async () => {
		const token = await createToken('FR');
		const request = new Request('https://tailflare.test/api/v1/me', {
			headers: { cookie: `tailflare_token=${encodeURIComponent(token)}` },
		});

		const result = await call(router.me, undefined, { context: createContext('FR', request) });

		expect(result.identity).toMatchObject({
			addresses: ['100.64.0.2'],
			machineKey: 'mkey:peer',
			name: 'device.tailnet.ts.net',
			nodeKey: 'nodekey:peer',
			subject: 'device.tailnet.ts.net',
		});
		expect(result.tailflare).toMatchObject({
			peerCount: 1,
			self: {
				addresses: ['100.64.0.1', 'fd7a:115c:a1e0::1'],
				name: 'tailflare.tailnet.ts.net',
			},
			status: 'available',
		});
	});

	it('rejects the me procedure without an authentication cookie', async () => {
		await expect(call(router.me, undefined, { context: createContext('GB') })).rejects.toMatchObject({
			code: 'UNAUTHORIZED',
			message: 'Missing authentication cookie',
			status: 401,
		});
	});

});
