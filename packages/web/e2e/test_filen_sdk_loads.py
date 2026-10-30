"""Rite end-to-end: the real Filen SDK (not the test stand-in) loads and runs in the built app.

Regression test for "Super constructor null of anonymous class is not a constructor", which
appeared as soon as someone tapped "Connect Filen". Uses made-up credentials, so the expected
outcome is an ordinary sign-in or network error from Filen, never a crash of the SDK itself.

Run after `yarn build:web`:  python3 packages/web/e2e/test_filen_sdk_loads.py
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from harness import serve_dist  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

PORT = 3072


def check(condition, message):
    print(("PASS  " if condition else "FAIL  ") + message)
    if not condition:
        raise SystemExit(1)


def main():
    serve_dist(PORT)
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        calls = []

        def filen_api(route):
            # Stand in for Filen's servers: answer every API call with "wrong email or password".
            calls.append(route.request.url)
            route.fulfill(
                status=200,
                content_type="application/json",
                body='{"status":false,"code":"email_or_password_wrong","message":"Invalid email or password.","data":null}',
            )

        page.route("**/*.filen.io/**", filen_api)
        page.route("**/*.filen.net/**", filen_api)
        page.goto(f"http://127.0.0.1:{PORT}/")
        page.wait_for_timeout(4000)
        page.get_by_text("Create free account").click()
        page.get_by_role("radio", name="Filen").click()
        page.get_by_role("button", name="Connect Filen").first.click()
        page.get_by_placeholder("Filen email").fill("nobody@rite.invalid")
        page.get_by_placeholder("Filen password").fill("not-a-real-password")
        page.get_by_role("button", name="Connect Filen").last.click()

        error = page.locator(".text-danger").first
        error.wait_for(timeout=60000)
        text = error.inner_text()
        print("Filen answered:", text, "| API calls:", calls[:3])
        check(len(calls) > 0, "the Filen SDK reached Filen's API")
        check("constructor" not in text.lower(), "the Filen SDK loads and runs (no constructor crash)")
        browser.close()
    print("Filen SDK check passed.")


if __name__ == "__main__":
    main()
