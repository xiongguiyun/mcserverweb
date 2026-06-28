# 方境 BlockHaven

一个 Minecraft 风格宣传站，包含主页宣传、管理员公告、玩家论坛、注册登录、富文本编辑器和 Bilibili 视频嵌入。后端使用 Cloudflare Pages Functions，数据存储使用 Cloudflare D1。

## 本地运行

```bash
npm install
npm run db:init
npm run dev
```

打开 Wrangler 给出的本地地址。第一个注册账号会自动成为管理员。

## Cloudflare 部署

1. 安装并登录 Wrangler：

```bash
npm install
npx wrangler login
```

2. 创建 D1 数据库：

```bash
npx wrangler d1 create blockhaven_db
```

3. 把命令输出里的 `database_id` 填进 `wrangler.toml`。

4. 初始化线上数据库表：

```bash
npm run db:prod
```

5. 部署到 Cloudflare Pages：

```bash
npm run deploy
```

6. 在 Cloudflare Dashboard 的 Pages 项目里确认 D1 绑定：

- Binding name: `DB`
- Database: `blockhaven_db`

## 更新已有 D1 数据库

如果你已经部署过旧版本，需要在 Cloudflare D1 控制台执行一次：

```sql
ALTER TABLE announcements ADD COLUMN views INTEGER NOT NULL DEFAULT 0;
ALTER TABLE posts ADD COLUMN views INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN minecraft_name TEXT;
ALTER TABLE users ADD COLUMN minecraft_uuid TEXT;
```

如果你是全新数据库，直接执行 `schema.sql` 即可。

## 功能说明

- 第一个注册用户自动获得管理员权限。
- 管理员可以发布公告。
- 玩家论坛已经拆成独立页面。
- 注册用户可以在玩家论坛自由发帖。
- 玩家可以绑定、解绑或换绑正版 Minecraft 用户名，并在帖子卡片上显示皮肤人物。
- 管理员可以发布公告，并管理全部论坛内容。
- 管理员后台可以查看浏览数据、编辑/删除内容、添加/删除管理员。
- 第一个注册用户的管理员权限无法删除。
- 编辑器支持加粗、斜体、标题、列表、链接和 Bilibili 视频。
- Bilibili 支持粘贴完整链接、`BV...` 或 `av...`。

## 生产建议

当前版本是轻量可部署原型。正式运营前建议增加邮箱验证、找回密码、后台用户管理、公告编辑/删除、文章审核、图片上传到 R2，以及更严格的 HTML 白名单净化。
