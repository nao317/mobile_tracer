#!/usr/bin/env bash
set -euo pipefail

docs_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
docs_python="$docs_root/.venv-docs/bin/python"
if [ ! -x "$docs_python" ]; then
  echo '文書用の仮想環境がありません。docs/README.md の準備手順を実行してください。' >&2
  exit 1
fi
# Optional local native libraries, used when system installation is unavailable.
if [ -d "$docs_root/.venv-docs/lib/docs-native" ]; then
  export LD_LIBRARY_PATH="$docs_root/.venv-docs/lib/docs-native${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
fi
exec "$docs_python" "$docs_root/scripts/docs/build.py" "$@"
