# Agent instructions

<!-- ZEN-COMMON:START -->
<!-- Managed block. Canonical source: zen-hub/docs/agents/zen-common-agents.md.
     Do not edit between the ZEN-COMMON markers in target repos — edit the
     canonical file and run zen-hub/scripts/sync-zen-common.sh. -->

## Language policy

- Talk to the human user in **Russian**.
- Documents meant to be read by the user — ADRs, PRDs, handoffs, READMEs, issues, proposals — are written in **Russian**.
- Source code, commits, configs, comments, and agent-machinery artifacts (skills, instructions for other agents) are in **English**.
- Glossary terms keep their English names: when a Russian doc names a term, write the English name in square brackets — `[component]`, `[base]` — so it is clear the word comes from the glossary.

## Versions and library APIs

- Anything **new** built on Bun (new repos, services, scripts, docker images) targets **Bun 1.4+**: set it in `.mise.toml` / the `oven/bun` base image tag. Existing pins (e.g. zen-platform on 1.3.x) are not bumped by this rule — they upgrade on their own schedule.
- Never take version numbers (tools, dependencies, docker images, actions) from model memory — only from commands (`mise ls-remote <tool>`, `bun pm view <pkg> version`, `npm view`, `gh api`) or from repo files (`.mise.toml`, lockfiles). The Bun 1.4+ floor above is a policy minimum, not a snapshot — take the exact patch from `mise ls-remote bun`.
- Library APIs and signatures are also not to be taken from model memory — check via the context7 MCP when it is available in the repo.

## Auto-formatting

- Files may be auto-formatted by biome right after Write/Edit (a global harness hook; no-op in repos without a biome config). A formatting diff after writing is expected — do not re-edit files purely for formatting.
<!-- ZEN-COMMON:END -->

## Project identity

- project: dzenanalytics
- registry: https://github.com/velios/zen-hub/blob/main/docs/registry.md
