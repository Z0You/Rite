"""Rite end-to-end: the Authenticator and Spreadsheet editors inside the app.

Run after `yarn build:web`:  python3 packages/web/e2e/test_editors.py [screenshot-dir]
"""
import base64
import hashlib
import hmac
import pathlib
import struct
import sys
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from harness import FakeDrive, new_device, serve_dist  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

PORT = 3023
URL = f"http://127.0.0.1:{PORT}/"
SECRET = "JBSWY3DPEHPK3PXP"
SHOTS = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else None


def shot(page, name):
    if SHOTS:
        page.screenshot(path=str(SHOTS / f"{name}.png"))


def check(condition, message):
    print(("PASS  " if condition else "FAIL  ") + message)
    if not condition:
        raise SystemExit(1)


def totp(secret, at=None, digits=6, period=30):
    key = base64.b32decode(secret + "=" * (-len(secret) % 8))
    counter = int((at if at is not None else time.time()) // period)
    mac = hmac.new(key, struct.pack(">Q", counter), hashlib.sha1).digest()
    offset = mac[-1] & 0x0F
    code = (struct.unpack(">I", mac[offset : offset + 4])[0] & 0x7FFFFFFF) % 10**digits
    return str(code).zfill(digits)


def new_note_of_type(page, type_name, title):
    page.get_by_role("button", name="Create a new note in the selected tag").click()
    page.wait_for_timeout(1000)
    t = page.locator("#note-title-editor")
    t.click()
    t.press("Control+A")
    t.press_sequentially(title, delay=120)
    page.wait_for_timeout(800)
    page.get_by_role("button", name="Change note type").click()
    page.get_by_text(type_name, exact=True).click()
    page.wait_for_timeout(800)
    # Changing type may ask for confirmation.
    for label in ("Yes, change it", "Continue", "OK"):
        button = page.get_by_role("button", name=label, exact=True)
        if button.count() and button.first.is_visible():
            button.first.click()
            break
    page.wait_for_timeout(2500)
    return page.frame_locator("iframe").first


def main():
    serve_dist(PORT)
    drive = FakeDrive()
    with sync_playwright() as p:
        browser = p.chromium.launch()
        _, page = new_device(browser, drive, URL)
        page.wait_for_timeout(3000)
        page.keyboard.press("Escape")

        # ---------------------------------------------------------- Authenticator
        frame = new_note_of_type(page, "Authenticator", "My 2FA codes")
        frame.get_by_text("No accounts yet").wait_for(timeout=15000)
        check(True, "Authenticator editor loads inside the note")
        frame.locator("#add").click()
        frame.locator("#f-service").fill("GitHub")
        frame.locator("#f-account").fill("youba@example.com")
        frame.locator("#f-secret").fill("jbsw y3dp ehpk 3pxp")
        frame.locator("#save").click()
        page.wait_for_timeout(1500)
        shown = frame.locator(".code").first.inner_text().replace(" ", "")
        expected_now, expected_prev = totp(SECRET), totp(SECRET, time.time() - 2)
        check(shown in (expected_now, expected_prev), f"shows the correct 2FA code ({shown})")
        shot(page, "editor-authenticator")

        frame.locator("#add").click()
        frame.locator("#f-secret").fill(
            "otpauth://totp/ACME%20Co:jane@acme.test?secret=HXDMVJECJJWSRB3HWIZR4IFUGFTMXBOZ&issuer=ACME%20Co"
        )
        frame.locator("#f-secret").dispatch_event("change")
        page.wait_for_timeout(300)
        check(frame.locator("#f-service").input_value() == "ACME Co", "otpauth:// link fills in the account")
        frame.locator("#save").click()
        page.wait_for_timeout(1500)
        check(frame.locator(".card").count() == 2, "two accounts listed")

        # ------------------------------------------------------------ Spreadsheet
        sheet = new_note_of_type(page, "Spreadsheet", "Batch costs")
        sheet.locator(".x-spreadsheet").wait_for(timeout=15000)
        check(True, "Spreadsheet editor loads inside the note")
        overlay = sheet.locator(".x-spreadsheet-overlayer")
        box = overlay.bounding_box()
        # Cell A1 sits just right of the row numbers and below the column header.
        page.mouse.click(box["x"] + 60 + 50, box["y"] + 25 + 12)
        for value in ("12", "30", "=SUM(A1:A2)"):
            page.keyboard.type(value[0])
            page.wait_for_timeout(300)  # the first key opens the cell editor
            page.keyboard.type(value[1:], delay=80)
            page.wait_for_timeout(200)
            page.keyboard.press("Enter")
            page.wait_for_timeout(300)
        page.wait_for_timeout(1500)
        shot(page, "editor-spreadsheet")

        # ------------------------------------------------ Persistence after reload
        page.reload()
        page.wait_for_timeout(4000)
        page.keyboard.press("Escape")
        page.get_by_text("My 2FA codes").first.click()
        page.wait_for_timeout(3000)
        reopened = page.frame_locator("iframe").first
        check(reopened.locator(".card").count() == 2, "authenticator accounts are still there after a reload")

        page.get_by_text("Batch costs").first.click()
        page.wait_for_timeout(3000)
        check(page.get_by_text("12 · 30").count() > 0, "spreadsheet note keeps its cells after a reload")

        errors = page.errors
        check(not errors, "no JavaScript errors" + (f": {errors[:3]}" if errors else ""))
        browser.close()
    print("All editor checks passed.")


if __name__ == "__main__":
    main()
