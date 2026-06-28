const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });

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

const hashPassword = async (password, salt = crypto.randomUUID()) => {
  const encoded = new TextEncoder().encode(`${salt}:${password}`);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  const hash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${salt}:${hash}`;
};

const verifyPassword = async (password, stored) => {
  const [salt] = stored.split(":");
  return (await hashPassword(password, salt)) === stored;
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

const publicUser = (user) =>
  user
    ? {
        id: user.id,
        username: user.username,
        role: user.role,
        minecraft_name: user.minecraft_name,
        minecraft_uuid: user.minecraft_uuid,
      }
    : null;

const currentUser = async (env, request) => {
  const token = getCookie(request, "session");
  if (!token) return null;
  return env.DB.prepare(
    `SELECT users.id, users.username, users.role, users.minecraft_name, users.minecraft_uuid, users.created_at
     FROM sessions
     JOIN users ON users.id = sessions.user_id
     WHERE sessions.token = ? AND sessions.expires_at > datetime('now')`,
  )
    .bind(token)
    .first();
};

const requireUser = async (env, request) => {
  const user = await currentUser(env, request);
  if (!user) throw new Response(JSON.stringify({ error: "请先登录" }), { status: 401 });
  return user;
};

const requireAdmin = async (env, request) => {
  const user = await requireUser(env, request);
  if (user.role !== "admin") {
    throw new Response(JSON.stringify({ error: "只有管理员可以执行此操作" }), { status: 403 });
  }
  return user;
};

const ownerUser = async (env) => env.DB.prepare("SELECT id FROM users ORDER BY id ASC LIMIT 1").first();

const listAnnouncements = async (env) => {
  const { results } = await env.DB.prepare(
    `SELECT announcements.id, announcements.title, announcements.content_html, announcements.pinned,
            announcements.views, announcements.created_at, announcements.updated_at, users.username AS author
     FROM announcements
     JOIN users ON users.id = announcements.author_id
     ORDER BY announcements.pinned DESC, announcements.created_at DESC
     LIMIT 50`,
  ).all();
  return json({ items: results || [] });
};

const listPosts = async (env) => {
  const { results } = await env.DB.prepare(
    `SELECT posts.id, posts.title, posts.excerpt, posts.content_html, posts.views, posts.created_at,
            posts.updated_at, users.username AS author, users.minecraft_name, users.minecraft_uuid
     FROM posts
     JOIN users ON users.id = posts.author_id
     ORDER BY posts.created_at DESC
     LIMIT 100`,
  ).all();
  return json({ items: results || [] });
};

const register = async (env, request) => {
  const body = await readBody(request);
  const username = String(body.username || "").trim();
  const password = String(body.password || "");
  if (!/^[\w\u4e00-\u9fa5-]{3,20}$/.test(username)) {
    return json({ error: "用户名需要 3-20 位，可用中文、字母、数字、下划线和短横线" }, 400);
  }
  if (password.length < 6) return json({ error: "密码至少 6 位" }, 400);

  const count = await env.DB.prepare("SELECT COUNT(*) AS total FROM users").first();
  const role = count.total === 0 ? "admin" : "user";
  const passwordHash = await hashPassword(password);
  try {
    await env.DB.prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)")
      .bind(username, passwordHash, role)
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
  const user = await env.DB.prepare(
    "SELECT id, username, password_hash, role, minecraft_name, minecraft_uuid FROM users WHERE username = ?",
  )
    .bind(username)
    .first();
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return json({ error: "用户名或密码错误" }, 401);
  }

  const token = crypto.randomUUID() + crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', '+14 days'))",
  )
    .bind(token, user.id)
    .run();
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

const contentPayload = async (request) => {
  const body = await readBody(request);
  const title = String(body.title || "").trim().slice(0, 80);
  const contentHtml = sanitizeHtml(body.contentHtml);
  const excerpt = excerptFromHtml(contentHtml);
  if (!title || !excerpt) {
    throw new Response(JSON.stringify({ error: "标题和正文都要填写" }), { status: 400 });
  }
  return { title, contentHtml, excerpt };
};

const createAnnouncement = async (env, request) => {
  const user = await requireAdmin(env, request);
  const { title, contentHtml } = await contentPayload(request);
  await env.DB.prepare(
    `INSERT INTO announcements (title, content_html, author_id, pinned)
     VALUES (?, ?, ?, ?)`,
  )
    .bind(title, contentHtml, user.id, 0)
    .run();
  return json({ ok: true }, 201);
};

const createPost = async (env, request) => {
  const user = await requireUser(env, request);
  const { title, contentHtml, excerpt } = await contentPayload(request);
  await env.DB.prepare(
    `INSERT INTO posts (title, excerpt, content_html, author_id)
     VALUES (?, ?, ?, ?)`,
  )
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
  const user = await requireUser(env, request);
  const post = await env.DB.prepare("SELECT author_id FROM posts WHERE id = ?").bind(id).first();
  if (!post) return json({ error: "帖子不存在" }, 404);
  if (user.role !== "admin" && post.author_id !== user.id) return json({ error: "只能编辑自己的帖子" }, 403);
  const { title, contentHtml, excerpt } = await contentPayload(request);
  await env.DB.prepare("UPDATE posts SET title = ?, excerpt = ?, content_html = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .bind(title, excerpt, contentHtml, id)
    .run();
  return json({ ok: true });
};

const deletePost = async (env, request, id) => {
  const user = await requireUser(env, request);
  const post = await env.DB.prepare("SELECT author_id FROM posts WHERE id = ?").bind(id).first();
  if (!post) return json({ error: "帖子不存在" }, 404);
  if (user.role !== "admin" && post.author_id !== user.id) return json({ error: "只能删除自己的帖子" }, 403);
  await env.DB.prepare("DELETE FROM posts WHERE id = ?").bind(id).run();
  return json({ ok: true });
};

const deleteAnnouncement = async (env, request, id) => {
  await requireAdmin(env, request);
  await env.DB.prepare("DELETE FROM announcements WHERE id = ?").bind(id).run();
  return json({ ok: true });
};

const trackView = async (env, type, id) => {
  const table = type === "announcement" ? "announcements" : type === "post" ? "posts" : null;
  if (!table) return json({ error: "类型不存在" }, 404);
  await env.DB.prepare(`UPDATE ${table} SET views = COALESCE(views, 0) + 1 WHERE id = ?`).bind(id).run();
  return json({ ok: true });
};

const lookupMinecraft = async (minecraftName) => {
  if (!/^[A-Za-z0-9_]{3,16}$/.test(minecraftName)) {
    throw new Response(JSON.stringify({ error: "Minecraft 用户名需要 3-16 位，只能包含字母、数字和下划线" }), { status: 400 });
  }
  let response;
  try {
    response = await fetch(`https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(minecraftName)}`, {
      headers: { Accept: "application/json" },
    });
  } catch (error) {
    throw new Response(JSON.stringify({ error: `连接 Mojang 验证服务失败: ${messageFromError(error, "网络错误")}` }), {
      status: 502,
    });
  }
  if (response.status === 204 || response.status === 404) {
    throw new Response(JSON.stringify({ error: "没有找到这个正版 Minecraft 用户名" }), { status: 404 });
  }
  if (!response.ok) {
    throw new Response(JSON.stringify({ error: "暂时无法验证 Minecraft 用户名，请稍后再试" }), { status: 502 });
  }
  try {
    return await response.json();
  } catch {
    throw new Response(JSON.stringify({ error: "Minecraft 验证服务返回了无法识别的数据" }), { status: 502 });
  }
};

const bindMinecraft = async (env, request) => {
  try {
    const user = await requireUser(env, request);
    const body = await readBody(request);
    const minecraftName = String(body.minecraftName || "").trim();
    const profile = await lookupMinecraft(minecraftName);

    try {
      await env.DB.prepare("UPDATE users SET minecraft_name = ?, minecraft_uuid = ? WHERE id = ?")
        .bind(profile.name, profile.id, user.id)
        .run();
    } catch (error) {
      const message = messageFromError(error);
      if (/no such column/i.test(message)) {
        return json({ error: `数据库结构未更新完整: ${message}。请在 Cloudflare D1 中补齐缺失列后再试。` }, 500);
      }
      return json({ error: `保存 Minecraft 绑定失败: ${message}` }, 500);
    }

    const updated = await env.DB.prepare(
      "SELECT id, username, role, minecraft_name, minecraft_uuid FROM users WHERE id = ?",
    )
      .bind(user.id)
      .first();
    return json({ user: publicUser(updated) });
  } catch (error) {
    if (error instanceof Response) throw error;
    return json({ error: `Minecraft 用户名验证失败: ${messageFromError(error, "未知错误")}` }, 502);
  }
};

const unbindMinecraft = async (env, request) => {
  const user = await requireUser(env, request);
  await env.DB.prepare("UPDATE users SET minecraft_name = NULL, minecraft_uuid = NULL WHERE id = ?").bind(user.id).run();
  const updated = await env.DB.prepare(
    "SELECT id, username, role, minecraft_name, minecraft_uuid FROM users WHERE id = ?",
  )
    .bind(user.id)
    .first();
  return json({ user: publicUser(updated) });
};

const stats = async (env, request) => {
  await requireAdmin(env, request);
  const announcementViews = await env.DB.prepare("SELECT COALESCE(SUM(views), 0) AS total FROM announcements").first();
  const postViews = await env.DB.prepare("SELECT COALESCE(SUM(views), 0) AS total FROM posts").first();
  const userCount = await env.DB.prepare("SELECT COUNT(*) AS total FROM users").first();
  const boundCount = await env.DB.prepare("SELECT COUNT(*) AS total FROM users WHERE minecraft_name IS NOT NULL").first();
  return json({
    totalViews: Number(announcementViews.total || 0) + Number(postViews.total || 0),
    announcementViews: Number(announcementViews.total || 0),
    postViews: Number(postViews.total || 0),
    userCount: Number(userCount.total || 0),
    boundCount: Number(boundCount.total || 0),
  });
};

const listAdmins = async (env, request) => {
  await requireAdmin(env, request);
  const owner = await ownerUser(env);
  const { results } = await env.DB.prepare(
    `SELECT id, username, role, minecraft_name, minecraft_uuid, created_at
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

export async function onRequest(context) {
  const { request, env, params } = context;
  const pathname = `/${(params.path || []).join("/")}`;
  const method = request.method;

  try {
    if (method === "GET" && pathname === "/me") return json({ user: publicUser(await currentUser(env, request)) });
    if (method === "POST" && pathname === "/register") return register(env, request);
    if (method === "POST" && pathname === "/login") return login(env, request);
    if (method === "POST" && pathname === "/logout") return logout(env, request);
    if (method === "PUT" && pathname === "/me/minecraft") return bindMinecraft(env, request);
    if (method === "DELETE" && pathname === "/me/minecraft") return unbindMinecraft(env, request);

    if (method === "GET" && pathname === "/announcements") return listAnnouncements(env);
    if (method === "POST" && pathname === "/announcements") return createAnnouncement(env, request);
    if (method === "PUT" && /^\/announcements\/\d+$/.test(pathname)) {
      return updateAnnouncement(env, request, pathname.split("/").at(-1));
    }
    if (method === "DELETE" && /^\/announcements\/\d+$/.test(pathname)) {
      return deleteAnnouncement(env, request, pathname.split("/").at(-1));
    }

    if (method === "GET" && pathname === "/posts") return listPosts(env);
    if (method === "POST" && pathname === "/posts") return createPost(env, request);
    if (method === "PUT" && /^\/posts\/\d+$/.test(pathname)) return updatePost(env, request, pathname.split("/").at(-1));
    if (method === "DELETE" && /^\/posts\/\d+$/.test(pathname)) return deletePost(env, request, pathname.split("/").at(-1));

    if (method === "POST" && /^\/track-view\/(announcement|post)\/\d+$/.test(pathname)) {
      const [, , type, id] = pathname.split("/");
      return trackView(env, type, id);
    }
    if (method === "GET" && pathname === "/admin/stats") return stats(env, request);
    if (method === "GET" && pathname === "/admin/users") return listAdmins(env, request);
    if (method === "POST" && pathname === "/admin/users") return addAdmin(env, request);
    if (method === "DELETE" && /^\/admin\/users\/\d+$/.test(pathname)) {
      return removeAdmin(env, request, pathname.split("/").at(-1));
    }

    return json({ error: "接口不存在" }, 404);
  } catch (error) {
    console.error("API request failed", pathname, method, error);
    if (error instanceof Response) return error;
    return json({ error: messageFromError(error, "服务器错误") }, 500);
  }
}
