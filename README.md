# Rainbow Sports Academy bookings

The app uses one deployment with two routes:

- `/` is the public player booking form. Players do not log in.
- `/admin` is the private dashboard. It uses the configured username/password and is the only route that can read or download the workbook.

When `DATABASE_URL` is configured, the Node server stores bookings in Supabase PostgreSQL. Without it, local development falls back to an Excel workbook at `BOOKINGS_WORKBOOK_PATH` (default `data/bookings.xlsx`). The workbook is not in the public static-file list. Admins can inspect bookings in the dashboard or download an `.xlsx` export after signing in.

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

Open `http://localhost:3000/` for players and `http://localhost:3000/admin` for admins. If `DATABASE_URL` is absent, the first valid booking creates a local Excel workbook with a `Bookings` table containing these columns: `SubmittedAt`, `PlayerName`, `MobileNumber`, `PlayDate`, `Court`, `Membership`, `Players`, `FeeINR`.

## Excel storage and access

Player submissions are validated on the server before they are stored. The admin login uses a server-side scrypt password hash and a short-lived HttpOnly session cookie. Login attempts are rate-limited. The public page has no API to list, search, or download bookings.

The admin dashboard shows booking totals and rows, supports search and date filters, exports CSV, and has a **Download Excel** action. Both booking reads and workbook downloads require an authenticated admin session.

### Use Supabase storage on Render Free

Render's free filesystem is temporary and cannot attach a persistent disk. To keep bookings through redeploys without upgrading Render, use a Supabase PostgreSQL project:

1. Create a project in Supabase. In the project dashboard, click **Connect** and select **Session pooler**. Render runs this app as a persistent Node service; Supabase recommends Session pooler when a persistent backend needs IPv4 connectivity. Copy the URI Supabase provides rather than constructing the host or username yourself. Make sure the password is URL-encoded if it contains reserved URL characters.
2. In Render, open the `rsa-booking` web service, then **Environment → Add Environment Variable**.
3. Set key `DATABASE_URL` and value to the full Supabase Session pooler connection string. Keep it private. Do not use the Supabase `anon` key here.
4. Save changes and wait for Render to redeploy. On the first database request, the app creates the `public.bookings` table automatically, enables Row Level Security, and revokes table access from Supabase's `anon` and `authenticated` API roles. Only the private server database connection can access booking rows.
5. Submit a test booking, then sign in at `/admin` to confirm it appears. The admin **Download Excel** button exports the database rows as an `.xlsx` file.

When `DATABASE_URL` is present, PostgreSQL is the source of truth and the local workbook is not used. Without `DATABASE_URL`, local development falls back to `BOOKINGS_WORKBOOK_PATH`. Supabase free-tier quotas and inactivity/pause policies may apply; review its current plan limits and keep regular backups.

## Deploy

Deploy the Node app behind HTTPS. Keep `.env` or equivalent hosting environment settings private. Use the public homepage URL (`https://your-host/`) for the court QR code and give admins `https://your-host/admin`.

For Render Free, configure `DATABASE_URL` as described above. For a paid Render service with a persistent disk, you can instead set `BOOKINGS_WORKBOOK_PATH` to the mounted disk path. Never rely on the default ephemeral filesystem for live bookings. Run a single server instance unless you use a shared session store and coordinated storage.

The repository includes `render.yaml` for a free Node web service and prompts for private `ADMIN_PASSWORD` and `DATABASE_URL` values during initial Blueprint creation. It does not attach a paid disk; Supabase is the persistent store. If syncing it to an existing service, confirm the service name matches to avoid creating a duplicate. Render only prompts for `sync: false` secrets during the initial Blueprint creation; add or change secrets manually in the existing service's Environment settings.

The included anonymous booking form has server validation, a hidden bot trap, and basic rate limiting. Add hosting-level WAF or CAPTCHA controls if abuse becomes an issue.

## Keep-alive automation (Prevent Render cold start)

Render Free sleeps after 15 minutes of inactivity. To ensure instant page loads without the 30–40 second cold start delay, an automated GitHub Actions workflow [`.github/workflows/keep-alive.yml`](.github/workflows/keep-alive.yml) runs every 10 minutes in the background, continuously pinging the `/health` endpoint to keep the web service awake 24/7.

## Membership pricing

- One-day: ₹100 per player for one 1.5-2 hour session; total fee is ₹100 multiplied by the player count.
- Weekly: ₹500 fixed membership fee.
- Monthly: ₹1,000 fixed membership fee.