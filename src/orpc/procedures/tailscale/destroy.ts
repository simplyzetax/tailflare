import { base } from "../../base";

export const destroy = base
    .route({ method: "GET", path: "/destroy" })
    .handler(async ({ context }) => {
        const tailscale = context.base.Bindings.TAILSCALE.getByName(context.base.Variables.country);
        await tailscale.destroy();
        return { success: true };
    });