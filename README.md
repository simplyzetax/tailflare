> [!WARNING]
> **Security Notice:** This project does not implement authentication or authorization.
> All Tailscale endpoints (`/login`, `/proxy`, `/ready`, etc.) are publicly accessible without
> any authentication. Anyone with access to your Worker URL can authenticate with your
> Tailscale account and proxy requests to devices in your Tailnet.
> **Do not deploy this in production without adding proper authentication.**

<img src="https://i.imgur.com/EjG5URU.png" alt="Tailflare Logo" width="256" height="128" style="vertical-align: middle; margin-right: 16px;">

Seamlessly connect Cloudflare Workers to your private Tailscale network. Run a persistent Tailscale node inside a Durable Object to securely proxy traffic from the edge directly to your Tailnet devices.

---

## What is Tailflare?

Tailflare embeds a full Tailscale node (via WASM) within a Cloudflare Durable Object, giving Workers secure, low-latency access to your private network resources. It maintains a stable node identity, handles interactive authentication, and provides a simple HTTP proxy interface.

```text
┌─────────────┐      ┌────────────────────┐      ┌────────────────┐      ┌──────────────┐
│   Worker    │─────▶│  Durable Object    │─────▶│ Tailscale IPN  │─────▶│  Your Tailnet│
│             │      │  (Persistent WASM) │      │   (WASM)       │      │   Devices    │
└─────────────┘      └────────────────────┘      └────────────────┘      └───────────────┘
```

---

## Features

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
pnpm run dev

# Production
pnpm run deploy
```

---

## Usage

### 1. Authenticate with Tailscale

Visit your Worker's `/login` endpoint and follow the authentication flow:

```bash
curl https://your-worker.your-subdomain.workers.dev/login
# Redirects to Tailscale login page
```

### 2. Check Node Status

Verify your Durable Object is ready:

```bash
curl https://your-worker.your-subdomain.workers.dev/ready
# Returns: { "ready": true } if the Durable Object is ready
# Returns: { "ready": false } if the Durable Object is not ready
```

### 3. Proxy Requests

Send HTTP requests to any device in your Tailnet:

```bash
# Proxy to internal service
curl "https://your-worker.your-subdomain.workers.dev/proxy?url=http://finns-macbook-air.taild2803.ts.net:8080/api/status"

# Proxy with path
curl "https://your-worker.your-subdomain.workers.dev/proxy?url=http://finns-macbook-air.taild2803.ts.net:3000/metrics"
```

---

## How It Works

1. **Durable Object as a Tailscale Node**: Each Durable Object instance runs a WASM-compiled Tailscale IPN engine, maintaining persistent state and cryptographic identity.

2. **Synchronous Storage**: Node configuration, machine keys, and WireGuard state are stored in the Durable Object's transactional storage for instant recovery.

3. **Worker-Interface Separation**: The stateless Worker handles HTTP requests while the Durable Object manages the long-running Tailscale connection.

4. **Proxy Gateway**: HTTP requests are forwarded through the Tailscale interface, enabling Workers to reach private IPs, hostnames, and services.

---

## Development

| Command           | Action                 |
| ----------------- | ---------------------- |
| `pnpm run dev`    | Start local dev server |
| `pnpm run deploy` | Deploy to production   |
| `pnpm run test`   | Run test suite         |

---

## Limitations

- Durable Objects have [pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) based on requests and duration
- Each Durable Object represents a single Tailscale node
- Max request size limited by Workers runtime (100MB)
- WebSocket connections not yet supported

---

## Contributing

Issues and pull requests welcome! Please read our [Contributing Guide](CONTRIBUTING.md) for details.

---

## License

MIT License - see [LICENSE](LICENSE) file for details.
