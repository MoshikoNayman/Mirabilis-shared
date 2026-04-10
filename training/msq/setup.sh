#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  MSQ Model Setup — Mirabilis AI
#  Registers MSQ-1, MSQ-X, and MSQ-Noir into your local Ollama instance.
#  Run once. Re-run anytime to rebuild after editing a Modelfile.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"

# ── Verify Ollama is running ──────────────────────────────────────────────────
if ! ollama list &>/dev/null; then
  echo "✗  Ollama is not running. Start it with: ollama serve"
  exit 1
fi

# ── Build a model from a Modelfile ───────────────────────────────────────────
create() {
  local name=$1 file=$2 base=$3 size=$4
  echo ""
  echo "  ┌─ $name"
  echo "  │  Base : $base  ($size)"
  printf "  │  Status : "
  if ollama create "$name" -f "$DIR/$file" 2>&1 | tail -1 | grep -q "success\|created\|exists"; then
    echo "ready"
  else
    ollama create "$name" -f "$DIR/$file"
  fi
  echo "  └─ done"
}

echo ""
echo "  MSQ Model Setup — Mirabilis AI"
echo "  ═════════════════════════════════"

create "msq-1"    "Modelfile.msq-1"    "gemma3:latest"  "3.3 GB"
create "msq-x"    "Modelfile.msq-x"    "gemma3:12b"     "8.1 GB"
create "msq-noir" "Modelfile.msq-noir" "dolphin3:latest" "4.9 GB"

echo ""
echo "  ✓  All three MSQ models are registered."
echo "  ✓  Restart Mirabilis to see them in the model selector under 'MSQ'."
echo ""
