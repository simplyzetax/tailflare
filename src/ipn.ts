import "./wasm_exec.js";
import wasmBinary from "./main.wasm";

export async function createIPN(config: {
    authKey: string;
    panicHandler?: (msg: string) => void;
}) {
    // @ts-ignore
    const go = new Go();

    // wasmBinary is a Module, so instantiate returns the instance directly
    const instance = await WebAssembly.instantiate(wasmBinary, go.importObject);

    // DEBUG
    console.log("Calling go.run(instance)...");
    console.log("instance.exports:", Object.keys(instance.exports));
    console.log("instance type:", instance.constructor.name);

    go.run(instance).catch((err: any) => {
        config.panicHandler?.(String(err));
    });

    // newIPN attached by WASM runtime
    // @ts-ignore
    return (globalThis as any).newIPN({
        authKey: config.authKey
    });
}
