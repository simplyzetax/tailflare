export async function tryCatch<T>(fn: () => Promise<T>): Promise<T | undefined> {
    try {
        return await fn();
    } catch (err) {
        return undefined;
    }
}