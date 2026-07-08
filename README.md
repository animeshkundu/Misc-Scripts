# Misc-Scripts

Misc scripts and experiments.

A grab-bag repository for small utilities, one-off scripts, and infrastructure experiments.

## Experiments

### Copilot SDK on Runner probe

`.github/workflows/copilot-sdk-test.yml` empirically tests whether the official
GitHub Copilot CLI (`@github/copilot`) can run non-interactively on a
GitHub-hosted Actions runner, and under which token. It runs two jobs:

- **builtin-token** — attempts inference with the runner's built-in
  `GITHUB_TOKEN` (an app `ghs_` token, expected to be rejected by Copilot).
- **user-pat** — attempts inference with a repo secret `COPILOT_GITHUB_TOKEN`
  holding a user token that carries a Copilot entitlement.

Each job prints the CLI version and `--help`, then runs a single
non-interactive prompt (`copilot -p "..." --allow-all-tools`) and captures the
exit code and output regardless of success.
