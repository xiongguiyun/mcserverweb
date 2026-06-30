import { renderQrSvg } from "./qrcode-local.js";

const state = {
  me: null,
  site: { maintenanceMode: false },
  announcements: [],
  posts: [],
  stats: null,
  admins: [],
  profile: null,
  trash: { announcements: [], posts: [] },
  editingPostId: null,
  forumSearch: "",
  forumSearchOpen: false,
};

const page = document.body.dataset.page;
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const serverAddress = "play.blockhaven.cn";
let maintenanceRequestId = 0;
const isMobileViewport = () => window.matchMedia?.("(max-width: 620px)")?.matches;
const isCoarsePointer = () => window.matchMedia?.("(pointer: coarse)")?.matches;
const shouldUseMobileTotpLayout = () => isMobileViewport() || isCoarsePointer();
const staticPreviewNotice = "当前是静态预览模式，接口内容暂时不可用。";

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
    const contentType = response.headers.get("content-type") || "";
    const isHtmlFallback = contentType.includes("text/html") || /^\s*<!doctype html/i.test(raw);
    payload = { error: isHtmlFallback ? staticPreviewNotice : raw.trim() };
  }
  if (!response.ok) {
    const message = payload.error || `请求失败 (${response.status})`;
    showToast(message, { copyText: message === staticPreviewNotice ? "" : message });
    const error = new Error(message);
    error.payload = payload;
    throw error;
  }
  return payload;
};

const showToast = (message, options = {}) => {
  const toast = $("#toast");
  if (!toast) return;
  const { copyText = "" } = options;
  toast.textContent = message;
  toast.dataset.copyText = copyText;
  toast.classList.toggle("copyable", Boolean(copyText));
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
const isOwner = () => Boolean(state.me?.is_owner);
const minecraftImageUrl = (kind, name, size) => `/api/minecraft-image/${kind}/${encodeURIComponent(name)}/${size}`;
const skinUrl = (name, size = 210) => minecraftImageUrl("body", name, size);
const avatarUrl = (name, size = 32) => minecraftImageUrl("avatar", name, size);
const activeSkinSrc = (user, size = 210) => (user?.username ? skinUrl(user.username, size) : "/assets/unbound-skin.png");
const activeAvatarSrc = (user, size = 32) => (user?.username ? avatarUrl(user.username, size) : "/assets/unbound-skin.png");
const profileHref = (username) => `/profile.html?user=${encodeURIComponent(username)}`;
const totpQrUri = (result) => {
  const issuer = encodeURIComponent("LiouYang");
  return `otpauth://totp/${issuer}?secret=${encodeURIComponent(result.secret || "")}&issuer=${issuer}`;
};
const totpAccountInitials = () =>
  String(state.me?.username || "LiouYang")
    .trim()
    .slice(0, 2)
    .toUpperCase();
const currentProfileQuery = () => new URL(window.location.href).searchParams.get("user") || state.me?.username || "";
const prefersReducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
const dialogCloseDelay = () => (prefersReducedMotion() ? 0 : 240);

const renderTotpQrFallback = (result) => `
  <div class="totp-qr-fallback">
    <p>&#20108;&#32500;&#30721;&#26080;&#27861;&#26174;&#31034;&#65292;&#35831;&#20351;&#29992;&#25163;&#21160;&#23494;&#38053;&#12290;</p>
    <div class="totp-secret-card">
      <span class="totp-secret-label">&#25163;&#21160;&#23494;&#38053;</span>
      <code>${escapeHtml(result.secret)}</code>
    </div>
  </div>
`;

const safeRenderQrSvg = (result) => {
  try {
    return renderQrSvg(result.uri);
  } catch {
    return renderTotpQrFallback(result);
  }
};

const openDialog = (dialog) => {
  if (!dialog) return;
  window.clearTimeout(dialog.closeTimer);
  dialog.classList.remove("is-closing");
  if (dialog.open) return;
  dialog.showModal();
};

const closeDialogAnimated = (dialog) => {
  if (!dialog?.open) return;
  if (prefersReducedMotion()) {
    dialog.close();
    return;
  }
  if (dialog.classList.contains("is-closing")) return;
  dialog.classList.add("is-closing");
  const finishClose = () => {
    window.clearTimeout(dialog.closeTimer);
    dialog.close();
    dialog.classList.remove("is-closing");
    dialog.removeEventListener("animationend", onAnimationEnd);
  };
  const onAnimationEnd = (event) => {
    if (event.target === dialog) finishClose();
  };
  dialog.addEventListener("animationend", onAnimationEnd);
  dialog.closeTimer = window.setTimeout(finishClose, dialogCloseDelay() + 80);
};

const openPostDialog = () => openDialog($("#postDialog"));
const closePostDialog = () => closeDialogAnimated($("#postDialog"));
const openPreviewDialog = () => openDialog($("#previewDialog"));
const closePreviewDialog = () => closeDialogAnimated($("#previewDialog"));

const ensureSiteActionDialog = () => {
  let dialog = $("#siteActionDialog");
  if (dialog) return dialog;

  dialog = document.createElement("dialog");
  dialog.id = "siteActionDialog";
  dialog.className = "site-modal-dialog";
  dialog.innerHTML = `
    <div class="site-modal-shell">
      <button class="dialog-close site-modal-close" type="button" data-site-modal-cancel aria-label="关闭">×</button>
      <div class="site-modal-copy">
        <span class="site-modal-eyebrow" id="siteModalEyebrow">操作</span>
        <h2 id="siteModalTitle">请确认</h2>
        <p id="siteModalMessage"></p>
      </div>
      <label class="site-modal-field" id="siteModalField" hidden>
        <span id="siteModalLabel">请输入内容</span>
        <input id="siteModalInput" />
        <span class="site-modal-hint" id="siteModalHint" hidden></span>
      </label>
      <div class="site-modal-actions" id="siteModalActions">
        <button class="site-modal-option" type="button" data-site-modal-cancel>取消</button>
        <button class="site-modal-option is-primary" type="button" data-site-modal-confirm>确认</button>
      </div>
    </div>
  `;
  document.body.append(dialog);

  const cancel = () => resolveSiteActionDialog(dialog.dataset.mode === "confirm" ? false : null);
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    cancel();
  });
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) cancel();
  });
  dialog.querySelectorAll("[data-site-modal-cancel]").forEach((button) => button.addEventListener("click", cancel));
  dialog.querySelector("[data-site-modal-confirm]")?.addEventListener("click", () => submitSiteActionDialog());
  dialog.querySelector("#siteModalInput")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      submitSiteActionDialog();
    }
  });

  return dialog;
};

const resolveSiteActionDialog = (value) => {
  const dialog = $("#siteActionDialog");
  if (!dialog) return;
  const resolver = dialog._resolver;
  dialog._resolver = null;
  closeDialogAnimated(dialog);
  resolver?.(value);
};

const submitSiteActionDialog = () => {
  const dialog = $("#siteActionDialog");
  if (!dialog || !dialog._config) return;
  const input = $("#siteModalInput");

  if (dialog.dataset.mode === "prompt") {
    const rawValue = input?.value ?? "";
    const value = dialog._config.normalize ? dialog._config.normalize(rawValue) : rawValue.trim();
    if (dialog._config.required && !value) {
      showToast(dialog._config.requiredMessage || "请输入内容");
      input?.focus();
      return;
    }
    const validationMessage = dialog._config.validate?.(value);
    if (validationMessage) {
      showToast(validationMessage);
      input?.focus();
      return;
    }
    resolveSiteActionDialog(value);
    return;
  }

  resolveSiteActionDialog(true);
};

const showSiteActionDialog = (config) =>
  new Promise((resolve) => {
    const dialog = ensureSiteActionDialog();
    if (dialog._resolver) {
      const previousResolver = dialog._resolver;
      dialog._resolver = null;
      previousResolver(dialog.dataset.mode === "confirm" ? false : null);
      window.clearTimeout(dialog.closeTimer);
      dialog.classList.remove("is-closing");
      if (dialog.open) dialog.close();
    }

    dialog._resolver = resolve;
    dialog._config = config;
    dialog.dataset.mode = config.mode;

    const eyebrow = $("#siteModalEyebrow");
    const title = $("#siteModalTitle");
    const message = $("#siteModalMessage");
    const field = $("#siteModalField");
    const label = $("#siteModalLabel");
    const input = $("#siteModalInput");
    const hint = $("#siteModalHint");
    const confirmButton = dialog.querySelector("[data-site-modal-confirm]");
    const actions = $("#siteModalActions");

    if (eyebrow) eyebrow.textContent = config.eyebrow || (config.mode === "confirm" ? "操作确认" : "输入内容");
    if (title) title.textContent = config.title || (config.mode === "confirm" ? "请确认这一步操作" : "请输入内容");
    if (message) message.textContent = config.message || "";
    if (label) label.textContent = config.inputLabel || "请输入内容";
    if (hint) {
      hint.textContent = config.hint || "";
      hint.hidden = !config.hint;
    }
    if (field) field.hidden = config.mode !== "prompt";
    if (input) {
      input.value = config.defaultValue || "";
      input.placeholder = config.placeholder || "";
      input.type = config.inputType || "text";
      input.maxLength = config.maxLength ? Number(config.maxLength) : 524288;
      input.autocomplete = config.autocomplete || "off";
      input.inputMode = config.inputMode || "text";
    }
    dialog.querySelectorAll("[data-site-modal-cancel]").forEach((button) => {
      button.textContent = config.cancelLabel || "取消";
    });
    if (confirmButton) {
      confirmButton.textContent = config.confirmLabel || "确认";
      confirmButton.classList.toggle("is-primary", config.confirmTone !== "danger");
      confirmButton.classList.toggle("is-danger", config.confirmTone === "danger");
    }
    actions?.classList.toggle("is-danger", config.confirmTone === "danger");

    openDialog(dialog);
    window.requestAnimationFrame(() => {
      if (config.mode === "prompt") {
        input?.focus();
        input?.select();
        return;
      }
      confirmButton?.focus();
    });
  });

const showConfirmDialog = (message, options = {}) =>
  showSiteActionDialog({
    mode: "confirm",
    message,
    ...options,
  });

const showPromptDialog = (message, options = {}) =>
  showSiteActionDialog({
    mode: "prompt",
    message,
    ...options,
  });

const updateToolbarMorePosition = () => {
  const menu = $("#moreMenu");
  const button = $("#moreButton");
  if (!menu || !button || menu.hidden) return;
  const container = button.closest(".toolbar-more");
  if (!container) return;
  menu.style.removeProperty("left");
  menu.style.removeProperty("top");
  const rect = button.getBoundingClientRect();
  const menuHeight = menu.offsetHeight || 0;
  container.classList.toggle("is-open-upward", rect.bottom + menuHeight + 12 > window.innerHeight);
};

const closeToolbarMore = () => {
  const button = $("#moreButton");
  const menu = $("#moreMenu");
  if (!button || !menu) return;
  button.setAttribute("aria-expanded", "false");
  menu.hidden = true;
  button.closest(".toolbar-more")?.classList.remove("is-open", "is-open-upward");
};

const renderAuth = () => {
  const actions = $("#authActions");
  if (!actions) return;
  $$("[data-admin-link]").forEach((link) => {
    link.hidden = !isAdmin();
  });

  if (!state.me) {
    actions.innerHTML = "";
    return;
  }

  actions.innerHTML = `
    <a class="user-badge user-entry" href="${profileHref(state.me.username)}">
      <img class="user-avatar" src="${activeAvatarSrc(state.me, 32)}" alt="" />
      <span class="user-chip">${escapeHtml(state.me.username)}</span>
    </a>
    <button class="button small ghost" id="logoutButton" type="button">退出</button>
  `;
  $("#logoutButton")?.addEventListener("click", async () => {
    await api("/logout", { method: "POST" });
    state.me = null;
    if (page === "admin") {
      window.location.href = "/login.html";
      return;
    }
    renderAll();
    showToast("已退出登录");
  });
};

const renderMaintenanceBanner = () => {
  let banner = $("#maintenanceBanner");
  if (!state.site?.maintenanceMode || !isAdmin()) {
    banner?.remove();
    return;
  }
  if (!banner) {
    banner = document.createElement("div");
    banner.id = "maintenanceBanner";
    banner.className = "maintenance-banner";
    document.body.prepend(banner);
  }
  banner.textContent = "网站正在维护中，当前管理员可继续访问。";
};

const renderMaintenanceGate = () => {
  const gate = $("#maintenanceGate");
  if (!gate) return;
  const main = document.querySelector("main");
  if (!state.site?.maintenanceMode || isAdmin()) {
    gate.hidden = true;
    if (main) main.hidden = false;
    return;
  }
  gate.hidden = false;
  if (main) main.hidden = true;
  $("#maintenanceGateBody").innerHTML = state.me
    ? `
      <div class="maintenance-user">
        <img class="user-avatar large" src="${activeAvatarSrc(state.me, 48)}" alt="" />
        <div><strong>${escapeHtml(state.me.username)}</strong><p>你已登录，但网站当前维护中，请稍后再来。</p></div>
      </div>`
    : `<p>网站正在维护中，暂时仅管理员可登录。</p><a class="button primary" href="/login.html">管理员登录</a>`;
};

const cardTemplate = (item, type) => {
  const excerpt = item.excerpt || textFromHtml(item.content_html).slice(0, 110);
  const author = item.author || "管理员";
  const canManagePost = type === "post" && isAdmin();
  const skin =
    type === "post"
      ? `<a class="skin-link" href="${profileHref(author)}"><img class="skin-figure" src="${skinUrl(author, 210)}" alt="" loading="lazy" /></a>`
      : "";
  return `
    <article class="post-card ${type === "post" ? "forum-card" : ""}">
      ${skin}
      <h3>${escapeHtml(item.title)}</h3>
      <div class="meta">
        ${type === "announcement" ? "公告" : "玩家论坛"} /
        <a class="author-link" href="${profileHref(author)}">${escapeHtml(author)}</a> /
        ${formatDate(item.created_at)}
      </div>
      <p>${escapeHtml(excerpt || "暂无摘要。")}</p>
      <div class="card-actions">
        <button class="button ghost read-button" type="button" data-type="${type}" data-id="${item.id}">阅读</button>
        ${
          canManagePost
            ? `<button class="button ghost" type="button" data-edit-post="${item.id}">编辑</button>
               <button class="button danger" type="button" data-delete-post="${item.id}">删除</button>`
            : ""
        }
      </div>
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
    const filteredPosts = filterForumPosts(state.posts);
    postList.innerHTML = filteredPosts.length
      ? filteredPosts.map((item) => cardTemplate(item, "post")).join("")
      : `<div class="empty">还没有帖子。</div>`;
  }
  updateForumSearchStatus();
  bindContentButtons();
};

const normalizeSearchTerms = (value) =>
  String(value || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

const filterForumPosts = (posts) => {
  const query = state.forumSearch.trim();
  if (!query) return posts;
  const authorTerms = [];
  const freeTerms = [];
  for (const term of normalizeSearchTerms(query)) {
    if (term.startsWith("#") && term.length > 1) authorTerms.push(term.slice(1).toLowerCase());
    else freeTerms.push(term.toLowerCase());
  }
  return posts.filter((item) => {
    const title = String(item.title || "").toLowerCase();
    const author = String(item.author || "").toLowerCase();
    const content = textFromHtml(item.content_html).toLowerCase();
    const haystack = `${title} ${author} ${content}`;
    return authorTerms.every((term) => author.includes(term)) && freeTerms.every((term) => haystack.includes(term));
  });
};

const updateForumSearchStatus = () => {
  const status = $("#forumSearchStatus");
  const actions = $(".forum-toolbar-actions");
  if (!status) return;
  const query = state.forumSearch.trim();
  const total = state.posts.length;
  const matched = filterForumPosts(state.posts).length;
  status.hidden = !query;
  status.textContent = query ? `已筛选 ${matched}/${total} 条帖子` : "";
  actions?.classList.toggle("has-search-query", Boolean(query));
};

const totpPanelTemplate = (profile) => {
  if (!profile?.isSelf || profile.role !== "admin") return "";
  return `
    <section class="account-security" id="accountSecurity">
      <h3>双重验证</h3>
      <p>${profile.totp_enabled ? "当前已开启，登录后台时需要填写 6 位验证码。" : "开启后，登录后台时需要额外填写 Authenticator 验证码。"}</p>
      <div class="security-form">
        ${
          profile.totp_enabled
            ? `<button class="button danger" type="button" id="disableTotpButton">关闭 2FA</button>`
            : `<button class="button primary" type="button" id="beginTotpButton">开启 2FA</button>`
        }
      </div>
      <div class="totp-panel" id="totpSetupPanel" hidden></div>
    </section>
  `;
};

const renderTotpSetupPanel = (setupPanel, result) => {
  const mobileLayout = shouldUseMobileTotpLayout();
  const qrResult = { ...result, uri: totpQrUri(result) };
  setupPanel.hidden = false;
  setupPanel.innerHTML = `
    <p>${mobileLayout ? "可以直接跳转验证器，也可以扫描二维码或手动输入密钥。" : "在电脑上扫码添加，也可以切换成手动输入密钥。"}</p>
    ${mobileLayout ? `<a class="button ghost small mobile-authenticator-link" href="${escapeHtml(result.uri)}">打开验证器</a>` : ""}
    <div class="totp-visual-card" id="totpVisualCard">
      <div class="totp-account-preview" aria-label="验证器账户预览">
        <span class="totp-account-accent" aria-hidden="true"></span>
        <span class="totp-account-avatar">${escapeHtml(totpAccountInitials())}</span>
        <span class="totp-account-copy">
          <strong>Liou_Yang Server</strong>
          <span>${escapeHtml(state.me?.username || "Liou_Yang")}</span>
        </span>
      </div>
      <div class="totp-qr-shell" id="totpQrShell" aria-label="2FA 二维码">${safeRenderQrSvg(qrResult)}</div>
    </div>
    <button class="totp-text-toggle" type="button" id="totpSecretToggle">切换成密钥</button>
    <div class="totp-secret-card" id="totpSecretCard" hidden>
      <span class="totp-secret-label">手动密钥</span>
      <code>${escapeHtml(result.secret)}</code>
    </div>
    <div class="security-form">
      <input id="totpConfirmCode" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="6 位验证码" />
      <button class="button primary" type="button" id="confirmTotpButton">确认启用</button>
    </div>
  `;

  $("#totpSecretToggle")?.addEventListener("click", () => {
    const visualCard = $("#totpVisualCard");
    const secretCard = $("#totpSecretCard");
    const showingSecret = !secretCard?.hidden;
    if (secretCard) secretCard.hidden = showingSecret;
    if (visualCard) visualCard.hidden = !showingSecret;
    const toggle = $("#totpSecretToggle");
    if (toggle) toggle.textContent = showingSecret ? "切换成密钥" : "切换成二维码";
  });

  $("#totpConfirmCode")?.focus();
  $("#confirmTotpButton")?.addEventListener("click", async () => {
    const code = $("#totpConfirmCode")?.value.trim() || "";
    await api("/me/totp/confirm", { method: "POST", body: JSON.stringify({ code }) });
    await refreshPageData();
    showToast("2FA 已开启");
  });
};

const bindTotpSecurity = () => {
  const beginButton = $("#beginTotpButton");
  const disableButton = $("#disableTotpButton");
  const setupPanel = $("#totpSetupPanel");

  beginButton?.addEventListener("click", async () => {
    const result = await api("/me/totp/begin", { method: "POST" });
    if (!setupPanel) return;
    renderTotpSetupPanel(setupPanel, result);
  });

  disableButton?.addEventListener("click", async () => {
    const confirmed = await showConfirmDialog("确定关闭 2FA 吗？", {
      title: "关闭双重验证",
      eyebrow: "安全设置",
      confirmLabel: "关闭 2FA",
      confirmTone: "danger",
    });
    if (!confirmed) return;
    await api("/me/totp", { method: "DELETE" });
    await refreshPageData();
    showToast("2FA 已关闭");
  });
};

const bindContentButtons = () => {
  $$(".read-button").forEach((button) => {
    button.addEventListener("click", () => openReader(button.dataset.type, Number(button.dataset.id)));
  });
  $$("[data-edit-post]").forEach((button) => {
    button.addEventListener("click", () => {
      const post = state.posts.find((item) => item.id === Number(button.dataset.editPost));
      if (!post) return;
      state.editingPostId = post.id;
      $("#forumTitle").value = post.title;
      $("#editor").innerHTML = post.content_html;
      $("#forumPostSubmit").textContent = "保存修改";
      openPostDialog();
    });
  });
  $$("[data-delete-post]").forEach((button) => {
    button.addEventListener("click", async () => {
      const confirmed = await showConfirmDialog("删除后会进入回收站，7 天后彻底删除。确定继续吗？", {
        title: "删除帖子",
        eyebrow: "内容管理",
        confirmLabel: "移入回收站",
        confirmTone: "danger",
      });
      if (!confirmed) return;
      await api(`/posts/${button.dataset.deletePost}`, { method: "DELETE" });
      await loadPublicData();
      showToast("帖子已移入回收站");
    });
  });
};

const openReader = (type, id) => {
  const source = type === "announcement" ? state.announcements : state.posts;
  const item = source.find((entry) => entry.id === id);
  if (!item || !$("#readerContent")) return;
  api(`/track-view/${type}/${id}`, { method: "POST" }).catch(() => {});
  item.views = Number(item.views || 0) + 1;
  const author = item.author || "管理员";
  $("#readerContent").innerHTML = `
    <h1>${escapeHtml(item.title)}</h1>
    <div class="meta"><a class="author-link" href="${profileHref(author)}">${escapeHtml(author)}</a> / ${formatDate(item.created_at)} / ${item.views || 0} 次浏览</div>
    <div class="reader-body">${item.content_html}</div>
  `;
  openDialog($("#readerDialog"));
};

const command = (name, value = null) => {
  const editor = $("#editor");
  if (!editor) return;
  editor.focus();
  document.execCommand(name, false, value);
};

const insertHtmlBlock = (html) => command("insertHTML", html);

const setupEditor = () => {
  if (!$("#editor")) return;
  $$("[data-command]").forEach((button) => button.addEventListener("click", () => command(button.dataset.command)));
  $("#fontSizeSelect")?.addEventListener("change", (event) => {
    if (event.target.value) command("fontSize", event.target.value);
    event.target.value = "";
  });
  $("#blockFormatSelect")?.addEventListener("change", (event) => {
    if (event.target.value) command("formatBlock", event.target.value);
    event.target.value = "";
  });
  $("#linkButton")?.addEventListener("click", async () => {
    const url = await showPromptDialog("输入需要插入的链接地址。", {
      title: "插入链接",
      eyebrow: "编辑工具",
      inputLabel: "链接地址",
      placeholder: "https://example.com",
      confirmLabel: "插入链接",
      normalize: (value) => value.trim(),
    });
    if (url) command("createLink", url);
  });
  $("#imageButton")?.addEventListener("click", async () => {
    const url = await showPromptDialog("输入图片链接后会直接插入到正文中。", {
      title: "插入图片",
      eyebrow: "编辑工具",
      inputLabel: "图片链接",
      placeholder: "https://example.com/image.png",
      confirmLabel: "插入图片",
      normalize: (value) => value.trim(),
    });
    if (url) insertHtmlBlock(`<p><img src="${escapeHtml(url)}" alt="" class="inline-image" /></p>`);
  });
  $("#tableButton")?.addEventListener("click", () =>
    insertHtmlBlock(`<table class="inline-table"><tr><th>列 1</th><th>列 2</th></tr><tr><td>内容</td><td>内容</td></tr></table><p><br></p>`),
  );
  $("#spoilerButton")?.addEventListener("click", () => insertHtmlBlock(`<span class="spoiler-inline">隐藏内容</span>`));
  $("#hrButton")?.addEventListener("click", () => insertHtmlBlock(`<hr class="inline-rule" />`));
  $("#detailsButton")?.addEventListener("click", () => insertHtmlBlock(`<details class="inline-details"><summary>点击展开</summary><p>折叠内容</p></details><p><br></p>`));
  $("#codeButton")?.addEventListener("click", () => insertHtmlBlock(`<pre class="inline-code"><code>// code</code></pre><p><br></p>`));
  $("#quoteButton")?.addEventListener("click", () => insertHtmlBlock(`<blockquote>引用内容</blockquote><p><br></p>`));
  $("#colorButton")?.addEventListener("click", async () => {
    const color = await showPromptDialog("输入文本颜色，例如 #ff6600 或 rgb(255, 102, 0)。", {
      title: "文本颜色",
      eyebrow: "编辑工具",
      inputLabel: "颜色值",
      placeholder: "#ff6600",
      confirmLabel: "应用颜色",
      normalize: (value) => value.trim(),
    });
    if (color) command("foreColor", color);
  });
  $("#bilibiliButton")?.addEventListener("click", async () => {
    const input = await showPromptDialog("粘贴 Bilibili 链接、BV 号或 av 号。", {
      title: "插入 Bilibili 视频",
      eyebrow: "编辑工具",
      inputLabel: "视频地址或编号",
      placeholder: "BV1xx... 或 https://www.bilibili.com/...",
      confirmLabel: "插入视频",
      normalize: (value) => value.trim(),
    });
    const bv = input?.match(/BV[a-zA-Z0-9]{8,12}/)?.[0];
    const av = input?.match(/(?:av|aid=)(\d+)/i)?.[1];
    const src = bv ? `https://player.bilibili.com/player.html?bvid=${encodeURIComponent(bv)}` : av ? `https://player.bilibili.com/player.html?aid=${encodeURIComponent(av)}` : null;
    if (!src) return showToast("没有识别到有效的 Bilibili 视频 ID");
    insertHtmlBlock(`<p><iframe src="${src}" allowfullscreen loading="lazy"></iframe></p><p><br></p>`);
  });
  $("#moreButton")?.addEventListener("click", (event) => {
    event.stopPropagation();
    const button = $("#moreButton");
    const menu = $("#moreMenu");
    if (!button || !menu) return;
    const isOpen = button.getAttribute("aria-expanded") === "true";
    button.setAttribute("aria-expanded", String(!isOpen));
    menu.hidden = isOpen;
    button.closest(".toolbar-more")?.classList.toggle("is-open", !isOpen);
    if (!isOpen) updateToolbarMorePosition();
  });
  $("#moreMenu")?.addEventListener("click", (event) => event.stopPropagation());
  document.addEventListener("click", closeToolbarMore);
  window.addEventListener("resize", closeToolbarMore);
  window.addEventListener("scroll", updateToolbarMorePosition, { passive: true });
  $$(".toolbar-preview-button").forEach((button) => button.addEventListener("click", () => {
    const editor = $("#editor");
    const previewContent = $("#previewContent");
    if (!editor || !previewContent) return;
    const title = $("#forumTitle")?.value.trim() || $("#title")?.value.trim() || "预览";
    previewContent.innerHTML = `
      <h1>${escapeHtml(title)}</h1>
      <div class="reader-body">${editor.innerHTML.trim() || "<p>暂无内容</p>"}</div>
    `;
    openPreviewDialog();
  }));
};

const renderForumProfileCard = () => {
  const card = $("#profileCard");
  if (!card) return;
  if (!state.me) {
    card.classList.remove("is-logged-in");
    card.innerHTML = `
      <h2>玩家资料</h2>
      <div class="skin-stage"><img src="/assets/unbound-skin.png" alt="" loading="lazy" /></div>
      <p>论坛当前只允许管理员账号登录与发布管理。</p>
      <a class="button primary" href="/login.html">管理员登录</a>
    `;
    return;
  }
  card.classList.add("is-logged-in");
  card.innerHTML = `
    <h2>玩家资料</h2>
    <a class="profile-card-link" href="${profileHref(state.me.username)}">
      <div class="skin-stage"><img src="${activeSkinSrc(state.me, 210)}" alt="" loading="lazy" /></div>
      <div class="profile-name ${state.me.last_seen_at ? "online" : ""}">
        <strong>${escapeHtml(state.me.username)}</strong>
        <span>${escapeHtml(state.me.account_type || "管理员")}</span>
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
      <div class="skin-stage large"><img src="${activeSkinSrc(profile, 210)}" alt="" loading="lazy" /></div>
      <div class="profile-name ${profile.online ? "online" : ""}">
        <strong>${escapeHtml(profile.username)}</strong>
        <span>${escapeHtml(profile.accountType)} / 注册于 ${formatDate(profile.created_at)}</span>
      </div>
      <div class="profile-summary">
        <div><strong>${profile.postCount}</strong><span>最近帖子</span></div>
        <div><strong>${escapeHtml(profile.accountType)}</strong><span>账号类型</span></div>
      </div>
      ${totpPanelTemplate(profile)}
    </div>
  `;
  posts.innerHTML = `
    <div class="section-title compact"><h2>${escapeHtml(profile.username)} 的帖子</h2><p>展示最近 20 篇玩家内容。</p></div>
    <div class="list forum-list">${
      profile.posts.length ? profile.posts.map((item) => cardTemplate({ ...item, author: profile.username }, "post")).join("") : `<div class="empty">这个玩家暂时还没有发布。</div>`
    }</div>
  `;
  bindTotpSecurity();
  bindContentButtons();
};

const setupForumPost = () => {
  const searchToggle = $("#forumSearchToggle");
  const searchPanel = $("#forumSearchPanel");
  const searchActions = $(".forum-toolbar-actions");
  const searchInput = $("#forumSearchInput");
  const searchClear = $("#forumSearchClear");
  const searchTip = $(".forum-search-tip");
  const searchTipText = "支持标题、内容和发布者搜索。输入 #发布者名 可以直接按发布者筛选，例如 #Steve。";

  if (searchTip) {
    searchTip.removeAttribute("title");
    searchTip.setAttribute("role", "button");
    searchTip.setAttribute("tabindex", "0");
    searchTip.setAttribute("aria-expanded", "false");
    searchTip.setAttribute("data-tip", searchTipText);
    const tipBubble = document.createElement("span");
    tipBubble.className = "forum-search-tip-bubble";
    tipBubble.id = "forumSearchTipBubble";
    tipBubble.innerHTML = `
      <span class="forum-search-tip-heading">搜索示例</span>
      <span class="forum-search-tip-preview" aria-hidden="true">
        <span class="forum-search-tip-field">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="11" cy="11" r="6.5"></circle>
            <path d="M16.2 16.2 21 21"></path>
          </svg>
          <span class="forum-search-tip-placeholder">搜索标题、内容、发布者</span>
        </span>
      </span>
      <span class="forum-search-tip-copy">${searchTipText}</span>
      <span class="forum-search-tip-example">示例：#Steve 建筑据点</span>
    `;
    searchTip.append(tipBubble);
  }

  const setTipOpen = (open) => {
    searchTip?.classList.toggle("is-open", open);
    searchTip?.setAttribute("aria-expanded", String(open));
  };

  const syncSearch = (open = state.forumSearchOpen) => {
    state.forumSearchOpen = open;
    if (searchPanel) {
      searchPanel.hidden = false;
      searchPanel.classList.toggle("is-open", open);
      searchPanel.setAttribute("aria-hidden", String(!open));
    }
    searchActions?.classList.toggle("is-search-open", open);
    if (searchToggle) searchToggle.setAttribute("aria-expanded", String(open));
    if (open) {
      window.setTimeout(() => searchInput?.focus(), prefersReducedMotion() ? 0 : 40);
    } else {
      searchInput?.blur();
    }
  };

  searchToggle?.addEventListener("click", (event) => {
    event.stopPropagation();
    syncSearch(!state.forumSearchOpen);
  });
  searchPanel?.addEventListener("click", (event) => event.stopPropagation());
  searchInput?.addEventListener("input", (event) => {
    state.forumSearch = event.target.value;
    renderLists();
  });
  searchInput?.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      state.forumSearch = "";
      searchInput.value = "";
      renderLists();
      syncSearch(false);
    }
  });
  searchClear?.addEventListener("click", () => {
    state.forumSearch = "";
    if (searchInput) searchInput.value = "";
    renderLists();
    syncSearch(false);
  });
  searchTip?.addEventListener("mouseenter", () => setTipOpen(true));
  searchTip?.addEventListener("mouseleave", () => setTipOpen(false));
  searchTip?.addEventListener("focus", () => setTipOpen(true));
  searchTip?.addEventListener("blur", () => setTipOpen(false));
  searchTip?.addEventListener("click", (event) => {
    event.stopPropagation();
    setTipOpen(!searchTip.classList.contains("is-open"));
  });
  searchTip?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    setTipOpen(!searchTip.classList.contains("is-open"));
  });
  document.addEventListener("click", (event) => {
    const target = event.target;
    if (searchTip?.contains(target)) return;
    setTipOpen(false);
    if (!state.forumSearchOpen || searchPanel?.contains(target) || searchToggle?.contains(target)) return;
    syncSearch(false);
  });
  syncSearch(false);

  $("#openPostComposer")?.addEventListener("click", () => {
    if (!state.me) {
      window.location.href = "/login.html";
      return;
    }
    state.editingPostId = null;
    $("#forumPostForm")?.reset();
    if ($("#editor")) $("#editor").innerHTML = "";
    if ($("#forumPostSubmit")) $("#forumPostSubmit").textContent = "发布帖子";
    openPostDialog();
  });
  $$("[data-close-post]").forEach((button) => button.addEventListener("click", closePostDialog));
  $("#forumPostForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!state.me) {
      window.location.href = "/login.html";
      return;
    }
    const title = $("#forumTitle").value.trim();
    const contentHtml = $("#editor").innerHTML.trim();
    const endpoint = state.editingPostId ? `/posts/${state.editingPostId}` : "/posts";
    await api(endpoint, { method: state.editingPostId ? "PUT" : "POST", body: JSON.stringify({ title, contentHtml }) });
    state.editingPostId = null;
    closePostDialog();
    await loadPublicData();
    showToast("帖子已保存");
  });
};

const resetEditor = () => {
  $("#editingId").value = "";
  $("#publishForm")?.reset();
  if ($("#editor")) $("#editor").innerHTML = "";
  $("#contentType")?.removeAttribute("disabled");
};

const setupPublish = () => {
  $("#publishForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const type = $("#contentType").value;
    const id = $("#editingId").value;
    const title = $("#title").value.trim();
    const contentHtml = $("#editor").innerHTML.trim();
    const endpoint = type === "announcement" ? "/announcements" : "/posts";
    await api(id ? `${endpoint}/${id}` : endpoint, { method: id ? "PUT" : "POST", body: JSON.stringify({ title, contentHtml }) });
    resetEditor();
    await loadAdminData();
    showToast(id ? "内容已更新" : "内容已发布");
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
    statCard("管理员账号", state.stats.userCount),
  ].join("");
  $("#trashDock")?.remove();
  if (state.stats.trashCount > 0) {
    const dock = document.createElement("button");
    dock.id = "trashDock";
    dock.className = "trash-dock button danger";
    dock.type = "button";
    dock.textContent = `垃圾桶 ${state.stats.trashCount}`;
    dock.addEventListener("click", () => {
      location.hash = "#adminTrash";
      renderTrash();
    });
    document.body.append(dock);
  }
  if ($("#maintenanceToggle")) $("#maintenanceToggle").checked = Boolean(state.stats.maintenanceMode);
  if ($("#maintenanceStatusText")) $("#maintenanceStatusText").textContent = state.stats.maintenanceMode ? "当前维护模式已开启。" : "当前网站正常开放。";
};

const adminRows = (items, type) =>
  items.length
    ? items
        .map(
          (item) => `
            <div class="table-row">
              <div><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.author || "管理员")} / ${formatDate(item.created_at)} / ${item.views || 0} 次浏览</span></div>
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
      const source = type === "announcement" ? state.announcements : state.posts;
      const item = source.find((entry) => entry.id === Number(button.dataset.id));
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
      const confirmed = await showConfirmDialog("删除后会进入垃圾桶。确定继续吗？", {
        title: "删除内容",
        eyebrow: "内容管理",
        confirmLabel: "移入垃圾桶",
        confirmTone: "danger",
      });
      if (!confirmed) return;
      const type = button.dataset.delete;
      await api(`/${type === "announcement" ? "announcements" : "posts"}/${button.dataset.id}`, { method: "DELETE" });
      await loadAdminData();
      showToast("内容已移入垃圾桶");
    });
  });
};

const renderTrash = async () => {
  const panel = $("#adminTrash");
  if (!panel) return;
  const result = await api("/admin/trash");
  state.trash = result;
  const rows = [
    ...result.announcements.map((item) => ({ ...item, type: "announcement" })),
    ...result.posts.map((item) => ({ ...item, type: "post" })),
  ];
  panel.querySelector(".admin-table").innerHTML = rows.length
    ? rows
        .map(
          (item) => `
            <div class="table-row">
              <div><strong>${escapeHtml(item.title)}</strong><span>${item.type === "announcement" ? "公告" : "帖子"} / ${formatDate(item.deleted_at)}</span></div>
              <div class="row-actions">
                <button class="button small ghost" type="button" data-restore="${item.type}" data-id="${item.id}">恢复</button>
                <button class="button small danger" type="button" data-purge="${item.type}" data-id="${item.id}">彻底删除</button>
              </div>
            </div>`,
        )
        .join("")
    : `<div class="empty">垃圾桶为空。</div>`;
  $$("[data-restore]").forEach((button) =>
    button.addEventListener("click", async () => {
      await api(`/${button.dataset.restore === "announcement" ? "announcements" : "posts"}/${button.dataset.id}/restore`, { method: "POST" });
      await loadAdminData();
    }),
  );
  $$("[data-purge]").forEach((button) =>
    button.addEventListener("click", async () => {
      await api(`/${button.dataset.purge === "announcement" ? "announcements" : "posts"}/${button.dataset.id}/purge`, { method: "DELETE" });
      await loadAdminData();
    }),
  );
};

const renderAdmins = () => {
  if (!$("#adminUsers")) return;
  $("#adminUsers").innerHTML = state.admins.length
    ? state.admins
        .map(
          (user) => `
            <div class="table-row user-row">
              <div><strong>${escapeHtml(user.username)}</strong><span>${escapeHtml(user.account_type)} 路 ${formatDate(user.created_at)}</span></div>
              <div class="row-actions">
                ${
                  isOwner() && !user.is_owner
                    ? `
                      <button class="button small ghost" type="button" data-reset-admin="${user.id}" data-name="${escapeHtml(user.username)}">重置密码</button>
                      <button class="button small danger" type="button" data-remove-admin="${user.id}">删除</button>
                    `
                    : `<button class="button small ghost" type="button" disabled>${user.is_owner ? "服主账号" : "仅服主可操作"}</button>`
                }
              </div>
            </div>`,
        )
        .join("")
    : `<div class="empty">暂无管理员。</div>`;
  $$("[data-remove-admin]").forEach((button) => {
    button.addEventListener("click", async () => {
      const confirmed = await showConfirmDialog("确定删除这个管理员账号吗？", {
        title: "删除管理员",
        eyebrow: "权限管理",
        confirmLabel: "删除账号",
        confirmTone: "danger",
      });
      if (!confirmed) return;
      await api(`/admin/users/${button.dataset.removeAdmin}`, { method: "DELETE" });
      await loadAdminData();
      showToast("管理员已删除");
    });
  });
  $$("[data-reset-admin]").forEach((button) => {
    button.addEventListener("click", async () => {
      const password = await showPromptDialog(`为 ${button.dataset.name} 设置新密码（至少 6 位）。`, {
        title: "重置管理员密码",
        eyebrow: "权限管理",
        inputLabel: "新密码",
        inputType: "password",
        autocomplete: "new-password",
        maxLength: 120,
        confirmLabel: "重置密码",
        normalize: (value) => value.trim(),
        validate: (value) => (value.length >= 6 ? "" : "密码至少需要 6 位"),
      });
      if (!password) return;
      await api(`/admin/users/${button.dataset.resetAdmin}/password`, {
        method: "PUT",
        body: JSON.stringify({ password }),
      });
      showToast("密码已重置");
    });
  });
};

const setupAdminUsers = () => {
  $("#adminUserForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await api("/admin/users", {
      method: "POST",
      body: JSON.stringify({ username: $("#adminUsername").value.trim(), password: $("#adminPassword").value }),
    });
    event.target.reset();
    await loadAdminData();
    showToast("已创建管理员账号");
  });
};

const setupMaintenanceToggle = () => {
  $("#maintenanceToggle")?.addEventListener("change", async (event) => {
    const requestId = ++maintenanceRequestId;
    const enabled = event.target.checked;
    const previous = Boolean(state.stats?.maintenanceMode);
    state.site.maintenanceMode = enabled;
    if (state.stats) state.stats.maintenanceMode = enabled;
    renderStats();
    renderMaintenanceBanner();
    try {
      const result = await api("/admin/settings/maintenance", { method: "PUT", body: JSON.stringify({ enabled }) });
      if (requestId !== maintenanceRequestId) return;
      state.site.maintenanceMode = result.maintenanceMode;
      if (state.stats) state.stats.maintenanceMode = result.maintenanceMode;
      renderStats();
      renderMaintenanceBanner();
      showToast(result.maintenanceMode ? "已开启维护模式" : "已关闭维护模式");
    } catch (error) {
      if (requestId !== maintenanceRequestId) return;
      state.site.maintenanceMode = previous;
      if (state.stats) state.stats.maintenanceMode = previous;
      renderStats();
      renderMaintenanceBanner();
      showToast(error.message);
    }
  });
};

const setupAdminNavigation = () => {
  const links = $$(".admin-nav a");
  if (!links.length) return;

  const setActive = (current) => {
    links.forEach((link) => {
      const active = link.getAttribute("href") === current;
      link.classList.toggle("active", active);
    });
  };
  const sync = () => {
    const current = window.location.hash || "#adminOverview";
    setActive(current);
    if (current === "#adminTrash") renderTrash().catch((error) => showToast(error.message));
  };
  links.forEach((link) =>
    link.addEventListener("click", () => {
      const target = link.getAttribute("href");
      if (target) setActive(target);
    }),
  );
  window.addEventListener("hashchange", sync);
  sync();
};

const setupAdminMobileDrawer = () => {
  const toggle = $("#adminSidebarToggle");
  const drawer = $("#adminSidebarDrawer");
  const backdrop = $("#adminSidebarBackdrop");
  if (!toggle || !drawer || !backdrop) return;

  const setOpen = (open) => {
    document.body.classList.toggle("admin-drawer-open", open);
    toggle.setAttribute("aria-expanded", String(open));
    drawer.setAttribute("aria-hidden", String(!open));
    backdrop.hidden = false;
    if (!open) {
      window.setTimeout(() => {
        if (!document.body.classList.contains("admin-drawer-open")) {
          backdrop.hidden = true;
        }
      }, prefersReducedMotion() ? 0 : 240);
    }
  };

  toggle.addEventListener("click", () => setOpen(!document.body.classList.contains("admin-drawer-open")));
  backdrop.addEventListener("click", () => setOpen(false));
  $$(".admin-nav-drawer a").forEach((link) => link.addEventListener("click", () => setOpen(false)));
  window.addEventListener("resize", () => {
    if (window.innerWidth > 620) setOpen(false);
  });
};

const setupDialogDismiss = () => {
  $$("dialog").forEach((dialog) => {
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      closeDialogAnimated(dialog);
    });
    dialog.addEventListener("click", (event) => {
      if (event.target !== dialog) return;
      closeDialogAnimated(dialog);
    });
  });
};

const setupHomeActions = () => {
  $("#copyServerAddress")?.addEventListener("click", async () => {
    await navigator.clipboard.writeText(serverAddress);
    showToast("服务器地址已复制");
  });
};

const setupHeroTyping = () => {
  const title = $("#heroTypedTitle");
  if (!title) return;
  const fullText = title.dataset.text || "Liou_Yang Server";
  if (prefersReducedMotion()) {
    title.textContent = fullText;
    return;
  }
  let index = 0;
  title.textContent = "";
  const tick = () => {
    title.textContent = fullText.slice(0, index);
    if (index < fullText.length) {
      index += 1;
      window.setTimeout(tick, index > 9 ? 80 : 112);
    }
  };
  window.setTimeout(tick, 220);
};

const setupLoginPage = () => {
  if (page !== "login") return;
  const loginForm = $("#loginForm");
  loginForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const result = await api("/account", {
        method: "POST",
        body: JSON.stringify({
          username: $("#loginUsername").value.trim(),
          password: $("#loginPassword").value,
          totpCode: $("#loginTotpCode")?.value.trim(),
        }),
      });
      state.me = result.user;
      window.location.href = result.user?.role === "admin" ? "/admin.html" : "/forum.html";
    } catch (error) {
      if (error.payload?.needsTotp) $("#loginTotpCode")?.focus();
    }
  });
};

const loadBaseState = async () => {
  const me = await api("/me").catch(() => ({ user: null, site: { maintenanceMode: false } }));
  state.me = me.user;
  state.site = me.site || { maintenanceMode: false };
};

const loadPublicData = async () => {
  await loadBaseState();
  if (page === "home") state.announcements = (await api("/announcements").catch(() => ({ items: [] }))).items;
  if (page === "forum") state.posts = (await api("/posts").catch(() => ({ items: [] }))).items;
  if (page === "profile") {
    const username = currentProfileQuery();
    state.profile = username ? (await api(`/profiles/${encodeURIComponent(username)}`).catch(() => ({ profile: null }))).profile : null;
    state.posts = state.profile?.posts || [];
  }
  renderAll();
};

const loadAdminData = async () => {
  await loadBaseState();
  renderAll();
  renderAdminGate();
  if (!isAdmin()) return;
  const [announcements, posts, stats, admins] = await Promise.all([api("/announcements"), api("/posts"), api("/admin/stats"), api("/admin/users")]);
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

const refreshPageData = async () => (page === "admin" ? loadAdminData() : loadPublicData());

const renderAll = () => {
  renderAuth();
  renderMaintenanceBanner();
  renderMaintenanceGate();
  renderLists();
  renderForumProfileCard();
  renderProfilePage();
  if (page === "admin") renderAdminGate();
};

$("#toast")?.addEventListener("click", async (event) => {
  const copyText = event.currentTarget.dataset.copyText;
  if (!copyText) return;
  await navigator.clipboard?.writeText(copyText).catch(() => {});
});

$("#closeDialog")?.addEventListener("click", () => closeDialogAnimated($("#readerDialog")));
$$("[data-close-preview]").forEach((button) => button.addEventListener("click", closePreviewDialog));
setupDialogDismiss();
setupLoginPage();
setupEditor();
setupForumPost();
setupPublish();
setupAdminUsers();
setupMaintenanceToggle();
setupAdminNavigation();
setupAdminMobileDrawer();
setupHomeActions();
setupHeroTyping();

refreshPageData().catch((error) => showToast(error.message));

