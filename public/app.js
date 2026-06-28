const state = {
  me: null,
  site: { maintenanceMode: false },
  announcements: [],
  posts: [],
  stats: null,
  admins: [],
  profile: null,
};

const page = document.body.dataset.page;
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const serverAddress = "play.blockhaven.cn";

const copyErrorToClipboard = async (message) => {
  if (!message || !navigator.clipboard?.writeText) return false;
  try {
    await navigator.clipboard.writeText(message);
    return true;
  } catch {
    return false;
  }
};

const api = async (path, options = {}) => {
  const response = await fetch(`/api${path}`, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    credentials: "include",
    ...options,
  });
  const raw = await response.text();
  let payload = {};
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    payload = { error: raw.trim() };
  }
  if (!response.ok) {
    const message = payload.error || `请求失败 (${response.status})`;
    const copied = await copyErrorToClipboard(message);
    const error = new Error(copied ? `${message}（真实错误已自动复制）` : message);
    error.copied = copied;
    error.rawMessage = message;
    throw error;
  }
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
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));

const isAdmin = () => state.me?.role === "admin";
const profileName = (user) => user?.username || "玩家";
const skinUrl = (name, size = 210) => `https://mc-heads.net/body/${encodeURIComponent(name)}/${size}`;
const avatarUrl = (name, size = 32) => `https://mc-heads.net/avatar/${encodeURIComponent(name)}/${size}`;
const activeSkinSrc = (user, size = 210) => (user?.username ? skinUrl(user.username, size) : "/assets/unbound-skin.png");
const activeAvatarSrc = (user, size = 32) => (user?.username ? avatarUrl(user.username, size) : "/assets/unbound-skin.png");
const profileHref = (username) => `/profile.html?user=${encodeURIComponent(username)}`;
const maintenanceActive = () => Boolean(state.site?.maintenanceMode);

const copyText = async (value, label) => {
  await navigator.clipboard.writeText(value);
  showToast(`${label}已复制`);
};

const openAuthDialog = () => $("#authDialog")?.showModal();
const closeAuthDialog = () => $("#authDialog")?.close();
const openPostDialog = () => $("#postDialog")?.showModal();
const closePostDialog = () => $("#postDialog")?.close();

const renderAuth = () => {
  const actions = $("#authActions");
  if (!actions) return;
  $$("[data-admin-link]").forEach((link) => {
    link.hidden = !isAdmin();
  });

  if (!state.me) {
    actions.innerHTML = `<button class="button small primary" type="button" data-open-auth>登录 / 注册</button>`;
  } else {
    const avatar = activeAvatarSrc(state.me, 32);
    actions.innerHTML = `
      <a class="user-badge user-entry" href="${profileHref(state.me.username)}">
        <img class="user-avatar" src="${avatar}" alt="" />
        <span class="user-chip">${escapeHtml(state.me.username)}${isAdmin() ? " · 管理员" : ""}</span>
      </a>
      <button class="button small ghost" id="logoutButton" type="button">退出</button>
    `;
    $("#logoutButton")?.addEventListener("click", async () => {
      await api("/logout", { method: "POST" });
      state.me = null;
      renderAll();
      showToast("已退出登录");
    });
  }

  $$("[data-open-auth]").forEach((button) => button.addEventListener("click", openAuthDialog));
};

const renderMaintenanceBanner = () => {
  let banner = $("#maintenanceBanner");
  if (!maintenanceActive() || !isAdmin()) {
    banner?.remove();
    return;
  }
  if (!banner) {
    banner = document.createElement("div");
    banner.id = "maintenanceBanner";
    banner.className = "maintenance-banner";
    document.body.prepend(banner);
  }
  banner.textContent = "网站正在维护中，当前仅管理员可见。";
};

const renderMaintenanceGate = () => {
  const gate = $("#maintenanceGate");
  if (!gate) return;
  const main = document.querySelector("main");
  if (!maintenanceActive() || isAdmin()) {
    gate.hidden = true;
    if (main) main.hidden = false;
    return;
  }
  gate.hidden = false;
  if (main) main.hidden = true;
  const body = $("#maintenanceGateBody");
  if (body) {
    body.innerHTML = state.me
      ? `
        <div class="maintenance-user">
          <img class="user-avatar large" src="${activeAvatarSrc(state.me, 48)}" alt="" />
          <div>
            <strong>${escapeHtml(state.me.username)}</strong>
            <p>你已登录，网站当前正在维护，请稍后再来。</p>
          </div>
        </div>
      `
      : `
        <p>网站正在维护中，稍后会重新开放。</p>
        <button class="button primary" type="button" data-open-auth>登录账户</button>
      `;
  }
  $$("[data-open-auth]").forEach((button) => button.addEventListener("click", openAuthDialog));
};

const cardTemplate = (item, type) => {
  const excerpt = item.excerpt || textFromHtml(item.content_html).slice(0, 110);
  const author = item.author || "玩家";
  const skin =
    type === "post"
      ? `<a class="skin-link" href="${profileHref(author)}"><img class="skin-figure" src="${skinUrl(author, 170)}" alt="" loading="lazy" /></a>`
      : "";
  return `
    <article class="post-card ${type === "post" ? "forum-card" : ""}">
      ${skin}
      <h3>${escapeHtml(item.title)}</h3>
      <div class="meta">
        ${type === "announcement" ? "公告" : "玩家论坛"} ·
        <a class="author-link" href="${profileHref(author)}">${escapeHtml(author)}</a> ·
        ${formatDate(item.created_at)}
      </div>
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
      : `<div class="empty">还没有帖子，来发第一篇吧。</div>`;
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
  const author = item.author || "玩家";
  $("#readerContent").innerHTML = `
    <h1>${escapeHtml(item.title)}</h1>
    <div class="meta">
      <a class="author-link" href="${profileHref(author)}">${escapeHtml(author)}</a> ·
      ${formatDate(item.created_at)} · ${item.views || 0} 次浏览
    </div>
    <div class="reader-body">${item.content_html}</div>
  `;
  $("#readerDialog")?.showModal();
};

const command = (name, value = null) => {
  const editor = $("#editor");
  if (!editor) return;
  editor.focus();
  document.execCommand(name, false, value);
};

const insertHtmlBlock = (html) => command("insertHTML", html);

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

  $("#fontSizeSelect")?.addEventListener("change", (event) => {
    if (event.target.value) command("fontSize", event.target.value);
    event.target.value = "";
  });

  $("#blockFormatSelect")?.addEventListener("change", (event) => {
    if (event.target.value) command("formatBlock", event.target.value);
    event.target.value = "";
  });

  $("#linkButton")?.addEventListener("click", () => {
    const url = window.prompt("输入链接地址");
    if (url) command("createLink", url);
  });

  $("#imageButton")?.addEventListener("click", () => {
    const url = window.prompt("输入图片链接");
    if (url) insertHtmlBlock(`<p><img src="${escapeHtml(url)}" alt="" class="inline-image" /></p>`);
  });

  $("#tableButton")?.addEventListener("click", () => {
    insertHtmlBlock(
      `<table class="inline-table"><tr><th>列 1</th><th>列 2</th></tr><tr><td>内容</td><td>内容</td></tr></table><p><br></p>`,
    );
  });

  $("#spoilerButton")?.addEventListener("click", () => {
    insertHtmlBlock(`<span class="spoiler-inline">隐藏内容</span>`);
  });

  $("#hrButton")?.addEventListener("click", () => {
    insertHtmlBlock(`<hr class="inline-rule" />`);
  });

  $("#detailsButton")?.addEventListener("click", () => {
    insertHtmlBlock(`<details class="inline-details"><summary>点击展开</summary><p>折叠内容</p></details><p><br></p>`);
  });

  $("#codeButton")?.addEventListener("click", () => {
    insertHtmlBlock(`<pre class="inline-code"><code>// code</code></pre><p><br></p>`);
  });

  $("#quoteButton")?.addEventListener("click", () => {
    insertHtmlBlock(`<blockquote>引用内容</blockquote><p><br></p>`);
  });

  $("#colorButton")?.addEventListener("click", () => {
    const color = window.prompt("输入文本颜色，例如 #ff6600");
    if (color) command("foreColor", color);
  });

  $("#bilibiliButton")?.addEventListener("click", () => {
    const input = window.prompt("粘贴 Bilibili 链接、BV 号或 av 号");
    if (!input) return;
    const normalized = normalizeBilibili(input);
    if (!normalized) return showToast("没有识别到有效的 Bilibili 视频 ID");
    insertHtmlBlock(`<p><iframe src="${normalized}" allowfullscreen loading="lazy"></iframe></p><p><br></p>`);
  });

  const moreButton = $("#moreButton");
  const moreMenu = $("#moreMenu");
  moreButton?.addEventListener("click", () => {
    const isOpen = moreButton.getAttribute("aria-expanded") === "true";
    moreButton.setAttribute("aria-expanded", String(!isOpen));
    if (moreMenu) moreMenu.hidden = isOpen;
  });
};

const renderForumProfileCard = () => {
  const card = $("#profileCard");
  if (!card) return;
  if (!state.me) {
    card.innerHTML = `
      <h2>玩家资料</h2>
      <div class="skin-stage">
        <img src="/assets/unbound-skin.png" alt="" loading="lazy" />
      </div>
      <p>登录后可发布帖子，也能从头像或昵称进入你的独立资料页。</p>
      <button class="button primary" type="button" data-open-auth>登录 / 注册</button>
    `;
    $$("[data-open-auth]").forEach((button) => button.addEventListener("click", openAuthDialog));
    return;
  }

  card.innerHTML = `
    <h2>玩家资料</h2>
    <a class="profile-card-link" href="${profileHref(state.me.username)}">
      <div class="skin-stage">
        <img src="${activeSkinSrc(state.me, 210)}" alt="" loading="lazy" />
      </div>
      <div class="profile-name">
        <strong>${escapeHtml(state.me.username)}</strong>
        <span>${isAdmin() ? "管理员账号" : "注册玩家"}</span>
      </div>
    </a>
    <div class="profile-actions">
      <a class="button ghost" href="${profileHref(state.me.username)}">查看资料页</a>
      ${isAdmin() ? `<a class="button primary" href="/admin.html">后台管理</a>` : ""}
    </div>
  `;
};

const renderProfilePage = () => {
  const panel = $("#profilePanel");
  const posts = $("#profilePosts");
  if (!panel || !posts) return;
  const profile = state.profile;
  if (!profile) {
    panel.innerHTML = `<div class="empty">没有找到这个玩家。</div>`;
    posts.innerHTML = "";
    return;
  }

  panel.innerHTML = `
    <div class="profile-page-card">
      <div class="skin-stage large">
        <img src="${activeSkinSrc(profile, 240)}" alt="" loading="lazy" />
      </div>
      <div class="profile-name">
        <strong>${escapeHtml(profile.username)}</strong>
        <span>${profile.role === "admin" ? "管理员" : "玩家"} · 注册于 ${formatDate(profile.created_at)}</span>
      </div>
      <div class="profile-summary">
        <div><strong>${profile.postCount}</strong><span>最近帖子</span></div>
        <div><strong>${profile.role === "admin" ? "ON" : "USER"}</strong><span>账号类型</span></div>
      </div>
    </div>
  `;

  posts.innerHTML = `
    <div class="section-title compact">
      <h2>${escapeHtml(profile.username)} 的帖子</h2>
      <p>展示最近 20 篇玩家内容。</p>
    </div>
    <div class="list forum-list">
      ${
        profile.posts.length
          ? profile.posts.map((item) => cardTemplate({ ...item, author: profile.username }, "post")).join("")
          : `<div class="empty">这个玩家暂时还没有发帖。</div>`
      }
    </div>
  `;
  $$(".read-button").forEach((button) => {
    button.addEventListener("click", () => openReader(button.dataset.type, Number(button.dataset.id)));
  });
};

const setupForumPost = () => {
  $("#openPostComposer")?.addEventListener("click", () => {
    if (!state.me) {
      openAuthDialog();
      return;
    }
    openPostDialog();
  });

  $$("[data-close-post]").forEach((button) => button.addEventListener("click", closePostDialog));

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
      closePostDialog();
      await loadPublicData();
      showToast("帖子已发布");
    } catch (error) {
      showToast(error.message);
    }
  });
};

const resetEditor = () => {
  $("#editingId").value = "";
  $("#publishForm")?.reset();
  if ($("#editor")) $("#editor").innerHTML = "";
  $("#contentType")?.removeAttribute("disabled");
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
  if ($("#maintenanceToggle")) $("#maintenanceToggle").checked = Boolean(state.stats.maintenanceMode);
  if ($("#maintenanceStatusText")) {
    $("#maintenanceStatusText").textContent = state.stats.maintenanceMode ? "当前维护模式已开启。" : "当前网站正常开放。";
  }
};

const adminRows = (items, type) =>
  items.length
    ? items
        .map(
          (item) => `
            <div class="table-row">
              <div>
                <strong>${escapeHtml(item.title)}</strong>
                <span>${escapeHtml(item.author || "玩家")} · ${formatDate(item.created_at)} · ${item.views || 0} 次浏览</span>
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
      $("#contentType").setAttribute("disabled", "disabled");
      $("#title").value = item.title;
      $("#editor").innerHTML = item.content_html;
      $("#publishForm")?.scrollIntoView({ behavior: "smooth", block: "start" });
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
                <span>${user.is_owner ? "初始管理员" : "管理员"} · ${formatDate(user.created_at)}</span>
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

const setupMaintenanceToggle = () => {
  $("#maintenanceToggle")?.addEventListener("change", async (event) => {
    try {
      const result = await api("/admin/settings/maintenance", {
        method: "PUT",
        body: JSON.stringify({ enabled: event.target.checked }),
      });
      state.site.maintenanceMode = result.maintenanceMode;
      if (state.stats) state.stats.maintenanceMode = result.maintenanceMode;
      renderStats();
      renderMaintenanceBanner();
      showToast(result.maintenanceMode ? "已开启维护模式" : "已关闭维护模式");
    } catch (error) {
      event.target.checked = !event.target.checked;
      showToast(error.message);
    }
  });
};

const setupHomeActions = () => {
  $("#copyServerAddress")?.addEventListener("click", async () => {
    try {
      await copyText(serverAddress, "服务器地址");
    } catch {
      showToast("复制失败，请手动复制");
    }
  });
};

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
      await refreshPageData();
      showToast(mode === "register" ? "注册成功" : "登录成功");
    } catch (error) {
      showToast(error.message);
    }
  });
};

const currentProfileQuery = () => new URL(window.location.href).searchParams.get("user") || "";

const loadBaseState = async () => {
  const me = await api("/me").catch(() => ({ user: null, site: { maintenanceMode: false } }));
  state.me = me.user;
  state.site = me.site || { maintenanceMode: false };
};

const loadPublicData = async () => {
  await loadBaseState();
  if (page === "home") {
    const announcements = await api("/announcements").catch(() => ({ items: [] }));
    state.announcements = announcements.items;
  }
  if (page === "forum") {
    const posts = await api("/posts").catch(() => ({ items: [] }));
    state.posts = posts.items;
  }
  if (page === "profile") {
    const username = currentProfileQuery();
    if (username) {
      const result = await api(`/profiles/${encodeURIComponent(username)}`).catch(() => ({ profile: null }));
      state.profile = result.profile;
      state.posts = state.profile?.posts || [];
    } else {
      state.profile = null;
      state.posts = [];
    }
  }
  renderAll();
};

const loadAdminData = async () => {
  await loadBaseState();
  renderAll();
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
  state.site.maintenanceMode = Boolean(stats.maintenanceMode);
  state.admins = admins.items;
  renderAll();
  renderStats();
  renderManagement();
  renderAdmins();
};

const refreshPageData = async () => {
  if (page === "admin") return loadAdminData();
  return loadPublicData();
};

const renderAll = () => {
  renderAuth();
  renderMaintenanceBanner();
  renderMaintenanceGate();
  renderLists();
  renderForumProfileCard();
  renderProfilePage();
  if (page === "admin") renderAdminGate();
};

$("#closeDialog")?.addEventListener("click", () => $("#readerDialog")?.close());
setupAuth();
setupEditor();
setupForumPost();
setupPublish();
setupAdminUsers();
setupMaintenanceToggle();
setupHomeActions();

if (page === "admin") {
  loadAdminData().catch((error) => showToast(error.message));
} else {
  loadPublicData().catch((error) => showToast(error.message));
}
