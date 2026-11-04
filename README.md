<img src="https://i.imgur.com/EjG5URU.png" alt="Tailflare Logo" width="512" height="165" style="vertical-align: middle; margin-right: 16px;">

Seamlessly connect Cloudflare Workers to your private Tailscale network. Run a persistent Tailscale node inside a Durable Object to securely proxy traffic from the edge to your Tailnet devices, or restrict an entire Worker to users who can prove they are on your tailnet.

---

## What is Tailflare?

Tailflare embeds a full Tailscale node (via WASM) within a Cloudflare Durable Object, giving Workers secure, low-latency access to your private network resources. It maintains a stable node identity, handles interactive authentication, provides a simple HTTP proxy interface, and can issue Worker login tokens only to devices reachable through your tailnet.

```text
┌─────────────┐      ┌────────────────────┐      ┌────────────────┐      ┌──────────────┐
│   Worker    │─────▶│  Durable Object    │─────▶│ Tailscale IPN  │─────▶│  Your Tailnet│
│             │      │  (Persistent WASM) │      │   (WASM)       │      │   Devices    │
└─────────────┘      └────────────────────┘      └────────────────┘      └───────────────┘
```

---

## Features

- **Tailnet-Gated Worker Access**: Require users to prove tailnet membership before accessing protected Worker routes
- **Persistent Identity**: Machine keys and node state survive Durable Object restarts
- **Interactive Login**: Browser-based authentication flow via Worker endpoints
- **HTTP Proxy**: Simple `/proxy?url=http://target:port` interface
- **Automatic Reconnection**: Self-healing connection to your Tailnet
- **Global Edge Access**: Leverage Cloudflare's network from anywhere

---

## Quick Start

### Prerequisites

- [Cloudflare account](https://dash.cloudflare.com) with Workers Paid plan (Durable Objects requirement)
- [Tailscale account](https://login.tailscale.com/admin/settings/keys) with reusable auth key
- Node.js 18+ and pnpm installed

### Install

```bash
git clone https://github.com/simplyzetax/tailflare
cd tailflare
pnpm install
pnpm wasm:build
```

### Deploy

```bash
# Development
bun run dev

# Production
bun run deploy
```

---

## Usage

### 1. Authenticate with Tailscale

Visit your Worker's `/api/v1/login` endpoint and follow the authentication flow:

```bash
curl https://your-worker.your-subdomain.workers.dev/api/v1/login
# Redirects to Tailscale login page
```

### 2. Proxy Requests

Send HTTP requests to any device in your Tailnet:

```bash
# Proxy to internal service
curl "https://your-worker.your-subdomain.workers.dev/api/v1/proxy?url=http://finns-macbook-air.taild2803.ts.net:8080/api/status"

# Proxy with path
curl "https://your-worker.your-subdomain.workers.dev/api/v1/proxy?url=http://finns-macbook-air.taild2803.ts.net:3000/metrics"
```

### 3. Gate Worker Access With Your Tailnet

Tailflare can also protect Worker routes by requiring the browser to prove it can reach the Durable Object's Tailscale node. Only devices on your tailnet can complete the login, and on those it is invisible: visiting `/me` signs you in with no clicks.

```bash
open https://your-worker.your-subdomain.workers.dev/me
# or start explicitly, with an optional same-origin return path:
open "https://your-worker.your-subdomain.workers.dev/api/v1/notouchlogin?redirect=/me"
```

The flow is redirect-only (no cross-origin `fetch`, so HTTPS mixed-content rules don't get in the way):

1. `GET /api/v1/notouchlogin` sets a short-lived nonce cookie and redirects to `http://<tailflare tailnet IP>/api/v1/notouchlogin?state=<signed state>`.
2. That address is only reachable over Tailscale. The Durable Object resolves the source IP to a tailnet peer, signs a 3-hour session JWT for it, and redirects back to the Worker callback with a **single-use, 60-second code** (the JWT itself never appears in a URL).
3. `/api/v1/notouchlogin/callback` checks the signed state and nonce cookie (so a login can't be completed in a different browser), redeems the code, sets the HTTP-only `tailflare_token` cookie, and redirects to the requested path.

Browsers that already have a valid session skip the round trip. Failures land on `/me?login_error=…`, which shows the reason and a retry button instead of looping.

The `/me` page is a Vite + React SPA route styled with Tailwind CSS. It uses a typed oRPC client against the `/rpc` transport to load the current user from the `me` procedure, including verified JWT claims and live Tailflare/Tailscale context.

---

## How It Works

1. **Durable Object as a Tailscale Node**: Each Durable Object instance runs a WASM-compiled Tailscale IPN engine, maintaining persistent state and cryptographic identity.

2. **Synchronous Storage**: Node configuration, machine keys, and WireGuard state are stored in the Durable Object's transactional storage for instant recovery.

3. **Worker-Interface Separation**: The stateless Worker handles HTTP requests while the Durable Object manages the long-running Tailscale connection.

4. **Proxy Gateway**: HTTP requests are forwarded through the Tailscale interface, enabling Workers to reach private IPs, hostnames, and services.

5. **Tailnet Proof for Worker Login**: The Durable Object listens on its own Tailscale IP, serves a token endpoint over MagicDNS, and signs a short-lived JWT only after resolving the request's source IP to a known Tailscale peer.

---

## Development

| Command           | Action                 |
| ----------------- | ---------------------- |
| `bun run dev`     | Start Vite + Cloudflare dev server |
| `bun run build`   | Build Worker and React SPA |
| `bun run test`    | Run Vitest tests |
| `bun run typecheck` | Run TypeScript checks |
| `bun run deploy`  | Build and deploy to production |

---

## Limitations

- Durable Objects have [pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) based on requests and duration
- Each Durable Object represents a single Tailscale node
- WebSocket connections not yet supported

---

## Contributing

Issues and pull requests welcome! Please read our [Contributing Guide](CONTRIBUTING.md) for details.

---

## License

MIT License - see [LICENSE](LICENSE) file for details.
