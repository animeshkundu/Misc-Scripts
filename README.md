# Misc-Scripts

A grab-bag repository for small utilities, one-off scripts, and infrastructure
experiments. Its current focus is a body of research and verified probes into
**what AI inference and web search are possible from GitHub Actions runners**, and
how those pieces assemble into an autonomous, human-gated blogging pipeline.

## Structure

```
docs/
  research/     Research + empirical findings (start at docs/research/README.md)
  blueprint/    A living "how we think about building products" methodology doc
examples/
  workflows/    Four verified runner probes, as reference examples
.github/
  workflows/    The live copilot-sdk-test workflow (others live on probe branches)
```

## Research

[`docs/research/README.md`](docs/research/README.md) is the index and through-line.
In short, all verified on real runs:

- **GitHub Models** works keyless from a runner (`GITHUB_TOKEN` + `models: read`) —
  `gpt-5`/`o3`-class, no Claude/Gemini.
- **Copilot CLI/SDK** works with a Copilot **seat** token (the built-in `ghs_`
  token is rejected), and its `web_search` tool returns **raw** source pointers.
- The internal **Bing "Fast Search API"** returns raw hits and is reachable from a
  public runner, but its Entra auth is admin-gated (works locally / on a
  self-hosted runner via your own login).
- The **orchestration spine** already exists in-house as
  [`condukt`](https://github.com/animeshkundu/condukt); the recommended blog stack
  is Astro + Zod, publishing via PR-merge.

## Example workflows

[`examples/workflows/`](examples/workflows/) holds the four probes with a README
mapping each to its findings. They are reference examples (they do not auto-run
from `examples/`); the live, triggerable copies are on branches `main`,
`models-probe`, `web-search-probe`, and `bing-search-probe`.

## Secrets

- `COPILOT_GITHUB_TOKEN` — a Copilot-seat user token, used by the Copilot CLI/SDK
  probes. Provisioned as an encrypted repo secret; never printed.
- The GitHub Models probe needs **no** secret (built-in `GITHUB_TOKEN` +
  `permissions: models: read`).
