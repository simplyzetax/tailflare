import { health } from "./procedures/health";
import { login } from "./procedures/tailscale/login";
import { peers } from "./procedures/tailscale/peers";
import { destroy } from "./procedures/tailscale/destroy";

export const router = {
    health,
    tailscale: {
        peers,
        login,
        destroy,
    }
} as const;