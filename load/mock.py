"""Isolated Timestamp V2 simulator. Duplicate POSTs deliberately create new rows."""
import hashlib
import hmac
import json
import os
import re
import socket
import sqlite3
import ssl
import time
from contextlib import closing
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

PATH = "/api/v2/timestamps"
PREFIX = "6d747261636572"
CERTS = Path("/test-certs")
DATABASE = "/state/timestamps.sqlite"
TOKEN = (CERTS / "token").read_text().strip()
MODE = os.environ["MOCK_MODE"]
DELAY = int(os.environ["MOCK_DELAY_MS"]) / 1000
CONFIRM = int(os.environ["MOCK_CONFIRM_SECONDS"])


def db():
    return closing(sqlite3.connect(DATABASE, timeout=10))


def timestamp(row):
    ident, content, created = row
    confirmed = time.time() >= created + CONFIRM
    return {
        "id": ident, "version": "2", "prefix": PREFIX, "timestamp_type": "simple",
        "content_hash": content, "txid": hashlib.sha256(f"{ident}:{content}".encode()).hexdigest(),
        "status": "confirmed" if confirmed else "unconfirmed",
        "block_height": 1000 + ident if confirmed else None,
        "block_time": int(created) + CONFIRM if confirmed else None,
    }


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def reply(self, status, payload):
        raw = json.dumps(payload, separators=(",", ":")).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        try:
            self.wfile.write(raw)
        except OSError:
            pass

    def authorize(self):
        valid = hmac.compare_digest(self.headers.get("Authorization", "").encode(), f"Bearer {TOKEN}".encode())
        if not valid:
            self.reply(401, {"error": "unauthorized"})
        return valid

    def do_POST(self):
        if not self.authorize():
            return
        if self.path != PATH:
            return self.reply(404, {"error": "not_found"})
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if not 0 < size <= 1024:
                raise ValueError
            data = json.loads(self.rfile.read(size))
            content = data["content"]
            if (not re.fullmatch("[0-9a-f]{64}", content)
                    or data != {"content": content, "digest": "none", "prefix": PREFIX, "type": "simple"}):
                raise ValueError
        except (ValueError, KeyError, TypeError):
            return self.reply(400, {"error": "invalid_request"})
        time.sleep(DELAY)
        with db() as conn, conn:
            conn.execute("BEGIN IMMEDIATE")
            duplicate = conn.execute("SELECT 1 FROM stamps WHERE content=? LIMIT 1", (content,)).fetchone()
            conn.execute("UPDATE metrics SET posts=posts+1, duplicates=duplicates+?", (int(bool(duplicate)),))
            if MODE not in ("reject", "server-error"):
                created = time.time()
                ident = conn.execute("INSERT INTO stamps(content,created) VALUES(?,?)", (content, created)).lastrowid
        if MODE in ("reject", "server-error"):
            return self.reply(422 if MODE == "reject" else 503, {"error": "injected"})
        if MODE in ("lost", "lost-hidden"):
            self.connection.shutdown(socket.SHUT_RDWR)
            return
        result = timestamp((ident, content, created))
        if MODE == "mismatch":
            result["content_hash"] = hashlib.sha256(b"mismatch").hexdigest()
        self.reply(201, result)

    def do_GET(self):
        if not self.authorize():
            return
        with db() as conn, conn:
            if self.path == "/metrics":
                posts, duplicates, listed, fetched = conn.execute("SELECT * FROM metrics").fetchone()
                created, confirmed = conn.execute(
                    "SELECT count(*),count(*) FILTER (WHERE created <= ?) FROM stamps", (time.time() - CONFIRM,)
                ).fetchone()
                return self.reply(200, dict(posts=posts, created=created, duplicates=duplicates,
                                            list_requests=listed, id_requests=fetched, confirmed=confirmed))
            if self.path == PATH:
                conn.execute("UPDATE metrics SET listed=listed+1")
                rows = [] if MODE == "lost-hidden" else conn.execute("SELECT * FROM stamps ORDER BY id").fetchall()
                return self.reply(200, {"count": len(rows), "timestamps": [timestamp(row) for row in rows]})
            match = re.fullmatch(PATH + r"/([1-9][0-9]{0,17})", self.path)
            if match:
                conn.execute("UPDATE metrics SET fetched=fetched+1")
                row = conn.execute("SELECT * FROM stamps WHERE id=?", (int(match[1]),)).fetchone()
                if row and MODE != "lost-hidden":
                    return self.reply(200, timestamp(row))
        self.reply(404, {"error": "not_found"})


def main():
    with db() as conn:
        conn.executescript("""
            PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS stamps(id INTEGER PRIMARY KEY,content TEXT NOT NULL,created REAL NOT NULL);
            CREATE INDEX IF NOT EXISTS stamps_content ON stamps(content);
            CREATE TABLE IF NOT EXISTS metrics(posts INTEGER,duplicates INTEGER,listed INTEGER,fetched INTEGER);
            INSERT INTO metrics SELECT 0,0,0,0 WHERE NOT EXISTS (SELECT 1 FROM metrics);
        """)
    tls = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    tls.minimum_version = ssl.TLSVersion.TLSv1_2
    tls.load_cert_chain(CERTS / "server.crt", CERTS / "server.key")
    tls.load_verify_locations(CERTS / "ca.crt")
    tls.verify_mode = ssl.CERT_REQUIRED
    server = ThreadingHTTPServer(("0.0.0.0", 8443), Handler)
    server.socket = tls.wrap_socket(server.socket, server_side=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
