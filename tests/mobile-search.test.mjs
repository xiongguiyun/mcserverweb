import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { startPreview } from "./preview-server.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const preview = await startPreview();
preview.fixture.sqlite.exec(`
  INSERT INTO announcements (title, content_html, author_id, deleted_by, deleted_at)
  VALUES ('Deleted test', '<p>Trash</p>', 1, 1, CURRENT_TIMESTAMP);
`);
const browser = await chromium.launch({
  headless: true,
  ...(process.env.BROWSER_PATH ? { executablePath: process.env.BROWSER_PATH } : {}),
});
const output = resolve(process.env.TEST_ARTIFACTS || ".wrangler/regression-artifacts");
await mkdir(output, { recursive: true });
const errors = [];
const checks = [];

const geometry = async (button, root) => {
  await button.scrollIntoViewIfNeeded();
  await button.page().waitForTimeout(350);
  const bounds = await root.boundingBox();
  const box = await button.boundingBox();
  assert.ok(box.width >= 34 && box.height >= 34, JSON.stringify(box));
  assert.ok(box.x >= bounds.x - 1 && box.x + box.width <= bounds.x + bounds.width + 1,
    JSON.stringify({ bounds, box }));
  assert.equal(await button.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
  }), true, "Search must not be clipped or covered");
  return { x: box.x - bounds.x, y: box.y - bounds.y, width: box.width, height: box.height };
};

try {
  for (const width of [320, 365, 390, 620, 689, 768, 1067, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 698 } });
    await context.route("**/api/minecraft-image/**", (route) => route.fulfill({ status: 404 }));
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${preview.url}/__test/login?role=owner`);
    await page.locator("#adminUsers .table-row").first().waitFor();
    await page.goto(`${preview.url}/admin.html#adminTrash`);
    await page.locator("#adminTrash .table-row").first().waitFor();
    assert.equal(await page.locator("#trashDock").count(), 0);
    for (const key of ["announcements", "posts", "reports", "users", "trash"]) {
      const root = page.locator(`[data-admin-search-root="${key}"]`);
      const button = page.locator(`[data-admin-search-toggle="${key}"]`);
      const panel = page.locator(`[data-admin-search-panel="${key}"]`);
      const input = page.locator(`[data-admin-search="${key}"]`);
      const before = await geometry(button, root);
      assert.ok((await root.boundingBox()).height <= 46, "Closed toolbar must not reserve an input row");
      await button.click();
      await page.waitForTimeout(260);
      assert.equal(await panel.isVisible(), true);
      const after = await geometry(button, root);
      if (width <= 620) {
        assert.ok(Math.abs(before.x - after.x) < 1 && Math.abs(before.y - after.y) < 1, JSON.stringify({ message: "Toggle must stay in place", width, key, before, after }));
      }
      const inputBox = await input.boundingBox();
      const panelBox = await panel.boundingBox();
      assert.ok(inputBox.width >= 100 && panelBox.x >= 0 && panelBox.x + panelBox.width <= width, JSON.stringify({ width, key, inputBox, panelBox }));
      await input.fill("no-matching-item-xyz");
      await page.waitForTimeout(160);
      assert.match(await root.textContent(), /已筛选 0\//);
      if (width === 365) await page.screenshot({ path: resolve(output, `search-mobile-${key}-open.png`) });
      await page.locator(`[data-admin-search-clear="${key}"]`).click();
      await page.waitForTimeout(160);
      assert.equal(await input.inputValue(), "");
      await button.click();
      assert.equal(await panel.isVisible(), false);
      if (width === 365 && key === "announcements") {
        await page.locator("#adminAnnouncements").scrollIntoViewIfNeeded();
        await page.screenshot({ path: resolve(output, "search-mobile-announcements-closed.png") });
      }
      checks.push({ width, key, button: before });
    }
    for (const [path, rootSelector, buttonSelector, panelSelector, inputSelector] of [
      ["/forum.html", ".forum-toolbar-actions", "#forumSearchToggle", "#forumSearchPanel", "#forumSearchInput"],
      ["/profile.html?user=MemberTest", ".profile-post-toolbar", "#profilePostSearchToggle", "#profilePostSearchPanel", "#profilePostSearchInput"],
    ]) {
      await page.goto(preview.url + path);
      const root = page.locator(rootSelector);
      const button = page.locator(buttonSelector);
      await button.waitFor();
      await geometry(button, root);
      const closedHeight = await root.evaluate((el) => el.getBoundingClientRect().height);
      await button.click();
      await page.waitForTimeout(260);
      await geometry(button, root);
      const input = page.locator(inputSelector);
      const inputBox = await input.boundingBox();
      assert.ok(inputBox.width > 100 && inputBox.x >= 0 && inputBox.x + inputBox.width <= width, JSON.stringify({ path, width, inputBox }));
      await input.fill("no-matching-item-xyz");
      await page.waitForTimeout(200);
      await geometry(button, root);
      if (width === 365) await page.screenshot({ path: resolve(output, path.includes("profile") ? "search-mobile-profile-open.png" : "search-mobile-forum-open.png") });
      await input.press("Escape");
      await page.waitForTimeout(260);
      {
        assert.equal(await page.locator(panelSelector).isVisible(), false);
        assert.ok(Math.abs((await root.boundingBox()).height - closedHeight) < 2);
      }
      assert.equal(await page.locator("#trashDock").count(), 0);
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: checks.length, viewports: [320, 365, 390, 620, 689, 768, 1067, 1440], sample: checks.find((check) => check.width === 365), pageErrors: errors, screenshots: output }, null, 2));
} finally {
  await browser.close();
  await preview.close();
}
