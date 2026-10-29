"""End-to-end harness for Rite's web build.

Serves packages/web/dist, and provides a fake MEGA drive shared by several browser
contexts (simulated devices). MEGA itself is never contacted.
"""
import functools
import http.server
import itertools
import os
import pathlib
import threading
import time

HERE = pathlib.Path(__file__).resolve().parent
DIST = HERE.parent / "dist"
FAKE_MEGA_JS = (HERE / "fake-mega.js").read_text()


class FakeDrive:
    def __init__(self, email="me@mega.test", password="mega-pass"):
        self.email, self.password = email, password
        self.sid = "sid-%d" % int(time.time() * 1000)
        self.nodes = {}  # id -> {id, parent, name, directory, timestamp, size, data(bytes)}
        self.ids = itertools.count(1)
        self.lock = threading.Lock()

    def _info(self, node):
        return {k: node[k] for k in ("id", "parent", "name", "directory", "timestamp", "size")}

    def login(self, email, password):
        return self.sid if (email.strip().lower(), password) == (self.email, self.password) else None

    def list(self, sid):
        if sid != self.sid:
            return None
        with self.lock:
            return [self._info(n) for n in self.nodes.values()]

    def download(self, node_id):
        import base64

        return base64.b64encode(self.nodes[node_id]["data"]).decode()

    def upload(self, parent, name, b64):
        import base64

        with self.lock:
            node_id = "n%d" % next(self.ids)
            data = base64.b64decode(b64)
            self.nodes[node_id] = dict(
                id=node_id, parent=parent, name=name, directory=False,
                timestamp=time.time(), size=len(data), data=data,
            )
            return self._info(self.nodes[node_id])

    def mkdir(self, parent, name):
        with self.lock:
            node_id = "d%d" % next(self.ids)
            self.nodes[node_id] = dict(
                id=node_id, parent=parent, name=name, directory=True, timestamp=time.time(), size=0, data=b""
            )
            return self._info(self.nodes[node_id])

    def delete(self, node_id):
        with self.lock:
            self.nodes.pop(node_id, None)

    def files(self):
        return {n["name"]: n for n in self.nodes.values() if not n["directory"]}

    def vault_bytes(self):
        vaults = [n for n in self.nodes.values() if n["name"] == "rite-vault.json"]
        return vaults[-1]["data"] if vaults else None


def serve_dist(port):
    handler = functools.partial(_QuietHandler, directory=str(DIST))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", port), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


class _QuietHandler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, ".mjs": "text/javascript", ".js": "text/javascript", ".wasm": "application/wasm"}

    def log_message(self, *args):
        pass


def new_device(browser, drive, base_url, width=1280, height=820):
    """A fresh browser context = a new device with empty local storage."""
    context = browser.new_context(viewport={"width": width, "height": height})
    context.expose_function("__fakeMegaDriveLogin", drive.login)
    context.expose_function("__fakeMegaDriveList", drive.list)
    context.expose_function("__fakeMegaDriveDownload", drive.download)
    context.expose_function("__fakeMegaDriveUpload", drive.upload)
    context.expose_function("__fakeMegaDriveMkdir", drive.mkdir)
    context.expose_function("__fakeMegaDriveDelete", drive.delete)
    context.add_init_script(FAKE_MEGA_JS)
    page = context.new_page()
    page.errors = []
    page.on("pageerror", lambda e: page.errors.append(str(e)))
    page.goto(base_url)
    return context, page
