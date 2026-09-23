"""Loopback-only HTTPS file fixture for Rust transport tests; no service credentials."""
import http.server
import json
import pathlib
import ssl
import subprocess
import sys
import tempfile
import threading
import urllib.parse


class Reef(http.server.BaseHTTPRequestHandler):
    files = {}

    def log_message(self, *_args):
        pass

    def authorized(self):
        if self.headers.get("Authorization") != "Bearer reef-fixture":
            self.send_error(403)
            return False
        return True

    def reply(self, body, content_type="application/octet-stream"):
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_PUT(self):
        if not self.authorized():
            return
        if not self.path.startswith("/_reef/files/"):
            self.send_error(404)
            return
        path = urllib.parse.unquote(self.path[len("/_reef/files/"):])
        body = self.rfile.read(int(self.headers["Content-Length"]))
        self.files[path] = body
        self.reply(json.dumps({"status": "ok", "path": path, "size": len(body)}).encode(), "application/json")

    def do_GET(self):
        if not self.authorized():
            return
        if self.path == "/_reef/directories":
            entries = [{"name": path, "path": path, "type": "file", "size": len(body)} for path, body in self.files.items()]
            self.reply(json.dumps({"type": "directory", "directories": [], "files": entries}).encode(), "application/json")
            return
        path = urllib.parse.unquote(self.path[len("/_reef/files/"):])
        if not self.path.startswith("/_reef/files/") or path not in self.files:
            self.send_error(404)
            return
        self.reply(self.files[path], "application/json")


with tempfile.TemporaryDirectory(prefix="rust-reef-https-") as scratch:
    key, cert = pathlib.Path(scratch) / "key.pem", pathlib.Path(scratch) / "cert.pem"
    subprocess.run([
        "openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes",
        "-keyout", str(key), "-out", str(cert), "-days", "1", "-subj", "/CN=localhost",
    ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(cert, key)
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Reef)
    server.socket = context.wrap_socket(server.socket, server_side=True)
    worker = threading.Thread(target=server.serve_forever, daemon=True)
    worker.start()
    print(f"https://127.0.0.1:{server.server_port}/_reef", flush=True)
    # Parent closing stdin ends the fixture, including on a failed assertion.
    sys.stdin.read()
    server.shutdown()
    server.server_close()
    worker.join()
