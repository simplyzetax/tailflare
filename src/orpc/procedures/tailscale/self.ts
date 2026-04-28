import { base } from "../../base";

export const self = base
    .route({ method: "GET", path: "/self" })
    .handler(async ({ context }): Promise<TailscaleSelf> => {
        const tailscale = context.base.Bindings.TAILSCALE.getByName(context.base.Variables.country);
        return await tailscale.getSelf();
    });
