# AIRA Model Program — Discovery Report

Date: 2026-08-26

## 1. Repository state

- Repository: `rajpunkeshwarrajgautam-boop/aira-ai`
- Source integration branch inspected: `feature/omniroute-gateway`
- Inspected source HEAD: `acf5289c60bbbe03a8a8ee1a9fc0764f8e22c11a`
- Model-program branch: `feature/aira-model-family-soup`, created directly from that source HEAD
- PR #92: open, draft, unmerged; base `main`, head `feature/omniroute-gateway`
- PR #92 at inspection time: 175 commits / 115 changed files
- No force-push or merge was performed.
- Connected GitHub exposes committed remote state rather than a developer's local worktree; therefore local uncommitted filesystem changes are not asserted here. The model branch is anchored to the exact committed SHA above.

## 2. Current AIRA architecture

The application lives under `perplexity-clone/my-turborepo/apps/web` and currently uses Next.js 16.3, React 19, Auth.js/next-auth 5 beta, Prisma 7, PostgreSQL, Zod and the OpenAI client library. The Prisma schema owns durable users/auth, billing, usage, conversations/messages, research history, memories, agent runs/events/approvals and related state.

Production PostgreSQL is Supabase-hosted. Supabase is also used by optional private object-storage/knowledge paths, but the application auth/data abstraction is Prisma/Auth.js rather than a browser-direct Supabase auth architecture.

Grounded research requires Exa. AutoGPT and DeerFlow remain separate agent runtimes.

## 3. Current provider/model architecture

The application provider router can register OpenAI, NVIDIA and OmniRoute. It contains circuit/health handling, residency checks, safety/publication boundaries and pre-publication fallback behavior.

The product invariant is explicit in code:

- Free tier primary: NVIDIA
- Free/pro fallback: NVIDIA
- Pro primary default: OmniRoute

AIRA-native models must join this abstraction; they must not replace it.

## 4. OmniRoute integration points

Current routing aliases are:

- `auto`
- `auto/smart`
- `auto/coding`
- `auto/fast`
- `auto/cheap`
- `auto/offline`

Explicit selections are accepted only when the model ID was returned by OmniRoute discovery. This is the correct truth boundary for future `aira/*` IDs.

PR #92 remains intentionally unmerged until its live OmniRoute deployment/inference/preview gates pass.

## 5. Soup architecture/version

Inspected upstream: `MakazhanAlpamys/Soup`

Pinned commit for this scaffold:

`6c13c44f5eb6bef67bbd39d83ec7269ac3c31dbf`

Upstream package metadata at that commit declares:

- `soup-cli` 0.73.3
- Apache-2.0
- Python `>=3.10,<3.13`
- lightweight base CLI plus optional `[train]`, `[eval]`, `[data]`, `[serve]` stacks
- Transformers 5.12.1+ floor in the training stack for Qwen3.5 handling

Soup provides the required offline model-engineering surfaces: SFT/preference training, PEFT, data tooling, eval design/gates, diagnostics, merge/export, GGUF export and OpenAI-compatible serving.

## 6. Soup compatibility assessment

Status: `PARTIALLY_VERIFIED`

Verified statically/upstream:

- Qwen3.5 is explicitly represented in Soup's current model docs/catalog.
- Qwen3.5 text-only selection uses the causal-language-model path.
- Upstream has dedicated Qwen3.5 Transformers/text-modality/streaming regression tests.
- Current config schema and CLI support the required SFT/LoRA/quantization/eval/export workflow.

Not yet verified in AIRA's execution environment:

- installed pinned Soup dependency;
- real `soup doctor` output;
- a completed AIRA smoke training run;
- adapter load/delta verification;
- GGUF export of an AIRA candidate.

## 7. Local AMD training feasibility

Status: `PARTIALLY_VERIFIED`

Workstation target: Windows 11, Ryzen 7 9700X, RX 9070 XT 16 GiB (`gfx1201`), 32 GiB system RAM.

Current AMD Windows ROCm/HIP documentation lists RX 9070 XT / gfx1201 support, and current bitsandbytes ROCm packaging includes Windows gfx1201 paths. Soup itself continues to describe CUDA as the recommended GPU path rather than guaranteeing this exact Windows+ROCm combination.

Promotion to `VERIFIED` requires a real isolated Python 3.12 Soup smoke train plus adapter-load verification on that host. No system-wide nightly GPU stack is authorized by this program.

## 8. Candidate foundation models

First selected research candidate:

`Qwen/Qwen3.5-9B-Base` for AIRA Core v0.

Reasons:

- appropriate first serious Core size class;
- downstream fine-tuning/PEFT intent;
- Apache-2.0 model family release;
- Soup's explicit current Qwen3.5 text-only/Transformers support;
- tractable enough to falsify the model-factory hypothesis before moving to 30B/70B+ work.

This is not a claim that it is the strongest possible 9B base. The final release-candidate selection remains benchmark-driven.

## 9. Recommended tier mapping

- Edge: 1B–4B, local/low-latency specialization
- Core: 7B–10B, first serious general assistant — active research tier
- Pro: 12B–16B, stronger coding/research/reasoning per dollar
- Ultra: 30B–35B or efficient equivalent
- Apex: frontier-scale dense/MoE/hybrid; architecture intentionally unlocked

## 10. Training architecture

`provenance-reviewed data -> Soup -> adapter/checkpoint -> frozen evaluation -> regression decision -> merge/export`

Soup stays outside the Next.js/Vercel runtime.

## 11. Evaluation architecture

Two complementary suites:

1. standardized public benchmarks;
2. private frozen AIRA product evaluations for tools, research/RAG/citations, repository coding, agents, business and English/Hindi/Hinglish.

All candidate comparisons keep raw-model and system-with-tools results separate and require statistical uncertainty rather than one-shot score ordering.

## 12. Deployment architecture

`AIRA artifact -> persistent inference server -> OpenAI-compatible endpoint -> OmniRoute discovery -> existing AIRA provider router / Compare`

Vercel is not the large-model inference host.

## 13. Primary risks

1. Windows+RX 9070 XT Soup training has not been executed yet.
2. The real Core dataset is not assembled/licensed/frozen yet.
3. Benchmark contamination can invalidate apparent gains if the data/eval boundary is weak.
4. A training win may regress tool calling, factuality, structured output or multilingual behavior.
5. A model can be technically trained but operationally unusable because serving cost/latency or OmniRoute integration fails.
6. The open OmniRoute deployment gate in PR #92 remains an external dependency for end-to-end hosted AIRA-native serving.

## 14. Exact first implementation step

Create a fail-closed model-lab scaffold pinned to Soup 0.73.3, add provenance/eval contracts and a typed AIRA tier registry that exposes no model unless OmniRoute discovers it, then run the 0.8B Qwen3.5 smoke recipe before any 9B training.

That scaffold is the scope of the first model-program commit. The next hardware-dependent action is the pinned smoke train, not Apex/70B training.
