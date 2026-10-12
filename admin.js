const loginView = document.querySelector('#login-view');
const dashboardView = document.querySelector('#dashboard-view');
const tableBody = document.querySelector('#admin-booking-rows');
const tableState = document.querySelector('#table-state');
const searchInput = document.querySelector('#admin-search');
const dateFilter = document.querySelector('#date-filter');
let bookings = [];

function localDateString() {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
}

function escapeCsv(value) {
  let text = String(value ?? '');
  if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function setTableMessage(message, state = 'empty') {
  tableState.hidden = false;
  tableState.classList.toggle('is-error', state === 'error');
  const loadingMark = tableState.querySelector('.loading-mark');
  if (loadingMark) {
    loadingMark.style.display = state === 'loading' ? 'block' : 'none';
  }
  tableState.querySelector('p').textContent = message;
}

function formattedDate(value) {
  if (!value) return '';
  const str = String(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return String(value);
  const [year, month, day] = str.split('-').map(Number);
  return new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(year, month - 1, day));
}

function formatTime(value) {
  if (!value) return '—';
  const match = String(value).match(/^(\d{1,2}):(\d{2})$/);
  if (match) {
    let hours = Number(match[1]);
    const minutes = match[2];
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;
    return `${hours}:${minutes} ${ampm}`;
  }
  return String(value);
}

let toastTimer;
function showToast(message, isError = false) {
  const toast = document.querySelector('#toast');
  const msgEl = document.querySelector('#toast-message');
  if (!toast || !msgEl) return;
  msgEl.textContent = message;
  toast.classList.toggle('is-error', isError);
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 4000);
}

function formatDateTime(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(d);
  } catch {
    return String(iso);
  }
}

function addCell(row, className, value) {
  const cell = document.createElement('td');
  cell.className = className;
  cell.textContent = value;
  row.append(cell);
}

function renderRows() {
  const today = localDateString();
  const query = searchInput.value.trim().toLocaleLowerCase();
  const visible = bookings.filter((booking) => {
    const playDate = String(booking.playDate || '').slice(0, 10);
    if (dateFilter.value === 'upcoming' && playDate < today) return false;
    if (dateFilter.value === 'past' && playDate >= today) return false;
    return `${booking.playerName || ''} ${booking.mobileNumber || ''} ${booking.court || ''} ${booking.playTime || ''} ${playDate}`.toLocaleLowerCase().includes(query);
  });

  tableBody.replaceChildren(...visible.map((booking) => {
    const row = document.createElement('tr');
    addCell(row, 'player-name', booking.playerName);
    addCell(row, '', booking.mobileNumber);
    addCell(row, '', formattedDate(booking.playDate));
    addCell(row, 'time-value', formatTime(booking.playTime));

    const courtCell = document.createElement('td');
    const courtBadge = document.createElement('span');
    courtBadge.className = 'court-badge';
    courtBadge.textContent = booking.court;
    courtCell.append(courtBadge);
    row.append(courtCell);

    addCell(row, '', String(booking.players));
    addCell(row, 'fee-value', `₹${new Intl.NumberFormat('en-IN').format(booking.feeINR)}`);
    addCell(row, 'submitted-cell', formatDateTime(booking.submittedAt));

    const actionCell = document.createElement('td');
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete-action-btn';
    deleteBtn.type = 'button';
    deleteBtn.innerHTML = '🗑 Delete';
    deleteBtn.title = `Delete booking for ${booking.playerName}`;
    deleteBtn.addEventListener('click', async () => {
      const confirmMsg = `Are you sure you want to delete the booking for ${booking.playerName} on ${formattedDate(booking.playDate)}?`;
      if (!window.confirm(confirmMsg)) return;

      deleteBtn.disabled = true;
      deleteBtn.textContent = 'Deleting…';
      try {
        const response = await fetch('/api/admin/bookings/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: booking.id }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || 'Failed to delete booking.');
        showToast(`Booking for ${booking.playerName} deleted.`);
        await loadBookings();
      } catch (err) {
        showToast(err.message || 'Could not delete booking.', true);
        deleteBtn.disabled = false;
        deleteBtn.innerHTML = '🗑 Delete';
      }
    });
    actionCell.append(deleteBtn);
    row.append(actionCell);

    return row;
  }));

  document.querySelector('#visible-count').textContent = `${visible.length} ${visible.length === 1 ? 'record' : 'records'}`;
  tableState.hidden = visible.length > 0;
  if (visible.length === 0) {
    setTableMessage(bookings.length ? 'No bookings match these filters.' : 'No bookings have been submitted yet.', 'empty');
  }
}

function renderSummary() {
  const today = localDateString();
  document.querySelector('#total-bookings').textContent = String(bookings.length);
  document.querySelector('#upcoming-bookings').textContent = String(bookings.filter((booking) => String(booking.playDate || '').slice(0, 10) >= today).length);
  document.querySelector('#total-players').textContent = String(bookings.reduce((sum, booking) => sum + booking.players, 0));
  const fees = bookings.reduce((sum, booking) => sum + booking.feeINR, 0);
  document.querySelector('#total-fees').textContent = `₹${new Intl.NumberFormat('en-IN').format(fees)}`;
}

async function loadBookings() {
  setTableMessage('Loading bookings…', 'loading');
  try {
    const response = await fetch('/api/admin/bookings', { headers: { accept: 'application/json' }, cache: 'no-store' });
    if (response.status === 401) {
      window.location.assign('/admin?error=login');
      return;
    }
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not load bookings.');
    bookings = Array.isArray(result.rows) ? result.rows : [];
    renderSummary();
    renderRows();
  } catch (error) {
    setTableMessage(error.message || 'Could not load bookings from storage.', 'error');
  }
}

function downloadCsv() {
  const columns = ['Player name', 'Mobile number', 'Date of play', 'Time of play', 'Court', 'Players', 'Fee INR', 'Submitted at'];
  const rows = bookings.map((booking) => [booking.playerName, booking.mobileNumber, booking.playDate, formatTime(booking.playTime), booking.court, booking.players, booking.feeINR, booking.submittedAt]);
  const csv = [columns, ...rows].map((row) => row.map(escapeCsv).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `rainbow-sports-bookings-${localDateString()}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

async function downloadWorkbook() {
  const response = await fetch('/api/admin/workbook', { cache: 'no-store' });
  if (!response.ok) throw new Error('Could not download the booking export.');
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = 'rainbow-sports-bookings.xlsx';
  link.click();
  URL.revokeObjectURL(url);
}

async function initializeAdmin() {
  const params = new URLSearchParams(window.location.search);
  const messages = {
    setup: 'Admin login is not configured. Ask the academy administrator to set the server password.',
    login: 'Please enter the correct admin username and password.',
  };
  try {
    const response = await fetch('/api/admin/session', { cache: 'no-store' });
    const session = await response.json();
    if (session.authenticated) {
      loginView.hidden = true;
      dashboardView.hidden = false;
      document.querySelector('#signed-in-username').textContent = `Signed in as ${session.username}`;

      const notice = document.querySelector('#storage-notice');
      if (notice) {
        notice.hidden = false;
        if (session.persistent) {
          notice.className = 'storage-notice is-safe';
          notice.innerHTML = '<span>🔒 <strong>Data Safe & Permanent</strong>: Stored in PostgreSQL database. Bookings are preserved across all redeploys.</span>';
        } else {
          notice.className = 'storage-notice is-warning';
          notice.innerHTML = '<span>⚠️ <strong>Storage Warning</strong>: Running on temporary Render disk. Add <code>DATABASE_URL</code> to Render Environment Variables so bookings are never erased on redeploy.</span>';
        }
      }

      await loadBookings();
      return;
    }

    dashboardView.hidden = true;
    loginView.hidden = false;
    const message = messages[params.get('error')];
    if (message) {
      const notice = document.querySelector('#login-message');
      notice.textContent = message;
      notice.hidden = false;
    }
    if (!session.loginConfigured) {
      document.querySelector('#login-button').disabled = true;
      const notice = document.querySelector('#login-message');
      notice.textContent = messages.setup;
      notice.hidden = false;
    }
  } catch {
    loginView.hidden = false;
    const notice = document.querySelector('#login-message');
    notice.textContent = 'The admin service is unavailable. Please try again later.';
    notice.hidden = false;
  }
}

searchInput.addEventListener('input', renderRows);
document.querySelector('#admin-login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = document.querySelector('#login-button');
  const notice = document.querySelector('#login-message');
  button.disabled = true;
  notice.hidden = true;
  try {
    const response = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        username: document.querySelector('#admin-username').value,
        password: document.querySelector('#admin-password').value,
      }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Sign-in failed.');
    window.location.assign('/admin');
  } catch (error) {
    notice.textContent = error.message || 'Sign-in failed. Try again.';
    notice.hidden = false;
    document.querySelector('#admin-password').value = '';
    document.querySelector('#admin-password').focus();
  } finally {
    button.disabled = false;
  }
});
dateFilter.addEventListener('change', renderRows);
document.querySelector('#refresh-button').addEventListener('click', loadBookings);
document.querySelector('#export-button').addEventListener('click', downloadCsv);
document.querySelector('#workbook-button').addEventListener('click', () => downloadWorkbook().catch((error) => setTableMessage(error.message, true)));
document.querySelector('#logout-button').addEventListener('click', async () => {
  await fetch('/api/admin/logout', { method: 'POST' });
  window.location.assign('/admin');
});

// Automatically poll for new bookings every 15 seconds when active
setInterval(() => {
  if (dashboardView && !dashboardView.hidden) {
    loadBookings();
  }
}, 15_000);

// Refresh when admin switches back to the tab or wakes phone screen
window.addEventListener('focus', () => {
  if (dashboardView && !dashboardView.hidden) {
    loadBookings();
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && dashboardView && !dashboardView.hidden) {
    loadBookings();
  }
});

initializeAdmin();
