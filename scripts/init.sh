#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."

python3 - <<'PY'
from pathlib import Path
import os
import secrets

path = Path('.env')
text = path.read_text() if path.exists() else Path('.env.example').read_text()
lines = text.splitlines()
for key in ('TAPYRUS_RPC_PASSWORD', 'POSTGRES_PASSWORD'):
    found = False
    for i, line in enumerate(lines):
        if line.startswith(key + '='):
            found = True
            if not line.split('=', 1)[1].strip():
                lines[i] = key + '=' + secrets.token_hex(32)
    if not found:
        lines.append(key + '=' + secrets.token_hex(32))
new_text = '\n'.join(lines) + '\n'
if not path.exists() or new_text != text:
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w') as output:
        output.write(new_text)
path.chmod(0o600)
print('Local environment file ready; credentials are not printed.')
PY

docker compose run --rm tapyrus-bootstrap
echo 'Initialization complete. Run: docker compose up --build --wait --wait-timeout 180'
