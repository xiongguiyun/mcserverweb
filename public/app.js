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
    const message = payload.error || `璇锋眰澶辫触 (${response.status})`;
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
    <a class="button ghost small" href="${escapeHtml(result.uri)}">&#25171;&#24320;&#39564;&#35777;&#22120;</a>
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
    <button class="button small ghost" id="logoutButton" type="button">閫€鍑?/button>
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
        <div><strong>${escapeHtml(state.me.username)}</strong><p>浣犲凡鐧诲綍锛屼絾缃戠珯褰撳墠缁存姢涓紝璇风◢鍚庡啀鏉ャ€?/p></div>
      </div>`
    : `<p>缃戠珯姝ｅ湪缁存姢涓紝鏆傛椂浠呯鐞嗗憳鍙櫥褰曘€?/p><a class="button primary" href="/login.html">绠＄悊鍛樼櫥褰?/a>`;
};

const cardTemplate = (item, type) => {
  const excerpt = item.excerpt || textFromHtml(item.content_html).slice(0, 110);
  const author = item.author || "管理员";
  const canManagePost = type === "post" && isAdmin();
  const skin =
    type === "post"
      ? `<a class="skin-link" href="${profileHref(author)}"><img class="skin-figure" src="${skinUrl(author, 170)}" alt="" loading="lazy" /></a>`
      : "";
  return `
    <article class="post-card ${type === "post" ? "forum-card" : ""}">
      ${skin}
      <h3>${escapeHtml(item.title)}</h3>
      <div class="meta">
        ${type === "announcement" ? "鍏憡" : "鐜╁璁哄潧"} 路
        <a class="author-link" href="${profileHref(author)}">${escapeHtml(author)}</a> 路
        ${formatDate(item.created_at)}
      </div>
      <p>${escapeHtml(excerpt || "暂无摘要。")}</p>
      <div class="card-actions">
        <button class="button ghost read-button" type="button" data-type="${type}" data-id="${item.id}">闃呰</button>
        ${
          canManagePost
            ? `<button class="button ghost" type="button" data-edit-post="${item.id}">缂栬緫</button>
               <button class="button danger" type="button" data-delete-post="${item.id}">鍒犻櫎</button>`
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
      : `<div class="empty">杩樻病鏈夊叕鍛娿€?/div>`;
  }
  const postList = $("#postList");
  if (postList) {
    const filteredPosts = filterForumPosts(state.posts);
    postList.innerHTML = filteredPosts.length
      ? filteredPosts.map((item) => cardTemplate(item, "post")).join("")
      : `<div class="empty">杩樻病鏈夊笘瀛愩€?/div>`;
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
  if (!status) return;
  const query = state.forumSearch.trim();
  const total = state.posts.length;
  const matched = filterForumPosts(state.posts).length;
  status.textContent = query ? `已筛选 ${matched}/${total} 条帖子` : `共 ${total} 条帖子`;
};

const totpPanelTemplate = (profile) => {
  if (!profile?.isSelf || profile.role !== "admin") return "";
  return `
    <section class="account-security" id="accountSecurity">
      <h3>鍙岄噸楠岃瘉</h3>
      <p>${profile.totp_enabled ? "当前已开启，登录后台时需要填写 6 位验证码。" : "开启后，登录后台时需要额外填写 Authenticator 验证码。"}</p>
      <div class="security-form">
        ${
          profile.totp_enabled
            ? `<button class="button danger" type="button" id="disableTotpButton">鍏抽棴 2FA</button>`
            : `<button class="button primary" type="button" id="beginTotpButton">寮€鍚?2FA</button>`
        }
      </div>
      <div class="totp-panel" id="totpSetupPanel" hidden></div>
    </section>
  `;
};

const renderTotpSetupPanel = (setupPanel, result) => {
  const mobileLayout = shouldUseMobileTotpLayout();
  setupPanel.hidden = false;
  setupPanel.innerHTML = `
    <p>${mobileLayout ? "在手机上可以直接打开验证器，也可以手动输入下面的密钥。" : "在电脑上可以直接扫码添加，也可以切换成手动输入密钥。"}</p>
    ${
      mobileLayout
        ? `
          <a class="button ghost small" href="${escapeHtml(result.uri)}">鎵撳紑楠岃瘉鍣?/a>
          <div class="totp-secret-card">
            <span class="totp-secret-label">鎵嬪姩瀵嗛挜</span>
            <code>${escapeHtml(result.secret)}</code>
          </div>
        `
        : `
          <div class="totp-visual-card" id="totpVisualCard">
            <div class="totp-qr-shell" id="totpQrShell" aria-label="2FA 浜岀淮鐮?>${safeRenderQrSvg(result)}</div>
          </div>
          <button class="totp-text-toggle" type="button" id="totpSecretToggle">鍒囨崲鎴愬瘑閽?/button>
          <div class="totp-secret-card" id="totpSecretCard" hidden>
            <span class="totp-secret-label">鎵嬪姩瀵嗛挜</span>
            <code>${escapeHtml(result.secret)}</code>
          </div>
        `
    }
    <div class="security-form">
      <input id="totpConfirmCode" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="6 浣嶉獙璇佺爜" />
      <button class="button primary" type="button" id="confirmTotpButton">纭鍚敤</button>
    </div>
  `;

  if (!mobileLayout) {
    $("#totpSecretToggle")?.addEventListener("click", () => {
      const visualCard = $("#totpVisualCard");
      const secretCard = $("#totpSecretCard");
      const showingSecret = !secretCard?.hidden;
      if (secretCard) secretCard.hidden = showingSecret;
      if (visualCard) visualCard.hidden = !showingSecret;
      const toggle = $("#totpSecretToggle");
      if (toggle) toggle.textContent = showingSecret ? "切换成密钥" : "切换成二维码";
    });
  }

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
    return;
    setupPanel.innerHTML = `
      <p>鍦?Authenticator 閲屾墜鍔ㄨ緭鍏ヤ笅闈㈢殑瀵嗛挜锛岀劧鍚庡～鍐欑敓鎴愮殑 6 浣嶉獙璇佺爜纭鍚敤銆?/p>
      <code>${escapeHtml(result.secret)}</code>
      <a class="button ghost small" href="${escapeHtml(result.uri)}">鎵撳紑楠岃瘉鍣ㄩ摼鎺?/a>
      <div class="security-form">
        <input id="totpConfirmCode" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="6 浣嶉獙璇佺爜" />
        <button class="button primary" type="button" id="confirmTotpButton">纭鍚敤</button>
      </div>
    `;
    $("#totpConfirmCode")?.focus();
    $("#confirmTotpButton")?.addEventListener("click", async () => {
      const code = $("#totpConfirmCode")?.value.trim() || "";
      await api("/me/totp/confirm", { method: "POST", body: JSON.stringify({ code }) });
      await refreshPageData();
      showToast("2FA 已开启");
    });
  });

  disableButton?.addEventListener("click", async () => {
    if (!window.confirm("纭畾鍏抽棴 2FA 鍚楋紵")) return;
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
      $("#forumPostSubmit").textContent = "淇濆瓨淇敼";
      openPostDialog();
    });
  });
  $$("[data-delete-post]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!window.confirm("删除后会进入回收站，7 天后彻底删除。确定继续吗？")) return;
      await api(`/posts/${button.dataset.deletePost}`, { method: "DELETE" });
      await loadPublicData();
      showToast("甯栧瓙宸茬Щ鍏ュ洖鏀剁珯");
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
    <div class="meta"><a class="author-link" href="${profileHref(author)}">${escapeHtml(author)}</a> 路 ${formatDate(item.created_at)} 路 ${item.views || 0} 娆℃祻瑙?/div>
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
  $("#linkButton")?.addEventListener("click", () => {
    const url = window.prompt("杈撳叆閾炬帴鍦板潃");
    if (url) command("createLink", url);
  });
  $("#imageButton")?.addEventListener("click", () => {
    const url = window.prompt("杈撳叆鍥剧墖閾炬帴");
    if (url) insertHtmlBlock(`<p><img src="${escapeHtml(url)}" alt="" class="inline-image" /></p>`);
  });
  $("#tableButton")?.addEventListener("click", () =>
    insertHtmlBlock(`<table class="inline-table"><tr><th>鍒?1</th><th>鍒?2</th></tr><tr><td>鍐呭</td><td>鍐呭</td></tr></table><p><br></p>`),
  );
  $("#spoilerButton")?.addEventListener("click", () => insertHtmlBlock(`<span class="spoiler-inline">闅愯棌鍐呭</span>`));
  $("#hrButton")?.addEventListener("click", () => insertHtmlBlock(`<hr class="inline-rule" />`));
  $("#detailsButton")?.addEventListener("click", () => insertHtmlBlock(`<details class="inline-details"><summary>鐐瑰嚮灞曞紑</summary><p>鎶樺彔鍐呭</p></details><p><br></p>`));
  $("#codeButton")?.addEventListener("click", () => insertHtmlBlock(`<pre class="inline-code"><code>// code</code></pre><p><br></p>`));
  $("#quoteButton")?.addEventListener("click", () => insertHtmlBlock(`<blockquote>寮曠敤鍐呭</blockquote><p><br></p>`));
  $("#colorButton")?.addEventListener("click", () => {
    const color = window.prompt("杈撳叆鏂囨湰棰滆壊锛屼緥濡?#ff6600");
    if (color) command("foreColor", color);
  });
  $("#bilibiliButton")?.addEventListener("click", () => {
    const input = window.prompt("粘贴 Bilibili 链接、BV 号或 av 号");
    const bv = input?.match(/BV[a-zA-Z0-9]{8,12}/)?.[0];
    const av = input?.match(/(?:av|aid=)(\d+)/i)?.[1];
    const src = bv ? `https://player.bilibili.com/player.html?bvid=${encodeURIComponent(bv)}` : av ? `https://player.bilibili.com/player.html?aid=${encodeURIComponent(av)}` : null;
    if (!src) return showToast("娌℃湁璇嗗埆鍒版湁鏁堢殑 Bilibili 瑙嗛 ID");
    insertHtmlBlock(`<p><iframe src="${src}" allowfullscreen loading="lazy"></iframe></p><p><br></p>`);
  });
  $("#moreButton")?.addEventListener("click", () => {
    const button = $("#moreButton");
    const menu = $("#moreMenu");
    const isOpen = button.getAttribute("aria-expanded") === "true";
    button.setAttribute("aria-expanded", String(!isOpen));
    if (menu) menu.hidden = isOpen;
    button.closest(".toolbar-more")?.classList.toggle("is-open", !isOpen);
    if (menu && !isOpen) {
      const rect = button.getBoundingClientRect();
      menu.style.left = `${Math.min(rect.left, window.innerWidth - 170)}px`;
      menu.style.top = `${rect.bottom + 8}px`;
    }
  });
  $$(".toolbar-preview-button").forEach((button) => button.addEventListener("click", () => {
    const editor = $("#editor");
    const previewContent = $("#previewContent");
    if (!editor || !previewContent) return;
    const title = $("#forumTitle")?.value.trim() || $("#title")?.value.trim() || "棰勮";
    previewContent.innerHTML = `
      <h1>${escapeHtml(title)}</h1>
      <div class="meta">棰勮妯″紡 路 浠呮煡鐪嬪綋鍓嶇紪杈戝唴瀹癸紝涓嶄細鐩存帴淇濆瓨</div>
      <div class="reader-body">${editor.innerHTML.trim() || "<p>鏆傛棤鍐呭</p>"}</div>
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
      <h2>鐜╁璧勬枡</h2>
      <div class="skin-stage"><img src="/assets/unbound-skin.png" alt="" loading="lazy" /></div>
      <p>璁哄潧褰撳墠鍙厑璁哥鐞嗗憳璐﹀彿鐧诲綍涓庡彂甯栫鐞嗐€?/p>
      <a class="button primary" href="/login.html">绠＄悊鍛樼櫥褰?/a>
    `;
    return;
  }
  card.classList.add("is-logged-in");
  card.innerHTML = `
    <h2>鐜╁璧勬枡</h2>
    <a class="profile-card-link" href="${profileHref(state.me.username)}">
      <div class="skin-stage"><img src="${activeSkinSrc(state.me, 210)}" alt="" loading="lazy" /></div>
      <div class="profile-name ${state.me.last_seen_at ? "online" : ""}">
        <strong>${escapeHtml(state.me.username)}</strong>
        <span>${escapeHtml(state.me.account_type || "管理员")}</span>
      </div>
    </a>
    <div class="profile-actions">
      <a class="button ghost" href="${profileHref(state.me.username)}">鏌ョ湅璧勬枡椤?/a>
      ${isAdmin() ? `<a class="button primary" href="/admin.html">鍚庡彴绠＄悊</a>` : ""}
    </div>
  `;
};

const renderProfilePage = () => {
  const panel = $("#profilePanel");
  const posts = $("#profilePosts");
  if (!panel || !posts) return;
  const profile = state.profile;
  if (!profile) {
    panel.innerHTML = `<div class="empty">娌℃湁鎵惧埌杩欎釜鐜╁銆?/div>`;
    posts.innerHTML = "";
    return;
  }
  panel.innerHTML = `
    <div class="profile-page-card">
      <div class="skin-stage large"><img src="${activeSkinSrc(profile, 240)}" alt="" loading="lazy" /></div>
      <div class="profile-name ${profile.online ? "online" : ""}">
        <strong>${escapeHtml(profile.username)}</strong>
        <span>${escapeHtml(profile.accountType)} 路 娉ㄥ唽浜?${formatDate(profile.created_at)}</span>
      </div>
      <div class="profile-summary">
        <div><strong>${profile.postCount}</strong><span>鏈€杩戝笘瀛?/span></div>
        <div><strong>${escapeHtml(profile.accountType)}</strong><span>璐﹀彿绫诲瀷</span></div>
      </div>
      ${totpPanelTemplate(profile)}
    </div>
  `;
  posts.innerHTML = `
    <div class="section-title compact"><h2>${escapeHtml(profile.username)} 鐨勫笘瀛?/h2><p>灞曠ず鏈€杩?20 绡囩帺瀹跺唴瀹广€?/p></div>
    <div class="list forum-list">${
      profile.posts.length ? profile.posts.map((item) => cardTemplate({ ...item, author: profile.username }, "post")).join("") : `<div class="empty">杩欎釜鐜╁鏆傛椂杩樻病鏈夊彂甯栥€?/div>`
    }</div>
  `;
  bindTotpSecurity();
  bindContentButtons();
};

const setupForumPost = () => {
  const searchToggle = $("#forumSearchToggle");
  const searchPanel = $("#forumSearchPanel");
  const searchInput = $("#forumSearchInput");
  const searchClear = $("#forumSearchClear");

  const syncSearch = (open = state.forumSearchOpen) => {
    state.forumSearchOpen = open;
    if (searchPanel) {
      searchPanel.hidden = false;
      searchPanel.classList.toggle("is-open", open);
      searchPanel.setAttribute("aria-hidden", String(!open));
    }
    if (searchToggle) searchToggle.setAttribute("aria-expanded", String(open));
    if (open) {
      window.setTimeout(() => searchInput?.focus(), prefersReducedMotion() ? 0 : 40);
    } else {
      searchInput?.blur();
    }
  };

  searchToggle?.addEventListener("click", () => syncSearch(!state.forumSearchOpen));
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
  syncSearch(false);

  $("#openPostComposer")?.addEventListener("click", () => {
    if (!state.me) {
      window.location.href = "/login.html";
      return;
    }
    state.editingPostId = null;
    $("#forumPostForm")?.reset();
    if ($("#editor")) $("#editor").innerHTML = "";
    if ($("#forumPostSubmit")) $("#forumPostSubmit").textContent = "鍙戝竷甯栧瓙";
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
    statCard("鍏憡娴忚", state.stats.announcementViews),
    statCard("璁哄潧娴忚", state.stats.postViews),
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
              <div><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.author || "管理员")} 路 ${formatDate(item.created_at)} 路 ${item.views || 0} 次浏览</span></div>
              <div class="row-actions">
                <button class="button small ghost" type="button" data-edit="${type}" data-id="${item.id}">缂栬緫</button>
                <button class="button small danger" type="button" data-delete="${type}" data-id="${item.id}">鍒犻櫎</button>
              </div>
            </div>`,
        )
        .join("")
    : `<div class="empty">鏆傛棤鍐呭銆?/div>`;

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
      if (!window.confirm("删除后会进入垃圾桶。确定继续吗？")) return;
      const type = button.dataset.delete;
      await api(`/${type === "announcement" ? "announcements" : "posts"}/${button.dataset.id}`, { method: "DELETE" });
      await loadAdminData();
      showToast("鍐呭宸茬Щ鍏ュ瀮鍦炬《");
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
              <div><strong>${escapeHtml(item.title)}</strong><span>${item.type === "announcement" ? "鍏憡" : "甯栧瓙"} 路 ${formatDate(item.deleted_at)}</span></div>
              <div class="row-actions">
                <button class="button small ghost" type="button" data-restore="${item.type}" data-id="${item.id}">鎭㈠</button>
                <button class="button small danger" type="button" data-purge="${item.type}" data-id="${item.id}">褰诲簳鍒犻櫎</button>
              </div>
            </div>`,
        )
        .join("")
    : `<div class="empty">鍨冨溇妗朵负绌恒€?/div>`;
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
                      <button class="button small ghost" type="button" data-reset-admin="${user.id}" data-name="${escapeHtml(user.username)}">閲嶇疆瀵嗙爜</button>
                      <button class="button small danger" type="button" data-remove-admin="${user.id}">鍒犻櫎</button>
                    `
                    : `<button class="button small ghost" type="button" disabled>${user.is_owner ? "鏈嶄富璐﹀彿" : "浠呮湇涓诲彲鎿嶄綔"}</button>`
                }
              </div>
            </div>`,
        )
        .join("")
    : `<div class="empty">鏆傛棤绠＄悊鍛樸€?/div>`;
  $$("[data-remove-admin]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!window.confirm("确定删除这个管理员账号吗？")) return;
      await api(`/admin/users/${button.dataset.removeAdmin}`, { method: "DELETE" });
      await loadAdminData();
      showToast("绠＄悊鍛樺凡鍒犻櫎");
    });
  });
  $$("[data-reset-admin]").forEach((button) => {
    button.addEventListener("click", async () => {
      const password = window.prompt(`涓?${button.dataset.name} 璁剧疆鏂板瘑鐮侊紙鑷冲皯 6 浣嶏級`);
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
    showToast("宸插垱寤虹鐞嗗憳璐﹀彿");
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
  const sections = $$(".admin-panel[id]");
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
  links.forEach((link) => link.addEventListener("click", () => window.setTimeout(sync, 0)));
  window.addEventListener("hashchange", sync);
  sync();

  if (!sections.length) return;

  const syncByScroll = () => {
    const anchorLine = Math.min(window.innerHeight * 0.42, 360);
    const currentSection =
      sections.find((section) => {
        const rect = section.getBoundingClientRect();
        return rect.top <= anchorLine && rect.bottom >= anchorLine;
      }) || sections.find((section) => section.getBoundingClientRect().top > 0) || sections.at(-1);
    if (!currentSection) return;
    const current = `#${currentSection.id}`;
    if (window.location.hash !== current) {
      window.history.replaceState(null, "", current);
    }
    setActive(current);
  };

  window.addEventListener("scroll", () => window.requestAnimationFrame(syncByScroll), { passive: true });
  window.addEventListener("resize", syncByScroll);
  syncByScroll();
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

