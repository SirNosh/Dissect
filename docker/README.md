# Dissect Docker Image

This directory contains the daemon image build used by this repository.

The image runs the daemon headless and serves the bundled web UI from the same
HTTP origin. Build and run it from this checkout, then open the daemon URL.

```bash
docker build -t dissect -f docker/Dockerfile .
docker run -d --name dissect \
  -p 6767:6767 \
  -e PASEO_PASSWORD=change-me \
  -v "$PWD/dissect-home:/home/dissect" \
  -v "$PWD:/workspace" \
  dissect
```

Then open `http://localhost:6767`.

The base image intentionally does not bundle agent CLIs. Extend it with the
agents you use:

```Dockerfile
FROM ghcr.io/getpaseo/paseo:latest

USER root
RUN npm install -g @openai/codex @anthropic-ai/claude-code
```

See [docs/docker.md](../docs/docker.md) for Compose, reverse proxy, security,
agent auth, and troubleshooting notes.
