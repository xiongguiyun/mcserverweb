const state = {
  me: null,
  announcements: [],
  posts: [],
  stats: null,
  admins: [],
};

const page = document.body.dataset.page;
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const api = async (path, options = {}) => {
  const response = await fetch(`/api${path}`, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    credentials: "include",
    ...options,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "请求失败");
  return payload;
};

const showToast = (message) => {
  const toast = $("#toast");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("show"), 2600);
};

const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[char]);

const textFromHtml = (html) => {
  const div = document.createElement("div");
  div.innerHTML = html || "";
  return div.textContent.replace(/\s+/g, " ").trim();
};

const formatDate = (value) =>
  new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));

const isAdmin = () => state.me?.role === "admin";
const skinName = (item) => item.minecraft_name || item.author || "Steve";
const skinUrl = (name, size = 210) => `https://mc-heads.net/body/${encodeURIComponent(name)}/${size}`;

const renderAuth = () => {
  const actions = $("#authActions");
  if (!actions) return;
  $$("[data-admin-link]").forEach((link) => {
    link.hidden = !isAdmin();
  });

  if (!state.me) {
    actions.innerHTML = `<button class="button small primary" type="button" data-open-auth>登录 / 注册</button>`;
  } else {
    actions.innerHTML = `
      <span class="user-chip">${escapeHtml(state.me.username)}${isAdmin() ? " · 管理员" : ""}</span>
      <button class="button small ghost" id="logoutButton" type="button">退出</button>
    `;
    $("#logoutButton").addEventListener("click", async () => {
      await api("/logout", { method: "POST" });
      state.me = null;
      renderAuth();
      renderProfile();
      if (page === "admin") renderAdminGate();
      showToast("已退出登录");
    });
  }

  $$("[data-open-auth]").forEach((button) => button.addEventListener("click", openAuthDialog));
};

const openAuthDialog = () => $("#authDialog")?.showModal();
const closeAuthDialog = () => $("#authDialog")?.close();

const setupAuth = () => {
  const form = $("#authForm");
  if (!form) return;
  $$("[data-close-auth]").forEach((button) => button.addEventListener("click", closeAuthDialog));
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const mode = event.submitter?.dataset.mode || "login";
    try {
      const result = await api(mode === "register" ? "/register" : "/login", {
        method: "POST",
        body: JSON.stringify({
          username: $("#username").value,
          password: $("#password").value,
        }),
      });
      state.me = result.user;
      form.reset();
      closeAuthDialog();
      renderAuth();
      renderProfile();
      showToast(mode === "register" ? "注册成功" : "登录成功");
      if (page === "admin") await loadAdminData();
    } catch (error) {
      showToast(error.message);
    }
  });
};

const cardTemplate = (item, type) => {
  const excerpt = item.excerpt || textFromHtml(item.content_html).slice(0, 96);
  const author = item.minecraft_name || item.author || "玩家";
  const skin = type === "post" ? `<img class="skin-figure" src="${skinUrl(author, 170)}" alt="" loading="lazy" />` : "";
  return `
    <article class="post-card ${type === "post" ? "forum-card" : ""}">
      ${skin}
      <h3>${escapeHtml(item.title)}</h3>
      <div class="meta">${type === "announcement" ? "公告" : "玩家论坛"} · ${escapeHtml(author)} · ${formatDate(item.created_at)}</div>
      <p>${escapeHtml(excerpt || "暂无摘要。")}</p>
      <button class="button ghost read-button" type="button" data-type="${type}" data-id="${item.id}">阅读</button>
    </article>
  `;
};

const renderLists = () => {
  const announcementList = $("#announcementList");
  if (announcementList) {
    announcementList.innerHTML = state.announcements.length
      ? state.announcements.map((item) => cardTemplate(item, "announcement")).join("")
      : `<div class="empty">还没有公告。</div>`;
  }

  const postList = $("#postList");
  if (postList) {
    postList.innerHTML = state.posts.length
      ? state.posts.map((item) => cardTemplate(item, "post")).join("")
      : `<div class="empty">还没有玩家帖子。</div>`;
  }

  $$(".read-button").forEach((button) => {
    button.addEventListener("click", () => openReader(button.dataset.type, Number(button.dataset.id)));
  });
};

const openReader = (type, id) => {
  const source = type === "announcement" ? state.announcements : state.posts;
  const item = source.find((entry) => entry.id === id);
  if (!item || !$("#readerContent")) return;
  api(`/track-view/${type}/${id}`, { method: "POST" }).catch(() => {});
  item.views = Number(item.views || 0) + 1;
  const author = item.minecraft_name || item.author || "玩家";
  $("#readerContent").innerHTML = `
    <h1>${escapeHtml(item.title)}</h1>
    <div class="meta">${escapeHtml(author)} · ${formatDate(item.created_at)} · ${item.views || 0} 次浏览</div>
    <div class="reader-body">${item.content_html}</div>
  `;
  $("#readerDialog").showModal();
};

const command = (name, value = null) => {
  const editor = $("#editor");
  if (!editor) return;
  editor.focus();
  document.execCommand(name, false, value);
};

const normalizeBilibili = (value) => {
  const trimmed = value.trim();
  const bv = trimmed.match(/BV[a-zA-Z0-9]{8,12}/)?.[0];
  if (bv) return `https://player.bilibili.com/player.html?bvid=${encodeURIComponent(bv)}`;
  const av = trimmed.match(/(?:av|aid=)(\d+)/i)?.[1];
  if (av) return `https://player.bilibili.com/player.html?aid=${encodeURIComponent(av)}`;
  return null;
};

const setupEditor = () => {
  if (!$("#editor")) return;
  $$("[data-command]").forEach((button) => {
    button.addEventListener("click", () => command(button.dataset.command));
  });
  $$("[data-format]").forEach((button) => {
    button.addEventListener("click", () => command("formatBlock", button.dataset.format));
  });
  $("#linkButton")?.addEventListener("click", () => {
    const url = window.prompt("输入链接地址");
    if (url) command("createLink", url);
  });
  $("#bilibiliButton")?.addEventListener("click", () => {
    const input = window.prompt("粘贴 Bilibili 链接、BV 号或 av 号");
    if (!input) return;
    const normalized = normalizeBilibili(input);
    if (!normalized) return showToast("没有识别到有效的 Bilibili 视频 ID");
    command("insertHTML", `<p><iframe src="${normalized}" allowfullscreen loading="lazy"></iframe></p><p><br></p>`);
  });
};

const renderProfile = () => {
  const card = $("#profileCard");
  if (!card) return;
  if (!state.me) {
    card.innerHTML = `
      <h2>玩家资料</h2>
      <div class="skin-stage placeholder-skin"></div>
      <p>登录后可以绑定正版 Minecraft 名称，并在论坛帖子中展示人物。</p>
      <button class="button primary" type="button" data-open-auth>登录 / 注册</button>
    `;
    $$("[data-open-auth]").forEach((button) => button.addEventListener("click", openAuthDialog));
    return;
  }

  const mcName = state.me.minecraft_name || "";
  card.innerHTML = `
    <h2>玩家资料</h2>
    <div class="skin-stage">
      <img src="${skinUrl(mcName || state.me.username, 210)}" alt="" loading="lazy" />
    </div>
    <div class="profile-name">
      <strong>${escapeHtml(mcName || state.me.username)}</strong>
      <span>${mcName ? "已绑定正版 Minecraft" : "未绑定 Minecraft"}</span>
    </div>
    <form id="minecraftForm" class="profile-form">
      <input id="minecraftName" placeholder="正版 Minecraft 用户名" value="${escapeHtml(mcName)}" />
      <button class="button primary" type="submit">${mcName ? "换绑" : "绑定"}</button>
      ${mcName ? `<button class="button ghost" type="button" id="unbindMinecraft">解绑</button>` : ""}
    </form>
  `;
  setupMinecraftBinding();
};

const setupMinecraftBinding = () => {
  $("#minecraftForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const minecraftName = $("#minecraftName").value.trim();
      const result = await api("/me/minecraft", {
        method: "PUT",
        body: JSON.stringify({ minecraftName }),
      });
      state.me = result.user;
      renderAuth();
      renderProfile();
      showToast("Minecraft 绑定已更新");
    } catch (error) {
      showToast(error.message);
    }
  });
  $("#unbindMinecraft")?.addEventListener("click", async () => {
    const result = await api("/me/minecraft", { method: "DELETE" });
    state.me = result.user;
    renderProfile();
    showToast("已解绑 Minecraft");
  });
};

const setupForumPost = () => {
  const form = $("#forumPostForm");
  if (!form) return;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      if (!state.me) throw new Error("请先登录");
      const title = $("#forumTitle").value.trim();
      const contentHtml = $("#editor").innerHTML.trim();
      if (!title || !textFromHtml(contentHtml)) throw new Error("标题和正文都要填写");
      await api("/posts", {
        method: "POST",
        body: JSON.stringify({ title, contentHtml }),
      });
      form.reset();
      $("#editor").innerHTML = "";
      await loadPublicData();
      showToast("帖子已发布");
    } catch (error) {
      showToast(error.message);
    }
  });
};

const resetEditor = () => {
  $("#editingId").value = "";
  $("#publishForm").reset();
  $("#editor").innerHTML = "";
  $("#contentType").disabled = false;
};

const setupPublish = () => {
  const form = $("#publishForm");
  if (!form) return;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      if (!isAdmin()) throw new Error("只有管理员可以发布内容");
      const type = $("#contentType").value;
      const id = $("#editingId").value;
      const title = $("#title").value.trim();
      const contentHtml = $("#editor").innerHTML.trim();
      if (!title || !textFromHtml(contentHtml)) throw new Error("标题和正文都要填写");
      const endpoint = type === "announcement" ? "/announcements" : "/posts";
      await api(id ? `${endpoint}/${id}` : endpoint, {
        method: id ? "PUT" : "POST",
        body: JSON.stringify({ title, contentHtml }),
      });
      resetEditor();
      await loadAdminData();
      showToast(id ? "内容已更新" : "内容已发布");
    } catch (error) {
      showToast(error.message);
    }
  });
  $("#cancelEditButton")?.addEventListener("click", resetEditor);
};

const renderAdminGate = () => {
  const shell = $("#adminShell");
  const locked = $("#adminLocked");
  if (!shell || !locked) return;
  shell.hidden = !isAdmin();
  locked.hidden = isAdmin();
};

const statCard = (label, value) => `<article class="stat-card"><span>${label}</span><strong>${value}</strong></article>`;

const renderStats = () => {
  if (!$("#statsGrid") || !state.stats) return;
  $("#statsGrid").innerHTML = [
    statCard("总浏览", state.stats.totalViews),
    statCard("公告浏览", state.stats.announcementViews),
    statCard("论坛浏览", state.stats.postViews),
    statCard("注册用户", state.stats.userCount),
  ].join("");
};

const adminRows = (items, type) =>
  items.length
    ? items
        .map(
          (item) => `
            <div class="table-row">
              <div>
                <strong>${escapeHtml(item.title)}</strong>
                <span>${escapeHtml(item.minecraft_name || item.author || "玩家")} · ${formatDate(item.created_at)} · ${item.views || 0} 次浏览</span>
              </div>
              <div class="row-actions">
                <button class="button small ghost" type="button" data-edit="${type}" data-id="${item.id}">编辑</button>
                <button class="button small danger" type="button" data-delete="${type}" data-id="${item.id}">删除</button>
              </div>
            </div>`,
        )
        .join("")
    : `<div class="empty">暂无内容。</div>`;

const renderManagement = () => {
  if ($("#manageAnnouncements")) $("#manageAnnouncements").innerHTML = adminRows(state.announcements, "announcement");
  if ($("#managePosts")) $("#managePosts").innerHTML = adminRows(state.posts, "post");

  $$("[data-edit]").forEach((button) => {
    button.addEventListener("click", () => {
      const type = button.dataset.edit;
      const id = Number(button.dataset.id);
      const source = type === "announcement" ? state.announcements : state.posts;
      const item = source.find((entry) => entry.id === id);
      if (!item) return;
      $("#editingId").value = item.id;
      $("#contentType").value = type === "announcement" ? "announcement" : "post";
      $("#contentType").disabled = true;
      $("#title").value = item.title;
      $("#editor").innerHTML = item.content_html;
      $("#publishForm").scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });

  $$("[data-delete]").forEach((button) => {
    button.addEventListener("click", async () => {
      const type = button.dataset.delete;
      const id = button.dataset.id;
      if (!window.confirm("确定删除这条内容吗？")) return;
      await api(`/${type === "announcement" ? "announcements" : "posts"}/${id}`, { method: "DELETE" });
      await loadAdminData();
      showToast("内容已删除");
    });
  });
};

const renderAdmins = () => {
  if (!$("#adminUsers")) return;
  $("#adminUsers").innerHTML = state.admins.length
    ? state.admins
        .map(
          (user) => `
            <div class="table-row user-row">
              <div>
                <strong>${escapeHtml(user.username)}</strong>
                <span>${user.minecraft_name ? `Minecraft: ${escapeHtml(user.minecraft_name)}` : "未绑定 Minecraft"} · ${user.is_owner ? "初始管理员" : "管理员"} · ${formatDate(user.created_at)}</span>
              </div>
              <div class="row-actions">
                <button class="button small danger" type="button" data-remove-admin="${user.id}" ${user.is_owner ? "disabled" : ""}>删除管理员</button>
              </div>
            </div>`,
        )
        .join("")
    : `<div class="empty">暂无管理员。</div>`;

  $$("[data-remove-admin]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (button.disabled) return;
      if (!window.confirm("确定删除这个管理员权限吗？")) return;
      await api(`/admin/users/${button.dataset.removeAdmin}`, { method: "DELETE" });
      await loadAdminData();
      showToast("管理员已删除");
    });
  });
};

const setupAdminUsers = () => {
  const form = $("#adminUserForm");
  if (!form) return;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api("/admin/users", {
        method: "POST",
        body: JSON.stringify({ username: $("#adminUsername").value.trim() }),
      });
      form.reset();
      await loadAdminData();
      showToast("已添加管理员");
    } catch (error) {
      showToast(error.message);
    }
  });
};

const loadPublicData = async () => {
  const requests = [api("/me").catch(() => ({ user: null }))];
  if (page === "home") requests.push(api("/announcements").catch(() => ({ items: [] })));
  if (page === "forum") requests.push(api("/posts").catch(() => ({ items: [] })));
  const results = await Promise.all(requests);
  state.me = results[0].user;
  if (page === "home") state.announcements = results[1].items;
  if (page === "forum") state.posts = results[1].items;
  renderAuth();
  renderProfile();
  renderLists();
};

const loadAdminData = async () => {
  const me = await api("/me").catch(() => ({ user: null }));
  state.me = me.user;
  renderAuth();
  renderAdminGate();
  if (!isAdmin()) return;

  const [announcements, posts, stats, admins] = await Promise.all([
    api("/announcements"),
    api("/posts"),
    api("/admin/stats"),
    api("/admin/users"),
  ]);
  state.announcements = announcements.items;
  state.posts = posts.items;
  state.stats = stats;
  state.admins = admins.items;
  renderStats();
  renderManagement();
  renderAdmins();
};

$("#closeDialog")?.addEventListener("click", () => $("#readerDialog").close());
setupAuth();
setupEditor();
setupForumPost();
setupPublish();
setupAdminUsers();

if (page === "admin") {
  loadAdminData().catch((error) => showToast(error.message));
} else {
  loadPublicData().catch((error) => showToast(error.message));
}
