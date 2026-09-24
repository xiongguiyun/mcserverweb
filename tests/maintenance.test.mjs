import test from "node:test";
import assert from "node:assert/strict";
import { createFixture } from "./support.mjs";

test("shared maintenance copy, approval permissions, conflicts and immediate guest state", async () => {
  const fixture = createFixture();
  const { call } = fixture;
  try {
    let response = await call("/admin/settings/maintenance");
    assert.equal(response.data.customMaintenanceTitle, "");
    assert.equal(response.data.customMaintenanceDescription, "");
    assert.equal(response.data.pendingMaintenance, null);

    const before = fixture.counts();
    response = await call("/admin/settings/maintenance", {
      method: "PUT", body: { title: "Owner title", description: "Line one\nLine two", enabled: true },
    });
    assert.equal(response.status, 200);
    assert.equal(response.data.maintenanceTitle, "Owner title");
    assert.equal(fixture.counts().batches - before.batches, 1);
    // No schema migrations or unrelated background writes on the settings hot path.
    assert.equal(fixture.counts().writes - before.writes, 4);
    const guest = await call("/me", { role: null });
    assert.equal(guest.data.site.maintenanceTitle, "Owner title");
    assert.equal(guest.data.site.maintenanceDescription, "Line one\nLine two");
    assert.equal(guest.headers.get("cache-control"), "no-store");

    const admin = await call("/admin/settings/maintenance", { role: "admin" });
    assert.equal(admin.data.customMaintenanceTitle, "Owner title");
    response = await call("/admin/settings/maintenance", {
      role: "admin", method: "PUT", body: { title: "Proposed title", description: "Proposed description" },
    });
    assert.equal(response.data.approvalRequired, true);
    const proposal = response.data.pendingMaintenance;
    assert.equal(proposal.requesterId, 2);
    assert.equal(response.data.maintenanceTitle, "Owner title");
    assert.equal((await call("/me", { role: null })).data.site.maintenanceTitle, "Owner title");
    assert.equal((await call("/admin/settings/maintenance", {
      role: "other", method: "PUT", body: { title: "Overwrite attempt" },
    })).status, 409);
    assert.equal((await call("/admin/settings/maintenance/review", {
      role: "admin", method: "POST", body: { id: proposal.id, action: "approve" },
    })).status, 403);
    assert.equal((await call("/admin/settings/maintenance", {
      role: "member", method: "PUT", body: { title: "Unauthorized" },
    })).status, 403);
    assert.equal((await call("/admin/settings/maintenance", { role: null })).status, 401);
    assert.equal((await call("/admin/settings/maintenance/review", {
      method: "POST", body: { id: "stale", action: "approve" },
    })).status, 409);
    response = await call("/admin/settings/maintenance/review", {
      method: "POST", body: { id: proposal.id, action: "approve" },
    });
    assert.equal(response.data.maintenanceTitle, "Proposed title");
    assert.equal(response.data.pendingMaintenance, null);
    assert.equal((await call("/me", { role: null })).data.site.maintenanceTitle, "Proposed title");
    assert.equal((await call("/admin/settings/maintenance/review", {
      method: "POST", body: { id: proposal.id, action: "approve" },
    })).status, 409);

    response = await call("/admin/settings/maintenance", {
      role: "admin", method: "PUT", body: { title: "Rejected", description: "Rejected" },
    });
    response = await call("/admin/settings/maintenance/review", {
      method: "POST", body: { id: response.data.pendingMaintenance.id, action: "reject" },
    });
    assert.equal(response.data.maintenanceTitle, "Proposed title");
    assert.equal(response.data.pendingMaintenance, null);
    response = await call("/admin/settings/maintenance", { role: "admin", method: "PUT", body: { enabled: false } });
    assert.equal(response.data.maintenanceMode, false);
    assert.equal(response.data.customMaintenanceTitle, "Proposed title");
    response = await call("/admin/settings/maintenance", { method: "PUT", body: { title: "", description: "" } });
    assert.equal(response.data.customMaintenanceTitle, "");
    assert.equal(response.data.customMaintenanceDescription, "");
    assert.notEqual(response.data.maintenanceTitle, "");
  } finally {
    fixture.sqlite.close();
  }
});

test("admin data and nested video survive API round trips", async () => {
  const fixture = createFixture();
  try {
    for (const path of ["/announcements", "/posts", "/admin/stats", "/admin/users", "/admin/reports", "/admin/trash"]) {
      assert.equal((await fixture.call(path)).status, 200, path);
    }
    const contentHtml = '<details class="inline-details" open><summary>Video</summary><blockquote class="inline-quote"><iframe src="https://player.bilibili.com/player.html?bvid=BV1xx411c7mD&autoplay=0" width="640" height="360"></iframe></blockquote></details>';
    const saved = await fixture.call("/announcements", { method: "POST", body: { title: "Nested video", contentHtml } });
    assert.equal(saved.status, 201);
    const list = await fixture.call("/announcements");
    const html = list.data.items.find((item) => item.title === "Nested video").content_html;
    assert.match(html, /<details[\s\S]*<blockquote[\s\S]*<iframe/);
    assert.match(html, /width="640" height="360"/);
    assert.match(html, /referrerpolicy="strict-origin-when-cross-origin"/);
  } finally {
    fixture.sqlite.close();
  }
});
