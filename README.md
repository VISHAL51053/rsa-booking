# Rainbow Sports Academy bookings

The app uses one deployment with two routes:

- `/` is the public player booking form. Players do not log in.
- `/admin` is the private dashboard. It uses the configured username/password and is the only route that can read or download the workbook.

The Node server writes bookings directly to an Excel workbook at `BOOKINGS_WORKBOOK_PATH` (default `data/bookings.xlsx`). The workbook is not in the public static-file list. Admins can inspect the rows in the dashboard or download the `.xlsx` file after signing in.

## Local setup

Copy the template, then edit `.env` locally. `.env` is excluded from Git:

```powershell
Copy-Item .env.example .env
```

Set `ADMIN_USERNAME` and `ADMIN_PASSWORD` in `.env`. The default username is `admin`; the password must be at least 12 characters. The requested password is configured in the local `.env`; change it to a unique, randomly generated password before making the admin URL public, because predictable passwords are easier to guess. Never commit or share `.env`.

Install packages and start the server:

```powershell
npm install
npm start
```

Open `http://localhost:3000/` for players and `http://localhost:3000/admin` for admins. On the first valid booking, the server creates an Excel workbook with a `Bookings` table containing these columns: `SubmittedAt`, `PlayerName`, `MobileNumber`, `PlayDate`, `Court`, `Membership`, `Players`, `FeeINR`.

## Excel storage and access

Player submissions are validated on the server before they are appended to the workbook. The admin login uses a server-side scrypt password hash and a short-lived HttpOnly session cookie. Login attempts are rate-limited. The public page has no API to list, search, or download bookings.

The admin dashboard shows booking totals and rows, supports search and date filters, exports CSV, and has a **Download Excel** action. Both booking reads and workbook downloads require an authenticated admin session.

## Deploy

Deploy the Node app behind HTTPS. Keep `.env` or the equivalent hosting environment settings private. Use the public homepage URL (`https://your-host/`) for the court QR code and give admins `https://your-host/admin`.

The workbook is stored on the server filesystem at `BOOKINGS_WORKBOOK_PATH`. For hosting, point this setting to a persistent disk or mounted volume; ephemeral deployment storage can be lost when the app restarts or redeploys. Back up the workbook regularly. Run a single server instance unless a shared session store and coordinated workbook storage are added.

The included anonymous booking form has server validation, a hidden bot trap, and basic rate limiting. Add hosting-level WAF or CAPTCHA controls if abuse becomes an issue.

## Membership pricing

- One-day: ₹100 per player for one 1.5-2 hour session; total fee is ₹100 multiplied by the player count.
- Weekly: ₹500 fixed membership fee.
- Monthly: ₹1,000 fixed membership fee.