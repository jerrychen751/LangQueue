import asyncio
from playwright.async_api import async_playwright, Page, expect

async def main():
    path_to_extension = "dist"
    user_data_dir = "/tmp/test-user-data-dir"

    async with async_playwright() as p:
        context = await p.chromium.launch_persistent_context(
            user_data_dir,
            headless=True,
            channel="chromium",
            args=[
                f"--disable-extensions-except={path_to_extension}",
                f"--load-extension={path_to_extension}",
            ],
        )

        # It can take a moment for the extension to load, so we'll wait for the service worker.
        try:
            service_worker = context.service_workers[0]
        except IndexError:
            service_worker = await context.wait_for_event('serviceworker')

        extension_id = service_worker.url.split('/')[2]

        # Navigate to a page where the extension should be active
        page = await context.new_page()
        await page.goto("https://www.google.com", wait_until="load")

        # Open the extension popup
        popup_page = await context.new_page()
        await popup_page.goto(f"chrome-extension://{extension_id}/popup.html")

        # Wait for the preloader to disappear
        await expect(popup_page.locator("#preloader")).to_be_hidden(timeout=15000)

        # Now, look for the text within the main application
        await expect(popup_page.locator("#root").get_by_text("LangQueue")).to_be_visible()

        # Give it a moment to render the content
        await popup_page.wait_for_selector("text=New Prompt", timeout=15000)

        # Take a screenshot
        await popup_page.screenshot(path="jules-scratch/verification/verification.png")

        await context.close()

if __name__ == "__main__":
    asyncio.run(main())