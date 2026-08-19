# AIRA GPU fabric and promotion gate

This is an infrastructure validation boundary, not a claim that AIRA currently owns a multi-node accelerator cluster.

## Network zones

Keep management/control traffic, GPU collective/RDMA traffic, storage/checkpoint traffic, and untrusted sandbox traffic on separate network/security boundaries. The Python sandbox must never join the GPU/RDMA network.

## Single-node gate

Run `validate_fabric.sh` in `single-node` mode to inventory GPUs and inspect the local GPU topology before enabling self-hosted inference.

## Multi-node gate

Each node must pass the local inventory plus RDMA tooling/memlock checks. Then run low-level RDMA bandwidth/latency checks between every intended peer and NCCL collective tests across the real distributed launch topology. The repository cannot manufacture these results; they must be observed on the provisioned hosts.

The validator intentionally refuses multi-node promotion when RDMA tooling or required NCCL tests are absent. NVIDIA's NCCL troubleshooting guidance recommends validating low-level InfiniBand/RoCE communication before relying on NCCL collectives.

## Promotion order

1. GPU/driver inventory
2. local GPU topology
3. RDMA link state and peer bandwidth
4. NCCL collective test
5. inference server health under synthetic concurrency
6. controlled AIRA canary with provider fallback still available
7. only then consider self-hosted inference a production backend

Training promotion is separate: a training artifact must additionally pass the evaluation and safety gates in `../training/`.
