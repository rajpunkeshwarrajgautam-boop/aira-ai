# AIRA Model Tiers

The tier names describe product/compute classes, not guaranteed intelligence rankings. All tiers remain research states until evaluated.

| Tier | Target class | Primary objective | Current base | Evidence |
| --- | --- | --- | --- | --- |
| AIRA Edge | 1B–4B | local/edge latency, structured output, routing, extraction | not selected | NOT_TESTED |
| AIRA Core | 7B–10B | general assistant, tools, research/RAG, coding, English/Hindi/Hinglish | `Qwen/Qwen3.5-9B-Base` candidate | NOT_TESTED |
| AIRA Pro | 12B–16B | stronger coding/reasoning/research per dollar | not selected | NOT_TESTED |
| AIRA Ultra | 30B–35B or efficient equivalent | expert engineering/research/agents | not selected | NOT_TESTED |
| AIRA Apex | frontier-scale dense/MoE/hybrid | broad frontier competition | architecture not locked | NOT_TESTED |

## Reasoning variants

A reasoning suffix such as `AIRA Core-R` is permitted only after an experiment proves a distinct reasoning configuration is useful. Do not create visible model entries simply to fill out the family.

## Selection criteria

Every base-model decision must include:

- commercial and derivative-model rights;
- architecture and active/total parameter count;
- text/multimodal modality and tokenizer behavior;
- context length;
- instruction, reasoning, coding, multilingual and tool-use quality;
- Soup/Transformers/PEFT compatibility;
- llama.cpp/vLLM/SGLang compatibility where deployment requires it;
- VRAM, throughput, latency and serving cost;
- quantization behavior;
- known training/inference pathologies.

## First hypothesis

AIRA Core is the first proof point because it is large enough to test serious general capability while remaining tractable for QLoRA/layer-streaming experiments. AIRA Apex is research-only until Core proves the data, eval, training, export and routing loop.
