import wasmBinary from "./tailscale.wasm";

type WebAssemblyInstantiateResult = WebAssembly.Instance | { instance: WebAssembly.Instance };

export async function createIPN(config: {
    stateStorage: { getState(key: string): string; setState(key: string, val: string): void };
    panicHandler: (msg: string) => void;
    controlURL?: string;
    authKey?: string;
}) {
    await import("./wasm_exec.js");
    // @ts-ignore
    const go = new Go();
	const result = (await WebAssembly.instantiate(wasmBinary, go.importObject)) as WebAssemblyInstantiateResult;
	const instance = result instanceof WebAssembly.Instance ? result : result.instance;
	go.run(instance).catch((err: any) => config.panicHandler(String(err)));

    return (globalThis).newIPN({
        hostname: "tailflare",
        controlURL: config.controlURL,
        stateStorage: config.stateStorage,
        authKey: config.authKey ?? "",
    });
}
