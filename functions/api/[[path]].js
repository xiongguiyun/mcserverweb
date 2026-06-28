const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const emailProviders = {
  outlook: ["outlook.com", "hotmail.com", "live.com"],
  google: ["gmail.com", "googlemail.com"],
  qq: ["qq.com"],
  netease: ["163.com", "126.com", "yeah.net"],
};

const messageFromError = (error, fallback = "服务器错误") => {
  if (!error) return fallback;
  if (typeof error === "string") return error;
  if (typeof error.message === "string" && error.message) return error.message;
  return fallback;
};

const getCookie = (request, name) => {
  const cookie = request.headers.get("Cookie") || "";
  return cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
};

const base64UrlToBytes = (value) => {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
};

const bytesToBase32 = (bytes) => {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  let output = "";
  bytes.forEach((byte) => {
    bits += byte.toString(2).padStart(8, "0");
  });
  for (let index = 0; index < bits.length; index += 5) {
    output += alphabet[parseInt(bits.slice(index, index + 5).padEnd(5, "0"), 2)];
  }
  return output;
};

const base32ToBytes = (value) => {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = String(value || "").replace(/=+$/g, "").toUpperCase();
  let bits = "";
  for (const char of clean) {
    const index = alphabet.indexOf(char);
    if (index < 0) continue;
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(parseInt(bits.slice(index, index + 8), 2));
  }
  return new Uint8Array(bytes);
};

const hashPassword = async (password, salt = crypto.randomUUID()) => {
  const encoded = textEncoder.encode(`${salt}:${password}`);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  const hash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${salt}:${hash}`;
};

const verifyPassword = async (password, stored) => {
  const [salt] = stored.split(":");
  return (await hashPassword(password, salt)) === stored;
};

const hashCode = async (code) => {
  const digest = await crypto.subtle.digest("SHA-256", textEncoder.encode(String(code)));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

const sanitizeHtml = (html) => {
  let output = String(html || "");
  output = output.replace(/<script[\s\S]*?<\/script>/gi, "");
  output = output.replace(/<(style|object|embed|link|meta|base)[\s\S]*?<\/\1>/gi, "");
  output = output.replace(/<(style|object|embed|link|meta|base)\b[^>]*>/gi, "");
  output = output.replace(/\son\w+(="[^"]*"|='[^']*'|=[^\s>]+)?/gi, "");
  output = output.replace(/javascript:/gi, "");
  output = output.replace(/<iframe\b[^>]*>(?:[\s\S]*?<\/iframe>)?/gi, (iframe) => {
    const src = iframe.match(/\ssrc=["']([^"']+)["']/i)?.[1] || "";
    if (!/^https:\/\/player\.bilibili\.com\/player\.html\?(bvid=BV[a-zA-Z0-9]{8,12}|aid=\d+)/.test(src)) {
      return "";
    }
    return `<iframe src="${src}" sandbox="allow-scripts allow-same-origin allow-presentation" allowfullscreen loading="lazy"></iframe>`;
  });
  return output.slice(0, 60000);
};

const excerptFromHtml = (html) =>
  sanitizeHtml(html)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);

const readBody = async (request) => {
  try {
    return await request.json();
  } catch {
    return {};
  }
};

const detectEmailProvider = (email) => {
  const domain = String(email || "").split("@").at(-1)?.toLowerCase();
  return Object.entries(emailProviders).find(([, domains]) => domains.includes(domain))?.[0] || null;
};

const normalizeEmail = (email) => String(email || "").trim().toLowerCase();

const publicUser = (user) =>
  user
    ? {
        id: user.id,
        username: user.username,
        role: user.role,
        email: user.email,
        email_provider: user.email_provider,
        email_verified: Boolean(user.email_verified),
        must_bind_email: !user.email_verified,
        totp_enabled: Boolean(user.totp_enabled),
        created_at: user.created_at,
        last_seen_at: user.last_seen_at,
      }
    : null;

const getSiteSettings = async (env) => {
  try {
    const { results } = await env.DB.prepare("SELECT key, value FROM site_settings").all();
    const map = Object.fromEntries((results || []).map((row) => [row.key, row.value]));
    return { maintenanceMode: map.maintenance_mode === "on" };
  } catch (error) {
    if (/no such table/i.test(messageFromError(error))) return { maintenanceMode: false };
    throw error;
  }
};

const setSiteSetting = async (env, key, value) => {
  await env.DB.prepare(
    `INSERT INTO site_settings (key, value, updated_at)
     VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
  )
    .bind(key, value)
    .run();
};

const currentUser = async (env, request) => {
  const token = getCookie(request, "session");
  if (!token) return null;
  const user = await env.DB.prepare(
    `SELECT users.id, users.username, users.role, users.email, users.email_provider, users.email_verified,
            users.totp_enabled, users.created_at, users.last_seen_at
     FROM sessions
     JOIN users ON users.id = sessions.user_id
     WHERE sessions.token = ? AND sessions.expires_at > datetime('now')`,
  )
    .bind(token)
    .first();
  if (user) {
    await env.DB.prepare("UPDATE users SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?").bind(user.id).run();
  }
  return user;
};

const requireUser = async (env, request) => {
  const user = await currentUser(env, request);
  if (!user) throw new Response(JSON.stringify({ error: "请先登录" }), { status: 401 });
  return user;
};

const requireVerifiedUser = async (env, request) => {
  const user = await requireUser(env, request);
  if (!user.email_verified) {
    throw new Response(JSON.stringify({ error: "请先绑定并验证邮箱后继续使用账户" }), { status: 403 });
  }
  return user;
};

const requireAdmin = async (env, request) => {
  const user = await requireVerifiedUser(env, request);
  if (user.role !== "admin") {
    throw new Response(JSON.stringify({ error: "只有管理员可以执行此操作" }), { status: 403 });
  }
  return user;
};

const ownerUser = async (env) => env.DB.prepare("SELECT id FROM users ORDER BY id ASC LIMIT 1").first();

const createSession = async (env, user) => {
  const token = crypto.randomUUID() + crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', '+14 days'))",
  )
    .bind(token, user.id)
    .run();
  return token;
};

const sendEmail = async (env, to, subject, body) => {
  if (!env.SMTP_USER || !env.SMTP_PASS) {
    console.log("Email delivery skipped. Configure SMTP_USER and SMTP_PASS.", { to, subject, body });
    return { skipped: true };
  }
  const from = env.SMTP_FROM || env.SMTP_USER;
  const response = await fetch(env.EMAIL_API_URL || "https://api.smtp2go.com/v3/email/send", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Smtp2go-Api-Key": env.EMAIL_API_KEY || "",
    },
    body: JSON.stringify({
      sender: from,
      to: [to],
      subject,
      text_body: body,
    }),
  }).catch((error) => ({ ok: false, status: 0, text: async () => messageFromError(error) }));
  if (!response.ok) {
    console.log("Email provider failed", await response.text());
  }
  return { skipped: false };
};

const createEmailCode = async (env, { userId = null, email, purpose }) => {
  const code = String(Math.floor(100000 + Math.random() * 900000));
  await env.DB.prepare(
    `INSERT INTO email_codes (user_id, email, purpose, code_hash, expires_at)
     VALUES (?, ?, ?, ?, datetime('now', '+10 minutes'))`,
  )
    .bind(userId, email, purpose, await hashCode(code))
    .run();
  await sendEmail(env, email, "Liou_Yang Server 验证码", `你的验证码是 ${code}，10 分钟内有效。`);
  return code;
};

const verifyEmailCode = async (env, { email, purpose, code }) => {
  const row = await env.DB.prepare(
    `SELECT id, code_hash, user_id FROM email_codes
     WHERE email = ? AND purpose = ? AND used_at IS NULL AND expires_at > datetime('now')
     ORDER BY id DESC LIMIT 1`,
  )
    .bind(email, purpose)
    .first();
  if (!row || row.code_hash !== (await hashCode(code))) return null;
  await env.DB.prepare("UPDATE email_codes SET used_at = CURRENT_TIMESTAMP WHERE id = ?").bind(row.id).run();
  return row;
};

const me = async (env, request) => {
  const user = await currentUser(env, request);
  const site = await getSiteSettings(env);
  return json({ user: publicUser(user), site: { maintenanceMode: site.maintenanceMode } });
};

const listAnnouncements = async (env, { trash = false } = {}) => {
  const { results } = await env.DB.prepare(
    `SELECT announcements.id, announcements.title, announcements.content_html, announcements.pinned,
            announcements.views, announcements.deleted_at, announcements.created_at, announcements.updated_at,
            users.username AS author
     FROM announcements
     JOIN users ON users.id = announcements.author_id
     WHERE ${trash ? "announcements.deleted_at IS NOT NULL" : "announcements.deleted_at IS NULL"}
     ORDER BY announcements.pinned DESC, announcements.created_at DESC
     LIMIT 50`,
  ).all();
  return json({ items: results || [] });
};

const listPosts = async (env, { trash = false } = {}) => {
  if (!trash) {
    await env.DB.prepare("DELETE FROM posts WHERE deleted_at IS NOT NULL AND deleted_at < datetime('now', '-7 days')").run();
  }
  const { results } = await env.DB.prepare(
    `SELECT posts.id, posts.title, posts.excerpt, posts.content_html, posts.views, posts.deleted_at, posts.created_at,
            posts.updated_at, users.username AS author
     FROM posts
     JOIN users ON users.id = posts.author_id
     WHERE ${trash ? "posts.deleted_at IS NOT NULL" : "posts.deleted_at IS NULL"}
     ORDER BY posts.created_at DESC
     LIMIT 100`,
  ).all();
  return json({ items: results || [] });
};

const profile = async (env, request, username) => {
  const viewer = await currentUser(env, request);
  const user = await env.DB.prepare(
    `SELECT id, username, role, email, email_provider, email_verified, totp_enabled, last_seen_at, created_at
     FROM users
     WHERE lower(username) = lower(?)`,
  )
    .bind(username)
    .first();
  if (!user) return json({ error: "没有找到这个玩家" }, 404);
  const posts = await env.DB.prepare(
    `SELECT id, title, excerpt, content_html, views, created_at, updated_at
     FROM posts
     WHERE author_id = ? AND deleted_at IS NULL
     ORDER BY created_at DESC
     LIMIT 20`,
  )
    .bind(user.id)
    .all();
  const isSelf = viewer?.id === user.id;
  return json({
    profile: {
      id: user.id,
      username: user.username,
      role: user.role,
      accountType: user.role === "admin" ? "管理员" : "成员",
      email: isSelf ? user.email : null,
      email_provider: isSelf ? user.email_provider : null,
      email_verified: Boolean(user.email_verified),
      totp_enabled: Boolean(user.totp_enabled),
      online: user.last_seen_at ? Date.now() - new Date(user.last_seen_at).getTime() < 5 * 60 * 1000 : false,
      created_at: user.created_at,
      postCount: (posts.results || []).length,
      posts: posts.results || [],
      isSelf,
    },
  });
};

const register = async (env, request) => {
  const body = await readBody(request);
  const username = String(body.username || "").trim();
  const password = String(body.password || "");
  const email = normalizeEmail(body.email);
  const code = String(body.emailCode || "").trim();
  const provider = detectEmailProvider(email);
  if (!/^[\w\u4e00-\u9fa5-]{3,20}$/.test(username)) {
    return json({ error: "用户名需要 3-20 位，可用中文、字母、数字、下划线和短横线" }, 400);
  }
  if (password.length < 6) return json({ error: "密码至少 6 位" }, 400);
  if (!provider) return json({ error: "邮箱只支持 Outlook、Google、QQ、网易邮箱" }, 400);
  if (!(await verifyEmailCode(env, { email, purpose: "verify_email", code }))) return json({ error: "邮箱验证码错误或已过期" }, 400);

  const count = await env.DB.prepare("SELECT COUNT(*) AS total FROM users").first();
  const role = count.total === 0 ? "admin" : "user";
  const passwordHash = await hashPassword(password);
  try {
    await env.DB.prepare(
      "INSERT INTO users (username, password_hash, role, email, email_provider, email_verified, last_seen_at) VALUES (?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)",
    )
      .bind(username, passwordHash, role, email, provider)
      .run();
  } catch {
    return json({ error: "用户名已存在" }, 409);
  }
  return login(env, request, { username, password });
};

const login = async (env, request, overrideBody = null) => {
  const body = overrideBody || (await readBody(request));
  const username = String(body.username || "").trim();
  const password = String(body.password || "");
  const totpCode = String(body.totpCode || "").trim();
  const user = await env.DB.prepare(
    "SELECT id, username, password_hash, role, email, email_provider, email_verified, totp_secret, totp_enabled, created_at, last_seen_at FROM users WHERE username = ?",
  )
    .bind(username)
    .first();
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return json({ error: "用户名或密码错误" }, 401);
  }
  if (user.totp_enabled && !(await verifyTotpAsync(user.totp_secret, totpCode))) {
    return json({ error: "请输入正确的双重验证码", needsTotp: true }, 401);
  }
  const token = await createSession(env, user);
  await env.DB.prepare("UPDATE users SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?").bind(user.id).run();
  return json({ user: publicUser(user) }, 200, {
    "Set-Cookie": `session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=1209600`,
  });
};

const logout = async (env, request) => {
  const token = getCookie(request, "session");
  if (token) await env.DB.prepare("DELETE FROM sessions WHERE token = ?").bind(token).run();
  return json({ ok: true }, 200, {
    "Set-Cookie": "session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0",
  });
};

const sendVerifyCode = async (env, request) => {
  const body = await readBody(request);
  const email = normalizeEmail(body.email);
  const provider = detectEmailProvider(email);
  if (!provider) return json({ error: "邮箱只支持 Outlook、Google、QQ、网易邮箱" }, 400);
  const user = await currentUser(env, request);
  await createEmailCode(env, { userId: user?.id || null, email, purpose: "verify_email" });
  return json({ ok: true, provider });
};

const updateEmail = async (env, request) => {
  const user = await requireUser(env, request);
  const body = await readBody(request);
  const email = normalizeEmail(body.email);
  const provider = detectEmailProvider(email);
  const code = String(body.emailCode || "").trim();
  if (!provider) return json({ error: "邮箱只支持 Outlook、Google、QQ、网易邮箱" }, 400);
  if (!(await verifyEmailCode(env, { email, purpose: "verify_email", code }))) return json({ error: "邮箱验证码错误或已过期" }, 400);
  await env.DB.prepare("UPDATE users SET email = ?, email_provider = ?, email_verified = 1 WHERE id = ?")
    .bind(email, provider, user.id)
    .run();
  return me(env, request);
};

const sendResetCode = async (env, request) => {
  const body = await readBody(request);
  const email = normalizeEmail(body.email);
  const user = await env.DB.prepare("SELECT id FROM users WHERE email = ? AND email_verified = 1").bind(email).first();
  if (user) await createEmailCode(env, { userId: user.id, email, purpose: "reset_password" });
  return json({ ok: true });
};

const resetPassword = async (env, request) => {
  const body = await readBody(request);
  const email = normalizeEmail(body.email);
  const password = String(body.password || "");
  const code = String(body.emailCode || "").trim();
  if (password.length < 6) return json({ error: "密码至少 6 位" }, 400);
  const verified = await verifyEmailCode(env, { email, purpose: "reset_password", code });
  if (!verified) return json({ error: "验证码错误或已过期" }, 400);
  await env.DB.prepare("UPDATE users SET password_hash = ? WHERE id = ?").bind(await hashPassword(password), verified.user_id).run();
  await env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(verified.user_id).run();
  return json({ ok: true });
};

const generateTotpAsync = async (secret, counter) => {
  const key = await crypto.subtle.importKey("raw", base32ToBytes(secret), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  view.setUint32(4, counter);
  const hmac = new Uint8Array(await crypto.subtle.sign("HMAC", key, buffer));
  const offset = hmac[hmac.length - 1] & 0xf;
  const binary = ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
  return String(binary % 1000000).padStart(6, "0");
};

const verifyTotpAsync = async (secret, token) => {
  if (!secret || !/^\d{6}$/.test(token || "")) return false;
  const counter = Math.floor(Date.now() / 30000);
  for (const offset of [-1, 0, 1]) {
    if ((await generateTotpAsync(secret, counter + offset)) === token) return true;
  }
  return false;
};

const beginTotp = async (env, request) => {
  const user = await requireVerifiedUser(env, request);
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  const secret = bytesToBase32(bytes);
  await env.DB.prepare("UPDATE users SET totp_secret = ?, totp_enabled = 0 WHERE id = ?").bind(secret, user.id).run();
  const issuer = "Liou_Yang Server";
  const uri = `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(user.username)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}`;
  return json({ secret, uri });
};

const confirmTotp = async (env, request) => {
  const user = await requireVerifiedUser(env, request);
  const body = await readBody(request);
  const row = await env.DB.prepare("SELECT totp_secret FROM users WHERE id = ?").bind(user.id).first();
  if (!(await verifyTotpAsync(row?.totp_secret, String(body.code || "").trim()))) return json({ error: "双重验证码不正确" }, 400);
  await env.DB.prepare("UPDATE users SET totp_enabled = 1 WHERE id = ?").bind(user.id).run();
  return json({ ok: true });
};

const disableTotp = async (env, request) => {
  const user = await requireVerifiedUser(env, request);
  await env.DB.prepare("UPDATE users SET totp_secret = NULL, totp_enabled = 0 WHERE id = ?").bind(user.id).run();
  return json({ ok: true });
};

const contentPayload = async (request) => {
  const body = await readBody(request);
  const title = String(body.title || "").trim().slice(0, 80);
  const contentHtml = sanitizeHtml(body.contentHtml);
  const excerpt = excerptFromHtml(contentHtml);
  if (!title || !excerpt) throw new Response(JSON.stringify({ error: "标题和正文都要填写" }), { status: 400 });
  return { title, contentHtml, excerpt };
};

const createAnnouncement = async (env, request) => {
  const user = await requireAdmin(env, request);
  const { title, contentHtml } = await contentPayload(request);
  await env.DB.prepare("INSERT INTO announcements (title, content_html, author_id, pinned) VALUES (?, ?, ?, 0)")
    .bind(title, contentHtml, user.id)
    .run();
  return json({ ok: true }, 201);
};

const createPost = async (env, request) => {
  const user = await requireVerifiedUser(env, request);
  const { title, contentHtml, excerpt } = await contentPayload(request);
  await env.DB.prepare("INSERT INTO posts (title, excerpt, content_html, author_id) VALUES (?, ?, ?, ?)")
    .bind(title, excerpt, contentHtml, user.id)
    .run();
  return json({ ok: true }, 201);
};

const updateAnnouncement = async (env, request, id) => {
  await requireAdmin(env, request);
  const { title, contentHtml } = await contentPayload(request);
  await env.DB.prepare("UPDATE announcements SET title = ?, content_html = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .bind(title, contentHtml, id)
    .run();
  return json({ ok: true });
};

const updatePost = async (env, request, id) => {
  const user = await requireVerifiedUser(env, request);
  const post = await env.DB.prepare("SELECT author_id FROM posts WHERE id = ? AND deleted_at IS NULL").bind(id).first();
  if (!post) return json({ error: "帖子不存在" }, 404);
  if (user.role !== "admin" && post.author_id !== user.id) return json({ error: "只能编辑自己的帖子" }, 403);
  const { title, contentHtml, excerpt } = await contentPayload(request);
  await env.DB.prepare("UPDATE posts SET title = ?, excerpt = ?, content_html = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .bind(title, excerpt, contentHtml, id)
    .run();
  return json({ ok: true });
};

const deletePost = async (env, request, id) => {
  const user = await requireVerifiedUser(env, request);
  const post = await env.DB.prepare("SELECT author_id FROM posts WHERE id = ? AND deleted_at IS NULL").bind(id).first();
  if (!post) return json({ error: "帖子不存在" }, 404);
  if (user.role !== "admin" && post.author_id !== user.id) return json({ error: "只能删除自己的帖子" }, 403);
  await env.DB.prepare("UPDATE posts SET deleted_at = CURRENT_TIMESTAMP, deleted_by = ? WHERE id = ?").bind(user.id, id).run();
  return json({ ok: true });
};

const restorePost = async (env, request, id) => {
  await requireAdmin(env, request);
  await env.DB.prepare("UPDATE posts SET deleted_at = NULL, deleted_by = NULL WHERE id = ?").bind(id).run();
  return json({ ok: true });
};

const purgePost = async (env, request, id) => {
  await requireAdmin(env, request);
  await env.DB.prepare("DELETE FROM posts WHERE id = ? AND deleted_at IS NOT NULL").bind(id).run();
  return json({ ok: true });
};

const deleteAnnouncement = async (env, request, id) => {
  const user = await requireAdmin(env, request);
  await env.DB.prepare("UPDATE announcements SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?").bind(id).run();
  return json({ ok: true, user: publicUser(user) });
};

const restoreAnnouncement = async (env, request, id) => {
  await requireAdmin(env, request);
  await env.DB.prepare("UPDATE announcements SET deleted_at = NULL WHERE id = ?").bind(id).run();
  return json({ ok: true });
};

const purgeAnnouncement = async (env, request, id) => {
  await requireAdmin(env, request);
  await env.DB.prepare("DELETE FROM announcements WHERE id = ? AND deleted_at IS NOT NULL").bind(id).run();
  return json({ ok: true });
};

const trackView = async (env, type, id) => {
  const table = type === "announcement" ? "announcements" : type === "post" ? "posts" : null;
  if (!table) return json({ error: "类型不存在" }, 404);
  await env.DB.prepare(`UPDATE ${table} SET views = COALESCE(views, 0) + 1 WHERE id = ? AND deleted_at IS NULL`).bind(id).run();
  return json({ ok: true });
};

const stats = async (env, request) => {
  await requireAdmin(env, request);
  const site = await getSiteSettings(env);
  const announcementViews = await env.DB.prepare("SELECT COALESCE(SUM(views), 0) AS total FROM announcements WHERE deleted_at IS NULL").first();
  const postViews = await env.DB.prepare("SELECT COALESCE(SUM(views), 0) AS total FROM posts WHERE deleted_at IS NULL").first();
  const userCount = await env.DB.prepare("SELECT COUNT(*) AS total FROM users").first();
  const trashCount = await env.DB.prepare(
    "SELECT (SELECT COUNT(*) FROM posts WHERE deleted_at IS NOT NULL) + (SELECT COUNT(*) FROM announcements WHERE deleted_at IS NOT NULL) AS total",
  ).first();
  return json({
    totalViews: Number(announcementViews.total || 0) + Number(postViews.total || 0),
    announcementViews: Number(announcementViews.total || 0),
    postViews: Number(postViews.total || 0),
    userCount: Number(userCount.total || 0),
    trashCount: Number(trashCount.total || 0),
    maintenanceMode: site.maintenanceMode,
  });
};

const listAdmins = async (env, request) => {
  await requireAdmin(env, request);
  const owner = await ownerUser(env);
  const { results } = await env.DB.prepare(
    `SELECT id, username, role, email, email_provider, email_verified, created_at
     FROM users
     WHERE role = 'admin'
     ORDER BY id ASC`,
  ).all();
  return json({ items: (results || []).map((user) => ({ ...user, is_owner: owner?.id === user.id })) });
};

const addAdmin = async (env, request) => {
  await requireAdmin(env, request);
  const body = await readBody(request);
  const username = String(body.username || "").trim();
  const result = await env.DB.prepare("UPDATE users SET role = 'admin' WHERE username = ?").bind(username).run();
  if (!result.meta?.changes) return json({ error: "没有找到这个用户" }, 404);
  return json({ ok: true });
};

const removeAdmin = async (env, request, id) => {
  const user = await requireAdmin(env, request);
  const targetId = Number(id);
  const owner = await ownerUser(env);
  if (owner?.id === targetId) return json({ error: "第一个注册用户的管理员权限不能删除" }, 400);
  if (user.id === targetId) return json({ error: "不能删除自己的管理员权限" }, 400);
  await env.DB.prepare("UPDATE users SET role = 'user' WHERE id = ? AND role = 'admin'").bind(targetId).run();
  return json({ ok: true });
};

const updateMaintenance = async (env, request) => {
  await requireAdmin(env, request);
  const body = await readBody(request);
  const enabled = Boolean(body.enabled);
  await setSiteSetting(env, "maintenance_mode", enabled ? "on" : "off");
  return json({ ok: true, maintenanceMode: enabled });
};

export async function onRequest(context) {
  const { request, env, params } = context;
  const pathname = `/${(params.path || []).join("/")}`;
  const method = request.method;

  try {
    if (method === "GET" && pathname === "/me") return me(env, request);
    if (method === "POST" && pathname === "/email/send-code") return sendVerifyCode(env, request);
    if (method === "POST" && pathname === "/password/send-reset") return sendResetCode(env, request);
    if (method === "POST" && pathname === "/password/reset") return resetPassword(env, request);
    if (method === "POST" && pathname === "/register") return register(env, request);
    if (method === "POST" && pathname === "/login") return login(env, request);
    if (method === "POST" && pathname === "/logout") return logout(env, request);
    if (method === "PUT" && pathname === "/me/email") return updateEmail(env, request);
    if (method === "POST" && pathname === "/me/totp/begin") return beginTotp(env, request);
    if (method === "POST" && pathname === "/me/totp/confirm") return confirmTotp(env, request);
    if (method === "DELETE" && pathname === "/me/totp") return disableTotp(env, request);

    if (method === "GET" && pathname === "/announcements") return listAnnouncements(env);
    if (method === "POST" && pathname === "/announcements") return createAnnouncement(env, request);
    if (method === "PUT" && /^\/announcements\/\d+$/.test(pathname)) return updateAnnouncement(env, request, pathname.split("/").at(-1));
    if (method === "DELETE" && /^\/announcements\/\d+$/.test(pathname)) return deleteAnnouncement(env, request, pathname.split("/").at(-1));
    if (method === "POST" && /^\/announcements\/\d+\/restore$/.test(pathname)) return restoreAnnouncement(env, request, pathname.split("/").at(-2));
    if (method === "DELETE" && /^\/announcements\/\d+\/purge$/.test(pathname)) return purgeAnnouncement(env, request, pathname.split("/").at(-2));

    if (method === "GET" && pathname === "/posts") return listPosts(env);
    if (method === "POST" && pathname === "/posts") return createPost(env, request);
    if (method === "PUT" && /^\/posts\/\d+$/.test(pathname)) return updatePost(env, request, pathname.split("/").at(-1));
    if (method === "DELETE" && /^\/posts\/\d+$/.test(pathname)) return deletePost(env, request, pathname.split("/").at(-1));
    if (method === "POST" && /^\/posts\/\d+\/restore$/.test(pathname)) return restorePost(env, request, pathname.split("/").at(-2));
    if (method === "DELETE" && /^\/posts\/\d+\/purge$/.test(pathname)) return purgePost(env, request, pathname.split("/").at(-2));
    if (method === "GET" && /^\/profiles\/[^/]+$/.test(pathname)) return profile(env, request, decodeURIComponent(pathname.split("/").at(-1)));

    if (method === "POST" && /^\/track-view\/(announcement|post)\/\d+$/.test(pathname)) {
      const [, , type, id] = pathname.split("/");
      return trackView(env, type, id);
    }
    if (method === "GET" && pathname === "/admin/stats") return stats(env, request);
    if (method === "GET" && pathname === "/admin/users") return listAdmins(env, request);
    if (method === "POST" && pathname === "/admin/users") return addAdmin(env, request);
    if (method === "DELETE" && /^\/admin\/users\/\d+$/.test(pathname)) return removeAdmin(env, request, pathname.split("/").at(-1));
    if (method === "GET" && pathname === "/admin/trash") {
      await requireAdmin(env, request);
      const [announcements, posts] = await Promise.all([listAnnouncements(env, { trash: true }), listPosts(env, { trash: true })]);
      return json({ announcements: (await announcements.json()).items, posts: (await posts.json()).items });
    }
    if (method === "PUT" && pathname === "/admin/settings/maintenance") return updateMaintenance(env, request);

    return json({ error: "接口不存在" }, 404);
  } catch (error) {
    console.error("API request failed", pathname, method, error);
    if (error instanceof Response) return error;
    return json({ error: messageFromError(error, "服务器错误") }, 500);
  }
}
