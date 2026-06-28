# Liou_Yang Server

一个 Minecraft 风格的宣传站，包含主页宣传、公告、玩家论坛、玩家资料、后台管理、维护模式、邮箱验证、找回密码、Authenticator 双重验证和回收站。

## 更新已有 D1 数据库

如果你已经部署过旧版本，在 Cloudflare D1 控制台执行下面 SQL。提示 `duplicate column name` 或 `already exists` 说明该字段已经存在，可以忽略对应语句。

```sql
ALTER TABLE users ADD COLUMN email TEXT;
ALTER TABLE users ADD COLUMN email_provider TEXT;
ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN totp_secret TEXT;
ALTER TABLE users ADD COLUMN totp_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN last_seen_at TEXT;
ALTER TABLE announcements ADD COLUMN deleted_at TEXT;
ALTER TABLE posts ADD COLUMN deleted_at TEXT;
ALTER TABLE posts ADD COLUMN deleted_by INTEGER;

CREATE TABLE IF NOT EXISTS site_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS email_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('verify_email', 'reset_password')),
  code_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

## QQ 邮箱验证码配置

Cloudflare Pages Functions 不能像普通服务器一样直接稳定使用 QQ SMTP 长连接。当前项目预留的是 HTTP 邮件服务接口：推荐用 SMTP2GO、Resend、MailChannels Worker 或你自己的邮件网关，再由网关使用 QQ 邮箱 SMTP 发信。

QQ 邮箱侧：

1. 登录 QQ 邮箱网页版。
2. 进入 `设置` -> `账号`。
3. 开启 `POP3/SMTP服务`。
4. 按提示发送短信验证。
5. 复制生成的 `授权码`，它不是 QQ 密码。

Cloudflare Pages 侧，在项目 `Settings` -> `Environment variables` 添加：

```text
SMTP_USER=你的QQ邮箱@qq.com
SMTP_PASS=QQ邮箱SMTP授权码
SMTP_FROM=你的QQ邮箱@qq.com
EMAIL_API_URL=你的邮件网关HTTP地址
EMAIL_API_KEY=邮件网关API Key
```

如果暂时不配置邮件服务，网站会把验证码邮件内容写入 Cloudflare Workers Logs，适合本地测试，但不适合正式运营。

## 现在的功能

- 注册时必须填写邮箱并输入验证码。
- 邮箱只支持 Outlook、Google、QQ、网易邮箱。
- 旧账号没有邮箱时，登录后会被要求先绑定邮箱。
- 支持邮箱验证码找回密码。
- 支持 Authenticator 双重验证。
- 玩家资料显示账号类型：管理员或成员。
- 最近在线用户名称左上角显示绿色圆点。
- 玩家可以编辑或删除自己的帖子。
- 删除的帖子进入回收站，7 天后自动清理。
- 管理员删除公告或帖子后，后台左下角会出现垃圾桶按钮。
- 管理员可在垃圾桶恢复或彻底删除内容。

## 部署更新

1. 执行上面的 D1 SQL。
2. 配置邮件环境变量。
3. 推送代码到 GitHub 或重新部署 Cloudflare Pages。
4. 部署后先用测试账号验证注册、邮箱验证码、找回密码和 2FA。
