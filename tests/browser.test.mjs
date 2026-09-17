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
const contexts = [];
const login = async (role, viewport = { width: 1440, height: 1000 }) => {
  const context = await browser.newContext({ viewport });
  contexts.push(context);
  // Deterministic frame fixture tests our geometry, not Bilibili's external service.
  await context.route("https://player.bilibili.com/**", (route) => route.fulfill({
    contentType: "text/html",
    body: '<!doctype html><html><body style="margin:0;background:#292f37;color:white"><video controls style="width:100%;height:100%"></video></body></html>',
  }));
  await context.route("**/api/minecraft-image/**", (route) => route.fulfill({ status: 404 }));
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${preview.url}/__test/login?role=${role}`);
  await page.locator("#statsGrid .stat-card").first().waitFor();
  return page;
};
const text = async (page, selector) => page.locator(selector).textContent();
const openEditor = async (page) => {
  await page.locator("#maintenanceEditorToggle").click();
  assert.equal(await page.locator("#maintenanceEditorPanel").evaluate((el) => el.open && el.matches(":modal")), true);
  await page.waitForTimeout(350);
};
const saveEditor = async (page, title, description) => {
  await page.locator("#maintenanceTitleInput").fill(title);
  await page.locator("#maintenanceDescriptionInput").fill(description);
  await page.locator("#maintenanceSettingsForm button[type=submit]").click();
  await page.locator("#maintenanceEditorPanel").waitFor({ state: "hidden" });
};

try {
  const owner = await login("owner");
  for (const [selector, expected] of [
    ["#manageAnnouncements", "Test announcement"], ["#managePosts", "Test post"],
    ["#adminReportsTable", "Test report"], ["#adminUsers", "OwnerTest"],
  ]) {
    await owner.locator(selector).getByText(expected, { exact: false }).first().waitFor();
  }
  assert.equal(await owner.locator("#trashDock").count(), 0);
  await openEditor(owner);
  assert.equal(await owner.locator("#maintenanceTitleInput").inputValue(), "");
  assert.equal(await owner.locator("#maintenanceDescriptionInput").inputValue(), "");
  assert.equal(await owner.locator("#adminOverview").isVisible(), true);
  await owner.screenshot({ path: resolve(output, "maintenance-dialog-desktop.png") });
  const writes = [];
  owner.on("request", (request) => { if (request.url().includes("/api/")) writes.push(request.url()); });
  await saveEditor(owner, "Shared maintenance title", "Shared description\nSecond line");
  assert.equal(writes.filter((url) => /\/api\/admin\/(stats|users|reports)/.test(url)).length, 0);
  await openEditor(owner);
  assert.equal(await owner.locator("#maintenanceTitleInput").inputValue(), "Shared maintenance title");
  await owner.locator("#maintenanceEditorPanel [data-dialog-close]").first().click();
  await owner.locator("#maintenanceEditorPanel").waitFor({ state: "hidden" });
  await owner.locator("#adminMaintenance .tg-toggle").click();
  await owner.waitForFunction(() => document.querySelector("#maintenanceStatusText").textContent.includes("已开启"));

  const guest = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  guest.on("pageerror", (error) => errors.push(error.message));
  await guest.goto(preview.url);
  await guest.locator("#maintenanceGate").waitFor({ state: "visible" });
  assert.match(await text(guest, "#maintenanceGate"), /Shared maintenance title/);
  assert.match(await text(guest, "#maintenanceGate"), /Second line/);
  await guest.screenshot({ path: resolve(output, "maintenance-gate-desktop.png") });

  const admin = await login("admin");
  await openEditor(admin);
  assert.equal(await admin.locator("#maintenanceTitleInput").inputValue(), "Shared maintenance title");
  assert.equal(await admin.locator("#maintenanceSettingsForm button[type=submit]").textContent(), "发送审批");
  await saveEditor(admin, "Pending title", "Pending description");
  assert.equal(await admin.locator("#maintenanceReviewButton").isVisible(), true);
  await guest.reload();
  await guest.locator("#maintenanceGate").waitFor({ state: "visible" });
  assert.match(await text(guest, "#maintenanceGate"), /Shared maintenance title/);
  await owner.reload();
  await owner.locator("#maintenanceReviewButton").waitFor({ state: "visible" });
  await owner.locator("#maintenanceReviewButton").click();
  await owner.locator("#maintenanceReviewDialog").waitFor({ state: "visible" });
  await owner.waitForTimeout(300);
  assert.equal(await text(owner, "#maintenanceReviewTitle"), "Pending title");
  await owner.screenshot({ path: resolve(output, "maintenance-approval-desktop.png") });
  await owner.locator('[data-maintenance-review="approve"]').click();
  await owner.locator("#maintenanceReviewDialog").waitFor({ state: "hidden" });
  assert.equal(await owner.locator("#maintenanceReviewButton").isVisible(), false);
  await guest.reload();
  await guest.locator("#maintenanceGate").waitFor({ state: "visible" });
  assert.match(await text(guest, "#maintenanceGate"), /Pending title/);

  await owner.locator('.admin-sidebar:not(.admin-sidebar-drawer) a[href="#adminTrash"]').click();
  await owner.locator("#adminTrash .empty").waitFor();
  assert.equal(await owner.locator("#trashDock").count(), 0);
  assert.equal(await owner.locator("#adminOverview").isVisible(), true);

  // Insert through the real toolbar, then drag an edge and wrap the selected video.
  await owner.locator("#editor").click();
  await owner.locator("#bilibiliButton").click();
  await owner.locator(".site-modal-dialog[open] input").fill("BV1xx411c7mD");
  await owner.locator(".site-modal-dialog[open] .is-primary").click();
  await owner.locator(".site-modal-dialog[open] input").fill("640x360");
  await owner.locator(".site-modal-dialog[open] .is-primary").click();
  await owner.locator("#editor iframe").waitFor();
  await owner.locator(".site-modal-dialog[open]").waitFor({ state: "hidden" });
  await owner.locator("#editor iframe").scrollIntoViewIfNeeded();
  await owner.waitForTimeout(350);
  const before = await owner.locator("#editor iframe").boundingBox();
  assert.ok(before.height > 300, JSON.stringify(before));
  await owner.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
  await owner.waitForTimeout(120);
  assert.equal(await owner.locator(".editor-video-resize").isVisible(), false);
  await owner.mouse.click(before.x + before.width / 2, before.y + before.height / 2);
  await owner.locator(".editor-video-resize").waitFor({ state: "visible" });
  await owner.locator("#title").click();
  assert.equal(await owner.locator(".editor-video-resize").isVisible(), false);
  await owner.locator("#editor iframe").scrollIntoViewIfNeeded();
  const selectedFrame = await owner.locator("#editor iframe").boundingBox();
  await owner.mouse.click(selectedFrame.x + selectedFrame.width / 2, selectedFrame.y + selectedFrame.height / 2);
  await owner.locator(".editor-video-resize").waitFor({ state: "visible" });
  const handle = owner.locator(".editor-video-resize .edge-e");
  const box = await handle.boundingBox();
  assert.ok(box && Math.abs(box.x + box.width / 2 - selectedFrame.x - selectedFrame.width) < 3, JSON.stringify({ box, selectedFrame }));
  await owner.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await owner.mouse.down();
  await owner.mouse.move(box.x + box.width / 2 - 100, box.y + box.height / 2, { steps: 8 });
  await owner.mouse.up();
  const after = await owner.locator("#editor iframe").boundingBox();
  assert.ok(after.width < before.width - 80, JSON.stringify({ before, after }));
  await owner.locator("#detailsButton").click();
  assert.equal(await owner.locator(".editor-video-resize").isVisible(), false);
  assert.equal(await owner.locator("#editor details iframe").count(), 1);
  await owner.locator("#moreButton").click();
  await owner.locator("#quoteButton").click();
  assert.equal(await owner.locator("#editor blockquote details iframe").count(), 1);
  await owner.locator("#editor details summary").click({ position: { x: 4, y: 14 } });
  await owner.waitForTimeout(310);
  assert.equal(await owner.locator("#editor details").evaluate((el) => el.open), false);
  await owner.locator("#editor details summary").click({ position: { x: 4, y: 14 } });
  await owner.waitForTimeout(310);
  assert.equal(await owner.locator("#editor details").evaluate((el) => el.open), true);
  await owner.screenshot({ path: resolve(output, "nested-video-desktop.png") });

  // One failed endpoint must not suppress other management panels.
  await owner.route("**/api/admin/reports?*", (route) => route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"Test unavailable"}' }));
  await owner.reload();
  await owner.locator("#adminReportsTable [data-load-retry]").waitFor();
  assert.match(await text(owner, "#manageAnnouncements"), /Test announcement/);
  assert.match(await text(owner, "#adminUsers"), /OwnerTest/);
  await owner.unroute("**/api/admin/reports?*");
  await owner.locator("#adminReportsTable [data-load-retry]").click();
  await owner.locator("#adminReportsTable").getByText("Test report", { exact: false }).waitFor();

  await owner.route("**/api/admin/settings/maintenance", (route) => {
    if (route.request().method() === "PUT") {
      return route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"Save unavailable"}' });
    }
    return route.continue();
  });
  await openEditor(owner);
  await owner.locator("#maintenanceTitleInput").fill("Unsaved draft");
  await owner.locator("#maintenanceSettingsForm button[type=submit]").click();
  await owner.waitForFunction(() => !document.querySelector("#maintenanceSettingsForm button[type=submit]").disabled);
  assert.equal(await owner.locator("#maintenanceTitleInput").inputValue(), "Unsaved draft");
  assert.equal(await owner.locator("#maintenanceEditorPanel").isVisible(), true);
  await owner.locator("#maintenanceEditorPanel [data-dialog-close]").first().click();
  await owner.locator("#maintenanceEditorPanel").waitFor({ state: "hidden" });
  await owner.unroute("**/api/admin/settings/maintenance");
  await openEditor(owner);
  assert.equal(await owner.locator("#maintenanceTitleInput").inputValue(), "Pending title");
  await owner.locator("#maintenanceEditorPanel [data-dialog-close]").first().click();
  await owner.locator("#maintenanceEditorPanel").waitFor({ state: "hidden" });
  await owner.locator("#adminMaintenance .tg-toggle").click();
  await owner.waitForFunction(() => document.querySelector("#maintenanceStatusText").textContent.includes("正常开放"));

  await owner.goto(`${preview.url}/forum.html`);
  await owner.locator("#openPostComposer").click();
  await owner.locator("#editor").click();
  await owner.locator("#bilibiliButton").click();
  await owner.locator(".site-modal-dialog[open] input").fill("BV1xx411c7mD");
  await owner.locator(".site-modal-dialog[open] .is-primary").click();
  await owner.locator(".site-modal-dialog[open] input").fill("640x360");
  await owner.locator(".site-modal-dialog[open] .is-primary").click();
  await owner.locator(".site-modal-dialog[open]").waitFor({ state: "hidden" });
  await owner.locator("#editor iframe").scrollIntoViewIfNeeded();
  await owner.waitForTimeout(350);
  const forumFrame = await owner.locator("#editor iframe").boundingBox();
  assert.equal(await owner.locator(".editor-video-resize").isVisible(), false);
  await owner.mouse.click(forumFrame.x + forumFrame.width / 2, forumFrame.y + forumFrame.height / 2);
  await owner.locator(".editor-video-resize").waitFor({ state: "visible" });
  const forumHandle = await owner.locator(".editor-video-resize .edge-se").boundingBox();
  assert.ok(Math.abs(forumHandle.x + forumHandle.width / 2 - forumFrame.x - forumFrame.width) < 3);
  assert.ok(Math.abs(forumHandle.y + forumHandle.height / 2 - forumFrame.y - forumFrame.height) < 3);
  await owner.mouse.move(forumHandle.x + forumHandle.width / 2, forumHandle.y + forumHandle.height / 2);
  await owner.mouse.down();
  await owner.mouse.move(forumHandle.x - 55, forumHandle.y - 30, { steps: 8 });
  await owner.mouse.up();
  assert.ok((await owner.locator("#editor iframe").boundingBox()).width < forumFrame.width - 40);
  await owner.screenshot({ path: resolve(output, "video-forum-dialog.png") });
  await owner.keyboard.press("Escape");
  await owner.locator("#postDialog").waitFor({ state: "hidden" });
  assert.equal(await owner.locator(".editor-video-resize").isVisible(), false);

  const mobile = await login("owner", { width: 390, height: 844 });
  assert.equal(await mobile.locator("#trashDock").count(), 0);
  await openEditor(mobile);
  await mobile.screenshot({ path: resolve(output, "maintenance-dialog-mobile.png") });
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await mobile.locator("#maintenanceEditorPanel [data-dialog-close]").first().click();
  await mobile.locator("#maintenanceEditorPanel").waitFor({ state: "hidden" });
  await mobile.locator("#adminSidebarToggle").click();
  await mobile.locator('#adminSidebarDrawer a[href="#adminTrash"]').click();
  await mobile.locator("#adminTrash .empty").waitFor();
  await mobile.screenshot({ path: resolve(output, "trash-mobile.png") });
  for (const path of ["/index.html", "/forum.html", "/profile.html?user=OwnerTest"]) {
    await mobile.goto(preview.url + path);
    assert.equal(await mobile.locator("#trashDock").count(), 0);
  }
  const member = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  contexts.push(member);
  await member.addCookies([{ name: "session", value: "test-member", url: preview.url }]);
  const memberPage = await member.newPage();
  memberPage.on("pageerror", (error) => errors.push(error.message));
  await memberPage.goto(`${preview.url}/forum.html`);
  assert.equal(await memberPage.locator("#trashDock").count(), 0);
  await memberPage.locator("#authActions .user-entry").click();
  await memberPage.locator("#profileTrashButton").click();
  await memberPage.locator("#profileTrashOverlay").waitFor({ state: "visible" });
  assert.match(memberPage.url(), /profile.html\?user=MemberTest/);
  await guest.close();
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, video: { before, after }, screenshots: output, pageErrors: errors }, null, 2));
} finally {
  for (const context of contexts) await context.close();
  await browser.close();
  await preview.close();
}
