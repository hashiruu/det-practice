#!/usr/bin/env python3
"""Whisper transcription daemon for DET practice.
POST /transcribe with a raw audio body (webm/opus or mp4/aac) -> {"text": "..."}.
Listens on 127.0.0.1:8095 only; the Node server proxies to it.
"""
import json
import os
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from faster_whisper import WhisperModel

# base.en: best speed/quality tradeoff for English-only CPU transcription
model = WhisperModel("base.en", device="cpu", compute_type="int8", cpu_threads=16)
print("whisper model loaded", flush=True)


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path != "/transcribe":
            self.send_response(404)
            self.end_headers()
            return
        n = int(self.headers.get("Content-Length", 0))
        if n <= 0 or n > 30_000_000:
            body = json.dumps({"error": "录音数据为空，请重新录音"}).encode()
            self.send_response(400)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        data = self.rfile.read(n)
        # Safari records mp4 (ftyp box near the start), Chrome records webm
        suffix = ".mp4" if b"ftyp" in data[:32] else ".webm"
        fd, path = tempfile.mkstemp(suffix=suffix)
        try:
            with os.fdopen(fd, "wb") as f:
                f.write(data)
            segments, _info = model.transcribe(
                path, language="en", beam_size=1, vad_filter=True
            )
            text = " ".join(s.text.strip() for s in segments).strip()
            body = json.dumps({"text": text}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except Exception as e:  # noqa: BLE001
            body = json.dumps({"error": str(e)}).encode()
            self.send_response(500)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            self.wfile.write(body)
        finally:
            try:
                os.unlink(path)
            except OSError:
                pass

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", 8095), Handler).serve_forever()
