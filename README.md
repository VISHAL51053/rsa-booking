# Rainbow Sports Academy bookings

The app uses one deployment with two routes:

- `/` is the public player booking form. Players do not log in.
- `/admin` is the private dashboard. It uses the configured username/password and is the only route that can read or download the workbook.

When `DATABASE_URL` is configured, the Node server stores bookings in PostgreSQL. Without it, bookings are stored in an Excel workbook at `BOOKINGS_WORKBOOK_PATH` (default `data/bookings.xlsx`). The workbook is not in the public static-file list. Admins can inspect bookings in the dashboard or download an `.xlsx` export after signing in.

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

### PostgreSQL storage (optional)

The VPS can store bookings in the local Excel workbook, or use PostgreSQL by setting `DATABASE_URL`. For PostgreSQL, create a database with a trusted provider (for example, AIC Cloud Managed Database or Supabase) and use its private connection string. The app creates its bookings table automatically on its first database request. Keep the connection string private, encode reserved characters in the password as required by the URL, and arrange regular database backups.

When `DATABASE_URL` is present, PostgreSQL is the source of truth and the local workbook is not used. Without it, bookings are written to `BOOKINGS_WORKBOOK_PATH` (default `data/bookings.xlsx`); back up this file regularly.

## Deploy to an AIC Cloud VPS

The app serves its frontend, admin pages, and API from one Node.js service. Use `rsabookings.gurubaranbuilders.co.in` for all of them; the frontend calls same-origin `/api/...` endpoints, so separate frontend/backend subdomains are not needed.

### 1. Point a subdomain to the VPS

In Domain India DNS management, create an **A** record for the chosen subdomain:

- Host/name: `rsabookings`
- Points to: your AIC Cloud VPS public IPv4 address (the screenshot shows `148.113.9.217`)
- TTL: leave the default

Do not change existing records such as `accounts.gurubaranbuilders.co.in` or email/MX records. In AIC Cloud's VPS **Add Domain** panel, add `rsabookings.gurubaranbuilders.co.in` if the panel requires domain registration; route it to port 80, where Nginx will listen. Do not expose the app's Node port publicly.

### 2. Install Node.js and Nginx

SSH into the Ubuntu 24.04 VPS using the SSH address and port shown in AIC Cloud. For this VPS, the screenshot shows port `20062`; substitute your actual SSH username if it differs:

```sh
ssh -p 20062 <username>@148.113.9.217
```

Install the required packages and confirm Node.js meets the repository requirement (`>=18.17`):

```sh
sudo apt update
sudo apt install -y git nodejs npm nginx
node --version
npm --version
```

If `node --version` is older than `v18.17`, install a current Node.js LTS release before continuing.

### 3. Install and configure the app

Clone your Git repository to the VPS (replace the URL with your repository URL):

```sh
sudo git clone <your-repository-url> /opt/rsa-booking
cd /opt/rsa-booking
sudo npm ci
sudo useradd --system --user-group --home-dir /opt/rsa-booking --shell /usr/sbin/nologin rsa-booking
sudo mkdir -p /var/lib/rsa-booking
sudo chown -R rsa-booking:rsa-booking /opt/rsa-booking /var/lib/rsa-booking
```

Create `/etc/rsa-booking.env` with private settings:

```ini
PORT=3000
ADMIN_USERNAME=admin
ADMIN_PASSWORD=replace-with-a-unique-long-password
BOOKINGS_WORKBOOK_PATH=/var/lib/rsa-booking/bookings.xlsx
# Optional: set this to a private PostgreSQL connection string for database storage
# DATABASE_URL=postgresql://...
```

For example, open the file with `sudo nano /etc/rsa-booking.env`, paste the settings, replace the example password, then save and exit.

Protect this file and ensure the service user can read it:

```sh
sudo chown root:rsa-booking /etc/rsa-booking.env
sudo chmod 640 /etc/rsa-booking.env
```

Create `/etc/systemd/system/rsa-booking.service` by running `sudo nano /etc/systemd/system/rsa-booking.service`, then add:

```ini
[Unit]
Description=Rainbow Sports Academy booking app
After=network.target

[Service]
Type=simple
User=rsa-booking
Group=rsa-booking
WorkingDirectory=/opt/rsa-booking
EnvironmentFile=/etc/rsa-booking.env
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Enable the service and verify it locally:

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now rsa-booking
sudo systemctl status rsa-booking
curl http://127.0.0.1:3000/health
```

### 4. Configure Nginx and HTTPS

Create `/etc/nginx/sites-available/rsa-booking`:

```nginx
server {
    listen 80;
    server_name rsabookings.gurubaranbuilders.co.in;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Enable the Nginx site:

```sh
sudo ln -s /etc/nginx/sites-available/rsa-booking /etc/nginx/sites-enabled/rsa-booking
sudo nginx -t
sudo systemctl reload nginx
```

In AIC Cloud, verify `rsabookings.gurubaranbuilders.co.in` in the VPS custom-domain section. AIC Cloud handles public HTTPS and forwards requests to Nginx on port 80 inside the VPS, so no firewall rule or Certbot certificate is needed for ports 80/443. Keep the Node.js port 3000 private; the app already listens on localhost.

Once AIC shows the domain as **Live — HTTPS**, open `https://rsabookings.gurubaranbuilders.co.in/` for players and `https://rsabookings.gurubaranbuilders.co.in/admin` for admins. Use the HTTPS homepage URL for the booking QR code. Check service logs with `sudo journalctl -u rsa-booking -f`. Back up `/var/lib/rsa-booking/bookings.xlsx` regularly if using Excel storage; use PostgreSQL and database backups if you prefer database storage.

The included anonymous booking form has server validation, a hidden bot trap, and basic rate limiting. Add hosting-level WAF or CAPTCHA controls if abuse becomes an issue. Run a single app instance unless you use a shared session store and coordinated storage.

## Session pricing

- Court session: ₹100 per player for one 1.5-hour session; total fee is ₹100 multiplied by the player count.

## Automated WhatsApp Booking Notifications

Upon successful reservation, an automated WhatsApp booking confirmation is generated containing:
- **Date of Play**: e.g. `Sun, 18 Oct 2026`
- **Time of Play**: e.g. `07:00 PM`
- **Court**: `Court 1` or `Court 2`
- **Players**: Number of players
- **Total Amount**: Recorded fee (e.g. `₹200` for 2 players)
- **Venue**: `Rainbow Sports Academy`

### Delivery & Controls
1. **Client-side instant trigger**: Automatically opens WhatsApp with the formatted confirmation addressed to the player's mobile number (`wa.me/<phone>`), accompanied by an interactive confirmation modal with direct WhatsApp action buttons.
2. **Admin Dashboard one-click WhatsApp**: In the admin portal (`/admin`), every reservation row includes a dedicated green `WhatsApp` button to instantly send or re-send the confirmation to the player.
3. **Optional Background Delivery**: Configure `WHATSAPP_WEBHOOK_URL` or Twilio credentials (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_NUMBER`) in `.env` for direct automated background dispatch. Set `ACADEMY_WHATSAPP_PHONE` to direct academy inquiries.