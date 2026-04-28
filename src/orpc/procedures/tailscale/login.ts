import { base } from "../../base";

export const login = base
    .route({ method: "GET", path: "/login" })
    .handler(async ({ context }): Promise<string> => {
        const tailscale = context.base.Bindings.TAILSCALE.getByName(context.base.Variables.country);
        return await tailscale.login();
    });