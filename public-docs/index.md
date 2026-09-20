---
title: Getting started
description: Install Dissect and start running coding agents from your machine.
nav: Getting started
order: 1
category: Getting started
---

# Getting started

Dissect runs coding agents on your machine and explains the codebase and the changes those agents make. Desktop, web, and CLI clients talk to a local daemon.

## CLI

```bash
npm install -g github:SirNosh/Dissect
dissect
```

Dissect starts the daemon locally, then asks whether to enable the end-to-end encrypted relay and print a pairing QR code. If you decline, enter the daemon address manually over TCP, Tailscale, or another VPN.

From a clone:

```bash
git clone https://github.com/SirNosh/Dissect.git
cd Dissect
npm install
npm run build:server
npx dissect
```

Configuration and local state live under the daemon home directory (defaults to `~/.paseo`).

## Desktop app

Build from this checkout with `npm run build:desktop`, or download a GitHub release when one is published. Open the app and the daemon starts automatically.

## Docker

Build the image from this repository, then run it:

```bash
docker build -t dissect -f docker/Dockerfile .
docker run -d --name dissect \
  -p 6767:6767 \
  -e PASEO_PASSWORD=change-me \
  -v "$PWD/dissect-home:/home/dissect" \
  -v "$PWD:/workspace" \
  dissect
```

Then open `http://localhost:6767`. See [docs/docker.md](/docs/docker.md) for Compose and security notes.
