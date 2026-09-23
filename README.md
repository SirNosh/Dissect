<p align="center">
  <img src="packages/website/public/dissect.svg" width="72" height="72" alt="Dissect">
</p>

<h1 align="center">Dissect</h1>

<p align="center">
  An on-demand comprehension layer for your codebase and the changes coding agents make to it.
</p>

Dissect runs a local daemon that manages coding agents (Claude Code, Codex, Copilot, OpenCode, and Pi) and adds a comprehension layer: **Dissect** for the current tree, **Dissect Diff** for the last agent turn.

- **Local-first:** your code stays on your machine.
- **Agents:** run, monitor, and steer Claude Code, Codex, Copilot, OpenCode, and Pi from one app.
- **Comprehension:** architecture maps, file explanations, and block-level change analysis.
- **Clients:** desktop, web, and CLI.

Later dissections use what you have already been shown. **I know this** marks a concept or file comfortable, and **Explain more** asks for a deeper pass next time. The next explanation retrieves only the concepts and paths that match the file, diff, or question, plus the last explanation stored for those, and leaves the rest out. Explanation preferences stay stored and are not written into the prompt.

The project site is at <https://sirnosh.github.io/Dissect/>.

## Origin

Dissect started as a hackathon project built on [Paseo](https://github.com/getpaseo/paseo). Paseo is the original repository: the local daemon, the agent clients, and the desktop shell. Dissect keeps that foundation and adds the comprehension layer for the codebase and for the changes coding agents make.

## Install

Same shape as a global CLI install. The command name is `dissect`.

```bash
npm install -g github:SirNosh/Dissect
dissect
```

That starts the local daemon, then asks whether to enable the encrypted relay for device pairing. If you decline, connect over TCP, Tailscale, or another VPN.

### From a clone (recommended while developing)

```bash
git clone https://github.com/SirNosh/Dissect.git
cd Dissect
npm install
npm run build:server
npx dissect
```

`npx dissect` and `dissect` after `npm run link:cli` are the same CLI.

### Prerequisites

Install and authenticate at least one agent CLI:

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code)
- [Codex](https://github.com/openai/codex)
- [GitHub Copilot](https://github.com/features/copilot/cli/)
- [OpenCode](https://github.com/anomalyco/opencode)
- [Pi](https://pi.dev)

### Analysis API keys

File-level Dissect uses **Gemini**. Architecture maps use **Grok**.

1. Copy `packages/server/.env.example` to `packages/server/.env`.
2. Add your keys:

```bash
GEMINI_API_KEY=your-gemini-key
GROK_API_KEY=your-xai-key
```

Get a Gemini key from [Google AI Studio](https://aistudio.google.com/apikey). Get a Grok key from the [xAI console](https://console.x.ai/). `XAI_API_KEY` is accepted as an alias for `GROK_API_KEY`.

Optional model overrides:

```bash
GEMINI_MODEL=gemini-2.5-flash
GROK_MODEL=grok-4
```

Restart the daemon after changing keys. No analysis runs until you click Dissect or Dissect Diff.

### Desktop app

Build the Electron app from this checkout (`npm run build:desktop`) or use a GitHub release when one is published. Opening the app starts the daemon.

## CLI

```bash
dissect run --provider claude/opus-4.6 "implement user authentication"
dissect run --provider codex/gpt-5.5 --worktree feature-x "implement feature X"

dissect ls                           # list running agents
dissect attach abc123                # stream live output
dissect send abc123 "also add tests" # follow-up task
```

In this checkout, `npm run cli -- ls -a -g` still targets the checkout-local daemon home.

## Development

```bash
npm run dev          # daemon (checkout-local home)
npm run dev:app      # Expo web/native client
npm run dev:desktop  # Electron desktop
npm run build:server
npm run typecheck
```

Repo map:

- `packages/server` — daemon, agent lifecycle, WebSocket API, Dissect analysis
- `packages/app` — Expo client (iOS, Android, web)
- `packages/cli` — `dissect` CLI
- `packages/desktop` — Electron wrapper
- `packages/relay` — encrypted relay transport

See [docs/development.md](docs/development.md) and [docs/product.md](docs/product.md).

## License

Apache-2.0
