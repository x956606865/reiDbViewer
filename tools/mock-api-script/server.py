#!/usr/bin/env python3
"""Simple HTTP server for testing query API scripts.

This server exposes a single endpoint `/api/batch` that accepts POST requests
with JSON payloads. Each batch is recorded in memory and echoed back in the
response so the desktop app can verify success behaviour.

Usage::

    python3 server.py

The server listens on http://127.0.0.1:8765 by default.
"""

from __future__ import annotations

import json
import logging
import signal
import sys
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Dict, List

HOST = "127.0.0.1"
PORT = 8765

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] %(levelname)s %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("mock-api-script")

_received_batches: List[Dict[str, Any]] = []


class BatchHandler(BaseHTTPRequestHandler):
    server_version = "MockApiScript/0.1"

    def _set_default_headers(self, status: int = HTTPStatus.OK) -> None:
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API
        if self.path == "/healthz":
            self._set_default_headers()
            self.wfile.write(json.dumps({"ok": True, "batches": len(_received_batches)}).encode())
            return
        self._set_default_headers(HTTPStatus.NOT_FOUND)
        self.wfile.write(json.dumps({"error": "not_found"}).encode())

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/api/batch":
            self._set_default_headers(HTTPStatus.NOT_FOUND)
            self.wfile.write(json.dumps({"error": "not_found"}).encode())
            return

        length_header = self.headers.get("Content-Length")
        try:
            length = int(length_header) if length_header else 0
        except ValueError:
            self._set_default_headers(HTTPStatus.BAD_REQUEST)
            self.wfile.write(json.dumps({"error": "invalid_content_length"}).encode())
            return

        payload = self.rfile.read(length) if length > 0 else b"{}"
        try:
            data = json.loads(payload.decode() or "{}")
        except json.JSONDecodeError as exc:
            logger.warning("failed to decode payload: %s", exc)
            self._set_default_headers(HTTPStatus.BAD_REQUEST)
            self.wfile.write(json.dumps({"error": "invalid_json"}).encode())
            return
        print(data)
        batch = {
            "items": data,
        }
        _received_batches.append(batch)
        logger.info("received batch: %s", batch)

        response = {
            "status": "ok",
            "received": len(batch),
            "total_batches": len(_received_batches),
        }
        self._set_default_headers()
        self.wfile.write(json.dumps(response).encode())

    def log_message(self, format: str, *args: Any) -> None:  # noqa: A003 - inherited signature
        logger.debug("%s - %s", self.address_string(), format % args)


def run() -> None:
    server = ThreadingHTTPServer((HOST, PORT), BatchHandler)
    logger.info("mock API server listening on http://%s:%s", HOST, PORT)

    def shutdown(signum: int, frame: Any) -> None:  # noqa: ANN001
        logger.info("received signal %s, shutting down", signum)
        server.shutdown()

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        logger.info("keyboard interrupt, shutting down")
    finally:
        server.server_close()
        logger.info("server stopped")


if __name__ == "__main__":
    try:
        run()
    except OSError as exc:
        logger.error("failed to start server: %s", exc)
        sys.exit(1)
