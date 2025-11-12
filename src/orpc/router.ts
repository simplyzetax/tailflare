import { health } from "./procedures/health";
import { login } from "./procedures/login";
import { peers } from "./procedures/peers";

export const router = {
    health,
    tailscale: {
        peers,
        login,
    }
} as const;