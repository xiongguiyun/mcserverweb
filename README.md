# Liou_Yang Server

一个 Minecraft 风格的宣传站，包含主页宣传、论坛公告、玩家论坛、注册登录、富文本编辑器、Bilibili 视频嵌入，以及正版 Minecraft 用户名绑定。

## 本地运行

```bash
npm install
npm run db:init
npm run dev
```

打开 Wrangler 给出的本地地址。第一个注册账号会自动成为管理员。

## Cloudflare 部署

1. 登录 Wrangler：

```bash
npx wrangler login
```

2. 创建 D1 数据库：

```bash
npx wrangler d1 create blockhaven_db
```

3. 把输出的 `database_id` 填进 [wrangler.toml](E:/网站/wrangler.toml)。

4. 初始化线上数据库：

```bash
npm run db:prod
```

5. 部署：

```bash
npm run deploy
```

6. 在 Cloudflare Dashboard 的 Pages 项目里确认 D1 绑定：

- Binding name: `DB`
- Database: `blockhaven_db`

## 更新已有 D1 数据库

如果你已经部署过旧版本，需要在 Cloudflare D1 控制台执行：

```sql
ALTER TABLE announcements ADD COLUMN views INTEGER NOT NULL DEFAULT 0;
ALTER TABLE posts ADD COLUMN views INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN minecraft_name TEXT;
ALTER TABLE users ADD COLUMN minecraft_uuid TEXT;
```

如果提示 `duplicate column name`，说明该列已经存在，可以忽略。

## 现在的功能

- 第一个注册用户自动获得管理员权限。
- 主页可一键复制服务器地址。
- 公告区单独展示，论坛是独立页面。
- 注册用户可以自由发帖。
- 所有注册用户都可以绑定、解绑、换绑正版 Minecraft 用户名。
- 绑定后帖子会显示对应皮肤人物；未绑定时显示项目内置占位皮肤。
- 管理员可以发布公告、编辑或删除全部论坛内容、添加或删除管理员。
- 第一个注册用户的管理员权限不能删除。
- 编辑器支持：
  `粗体`、`斜体`、`字号`、`段落格式`、`文本颜色`、`中划线`、`下划线`、`链接`、`图片`、`表格`、`内联遮挡`、`水平线`、`折叠`、`引用`、`代码`、`Bilibili 视频`

## 如何更新网站

1. 把 `E:\网站` 里的修改推送到你的 GitHub 仓库。
2. 如果这次有数据库字段更新，先去 Cloudflare D1 控制台执行上面的 `ALTER TABLE`。
3. 回到 Cloudflare Pages 项目，进入 `Deployments`。
4. 点击 `Retry deployment`，或者重新 push 一次代码触发自动部署。

## 生产建议

正式运营前，建议再补：

- 邮箱验证和找回密码
- 图片上传到 R2
- 更严格的 HTML 白名单净化
- 论坛审核、敏感词、举报和封禁机制
