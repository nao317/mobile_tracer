#!/usr/bin/env python3
"""Test HTTP/HTTPS forwarding in isolated containers, without host ports or secrets."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import uuid

ROOT = Path(__file__).resolve().parent.parent
NGINX = "nginx:1.30.6-alpine@sha256:47928bf67eb62a1863cb08d9ecb52d3e704304ba614eaee17884204677702951"
NODE = os.environ.get("NGINX_TEST_NODE_IMAGE", "node:24-alpine")
ECHO = "require('http').createServer((q,s)=>{s.setHeader('Content-Type','application/json');s.end(JSON.stringify({url:q.url,headers:q.headers}))}).listen(8080)"
PROBE = r"""
const assert = require('node:assert/strict');
const http = require('node:http');
function request(path, headers) {
  return new Promise((resolve,reject) => {
    http.get('http://nginx:8080'+path,{headers},response => {
      let body=''; response.on('data',chunk=>body+=chunk);
      response.on('end',()=>resolve({status:response.statusCode,headers:response.headers,body}));
    }).on('error',reject);
  });
}
(async () => {
  const expected = process.argv[1];
  const headers = {Host:'mbtracer.yellowtail.work','X-Forwarded-Proto':'https',
    'X-Forwarded-Host':'attacker.invalid','X-Forwarded-For':'198.51.100.42',
    'X-Real-IP':'198.51.100.42',Forwarded:'for=attacker;proto=http'};
  for (const path of ['/api/health?probe=not-in-logs','/login?probe=not-in-logs']) {
    const response = await request(path,headers);
    assert.equal(response.status,200);
    const data = JSON.parse(response.body);
    assert.equal(data.url,path);
    assert.equal(data.headers['x-forwarded-proto'],expected);
    assert.equal(data.headers['x-forwarded-host'],'mbtracer.yellowtail.work');
    assert.equal(data.headers.host,'mbtracer.yellowtail.work');
    assert.notEqual(data.headers['x-forwarded-for'],'198.51.100.42');
    assert.equal(data.headers.forwarded,undefined);
  }
  if (expected==='https') {
    const response = await request('/login?a=1',
      {Host:'mbtracer.yellowtail.work','X-Forwarded-Proto':'http'});
    assert.equal(response.status,308);
    assert.equal(response.headers.location,'https://mbtracer.yellowtail.work/login?a=1');
  }
})().catch(e=>{console.error(e);process.exit(1)});
"""


def main():
    with tempfile.TemporaryDirectory() as temp:
        path = Path(temp) / "compose.json"
        command = ["docker", "compose", "-p", "mobile-tracer-nginx-test-" + uuid.uuid4().hex[:8], "-f", str(path)]
        config = {"services": {
            "backend": {"image": NODE, "entrypoint": ["node", "-e", ECHO]},
            # The shared Nginx config expects frontend on port 3000.
            "frontend": {"image": NODE, "entrypoint": ["node", "-e", ECHO.replace("listen(8080)", "listen(3000)")]},
            "nginx": {"image": NGINX, "volumes": [],
                      "depends_on": ["frontend", "backend"],
                      "healthcheck": {"test": ["CMD", "wget", "-qO-", "http://127.0.0.1:8080/nginx-health"],
                                      "interval": "1s", "timeout": "2s", "retries": 15}}
        }}
        try:
            for name, expected in (("default.conf", "http"), ("public.conf", "https")):
                config["services"]["nginx"]["volumes"] = [
                    f"{ROOT}/docker/nginx/{name}:/etc/nginx/conf.d/default.conf:ro",
                    f"{ROOT}/docker/nginx/includes:/etc/nginx/mobile-tracer:ro",
                ]
                path.write_text(json.dumps(config))
                subprocess.run(command + ["up", "-d", "--wait", "--wait-timeout", "45"], check=True)
                subprocess.run(command + ["exec", "-T", "nginx", "nginx", "-t"], check=True)
                subprocess.run(command + ["exec", "-T", "frontend", "node", "-e", PROBE, expected], check=True)
                logs = subprocess.check_output(command + ["logs", "--no-color", "nginx"], text=True)
                if "not-in-logs" in logs:
                    raise RuntimeError("Query string leaked into Nginx logs")
                print(f"{name}: forwarding, headers, query privacy OK", flush=True)
        finally:
            if path.exists():
                subprocess.run(command + ["down", "--timeout", "5"], check=True)


if __name__ == "__main__":
    main()
