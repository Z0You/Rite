"""Rite end-to-end: two devices syncing through a (fake) MEGA drive.

Run after `yarn build:web`:  python3 packages/web/e2e/test_two_devices.py
Requires: pip install playwright && playwright install chromium
"""
import json
import pathlib
import sys
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from harness import FakeDrive, new_device, serve_dist  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

PORT = 3020
URL = f"http://127.0.0.1:{PORT}/"
EMAIL = "youba@rite.test"
PASSWORD = "correct horse battery staple"
TITLE = "ANPP inspection"
BODY = "Meeting with the inspector on Tuesday at 10"
EDIT = "Bring the CTD binder"
SHOTS = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else None


def shot(page, name):
    if SHOTS:
        page.screenshot(path=str(SHOTS / f"{name}.png"))


def check(condition, message):
    print(("PASS  " if condition else "FAIL  ") + message)
    if not condition:
        raise SystemExit(1)


def connect_mega(page):
    page.get_by_role("button", name="Connect MEGA").click()
    page.get_by_placeholder("MEGA email").fill("me@mega.test")
    page.get_by_placeholder("MEGA password").fill("mega-pass")
    page.get_by_role("button", name="Connect MEGA").click()
    page.get_by_text("Connected as").wait_for(timeout=15000)


_pump = []  # a page whose wait keeps Playwright's event loop (and the fake MEGA calls) running


def body_editor(page):
    """The note body: a Super (rich text) editor or the plain-text area, whichever is shown."""
    rich = page.locator('[contenteditable="true"]')
    return rich.first if rich.count() else page.locator("#note-text-editor")


def wait_for(predicate, timeout=30):
    end = time.time() + timeout
    while time.time() < end:
        if predicate():
            return True
        _pump[-1].wait_for_timeout(500)
    return False


def main():
    serve_dist(PORT)
    drive = FakeDrive()

    with sync_playwright() as p:
        browser = p.chromium.launch()

        # ------------------------------------------------------------ Device A
        _, a = new_device(browser, drive, URL)
        _pump.append(a)
        a.wait_for_timeout(3000)
        a.get_by_text("Create free account").click()
        connect_mega(a)
        a.get_by_placeholder("Email").fill(EMAIL)
        a.get_by_placeholder("Password").fill(PASSWORD)
        a.get_by_role("button", name="Next").click()
        a.get_by_placeholder("Confirm password").fill(PASSWORD)
        a.get_by_role("button", name="Create account & sign in").click()
        check(wait_for(lambda: drive.vault_bytes() is not None), "account created and vault written to MEGA")
        a.wait_for_timeout(2500)
        a.keyboard.press("Escape")

        a.get_by_role("button", name="Create a new note in the selected tag").click()
        a.wait_for_timeout(1200)
        title = a.locator("#note-title-editor")
        title.click()
        title.press("Control+A")
        # Type at human speed: the upstream editor drops a title typed and left within milliseconds.
        title.press_sequentially(TITLE, delay=150)
        a.wait_for_timeout(800)
        title.press("Enter")
        a.wait_for_timeout(800)
        editor = body_editor(a)
        editor.click()
        a.keyboard.type(BODY, delay=60)
        a.wait_for_timeout(500)
        shot(a, "a-note")

        def vault_has_items(min_notes):
            raw = drive.vault_bytes()
            if not raw:
                return False
            vault = json.loads(raw)
            notes = [i for i in vault["items"].values() if i["content_type"] == "Note" and not i["deleted"]]
            return len(notes) >= min_notes

        check(wait_for(lambda: vault_has_items(1)), "note synced into the MEGA vault")
        a.wait_for_timeout(3000)  # let the debounced title/body save settle

        raw = drive.vault_bytes().decode()
        check(BODY not in raw and TITLE not in raw, "MEGA only sees ciphertext (note text not present in the vault)")
        check(PASSWORD not in raw, "Rite password is not stored in the vault")
        vault = json.loads(raw)
        note = next(i for i in vault["items"].values() if i["content_type"] == "Note" and not i["deleted"])
        check(note["content"].startswith("004:"), "note content uses protocol 004 encryption")

        # ------------------------------------------------------------ Device B
        _, b = new_device(browser, drive, URL)
        b.wait_for_timeout(3000)
        shot(b, "b-start")
        b.get_by_text("Sign in", exact=True).click()
        shot(b, "b-sign-in-form")
        connect_mega(b)
        b.get_by_placeholder("Email").fill(EMAIL)
        b.get_by_placeholder("Password").fill(PASSWORD)
        b.get_by_role("button", name="Sign in").last.click()
        b.wait_for_timeout(6000)
        b.keyboard.press("Escape")
        shot(b, "b-signed-in")
        check(b.get_by_text(TITLE).count() > 0, "device B downloaded and decrypted the note")

        b.get_by_text(TITLE).first.click()
        b.wait_for_timeout(1000)
        editor_b = body_editor(b)
        editor_b.click()
        b.keyboard.press("Control+End")
        b.keyboard.press("Enter")
        b.keyboard.type(EDIT, delay=60)
        b.wait_for_timeout(4000)

        # Device A picks the change up on its next sync (auto-sync every 30 s; force one now).
        def a_sees_edit():
            a.evaluate("() => window.dispatchEvent(new Event('focus'))")
            return EDIT in a.inner_text("body")

        a.get_by_text(TITLE).first.click()
        check(wait_for(a_sees_edit, timeout=45), "edit made on device B appears on device A")
        shot(a, "a-after-sync")

        errors = a.errors + b.errors
        check(not errors, "no JavaScript errors" + (f": {errors[:3]}" if errors else ""))
        browser.close()

    print("All end-to-end checks passed.")


if __name__ == "__main__":
    main()
