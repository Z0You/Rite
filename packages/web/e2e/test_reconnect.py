"""Rite end-to-end: the storage connection ends while signed in (bug: endless password prompt).

Expected: no Rite password prompt, a "reconnect" notice instead, and syncing resumes after
reconnecting MEGA, with no notes lost.

Run after `yarn build:web`:  python3 packages/web/e2e/test_reconnect.py [screenshot-dir]
"""
import json
import pathlib
import sys
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from harness import FakeDrive, new_device, serve_dist  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

PORT = 3060
URL = f"http://127.0.0.1:{PORT}/"
EMAIL = "youba@rite.test"
PASSWORD = "correct horse battery staple"
SHOTS = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else None
_pump = []


def shot(page, name):
    if SHOTS:
        page.screenshot(path=str(SHOTS / f"{name}.png"))


def check(condition, message):
    print(("PASS  " if condition else "FAIL  ") + message)
    if not condition:
        raise SystemExit(1)


def wait_for(predicate, timeout=30):
    end = time.time() + timeout
    while time.time() < end:
        if predicate():
            return True
        _pump[-1].wait_for_timeout(500)
    return False


def notes(drive):
    raw = drive.vault_bytes()
    if not raw:
        return []
    return [i for i in json.loads(raw)["items"].values() if i["content_type"] == "Note" and not i["deleted"]]


def type_note(page, title, body):
    page.get_by_role("button", name="Create a new note in the selected tag").click()
    page.wait_for_timeout(1000)
    t = page.locator("#note-title-editor")
    t.click()
    t.press("Control+A")
    t.press_sequentially(title, delay=150)
    page.wait_for_timeout(800)
    t.press("Enter")
    page.locator("#note-text-editor").click()
    page.keyboard.type(body, delay=40)


def main():
    serve_dist(PORT)
    drive = FakeDrive()
    with sync_playwright() as p:
        browser = p.chromium.launch()
        _, a = new_device(browser, drive, URL)
        _pump.append(a)
        a.wait_for_timeout(3000)

        a.get_by_text("Create free account").click()
        a.get_by_role("button", name="Connect MEGA").first.click()
        a.get_by_placeholder("MEGA email").fill("me@mega.test")
        a.get_by_placeholder("MEGA password").fill("mega-pass")
        a.get_by_role("button", name="Connect MEGA").last.click()
        a.get_by_text("Connected as").wait_for(timeout=15000)
        a.get_by_placeholder("Email").fill(EMAIL)
        a.get_by_placeholder("Password").fill(PASSWORD)
        a.get_by_role("button", name="Next").click()
        a.get_by_placeholder("Confirm password").fill(PASSWORD)
        a.get_by_role("button", name="Create account & sign in").click()
        check(wait_for(lambda: drive.vault_bytes() is not None), "signed up with MEGA")
        a.wait_for_timeout(2500)
        a.keyboard.press("Escape")
        type_note(a, "Before", "written while MEGA works")
        check(wait_for(lambda: len(notes(drive)) == 1), "first note synced")
        a.wait_for_timeout(3000)

        # ---- MEGA ends the session (e.g. "log out of all devices" on mega.nz)
        drive.sessions.clear()
        type_note(a, "Offline", "written while MEGA is disconnected")
        check(wait_for(lambda: a.get_by_text("Syncing with MEGA is paused").count() > 0, timeout=40),
              "a 'syncing is paused' notice appears")
        a.wait_for_timeout(4000)
        shot(a, "reconnect-notice")
        prompt = a.get_by_text("refresh your session").count() + a.get_by_text("Please enter your account email and password").count()
        check(prompt == 0, "the Rite password prompt does NOT appear")
        check(a.get_by_text("Offline").count() > 0, "the note written meanwhile is kept on the device")

        # ---- Reconnect MEGA from the notice
        a.get_by_role("button", name="Reconnect MEGA").click()
        a.get_by_text("Your preferences for Rite").wait_for(timeout=10000)
        a.get_by_text("Sync storage").first.scroll_into_view_if_needed()
        a.get_by_placeholder("MEGA email").fill("me@mega.test")
        a.get_by_placeholder("MEGA password").fill("mega-pass")
        a.get_by_role("button", name="Connect MEGA").last.click()
        shot(a, "reconnect-form")
        check(wait_for(lambda: len(notes(drive)) == 2, timeout=60), "after reconnecting, the waiting note syncs to MEGA")
        a.keyboard.press("Escape")
        check(wait_for(lambda: a.get_by_text("Syncing with MEGA is paused").count() == 0, timeout=40),
              "the notice goes away once syncing works")

        errors = a.errors
        check(not errors, "no JavaScript errors" + (f": {errors[:3]}" if errors else ""))
        browser.close()
    print("All reconnect checks passed.")


if __name__ == "__main__":
    main()
