import { health } from "./procedures/health";
import { login } from "./procedures/tailscale/login";
import { peers } from "./procedures/tailscale/peers";

export const router = {
    health,
    tailscale: {
        peers,
        login,
    }
} as const;