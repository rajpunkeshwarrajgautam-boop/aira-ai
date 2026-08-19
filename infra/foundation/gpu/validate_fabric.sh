#!/usr/bin/env bash
set -euo pipefail

MODE="${AIRA_GPU_FABRIC_MODE:-single-node}"
REQUIRE_NCCL="${AIRA_REQUIRE_NCCL_TESTS:-true}"
NCCL_TEST_BIN="${AIRA_NCCL_TEST_BIN:-all_reduce_perf}"
MIN_GPUS="${AIRA_MIN_GPUS_PER_NODE:-1}"

fail() { echo "FAIL: $*" >&2; exit 1; }
info() { echo "AIRA_GPU_CHECK: $*"; }

command -v nvidia-smi >/dev/null 2>&1 || fail "nvidia-smi not found"
GPU_COUNT="$(nvidia-smi --query-gpu=index --format=csv,noheader | wc -l | tr -d ' ')"
[[ "$GPU_COUNT" =~ ^[0-9]+$ ]] || fail "could not determine GPU count"
(( GPU_COUNT >= MIN_GPUS )) || fail "GPU count $GPU_COUNT is below required $MIN_GPUS"
info "gpu_count=$GPU_COUNT"

nvidia-smi --query-gpu=index,name,uuid,pci.bus_id,memory.total --format=csv,noheader
nvidia-smi topo -m

if [[ "$MODE" == "multi-node" ]]; then
  if command -v ibstat >/dev/null 2>&1; then
    ibstat
  elif command -v rdma >/dev/null 2>&1; then
    rdma link show
  else
    fail "multi-node mode requires InfiniBand/RDMA tooling"
  fi

  MEMLOCK="$(ulimit -l)"
  [[ "$MEMLOCK" == "unlimited" ]] || fail "multi-node NCCL/RDMA requires unlimited memlock; current=$MEMLOCK"

  if [[ "$REQUIRE_NCCL" == "true" ]]; then
    command -v "$NCCL_TEST_BIN" >/dev/null 2>&1 || fail "$NCCL_TEST_BIN not found"
    MIN_BYTES="${AIRA_NCCL_MIN_BYTES:-8M}"
    MAX_BYTES="${AIRA_NCCL_MAX_BYTES:-1G}"
    FACTOR="${AIRA_NCCL_FACTOR:-2}"
    "$NCCL_TEST_BIN" -b "$MIN_BYTES" -e "$MAX_BYTES" -f "$FACTOR" -g "$GPU_COUNT"
  fi
elif [[ "$MODE" != "single-node" ]]; then
  fail "AIRA_GPU_FABRIC_MODE must be single-node or multi-node"
fi

info "status=PASS mode=$MODE"
