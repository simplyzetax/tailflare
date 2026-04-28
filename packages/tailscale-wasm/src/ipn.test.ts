import { beforeEach, describe, expect, it, vi } from 'vitest';

const wasmBinary = new ArrayBuffer(8);
const wasmInstance = { exports: {} };
const run = vi.fn<() => Promise<void>>();
const importObject = { env: { testImport: vi.fn() } };

vi.mock('./tailscale.wasm', () => ({ default: wasmBinary }));
vi.mock('./wasm_exec.js', () => ({}));

class FakeGo {
	importObject = importObject;
	run = run;
}

const globalWithWasm = globalThis as typeof globalThis & {
	Go: new () => FakeGo;
	newIPN: (config: IPNConfig) => IPN;
};

describe('createIPN', () => {
	beforeEach(() => {
		run.mockReset();
		run.mockResolvedValue(undefined);
		globalWithWasm.Go = FakeGo;
		globalWithWasm.newIPN = vi.fn(() => ({ login: vi.fn() }) as unknown as IPN);
		vi.spyOn(WebAssembly, 'instantiate').mockResolvedValue({ instance: wasmInstance } as never);
	});

	it('instantiates the wasm binary, starts Go, and returns the created IPN', async () => {
		const { createIPN } = await import('./ipn');
		const stateStorage = { getState: vi.fn(() => ''), setState: vi.fn() };
		const panicHandler = vi.fn();

		const ipn = await createIPN({ stateStorage, panicHandler });

		expect(WebAssembly.instantiate).toHaveBeenCalledWith(wasmBinary, importObject);
		expect(run).toHaveBeenCalledWith(wasmInstance);
		expect(globalWithWasm.newIPN).toHaveBeenCalledWith({
			authKey: '',
			controlURL: undefined,
			hostname: 'tailflare',
			stateStorage,
		});
		expect(ipn).toBe((globalWithWasm.newIPN as ReturnType<typeof vi.fn>).mock.results[0]?.value);
		expect(panicHandler).not.toHaveBeenCalled();
	});

	it('passes optional control URL and auth key to the wasm IPN factory', async () => {
		const { createIPN } = await import('./ipn');
		const stateStorage = { getState: vi.fn(() => ''), setState: vi.fn() };

		await createIPN({
			authKey: 'tskey-auth-test',
			controlURL: 'https://controlplane.test',
			panicHandler: vi.fn(),
			stateStorage,
		});

		expect(globalWithWasm.newIPN).toHaveBeenCalledWith({
			authKey: 'tskey-auth-test',
			controlURL: 'https://controlplane.test',
			hostname: 'tailflare',
			stateStorage,
		});
	});

	it('forwards asynchronous Go runtime failures to the panic handler', async () => {
		const { createIPN } = await import('./ipn');
		const panicHandler = vi.fn();
		run.mockRejectedValue(new Error('boom'));

		await createIPN({
			panicHandler,
			stateStorage: { getState: vi.fn(() => ''), setState: vi.fn() },
		});
		await Promise.resolve();

		expect(panicHandler).toHaveBeenCalledWith('Error: boom');
	});
});
