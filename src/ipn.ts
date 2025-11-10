import "./wasm_exec.js";
import wasmBinary from "./main.wasm";

export async function createIPN(config: {
    // NOTE: sync functions (no Promises!)
    stateStorage: {
        getState(key: string): string | null;
        setState(key: string, val: string): void;
    };
    panicHandler?: (msg: string) => void;
    controlURL?: string;
    authKey?: string; // optional for first run, usually ""
}) {
    // @ts-ignore
    const go = new Go();
    const instance = await WebAssembly.instantiate(wasmBinary, go.importObject);

    console.log(wasmBinary.byteLength)
    console.log(new Uint8Array(wasmBinary).slice(0, 256))

    go.run(instance).catch((err: any) => {
        config.panicHandler?.(String(err));
    });

    return (globalThis as any).newIPN({
        controlURL: config.controlURL,
        stateStorage: {
            getState: (k: string) => config.stateStorage.getState(k),
            setState: (k: string, v: string) => config.stateStorage.setState(k, v),
        },
        authKey: config.authKey ?? "",
    });
}
