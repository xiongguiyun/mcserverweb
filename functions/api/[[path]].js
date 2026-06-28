const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...headers,
    },
  });

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

const currentUser = async (env, request) => {
  const token = getCookie(request, "session");
  if (!token) return null;
  const row = await env.DB.prepare(
    `SELECT users.id, users.username, users.role
     FROM sessions
     JOIN users ON users.id = sessions.user_id
     WHERE sessions.token = ? AND sessions.expires_at > datetime('now')`,
  )
    .bind(token)
    .first();
  return row || null;
};

const requireUser = async (env, request) => {
  const user = await currentUser(env, request);
  if (!user) throw new Response(JSON.stringify({ error: "请先登录" }), { status: 401 });
  return user;
};

const listAnnouncements = async (env) => {
  const { results } = await env.DB.prepare(
    `SELECT announcements.id, announcements.title, announcements.content_html, announcements.pinned,
            announcements.created_at, users.username AS author
     FROM announcements
     JOIN users ON users.id = announcements.author_id
     ORDER BY announcements.pinned DESC, announcements.created_at DESC
     LIMIT 30`,
  ).all();
  return json({ items: results || [] });
};

const listPosts = async (env) => {
  const { results } = await env.DB.prepare(
    `SELECT posts.id, posts.title, posts.excerpt, posts.content_html, posts.created_at,
            users.username AS author
     FROM posts
     JOIN users ON users.id = posts.author_id
     ORDER BY posts.created_at DESC
     LIMIT 60`,
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
  const user = await env.DB.prepare("SELECT id, username, password_hash, role FROM users WHERE username = ?")
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
  return json(
    { user: { id: user.id, username: user.username, role: user.role } },
    200,
    {
      "Set-Cookie": `session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=1209600`,
    },
  );
};

const logout = async (env, request) => {
  const token = getCookie(request, "session");
  if (token) await env.DB.prepare("DELETE FROM sessions WHERE token = ?").bind(token).run();
  return json(
    { ok: true },
    200,
    { "Set-Cookie": "session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0" },
  );
};

const createAnnouncement = async (env, request) => {
  const user = await requireUser(env, request);
  if (user.role !== "admin") return json({ error: "只有管理员可以发布公告" }, 403);
  const body = await readBody(request);
  const title = String(body.title || "").trim().slice(0, 80);
  const contentHtml = sanitizeHtml(body.contentHtml);
  if (!title || !excerptFromHtml(contentHtml)) return json({ error: "标题和正文都要填写" }, 400);
  await env.DB.prepare(
    `INSERT INTO announcements (title, content_html, author_id, pinned)
     VALUES (?, ?, ?, ?)`,
  )
    .bind(title, contentHtml, user.id, body.pinned ? 1 : 0)
    .run();
  return json({ ok: true }, 201);
};

const createPost = async (env, request) => {
  const user = await requireUser(env, request);
  const body = await readBody(request);
  const title = String(body.title || "").trim().slice(0, 80);
  const contentHtml = sanitizeHtml(body.contentHtml);
  const excerpt = excerptFromHtml(contentHtml);
  if (!title || !excerpt) return json({ error: "标题和正文都要填写" }, 400);
  await env.DB.prepare(
    `INSERT INTO posts (title, excerpt, content_html, author_id)
     VALUES (?, ?, ?, ?)`,
  )
    .bind(title, excerpt, contentHtml, user.id)
    .run();
  return json({ ok: true }, 201);
};

export async function onRequest(context) {
  const { request, env, params } = context;
  const pathname = `/${(params.path || []).join("/")}`;

  try {
    if (request.method === "GET" && pathname === "/me") {
      return json({ user: await currentUser(env, request) });
    }
    if (request.method === "POST" && pathname === "/register") return register(env, request);
    if (request.method === "POST" && pathname === "/login") return login(env, request);
    if (request.method === "POST" && pathname === "/logout") return logout(env, request);
    if (request.method === "GET" && pathname === "/announcements") return listAnnouncements(env);
    if (request.method === "POST" && pathname === "/announcements") return createAnnouncement(env, request);
    if (request.method === "GET" && pathname === "/posts") return listPosts(env);
    if (request.method === "POST" && pathname === "/posts") return createPost(env, request);
    return json({ error: "接口不存在" }, 404);
  } catch (error) {
    if (error instanceof Response) return error;
    return json({ error: error.message || "服务器错误" }, 500);
  }
}
