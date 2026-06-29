# Liou_Yang Server

一个 Minecraft 风格的宣传站，包含主页宣传、公告、玩家论坛、玩家资料、后台管理、维护模式、邮箱验证、找回密码、Authenticator 双重验证和回收站。

## 更新已有 D1 数据库

如果你已经部署过旧版本，在 Cloudflare D1 控制台执行下面 SQL。提示 `duplicate column name` 或 `already exists` 表示字段已经存在，可以忽略对应语句。

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

## QQ 邮箱配置

当前站点强制只使用 QQ 邮箱，不接第三方邮件网关。Cloudflare Pages 中文界面这样配：

1. 打开 Cloudflare 控制台。
2. 进入 `计算（Workers）`。
3. 点击 `Workers 和 Pages`。
4. 选择你的 Pages 项目。
5. 进入 `设置`。
6. 找到 `环境变量`。
7. 添加下面 3 个变量。

```text
SMTP_USER=你的QQ邮箱@qq.com
SMTP_PASS=QQ邮箱授权码
SMTP_FROM=你的QQ邮箱@qq.com
```

如果你想指定连接参数，也可以继续加：

```text
SMTP_HOST=smtp.qq.com
SMTP_PORT=465
```

QQ 邮箱授权码获取方法：

1. 登录 QQ 邮箱网页版。
2. 进入 `设置` -> `账户`。
3. 开启 `POP3/SMTP 服务` 或 `IMAP/SMTP 服务`。
4. 按页面提示获取授权码。
5. 把授权码填到 `SMTP_PASS`。

## 现在的功能

- 注册时必须填写 QQ 邮箱并输入验证码。
- 旧账号没有邮箱时，登录后会被要求先绑定邮箱。
- 支持邮箱验证码找回密码。
- 支持 Authenticator 双重验证。
- 玩家资料显示账号类型：管理员或成员。
- 最近在线用户在昵称左上角显示绿色圆点。
- 玩家可以编辑或删除自己的帖子。
- 删除的内容进入回收站，7 天后自动清理。
- 管理员删除公告或帖子后可在垃圾桶中恢复或彻底删除。

## 部署更新

1. 执行上面的 D1 SQL。
2. 在 Cloudflare Pages 设置 QQ 邮箱环境变量。
3. 推送代码到 GitHub 或重新部署 Pages。
4. 部署后先用测试账号验证注册、邮箱验证码、找回密码和 2FA。
