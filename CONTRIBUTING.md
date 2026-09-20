# Contributing to Dissect

Reports, docs, and focused fixes are welcome.

## Bugs

Open an issue at [SirNosh/Dissect](https://github.com/SirNosh/Dissect/issues). Include what you did, what you expected, the version, the platform, and logs or screenshots.

## Pull requests

1. Read [docs/coding-standards.md](docs/coding-standards.md) and [docs/testing.md](docs/testing.md).
2. Keep the change small and test the path you changed. Do not run the full suite locally.
3. Run `npm run typecheck`, `npm run lint`, and `npm run format` on the files you touched.
4. Do not commit `.env` files, daemon homes, or anything under `.dev/`.

Product direction lives in [docs/product.md](docs/product.md).
