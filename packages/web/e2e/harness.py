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
FAKE_FILEN_JS = (HERE / "fake-filen.js").read_text()


class FakeDrive:
    def __init__(self, email="me@mega.test", password="mega-pass"):
        self.email, self.password = email, password
        self.sessions = set()
        self.nodes = {}  # id -> {id, parent, name, directory, timestamp, size, data(bytes)}
        self.ids = itertools.count(1)
        self.lock = threading.Lock()

    def _info(self, node):
        return {k: node[k] for k in ("id", "parent", "name", "directory", "timestamp", "size")}

    def login(self, email, password):
        # Like MEGA: every login opens a new session.
        if (email.strip().lower(), password) != (self.email, self.password):
            return None
        sid = "sid-%d" % next(self.ids)
        self.sessions.add(sid)
        return sid

    def logout(self, sid):
        self.sessions.discard(sid)

    def list(self, sid):
        if sid not in self.sessions:
            return None
        with self.lock:
            return [self._info(n) for n in self.nodes.values()]

    def download(self, node_id):
        import base64

        node = self.nodes.get(node_id)
        return base64.b64encode(node["data"]).decode() if node else None

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


class FakeFilen:
    """A Filen account shared by every simulated device. Like Filen, uploading a file whose
    name already exists in a folder replaces it (the old one becomes a previous version)."""

    ROOT = "root-folder"

    def __init__(self, email="me@filen.test", password="filen-pass"):
        self.email, self.password = email, password
        self.api_key = "filen-key-1"
        self.items = {}  # uuid -> {uuid, type, name, parent, timestamp, lastModified, size, data}
        self.versions = []
        self.ids = itertools.count(1)
        self.lock = threading.Lock()

    def _plain(self, item):
        out = {k: v for k, v in item.items() if k != "data"}
        if item["type"] == "file":
            out.update(mime="application/json", version=2, chunks=1, key="k", bucket="b", region="r")
        return out

    def _check(self, api_key):
        return None if api_key == self.api_key else {"__error": "api_key_not_found"}

    def login(self, email, password):
        if (email.strip().lower(), password) != (self.email, self.password):
            return None
        return {"apiKey": self.api_key, "masterKeys": ["master"], "baseFolderUUID": self.ROOT, "authVersion": 2, "userId": 1}

    def list(self, api_key, uuid, only_dirs):
        error = self._check(api_key)
        if error:
            return error
        with self.lock:
            return [self._plain(i) for i in self.items.values()
                    if i["parent"] == uuid and (not only_dirs or i["type"] == "directory")]

    def mkdir(self, api_key, parent, name):
        error = self._check(api_key)
        if error:
            return error
        with self.lock:
            uuid = "fd%d" % next(self.ids)
            now = int(time.time() * 1000)
            self.items[uuid] = dict(uuid=uuid, type="directory", name=name, parent=parent, timestamp=now, lastModified=now, size=0)
            return uuid

    def upload(self, api_key, parent, name, b64):
        import base64

        error = self._check(api_key)
        if error:
            return error
        with self.lock:
            for existing in [i for i in self.items.values() if i["parent"] == parent and i["name"] == name]:
                self.versions.append(self.items.pop(existing["uuid"]))
            uuid = "ff%d" % next(self.ids)
            data = base64.b64decode(b64)
            now = int(time.time() * 1000) + next(self.ids)
            self.items[uuid] = dict(uuid=uuid, type="file", name=name, parent=parent, timestamp=now,
                                    lastModified=now, size=len(data), data=data)
            return self._plain(self.items[uuid])

    def download(self, api_key, uuid):
        import base64

        error = self._check(api_key)
        if error:
            return error
        return base64.b64encode(self.items[uuid]["data"]).decode()

    def delete(self, api_key, uuid):
        error = self._check(api_key)
        if error:
            return error
        with self.lock:
            self.items.pop(uuid, None)

    def vault_bytes(self):
        vaults = [i for i in self.items.values() if i["name"] == "rite-vault.json"]
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


def new_device(browser, drive, base_url, width=1280, height=820, filen=None):
    """A fresh browser context = a new device with empty local storage."""
    context = browser.new_context(viewport={"width": width, "height": height})
    if filen is not None:
        context.expose_function("__fakeFilenLogin", filen.login)
        context.expose_function("__fakeFilenList", filen.list)
        context.expose_function("__fakeFilenMkdir", filen.mkdir)
        context.expose_function("__fakeFilenUpload", filen.upload)
        context.expose_function("__fakeFilenDownload", filen.download)
        context.expose_function("__fakeFilenDelete", filen.delete)
        context.add_init_script(FAKE_FILEN_JS)
    context.expose_function("__fakeMegaDriveLogin", drive.login)
    context.expose_function("__fakeMegaDriveList", drive.list)
    context.expose_function("__fakeMegaDriveDownload", drive.download)
    context.expose_function("__fakeMegaDriveUpload", drive.upload)
    context.expose_function("__fakeMegaDriveMkdir", drive.mkdir)
    context.expose_function("__fakeMegaDriveDelete", drive.delete)
    context.expose_function("__fakeMegaDriveLogout", drive.logout)
    context.add_init_script(FAKE_MEGA_JS)
    page = context.new_page()
    page.errors = []
    page.on("pageerror", lambda e: page.errors.append(str(e)))
    page.goto(base_url)
    return context, page
