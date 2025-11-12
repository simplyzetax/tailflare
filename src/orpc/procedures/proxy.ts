import { errors } from "../../utils/errors";
import { tryCatch } from "../../utils/try";
import { base } from "../base";
import { z } from "zod";

export const proxy = base
    .route({ method: "GET", path: "/proxy" })
    .input(z.object({
        url: z.string(),
    }))
    .handler(async ({ input, context }): Promise<Response> => {
        const tailscale = context.Bindings.TAILSCALE.getByName("singleton");

        const request = new Request(input.url, {
            method: "GET",
            headers: {},
            body: null,
        });

        const response = await tailscale.proxy(request);
        if (!response) throw errors.tailscale.proxyFailed.toResponse();

        return response;
    });