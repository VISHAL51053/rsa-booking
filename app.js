const form = document.querySelector('#booking-form');
const nameInput = document.querySelector('#player-name');
const mobileInput = document.querySelector('#mobile-number');
const dateInput = document.querySelector('#play-date');
const timeInput = document.querySelector('#play-time');
const playersInput = document.querySelector('#player-count');
const errors = {
  name: document.querySelector('#name-error'),
  mobile: document.querySelector('#mobile-error'),
  date: document.querySelector('#date-error'),
  time: document.querySelector('#time-error'),
  players: document.querySelector('#players-error'),
};
let toastTimer;

const bookingModal = document.querySelector('#booking-modal');
const modalCloseBtn = document.querySelector('#modal-close-btn');
const modalDoneBtn = document.querySelector('#modal-done-btn');
const modalSummaryName = document.querySelector('#modal-summary-name');
const modalSummaryDate = document.querySelector('#modal-summary-date');
const modalSummaryTime = document.querySelector('#modal-summary-time');
const modalSummaryCourt = document.querySelector('#modal-summary-court');
const modalSummaryPlayers = document.querySelector('#modal-summary-players');
const modalSummaryFee = document.querySelector('#modal-summary-fee');
const modalWaBtn = document.querySelector('#modal-whatsapp-btn');
const modalAcademyWaBtn = document.querySelector('#modal-academy-wa-btn');

function formatDisplayDate(dateStr) {
  try {
    const [y, m, d] = String(dateStr).slice(0, 10).split('-').map(Number);
    if (y && m && d) {
      return new Intl.DateTimeFormat('en-IN', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      }).format(new Date(y, m - 1, d));
    }
  } catch {}
  return dateStr;
}

function formatDisplayTime(timeStr) {
  if (!timeStr) return '';
  const match = String(timeStr).match(/^(\d{1,2}):(\d{2})$/);
  if (match) {
    let hours = Number(match[1]);
    const minutes = match[2];
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;
    return `${hours}:${minutes} ${ampm}`;
  }
  return timeStr;
}

function closeModal() {
  if (!bookingModal) return;
  bookingModal.classList.remove('is-visible');
  setTimeout(() => {
    bookingModal.hidden = true;
  }, 250);
}

function showBookingSuccess(bookingData, whatsappData) {
  if (!bookingModal) return;
  if (modalSummaryName) modalSummaryName.textContent = bookingData.playerName;
  if (modalSummaryDate) modalSummaryDate.textContent = formatDisplayDate(bookingData.playDate);
  if (modalSummaryTime) modalSummaryTime.textContent = formatDisplayTime(bookingData.playTime);
  if (modalSummaryCourt) modalSummaryCourt.textContent = bookingData.court;
  if (modalSummaryPlayers) modalSummaryPlayers.textContent = `${bookingData.players} Player${bookingData.players > 1 ? 's' : ''}`;
  if (modalSummaryFee) modalSummaryFee.textContent = `₹${new Intl.NumberFormat('en-IN').format(bookingData.feeINR)}`;

  const academyTarget = whatsappData?.academyLink || whatsappData?.link || 'https://wa.me/919842751053';
  if (modalWaBtn) {
    modalWaBtn.href = academyTarget;
  }
  if (modalAcademyWaBtn) {
    modalAcademyWaBtn.href = academyTarget;
    modalAcademyWaBtn.style.display = 'inline-flex';
  }

  bookingModal.hidden = false;
  requestAnimationFrame(() => {
    bookingModal.classList.add('is-visible');
  });

  // Automatically trigger opening Academy WhatsApp (9842751053) with pre-filled message
  if (academyTarget) {
    try {
      const waTab = window.open(academyTarget, '_blank', 'noopener,noreferrer');
      if (waTab) waTab.focus();
    } catch (popupErr) {
      console.warn('Popup blocked by browser; user can click WhatsApp button in modal.', popupErr);
    }
  }
}

if (modalCloseBtn) modalCloseBtn.addEventListener('click', closeModal);
if (modalDoneBtn) modalDoneBtn.addEventListener('click', closeModal);
if (bookingModal) {
  bookingModal.addEventListener('click', (event) => {
    if (event.target === bookingModal) closeModal();
  });
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !bookingModal.hidden) closeModal();
  });
}

function todayString(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function showToast(message, isError = false) {
  const toast = document.querySelector('#toast');
  document.querySelector('#toast-message').textContent = message;
  toast.classList.toggle('is-error', isError);
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 4000);
}

function setError(input, element, message) {
  element.textContent = message;
  input.setAttribute('aria-invalid', String(Boolean(message)));
  if (message) input.setAttribute('aria-describedby', element.id);
  else input.removeAttribute('aria-describedby');
}

function validate() {
  const name = nameInput.value.trim();
  const mobile = mobileInput.value.trim();
  const digitCount = mobile.replace(/\D/g, '').length;
  const playerCount = Number(playersInput.value);
  let valid = true;

  for (const key of Object.keys(errors)) {
    const input = key === 'name' ? nameInput : key === 'mobile' ? mobileInput : key === 'date' ? dateInput : key === 'time' ? timeInput : playersInput;
    setError(input, errors[key], '');
  }
  if (!name) { setError(nameInput, errors.name, 'Enter the player name.'); valid = false; }
  if (!mobile) { setError(mobileInput, errors.mobile, 'Enter a mobile number.'); valid = false; }
  else if (digitCount < 10 || digitCount > 15) { setError(mobileInput, errors.mobile, 'Use a valid 10-digit mobile number.'); valid = false; }
  if (!dateInput.value) { setError(dateInput, errors.date, 'Choose a date of play.'); valid = false; }
  else if (dateInput.value < todayString()) { setError(dateInput, errors.date, 'Choose today or a future date.'); valid = false; }
  if (!timeInput.value) { setError(timeInput, errors.time, 'Choose a time of play.'); valid = false; }
  else if (dateInput.value === todayString()) {
    const now = new Date();
    const curTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    if (timeInput.value < curTime) {
      setError(timeInput, errors.time, 'This time has already passed today. Select an upcoming time.');
      valid = false;
    }
  }
  if (!Number.isInteger(playerCount) || playerCount < 1 || playerCount > 20) { setError(playersInput, errors.players, 'Choose between 1 and 20 players.'); valid = false; }
  return valid;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!validate()) {
    form.querySelector('[aria-invalid="true"]')?.focus();
    return;
  }

  const button = form.querySelector('.submit-button');
  const courtSelected = form.querySelector('input[name="court"]:checked')?.value || 'Court 1';
  const booking = {
    playerName: nameInput.value.trim(),
    mobileNumber: mobileInput.value.trim(),
    playDate: dateInput.value,
    playTime: timeInput.value,
    court: courtSelected,
    membership: 'One-day',
    players: Number(playersInput.value),
    website: document.querySelector('#website')?.value || '',
  };

  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  button.querySelector('span').textContent = '…';
  try {
    const response = await fetch('/api/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(booking),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Booking could not be submitted. Please try again.');

    const bookingResult = result.booking || {
      playerName: booking.playerName,
      mobileNumber: booking.mobileNumber,
      playDate: booking.playDate,
      playTime: booking.playTime,
      court: booking.court,
      players: booking.players,
      feeINR: booking.players * 100,
    };
    const waData = result.whatsapp || {
      link: `https://wa.me/919842751053?text=${encodeURIComponent('Booking Confirmed')}`,
      academyLink: `https://wa.me/919842751053?text=${encodeURIComponent('Booking Confirmed')}`,
    };

    const bookingName = booking.playerName;
    form.reset();
    dateInput.value = todayString();
    timeInput.value = '';
    playersInput.value = '2';
    showToast(`Booking received for ${bookingName}.`);

    showBookingSuccess(bookingResult, waData);
  } catch (error) {
    showToast(error.message || 'Unable to send booking. Please try again.', true);
  } finally {
    button.disabled = false;
    button.removeAttribute('aria-busy');
    button.querySelector('span').textContent = '↗';
  }
});

document.querySelector('#decrease-players').addEventListener('click', () => {
  playersInput.value = String(Math.max(1, (Number(playersInput.value) || 1) - 1));
  setError(playersInput, errors.players, '');
});
document.querySelector('#increase-players').addEventListener('click', () => {
  playersInput.value = String(Math.min(20, (Number(playersInput.value) || 1) + 1));
  setError(playersInput, errors.players, '');
});
nameInput.addEventListener('input', () => setError(nameInput, errors.name, ''));
mobileInput.addEventListener('input', () => setError(mobileInput, errors.mobile, ''));
dateInput.addEventListener('input', () => {
  setError(dateInput, errors.date, '');
  if (timeInput.value) setError(timeInput, errors.time, '');
});
timeInput.addEventListener('input', () => setError(timeInput, errors.time, ''));
playersInput.addEventListener('input', () => setError(playersInput, errors.players, ''));
playersInput.addEventListener('change', () => {
  const value = Number(playersInput.value);
  if (Number.isFinite(value)) playersInput.value = String(Math.min(20, Math.max(1, value)));
});

dateInput.min = todayString();
dateInput.value = todayString();
document.querySelector('#today-label').textContent = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).format(new Date());
