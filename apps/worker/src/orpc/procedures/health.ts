import { base } from "../base";

export const health = base
    .route({ method: "GET", path: "/health" })
    .handler(async ({ context }) => {
        return { "status": "ok" };
    });