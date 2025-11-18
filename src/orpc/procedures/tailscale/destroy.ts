import { base } from "../../base";

export const destroy = base
    .route({ method: "GET", path: "/destroy" })
    .handler(async ({ context }) => {
        const tailscale = context.Bindings.TAILSCALE.getByName(context.country, {
            locationHint: context.locationHint,
        });
        await tailscale.destroy();
        return { success: true };
    });