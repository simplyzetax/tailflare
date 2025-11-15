import { base } from "../../base";

export const login = base
    .route({ method: "GET", path: "/login" })
    .handler(async ({ context }): Promise<string> => {
        const tailscale = context.Bindings.TAILSCALE.getByName(context.country, {
            locationHint: context.locationHint,
        });
        return await tailscale.login();
    });