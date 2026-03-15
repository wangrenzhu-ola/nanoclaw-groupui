from playwright.sync_api import sync_playwright


def main() -> None:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        console_errors: list[str] = []

        def on_console(msg):
            if msg.type == "error":
                console_errors.append(msg.text)

        page.on("console", on_console)
        page.goto("http://127.0.0.1:3003/r2-acceptance")
        page.wait_for_load_state("networkidle")

        page.locator("#mentionBtn").click()
        page.wait_for_timeout(600)
        mention_text = page.locator("#mentionResult").inner_text().strip()

        page.locator("#editBtn").click()
        page.wait_for_timeout(600)
        edit_text = page.locator("#editResult").inner_text().strip()

        page.locator("#recallBtn").click()
        page.wait_for_timeout(600)
        recall_text = page.locator("#recallResult").inner_text().strip()

        page.screenshot(path="/tmp/r2-acceptance-after-clicks.png", full_page=True)
        browser.close()

    if not mention_text:
        raise SystemExit("mentionResult is empty")
    if not edit_text:
        raise SystemExit("editResult is empty")
    if not recall_text:
        raise SystemExit("recallResult is empty")
    print("R2_PAGE_OK")
    print("MENTION_RESULT:", mention_text[:300])
    print("EDIT_RESULT:", edit_text[:300])
    print("RECALL_RESULT:", recall_text[:300])
    if console_errors:
        print("CONSOLE_ERRORS:", " | ".join(console_errors))
    print("SCREENSHOT:/tmp/r2-acceptance-after-clicks.png")


if __name__ == "__main__":
    main()
