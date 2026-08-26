# AIRA Model Training Runbook

## 1. Use the committed isolated RX 9070 XT operator

Soup 0.73.3 declares support for Python 3.10–3.12 only. On the designated Windows RX 9070 XT workstation, do not improvise a system-wide Python/ROCm install. Use the committed operator from the repository root:

```powershell
powershell -ExecutionPolicy Bypass -File .\model-lab\scripts\windows\run-rx9070xt-smoke.ps1
```

The operator creates/uses `.venv-model-lab`, installs the reviewed AMD gfx1201 ROCm/PyTorch path, installs the exact Soup commit from `model-lab/requirements/soup-pin.txt`, materializes the exact smoke-model revision, runs Soup training and verifies the adapter.

For diagnostics without training:

```powershell
powershell -ExecutionPolicy Bypass -File .\model-lab\scripts\windows\run-rx9070xt-smoke.ps1 -ProbeOnly
```

Do not replace the pinned Soup commit with `main` during a recorded run.

## 2. Prove the backend before any 9B work

The host is `PARTIALLY_VERIFIED`, not `VERIFIED`, until Soup itself completes a train/load test on the physical RX 9070 XT.

The smoke operator owns this proof chain:

1. ROCm-enabled PyTorch imports and identifies the AMD accelerator/HIP runtime.
2. bitsandbytes and Soup import in the same isolated environment.
3. the exact `Qwen/Qwen3.5-0.8B` revision is materialized.
4. the smoke JSONL is inspected by Soup.
5. `soup train` completes against the locally pinned snapshot.
6. adapter tensors load.
7. deterministic base-vs-adapter logits differ, proving the adapter is active.

If the AMD path fails for a backend-specific reason, keep the failure evidence and reproduce the same pinned recipe on a supported NVIDIA Linux host only after the compute path is authorized. Do not silently switch recipes and call the environments equivalent.

## 3. Build the real Core dataset

`model-lab/data/manifests/core-v0.json` remains `training_allowed=false` until the evidence gates pass.

First validate the candidate catalog:

```powershell
python model-lab/scripts/prepare_core_dataset.py --validate-only
```

The real build refuses any selected source unless that source has:

- an exact revision;
- `approved_for_training=true`;
- approved license review;
- approved provenance review;
- approved contamination review.

After source review, build the normalized ChatML mixture:

```powershell
python model-lab/scripts/prepare_core_dataset.py
```

The builder writes ignored evidence and deterministic `train.jsonl`, `validation.jsonl` and `holdout.jsonl` files under `model-lab/data/core-v0/`. It applies high-confidence secret filtering, exact message deduplication and frozen-eval exact prompt collision removal.

Then run the independent lexical contamination gate:

```powershell
python model-lab/scripts/check_dataset_contamination.py `
  --output model-lab/data/core-v0/contamination-report.json
```

This gate checks normalized exact hashes plus indexed word-trigram Jaccard overlap. Passing it is necessary but not sufficient: source-specific/public-benchmark provenance checks are still required for release review.

Count real training tokens with the exact base tokenizer. Then generate a reviewable manifest proposal:

```powershell
python model-lab/scripts/promote_core_manifest.py `
  --token-count <EXACT_TOKEN_COUNT> `
  --output model-lab/data/core-v0/core-v0.promoted-manifest.json
```

The promotion operator never edits the committed manifest in place. It requires source approvals, split hashes/counts, secret/dedup evidence, a passing contamination report and an explicit positive tokenizer-derived token count.

Only after reviewing that proposal and its evidence should the committed manifest be deliberately promoted.

## 4. Baseline before tuning

Evaluate the untouched exact `Qwen/Qwen3.5-9B-Base` revision on the frozen AIRA suite before SFT. Save raw generations, model revision, sampling parameters, latency, token counts and scorer outputs.

For a locally materialized model/adapter path, the pinned Soup CLI supports custom JSONL evaluation as:

```powershell
soup eval custom `
  --tasks model-lab/eval/data/core-v0-sanity.jsonl `
  --model <LOCAL_MODEL_OR_ADAPTER_PATH> `
  --output model-lab/eval/reports/core-v0-soup-custom.json
```

The AIRA sanity JSONL uses Soup's supported `prompt` / `expected` schema and defaults to exact scoring.

For an OpenAI-compatible served endpoint, use the committed deterministic endpoint evaluator:

```powershell
python model-lab/scripts/run_exact_eval.py `
  --base-url "https://<inference-host>/v1" `
  --api-key-env AIRA_INFERENCE_API_KEY `
  --model aira/core `
  --output model-lab/eval/reports/core-v0-sanity.json
```

The six-item sanity suite is a pipeline/regression gate only; it is not evidence of frontier capability.

## 5. Core SFT

After the real manifest is explicitly promoted and the exact dataset exists:

```powershell
soup train --config model-lab/soup/core/sft.yaml
```

The initial recipe is a hypothesis: 1 epoch, LoRA r=32/alpha=64, 4-bit quantization. Change one meaningful factor at a time and record it. Enable `stream_layers` only after correctness is proven on the exact model/backend combination.

Track training/validation loss, throughput, peak memory, wall time, checkpoint/adapter size and any backend fallback. Abort/recover on NaNs, exploding loss, data corruption, label-mask defects, unexpected CPU execution or memory thrashing.

## 6. Regression and release gates

Run the frozen AIRA suites against both the untouched base and candidate. The initial exact suite must be expanded with adjacent-skill, coding, tool-calling, research/RAG, factuality, multilingual and catastrophic-forgetting coverage before release-candidate promotion.

The repository-level release evidence gate is:

```powershell
python model-lab/scripts/check_release_gate.py <EVIDENCE_JSON> --gate release-candidate
```

For production evidence:

```powershell
python model-lab/scripts/check_release_gate.py <EVIDENCE_JSON> --gate production
```

These gates fail closed when adapter activity, inference, evaluation, regression, license or production-serving evidence is missing.

## 7. Preference optimization

Use DPO/ORPO/SimPO/KTO/IPO only when SFT failure analysis identifies a preference problem and a high-quality pair dataset exists. Do not run algorithms merely because Soup supports them.

Preference data should favor verifiable behaviors such as correct citations over fabricated citations, real tool calls over pretend calls, valid structured output over malformed output and working patches over plausible broken code.

## 8. Export and serve

After a candidate passes:

```powershell
soup merge --adapter model-lab/artifacts/aira-core-v0
soup export --model model-lab/artifacts/aira-core-v0 --format gguf --quant q4_k_m
```

Treat the first quantization as an experiment, not a release default. Compare relevant supported quants for quality loss, size, memory, TTFT and tokens/sec.

Hosted serving must use a persistent inference service; Vercel remains the web/control surface, not the model host. Use `docs/models/DEPLOYMENT.md` for the committed inference and OmniRoute verification commands.

## Run evidence

Every serious run records: run ID, AIRA git SHA, Soup commit/version, exact base revision, dataset/split hashes, config hash, seed, GPU/driver/runtime, training metrics, eval report, artifact hash and promotion/rejection decision.
