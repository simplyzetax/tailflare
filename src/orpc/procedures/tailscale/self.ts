import { base } from "../../base";

export const self = base
    .route({ method: "GET", path: "/self" })
    .handler(async ({ context }): Promise<TailscaleSelf> => {
        const tailscale = context.Bindings.TAILSCALE.getByName(context.Variables.country);
        return await tailscale.getSelf();
    });
