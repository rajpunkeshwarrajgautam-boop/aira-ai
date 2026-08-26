# AIRA Model Training Runbook

## 1. Create an isolated environment

Use Python 3.12. Soup 0.73.3 declares support for Python 3.10–3.12 only.

```powershell
py -3.12 -m venv .venv-soup
.\.venv-soup\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r model-lab/requirements/soup-pin.txt
soup doctor
```

Do not replace the pinned Soup commit with `main` during a recorded run.

## 2. Prove the backend first

On the RX 9070 XT workstation, verify ROCm-enabled PyTorch and bitsandbytes in the isolated environment. The host is `PARTIALLY_VERIFIED`, not `VERIFIED`, until Soup itself completes a train/load test.

Run the tiny smoke path before the 9B candidate:

```powershell
soup data inspect model-lab/data/smoke/core-smoke.jsonl
soup data lint model-lab/data/smoke/core-smoke.jsonl
soup train --config model-lab/soup/core/sft-smoke.yaml
```

Then load both the untouched base and produced adapter with deterministic prompts. Confirm adapter tensors are present and outputs change where expected.

If the AMD path fails for a backend-specific reason, keep the failure evidence and reproduce the same pinned recipe on a supported NVIDIA Linux host. Do not silently switch recipes and call the environments equivalent.

## 3. Build the real Core dataset

`model-lab/data/manifests/core-v0.json` currently has `training_allowed=false`. Do not run the 9B recipe until:

- every source is listed with provenance and revision;
- commercial/derivative training use is permitted;
- private/customer data is absent unless explicitly approved for a dedicated pipeline;
- exact and semantic deduplication are recorded;
- public and private eval contamination checks pass;
- train/validation splits are frozen;
- the manifest records actual example/token counts.

Use Soup data tooling for inspect/lint/stats/topics/dedup/split where compatible.

## 4. Baseline before tuning

Evaluate the untouched `Qwen/Qwen3.5-9B-Base`/appropriate chat baseline on the frozen AIRA suite before SFT. Save raw generations, model revision, sampling parameters, latency, token counts and scorer outputs.

## 5. Core SFT

After the manifest is enabled:

```powershell
soup train --config model-lab/soup/core/sft.yaml
```

The initial recipe is a hypothesis: 1 epoch, LoRA r=32/alpha=64, 4-bit quantization. Change one meaningful factor at a time and record it. Enable `stream_layers` only after correctness is proven on the exact model/backend combination.

## 6. Regression gate

```powershell
soup eval gate --suite model-lab/eval/configs/core-v0-gate.yaml --model model-lab/artifacts/aira-core-v0
```

Expand the gate with frozen adjacent-skill and catastrophic-forgetting suites before candidate promotion.

## 7. Preference optimization

Use DPO/ORPO/SimPO/KTO/IPO only when SFT failure analysis identifies a preference problem and a high-quality pair dataset exists. Do not run algorithms merely because Soup supports them.

## 8. Export and serve

After a candidate passes:

```powershell
soup merge --adapter model-lab/artifacts/aira-core-v0
soup export --model model-lab/artifacts/aira-core-v0 --format gguf --quant q4_k_m
```

Benchmark quantization loss before choosing a deployment quant. Hosted serving must use a persistent inference service; Vercel remains the web/control surface, not the model host.

## Run evidence

Every serious run records: run ID, AIRA git SHA, Soup commit/version, base revision, dataset hash, config hash, seed, GPU/driver/runtime, training metrics, eval report, artifact hash and promotion/rejection decision.
