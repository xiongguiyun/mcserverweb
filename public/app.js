const state = {
  me: null,
  announcements: [],
  posts: [],
};

const $ = (selector) => document.querySelector(selector);

const api = async (path, options = {}) => {
  const response = await fetch(`/api${path}`, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    credentials: "include",
    ...options,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "请求失败");
  }
  return payload;
};

const showToast = (message) => {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("show"), 2600);
};

const textFromHtml = (html) => {
  const div = document.createElement("div");
  div.innerHTML = html;
  return div.textContent.replace(/\s+/g, " ").trim();
};

const formatDate = (value) =>
  new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));

const renderAuth = () => {
  const actions = $("#authActions");
  if (!state.me) {
    actions.innerHTML = `<span>未登录</span>`;
    return;
  }
  actions.innerHTML = `
    <span>${state.me.username}${state.me.role === "admin" ? " · 管理员" : ""}</span>
    <button class="button small ghost" id="logoutButton" type="button">退出</button>
  `;
  $("#logoutButton").addEventListener("click", async () => {
    await api("/logout", { method: "POST" });
    state.me = null;
    renderAuth();
    showToast("已退出登录");
  });
};

const cardTemplate = (item, type) => {
  const excerpt = item.excerpt || textFromHtml(item.content_html).slice(0, 90);
  return `
    <article class="post-card">
      <h3>${escapeHtml(item.title)}</h3>
      <div class="meta">${type === "announcement" ? "公告" : "玩家文章"} · ${escapeHtml(item.author)} · ${formatDate(item.created_at)}</div>
      <p>${escapeHtml(excerpt || "这篇内容正在等待更多文字。")}</p>
      <button class="button ghost read-button" type="button" data-type="${type}" data-id="${item.id}">阅读</button>
    </article>
  `;
};

const renderLists = () => {
  $("#announcementList").innerHTML = state.announcements.length
    ? state.announcements.map((item) => cardTemplate(item, "announcement")).join("")
    : `<div class="empty">还没有公告。管理员登录后可以发布第一条。</div>`;
  $("#postList").innerHTML = state.posts.length
    ? state.posts.map((item) => cardTemplate(item, "post")).join("")
    : `<div class="empty">还没有玩家文章。注册后可以来写第一篇。</div>`;

  document.querySelectorAll(".read-button").forEach((button) => {
    button.addEventListener("click", () => openReader(button.dataset.type, Number(button.dataset.id)));
  });
};

const openReader = (type, id) => {
  const source = type === "announcement" ? state.announcements : state.posts;
  const item = source.find((entry) => entry.id === id);
  if (!item) return;
  $("#readerContent").innerHTML = `
    <h1>${escapeHtml(item.title)}</h1>
    <div class="meta">${escapeHtml(item.author)} · ${formatDate(item.created_at)}</div>
    <div class="reader-body">${item.content_html}</div>
  `;
  $("#readerDialog").showModal();
};

const escapeHtml = (value) =>
  String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[char]);

const loadData = async () => {
  const [me, announcements, posts] = await Promise.all([
    api("/me").catch(() => ({ user: null })),
    api("/announcements").catch(() => ({ items: [] })),
    api("/posts").catch(() => ({ items: [] })),
  ]);
  state.me = me.user;
  state.announcements = announcements.items;
  state.posts = posts.items;
  renderAuth();
  renderLists();
};

const command = (name, value = null) => {
  $("#editor").focus();
  document.execCommand(name, false, value);
};

const insertBilibili = () => {
  const input = window.prompt("粘贴 Bilibili 链接、BV 号或 av 号");
  if (!input) return;
  const normalized = normalizeBilibili(input);
  if (!normalized) {
    showToast("没有识别到有效的 Bilibili 视频 ID");
    return;
  }
  command(
    "insertHTML",
    `<p><iframe src="${normalized}" allowfullscreen loading="lazy"></iframe></p><p><br></p>`,
  );
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
  document.querySelectorAll("[data-command]").forEach((button) => {
    button.addEventListener("click", () => command(button.dataset.command));
  });
  document.querySelectorAll("[data-format]").forEach((button) => {
    button.addEventListener("click", () => command("formatBlock", button.dataset.format));
  });
  $("#linkButton").addEventListener("click", () => {
    const url = window.prompt("输入链接地址");
    if (url) command("createLink", url);
  });
  $("#bilibiliButton").addEventListener("click", insertBilibili);
};

const setupAuth = () => {
  $("#authForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const submitter = event.submitter;
    const mode = submitter?.dataset.mode || "login";
    try {
      const payload = {
        username: $("#username").value,
        password: $("#password").value,
      };
      const result = await api(mode === "register" ? "/register" : "/login", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      state.me = result.user;
      renderAuth();
      showToast(mode === "register" ? "注册成功" : "登录成功");
      $("#authForm").reset();
    } catch (error) {
      showToast(error.message);
    }
  });
};

const setupPublish = () => {
  $("#publishForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      if (!state.me) throw new Error("请先登录");
      const type = $("#contentType").value;
      const title = $("#title").value.trim();
      const contentHtml = $("#editor").innerHTML.trim();
      if (!title || !textFromHtml(contentHtml)) throw new Error("标题和正文都要填写");
      const endpoint = type === "announcement" ? "/announcements" : "/posts";
      await api(endpoint, {
        method: "POST",
        body: JSON.stringify({ title, contentHtml }),
      });
      $("#publishForm").reset();
      $("#editor").innerHTML = "";
      await loadData();
      showToast(type === "announcement" ? "公告已发布" : "文章已发布");
    } catch (error) {
      showToast(error.message);
    }
  });
};

$("#closeDialog").addEventListener("click", () => $("#readerDialog").close());
setupEditor();
setupAuth();
setupPublish();
loadData().catch((error) => showToast(error.message));
