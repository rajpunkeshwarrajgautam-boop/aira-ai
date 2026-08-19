# AIRA offline model-training plane

This directory defines AIRA's operator-controlled post-training boundary. It does **not** make the web application a training controller and it does not imply that a model has been trained.

## Stage contract

1. **SFT**: instruction/multi-turn behavior from validated demonstrations.
2. **Reward**: optional pairwise preference scorer used by PPO-style pipelines.
3. **DPO**: pairwise chosen/rejected preference optimization from an SFT-derived checkpoint or adapter.
4. **PPO**: optional reward-guided policy optimization; requires an independently evaluated reward model and stricter run review.
5. **Eval**: mandatory evaluation before any artifact can be considered for inference promotion.

SFT may be followed by DPO, PPO, or both only when the selected training engine supports the chosen lineage. Do not merge unrelated training lineages silently.

## Safety invariants

- Training data is validated before GPU allocation.
- Every run records dataset and config SHA-256 hashes.
- Training runs are offline and have no external network by default.
- The training image is operator-approved and immutable in production; the example image is intentionally invalid.
- The web application cannot launch these jobs.
- `--execute` additionally requires `AIRA_TRAINING_EXECUTION_APPROVED=true`.
- A completed training run is not automatically promoted to inference. Evaluation, safety regression, license/provenance, and rollback evidence are separate gates.
- Secrets, private user conversations, and durable memories must not be silently converted into training data. Dataset provenance and authorization are prerequisites outside this launcher.

## Dataset validation

```bash
python validate_dataset.py --stage sft --file data.jsonl
python validate_dataset.py --stage dpo --file preferences.jsonl
```

## Plan without execution

```bash
python pipeline.py --config training-stage.json --stage sft --dataset data.jsonl
```

## Execute on an approved GPU host

```bash
AIRA_TRAINING_EXECUTION_APPROVED=true python pipeline.py \
  --config training-stage.json --stage sft --dataset data.jsonl --execute
```
