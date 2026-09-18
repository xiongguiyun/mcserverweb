import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { startPreview } from "./preview-server.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const preview = await startPreview();
const browser = await chromium.launch({
  headless: true,
  ...(process.env.BROWSER_PATH ? { executablePath: process.env.BROWSER_PATH } : {}),
});
const output = resolve(process.env.TEST_ARTIFACTS || ".wrangler/regression-artifacts");
await mkdir(output, { recursive: true });
const errors = [];
const context = await browser.newContext({ viewport: { width: 1067, height: 912 } });
await context.route("https://player.bilibili.com/**", (route) => route.fulfill({
  contentType: "text/html", body: '<body style="background:#263b46;color:white">Video test frame</body>',
}));
await context.route("**/api/minecraft-image/**", (route) => route.fulfill({ status: 404 }));
const page = await context.newPage();
page.on("pageerror", (error) => errors.push(error.message));

try {
  await page.goto(`${preview.url}/__test/login?role=owner`);
  await page.locator("#adminTrash .empty").waitFor();
  assert.equal(await page.locator("#adminTrash").isVisible(), true, "Trash loads without hash or shortcut");
  assert.equal(await page.locator("#trashDock").count(), 0);

  await page.locator("#openAdminCreateUser").click();
  await page.locator("#adminCreateUser").waitFor({ state: "visible" });
  assert.equal(await page.locator("#adminUsersPanel").isVisible(), true);
  assert.equal(await page.locator("#adminCreateUser").evaluate((dialog) => dialog.open), true);
  await page.locator("#adminUsername").fill("CreatedAdmin");
  await page.locator("#adminPassword").fill("test-only-password");
  await page.waitForTimeout(800);
  await page.screenshot({ path: resolve(output, "admin-create-secondary.png") });
  await page.locator("#adminUserForm button[type=submit]").click();
  await page.locator("#adminUsers").getByText("CreatedAdmin", { exact: true }).waitFor();
  await page.locator("#adminCreateUser").waitFor({ state: "hidden" });
  assert.equal(await page.locator("#adminUserForm").isVisible(), false);
  const row = page.locator(".user-row").filter({ has: page.getByText("AdminTest", { exact: true }) });
  assert.deepEqual(
    await row.locator(".row-actions > *").evaluateAll((nodes) =>
      nodes.map((node) =>
        node.matches(".user-more-menu") ? "more" : node.matches("[data-role-user]") ? "role" : node.matches("[data-remove-user]") ? "delete" : "other",
      ),
    ),
    ["more", "role", "delete"],
  );
  assert.equal(await row.locator("[data-rename-user]").isVisible(), false);
  await row.locator(".user-more-menu summary").click();
  const menu = page.locator('.fui-popover-menu[aria-label="账号操作"]').filter({ visible: true });
  await menu.waitFor();
  await page.waitForTimeout(350);
  await page.screenshot({ path: resolve(output, "admin-user-more.png") });
  await menu.getByText("改名", { exact: true }).click();
  await page.locator(".site-modal-dialog[open] input").waitFor();
  assert.equal(await page.locator(".site-modal-dialog[open] input").inputValue(), "AdminTest");
  await page.keyboard.press("Escape");
  await page.locator(".site-modal-dialog[open]").waitFor({ state: "hidden" });
  await row.locator(".user-more-menu summary").click();
  await menu.getByText("改密码", { exact: true }).click();
  await page.locator(".site-modal-dialog[open] input[type=password]").waitFor();
  await page.keyboard.press("Escape");
  await page.locator(".site-modal-dialog[open]").waitFor({ state: "hidden" });

  // Separate edit hosts prevent typing in the body from mutating the summary.
  await page.locator("#editor").click();
  await page.locator("#detailsButton").click();
  const title = page.locator("#editor .inline-details-title");
  const body = page.locator("#editor .inline-details-body");
  await title.waitFor();
  await title.click({ position: { x: 70, y: 14 } });
  assert.equal(await title.evaluate((el) => el.closest("details").open), true);
  await title.fill("Custom title");
  await title.press("End");
  await page.keyboard.type("   ");
  assert.equal(await title.textContent(), "Custom title   ");
  await title.press("Enter");
  assert.equal(await body.evaluate((el) => document.activeElement === el), true);
  await body.fill("Body text");
  await body.press("End");
  await page.keyboard.type("     tail");
  assert.match((await body.textContent()).replace(/\u00a0/g, " "), /Body text     tail/);
  assert.equal(await title.textContent(), "Custom title   ");
  await body.press("Control+Home");
  await page.keyboard.press("Backspace");
  assert.equal(await title.textContent(), "Custom title   ");
  await title.fill("");
  await page.keyboard.type("Restored title");
  assert.equal(await title.textContent(), "Restored title");
  assert.match((await body.textContent()).replace(/\u00a0/g, " "), /Body text     tail/);
  await title.click({ position: { x: 4, y: 14 } });
  await page.waitForTimeout(320);
  assert.equal(await title.evaluate((el) => el.closest("details").open), false);
  await title.press("Enter");
  assert.equal(await title.evaluate((el) => el.closest("details").open), true);
  assert.equal(await body.evaluate((el) => document.activeElement === el), true);
  assert.equal(await page.locator("#editor summary").count(), 1);
  assert.doesNotMatch(await page.locator("#editor").textContent(), /详情/);
  await page.screenshot({ path: resolve(output, "details-separate-editing.png") });
  await page.locator("#previewButton").click();
  assert.equal(await page.locator("#previewContent [contenteditable]").count(), 0);
  await page.locator("#previewDialog [data-dialog-close]").click();
  await page.locator("#previewDialog").waitFor({ state: "hidden" });
  await page.locator("#title").fill("Editable fold test");
  await page.locator("#publishForm button[type=submit]").click();
  await page.locator("#manageAnnouncements").getByText("Editable fold test", { exact: true }).waitFor();
  const saved = await preview.fixture.call("/announcements");
  const html = saved.data.items.find((item) => item.title === "Editable fold test").content_html;
  assert.doesNotMatch(html, /contenteditable|data-editable-details/);
  assert.match(html, /inline-details-title/);
  assert.match(html, /inline-details-body/);

  await page.goto(`${preview.url}/profile.html?user=OwnerTest`);
  const setting = page.locator(".profile-setting").filter({ has: page.locator("#profileUsernameForm") });
  await setting.waitFor();
  for (let cycle = 0; cycle < 3; cycle++) {
    await setting.locator("summary").click();
    assert.equal(await setting.evaluate((el) => el.getAnimations().some((a) => a.id === "details-toggle")), true);
    await page.waitForTimeout(320);
    const expanded = (await setting.boundingBox()).height;
    assert.ok(expanded > 150);
    await setting.locator("summary").click();
    assert.equal(await setting.evaluate((el) => el.open), true, "Content remains rendered during closing motion");
    assert.equal(await setting.evaluate((el) => el.getAnimations().some((a) => a.id === "details-toggle")), true);
    await page.waitForTimeout(320);
    assert.equal(await setting.evaluate((el) => el.open), false);
    assert.ok((await setting.boundingBox()).height < 70);
  }
  await setting.locator("summary").click();
  await page.waitForTimeout(35);
  await setting.locator("summary").click();
  await page.waitForTimeout(320);
  assert.equal(await setting.evaluate((el) => el.open), false);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await setting.locator("summary").click();
  assert.equal(await setting.evaluate((el) => el.open && el.getAnimations().length === 0), true);
  await page.emulateMedia({ reducedMotion: "no-preference" });

  await page.setViewportSize({ width: 365, height: 698 });
  await page.goto(`${preview.url}/forum.html`);
  await page.locator("#openPostComposer").click();
  for (const id of ["fontSizeSelect", "blockFormatSelect", "alignSelect"]) {
    const select = page.locator(`#${id}`);
    await select.locator("xpath=..").locator(".tg-select-trigger").click();
    const popover = page.locator(".tg-select-popover:not([hidden])");
    await popover.waitFor();
    assert.equal(await popover.evaluate((element) => element.matches(":popover-open")), true);
    await popover.locator(".tg-option").first().click();
    assert.equal(await select.inputValue(), "");
    assert.equal(await popover.isVisible(), false);
  }
  await page.keyboard.press("Escape");
  await page.locator("#postDialog").waitFor({ state: "hidden" });
  await page.locator(".read-button").first().click();
  await page.locator("[data-comment-composer-toggle]").click();
  await page.locator("[data-comment-toolbar-toggle]").click();
  const toolbar = page.locator("[data-comment-toolbar-drawer]");
  await toolbar.waitFor();
  await page.locator("[data-comment-composer]").scrollIntoViewIfNeeded();
  await page.waitForTimeout(350);
  const tools = await toolbar.evaluate((el) => ({
    width: el.clientWidth, scrollWidth: el.scrollWidth,
    buttons: [...el.querySelectorAll("button,label")].map((item) => {
      const box = item.getBoundingClientRect();
      const parent = el.getBoundingClientRect();
      return { width: box.width, height: box.height, fits: box.left >= parent.left && box.right <= parent.right + 1 };
    }),
  }));
  assert.equal(tools.scrollWidth, tools.width);
  assert.equal(tools.buttons.length, 8);
  assert.ok(tools.buttons.every((item) => item.width >= 40 && item.height >= 40 && item.fits));
  assert.equal(await toolbar.locator("button svg").count(), 7);
  await page.screenshot({ path: resolve(output, "comment-tools-mobile.png") });
  await page.locator("[data-comment-editor]").fill("Formatted reply");
  await page.locator("[data-comment-editor]").press("Control+a");
  await page.locator('[data-comment-command="bold"]').click();
  assert.match(await page.locator("[data-comment-editor]").innerHTML(), /<(b|strong)>/);

  const member = await browser.newContext({ viewport: { width: 365, height: 698 } });
  await member.addCookies([{ name: "session", value: "test-member", url: preview.url }]);
  const memberPage = await member.newPage();
  memberPage.on("pageerror", (error) => errors.push(error.message));
  await preview.fixture.call("/posts/1", { role: "member", method: "DELETE" });
  await memberPage.goto(`${preview.url}/profile.html?user=MemberTest`);
  await memberPage.locator("#profileTrashButton").click();
  await memberPage.locator("#profileTrashOverlay").waitFor({ state: "visible" });
  assert.match(await memberPage.locator("#profileTrashOverlay").textContent(), /Test post/);
  await memberPage.locator("#profileTrashOverlay").getByRole("button", { name: "恢复", exact: true }).click();
  await memberPage.waitForFunction(() => !document.querySelector("#profileTrashOverlay").textContent.includes("Test post"));
  const restored = await preview.fixture.call("/posts");
  assert.ok(restored.data.items.some((post) => post.id === 1));
  await memberPage.goto(`${preview.url}/profile.html?user=OwnerTest`);
  assert.equal(await memberPage.locator("#profileTrashButton").count(), 0);
  await member.close();
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, settingsAnimationCycles: 3, commentTools: tools, pageErrors: errors, screenshots: output }, null, 2));
} finally {
  await browser.close();
  await preview.close();
}
