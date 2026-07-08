# Example workflows — verified runner probes

Four GitHub Actions workflows, each empirically run on a GitHub-hosted `ubuntu-latest`
runner to establish what AI inference and web search are possible from CI. They are
kept here as **reference examples** (they do not auto-run from `examples/`; the live
copies live on their respective branches). Each has a matching write-up under
[`../../docs/research/`](../../docs/research/).

| Workflow | Question it answers | Token | Verified result | Write-up |
|---|---|---|---|---|
| `copilot-sdk-test.yml` | Can the GitHub Copilot CLI/SDK run inference on a runner? | Copilot **seat** token (`COPILOT_GITHUB_TOKEN`); built-in `GITHUB_TOKEN` fails | ✅ Works with a seat token; the `ghs_` app token is rejected | [`copilot-sdk-on-runners.md`](../../docs/research/copilot-sdk-on-runners.md) |
| `github-models-test.yml` | Can GitHub Models be called keyless from a runner, and which models? | Built-in `GITHUB_TOKEN` + `models: read` (**no secret**) | ✅ `gpt-5`/`o3`/etc. work keyless; no Claude/Gemini; use `max_completion_tokens` for gpt-5/o-series | [`github-models-on-runners.md`](../../docs/research/github-models-on-runners.md) |
| `web-search-test.yml` | Can a GitHub-native surface return **raw** web-search pointers (not summaries)? | Copilot seat token; negative control uses keyless `GITHUB_TOKEN` | ✅ Copilot CLI `web_search` returns raw `{title,url,snippet}`; bare GitHub Models has **no** web access | [`github-web-search.md`](../../docs/research/github-web-search.md) |
| `bing-search-test.yml` | Is the internal Bing "Fast Search API" usable from a runner? | Entra ID token (OIDC/SP) — none configured, so the probe checks reachability + auth-config only | ⚠️ Endpoint is **reachable** from a public runner (401, not blocked); needs Entra auth (admin-gated) | [`bing-search.md`](../../docs/research/bing-search.md) |

## Notes

- **Keyless vs seat vs Entra.** Only `github-models-test.yml` needs no secret at all. The two Copilot-based probes need a Copilot-seat token stored as `COPILOT_GITHUB_TOKEN`. The Bing probe needs an Entra ID token, which on a hosted runner requires an app registration + admin-consented app-role (see the write-up for the non-admin alternatives).
- **These are probes, not production workflows.** They print evidence (tool lists, HTTP codes, per-query URLs) and are meant to be read alongside their docs, not deployed as-is.
- The live, triggerable copies remain on branches `main` (`copilot-sdk-test`), `models-probe`, `web-search-probe`, and `bing-search-probe`.
