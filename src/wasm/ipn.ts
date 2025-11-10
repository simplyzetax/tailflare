import "./wasm_exec.js";
import wasmBinary from "./tailscale.wasm";

export async function createIPN(config: {
    stateStorage: { getState(key: string): string; setState(key: string, val: string): void };
    panicHandler: (msg: string) => void;
    controlURL?: string;
    authKey?: string;
}) {
    // @ts-ignore
    const go = new Go();
    const instance = await WebAssembly.instantiate(wasmBinary, go.importObject);
    go.run(instance).catch((err: any) => config.panicHandler(String(err)));

    return (globalThis).newIPN({
        hostname: "tailflare",
        controlURL: config.controlURL,
        stateStorage: config.stateStorage,
        authKey: config.authKey ?? "",
    });
}
