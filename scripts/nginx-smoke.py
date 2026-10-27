#!/usr/bin/env python3
"""Check SSR, assets, API routing and forwarding headers through Nginx."""

from html import unescape
from html.parser import HTMLParser
import json
import urllib.error
import urllib.parse
import urllib.request
import uuid

from tapyrus_common import application_url, compose


class Assets(HTMLParser):
    def __init__(self):
        super().__init__()
        self.paths = set()

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag in ("script", "img"):
            path = attrs.get("src", "")
        elif tag == "link":
            path = attrs.get("href", "")
        else:
            return
        if path.startswith("/assets/"):
            self.paths.add(path)


def fetch(base, path, headers=None, status=200):
    request = urllib.request.Request(base + path, headers=headers or {})
    try:
        response = urllib.request.urlopen(request, timeout=20)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        body, content_type = response.read(), response.headers.get_content_type()
        if response.status != status:
            raise RuntimeError(f"{path} returned HTTP {response.status}, expected {status}")
        return body, content_type


def request_log(service, uri):
    output = compose("logs", "--no-color", "--no-log-prefix", "--tail=100", service)
    for line in output.splitlines():
        try:
            entry = json.loads(line)
        except json.JSONDecodeError:
            continue
        if entry.get("uri") == uri:
            return entry
    raise RuntimeError(f"No request log for {service}")


def main():
    base = application_url()
    body, _ = fetch(base, "/nginx-health")
    if body.strip() != b"ok":
        raise RuntimeError("Nginx health check did not respond")
    body, content_type = fetch(base, "/")
    if content_type != "text/html" or b"New React Router App" not in body or "What's next?" not in unescape(body.decode()):
        raise RuntimeError("SSR home page content was not returned")
    assets = Assets()
    assets.feed(body.decode())
    if not any(p.endswith(".js") for p in assets.paths) or not any(p.endswith(".css") for p in assets.paths):
        raise RuntimeError("Home page did not reference JavaScript and CSS assets")
    for path in assets.paths:
        content, kind = fetch(base, path)
        if not content or kind == "text/html":
            raise RuntimeError(f"Static asset was not returned: {path}")
    for path in ("/not-a-real-page", "/apiary"):
        body, kind = fetch(base, path, status=404)
        if kind != "text/html" or b"The requested page could not be found." not in body:
            raise RuntimeError("Frontend 404 was not preserved")
    for path in ("/api", "/api/not-a-real-endpoint"):
        body, kind = fetch(base, path, status=404)
        if kind != "application/json" or json.loads(body).get("error", {}).get("code") != "not_found":
            raise RuntimeError("API 404 was not returned by Go")

    marker = uuid.uuid4().hex
    query = f"?probe={marker}&value=a%2Fb&value=c%20d"
    host = "mobile-tracer.local:" + str(urllib.parse.urlsplit(base).port)
    headers = {"Host": host, "X-Forwarded-Host": "untrusted.invalid", "X-Forwarded-Proto": "https",
               "X-Forwarded-For": "198.51.100.20", "X-Real-IP": "198.51.100.20"}
    fetch(base, "/api/health" + query, headers)
    fetch(base, "/" + query, headers)
    api = request_log("backend", "/api/health" + query)
    web = request_log("frontend", "/" + query)
    for entry in (api, web):
        if entry.get("host") != host or not entry.get("remote_ip") or entry["remote_ip"] == "198.51.100.20":
            raise RuntimeError("Forwarded host or IP was not safely preserved")
    if api["remote_ip"] != web["remote_ip"] or web.get("scheme") != "http":
        raise RuntimeError("Applications disagree on forwarded request metadata")
    # This check targets the default Compose configuration, with only Nginx published.
    output = compose("ps", "--format=json")
    entries = json.loads(output) if output.lstrip().startswith("[") else [json.loads(line) for line in output.splitlines()]
    for entry in entries:
        published = [port for port in entry.get("Publishers") or [] if port.get("PublishedPort")]
        if published and entry["Service"] != "nginx":
            raise RuntimeError(f"Unexpected published port on {entry['Service']}")
    print("Nginx serves SSR/assets and preserves frontend/API 404s, paths, queries and request metadata.")


if __name__ == "__main__":
    main()
