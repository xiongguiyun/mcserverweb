import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { onRequest } from "../functions/api/[[path]].js";

export const createFixture = () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));
  sqlite.exec(`
    INSERT INTO users (id, username, password_hash, role) VALUES
      (1, 'OwnerTest', 'test-only', 'admin'),
      (2, 'AdminTest', 'test-only', 'admin'),
      (3, 'MemberTest', 'test-only', 'user'),
      (4, 'AdminOther', 'test-only', 'admin');
    INSERT INTO sessions (token, user_id, expires_at) VALUES
      ('test-owner', 1, datetime('now', '+1 day')),
      ('test-admin', 2, datetime('now', '+1 day')),
      ('test-member', 3, datetime('now', '+1 day')),
      ('test-other', 4, datetime('now', '+1 day'));
    INSERT INTO announcements (title, content_html, author_id) VALUES ('Test announcement', '<p>Announcement body</p>', 1);
    INSERT INTO posts (title, excerpt, content_html, author_id) VALUES ('Test post', 'Post body', '<p>Post body</p>', 3);
    INSERT INTO post_reports (post_id, reporter_id, reason) VALUES (1, 2, 'Test report');
  `);
  let writes = 0;
  let batches = 0;
  const DB = {
    prepare(sql) {
      let args = [];
      const statement = {
        bind(...values) { args = values; return statement; },
        async first() { return sqlite.prepare(sql).get(...args) || null; },
        async all() { return { results: sqlite.prepare(sql).all(...args) }; },
        async run() {
          writes += 1;
          const result = sqlite.prepare(sql).run(...args);
          return { success: true, meta: { changes: result.changes, last_row_id: Number(result.lastInsertRowid) } };
        },
      };
      return statement;
    },
    async batch(statements) {
      batches += 1;
      sqlite.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
  const handle = (request) => onRequest({
    request, env: { DB }, params: { path: new URL(request.url).pathname.replace(/^\/api\/?/, "").split("/") },
    waitUntil: (promise) => promise.catch(() => {}),
  });
  const call = async (path, { role = "owner", method = "GET", body } = {}) => {
    const headers = { "Content-Type": "application/json" };
    if (role) headers.Cookie = `session=test-${role}`;
    const response = await handle(new Request(`http://localhost/api${path}`, {
      method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }));
    return { status: response.status, headers: response.headers, data: await response.json() };
  };
  return { sqlite, DB, handle, call, counts: () => ({ writes, batches }) };
};
