"""Rite end-to-end: Filen sync and moving a vault from MEGA to Filen.

Run after `yarn build:web`:  python3 packages/web/e2e/test_filen.py [screenshot-dir]
"""
import json
import pathlib
import sys
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from harness import FakeDrive, FakeFilen, new_device, serve_dist  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

PORT = 3050
URL = f"http://127.0.0.1:{PORT}/"
EMAIL = "youba@rite.test"
PASSWORD = "correct horse battery staple"
TITLE = "Moving day"
BODY = "Notes that started on MEGA"
LATER = "Written after the move"
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


def connect(page, name, email, password):
    page.get_by_role("button", name=f"Connect {name}").first.click()
    page.get_by_placeholder(f"{name} email").fill(email)
    page.get_by_placeholder(f"{name} password").fill(password)
    page.get_by_role("button", name=f"Connect {name}").last.click()


def notes(vault_bytes):
    if not vault_bytes:
        return []
    vault = json.loads(vault_bytes)
    return [i for i in vault["items"].values() if i["content_type"] == "Note" and not i["deleted"]]


def sign_in(page, provider, email, password):
    page.get_by_text("Sign in", exact=True).click()
    if provider == "Filen":
        page.get_by_role("radio", name="Filen").click()
        connect(page, "Filen", "me@filen.test", "filen-pass")
    else:
        connect(page, "MEGA", "me@mega.test", "mega-pass")
    page.get_by_text("Connected as").wait_for(timeout=15000)
    page.get_by_placeholder("Email").fill(email)
    page.get_by_placeholder("Password").fill(password)
    page.get_by_role("button", name="Sign in").last.click()
    page.wait_for_timeout(6000)
    page.keyboard.press("Escape")


def open_preferences(page):
    page.keyboard.press("Escape")
    page.mouse.click(700, 400)
    page.mouse.click(60, 804)
    page.get_by_text("Your preferences for Rite").wait_for(timeout=10000)


def main():
    serve_dist(PORT)
    mega, filen = FakeDrive(), FakeFilen()

    with sync_playwright() as p:
        browser = p.chromium.launch()

        # ------------------------------------------------ Device A starts on MEGA
        _, a = new_device(browser, mega, URL, filen=filen)
        _pump.append(a)
        a.wait_for_timeout(3000)
        a.get_by_text("Create free account").click()
        shot(a, "filen-panel-mega")
        connect(a, "MEGA", "me@mega.test", "mega-pass")
        a.get_by_text("Connected as").wait_for(timeout=15000)
        a.get_by_placeholder("Email").fill(EMAIL)
        a.get_by_placeholder("Password").fill(PASSWORD)
        a.get_by_role("button", name="Next").click()
        a.get_by_placeholder("Confirm password").fill(PASSWORD)
        a.get_by_role("button", name="Create account & sign in").click()
        check(wait_for(lambda: mega.vault_bytes() is not None), "account created on MEGA")
        a.wait_for_timeout(2500)
        a.keyboard.press("Escape")

        a.get_by_role("button", name="Create a new note in the selected tag").click()
        a.wait_for_timeout(1000)
        title = a.locator("#note-title-editor")
        title.click()
        title.press("Control+A")
        title.press_sequentially(TITLE, delay=150)
        a.wait_for_timeout(800)
        title.press("Enter")
        a.locator("#note-text-editor").click()
        a.keyboard.type(BODY, delay=50)
        check(wait_for(lambda: len(notes(mega.vault_bytes())) == 1), "note synced to MEGA")
        a.wait_for_timeout(3000)

        # ------------------------------- Device C is signed in on MEGA before the move
        _, c = new_device(browser, mega, URL, filen=filen)
        c.wait_for_timeout(3000)
        sign_in(c, "MEGA", EMAIL, PASSWORD)
        check(c.get_by_text(TITLE).count() > 0, "device C (MEGA) sees the note")

        # ------------------------------------------- Device A moves to Filen
        open_preferences(a)
        a.get_by_text("Move to Filen").first.scroll_into_view_if_needed()
        shot(a, "filen-move-section")
        connect(a, "Filen", "me@filen.test", "filen-pass")
        a.get_by_role("button", name="Move to Filen").wait_for(timeout=15000)
        a.get_by_role("button", name="Move to Filen").click()
        a.get_by_role("button", name="Move to Filen").last.click()  # confirmation dialog
        check(wait_for(lambda: a.get_by_text("Done.").count() > 0, timeout=45), "move reports success")
        check(a.get_by_text("1 note moved from MEGA").count() > 0, "the message counts notes, not internal items")
        check(a.get_by_role("button", name="Move to MEGA").count() == 1, "the section now shows Filen and offers moving back")
        shot(a, "filen-moved")

        raw = filen.vault_bytes() or b""
        check(len(notes(raw)) == 1, "Filen now holds the note")
        check(BODY.encode() not in raw and PASSWORD.encode() not in raw, "Filen only sees ciphertext")
        check(json.loads(mega.vault_bytes()).get("movedTo", {}).get("host") == "filen://rite",
              "MEGA copy is kept and marked as moved to Filen")
        check(not any("password" in json.dumps(v) and "filen-pass" in json.dumps(v) for v in [a.evaluate("() => ({...localStorage})")]),
              "Filen password is not saved on the device")

        # ---------------------------------- Device A keeps working, now on Filen
        a.keyboard.press("Escape")
        a.wait_for_timeout(800)
        a.get_by_text(TITLE).first.click()
        a.locator("#note-text-editor").click()
        a.keyboard.press("Control+End")
        a.keyboard.press("Enter")
        a.keyboard.type(LATER, delay=50)
        check(wait_for(lambda: any(n["updated_at_timestamp"] for n in notes(filen.vault_bytes()))
                       and json.loads(filen.vault_bytes())["clock"] > json.loads(raw)["clock"], timeout=40),
              "edits after the move are saved to Filen")
        mega_after = mega.vault_bytes()

        # ------------------------------------------- Device B signs in with Filen
        _, b = new_device(browser, mega, URL, filen=filen)
        b.wait_for_timeout(3000)
        sign_in(b, "Filen", EMAIL, PASSWORD)
        shot(b, "filen-device-b")
        check(b.get_by_text(TITLE).count() > 0, "device B signed in with Filen and sees the note")
        b.get_by_text(TITLE).first.click()
        b.wait_for_timeout(1500)
        check(LATER in b.locator("#note-text-editor").input_value(), "device B has the edit made after the move")

        # ----------------------------- Device C (still on MEGA) is told to switch
        c.evaluate("() => window.dispatchEvent(new Event('focus'))")
        c.keyboard.press("Escape")
        open_preferences(c)
        c.get_by_text("Sync storage").first.wait_for(timeout=10000)
        connect(c, "Filen", "me@filen.test", "filen-pass")
        c.get_by_role("button", name="Move to Filen").wait_for(timeout=15000)
        c.get_by_role("button", name="Move to Filen").click()
        c.get_by_role("button", name="Move to Filen").last.click()
        check(wait_for(lambda: c.get_by_text("Done.").count() > 0, timeout=45), "device C switches over to Filen")
        c.keyboard.press("Escape")
        c.wait_for_timeout(1500)
        c.get_by_text(TITLE).first.click()
        c.wait_for_timeout(1500)
        check(LATER in c.locator("#note-text-editor").input_value(), "device C now has the edit made on Filen")
        check(mega.vault_bytes() == mega_after, "switching device C left the MEGA backup untouched")

        errors = a.errors + b.errors + c.errors
        check(not errors, "no JavaScript errors" + (f": {errors[:3]}" if errors else ""))
        browser.close()
    print("All Filen checks passed.")


if __name__ == "__main__":
    main()
