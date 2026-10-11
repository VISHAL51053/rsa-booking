const form = document.querySelector('#booking-form');
const nameInput = document.querySelector('#player-name');
const mobileInput = document.querySelector('#mobile-number');
const dateInput = document.querySelector('#play-date');
const playersInput = document.querySelector('#player-count');
const errors = {
  name: document.querySelector('#name-error'),
  mobile: document.querySelector('#mobile-error'),
  date: document.querySelector('#date-error'),
  players: document.querySelector('#players-error'),
};
let toastTimer;

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
    const input = key === 'name' ? nameInput : key === 'mobile' ? mobileInput : key === 'date' ? dateInput : playersInput;
    setError(input, errors[key], '');
  }
  if (!name) { setError(nameInput, errors.name, 'Enter the player name.'); valid = false; }
  if (!mobile) { setError(mobileInput, errors.mobile, 'Enter a mobile number.'); valid = false; }
  else if (digitCount < 7 || digitCount > 15) { setError(mobileInput, errors.mobile, 'Use a valid number with 7 to 15 digits.'); valid = false; }
  if (!dateInput.value) { setError(dateInput, errors.date, 'Choose a date of play.'); valid = false; }
  else if (dateInput.value < todayString()) { setError(dateInput, errors.date, 'Choose today or a future date.'); valid = false; }
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
  const membershipSelected = document.querySelector('input[name="membership"]:checked')?.value || 'One-day';
  const booking = {
    playerName: nameInput.value.trim(),
    mobileNumber: mobileInput.value.trim(),
    playDate: dateInput.value,
    court: courtSelected,
    membership: membershipSelected,
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

    const bookingName = booking.playerName;
    form.reset();
    const defaultMembership = document.querySelector('input[name="membership"][value="One-day"]');
    if (defaultMembership) defaultMembership.checked = true;
    dateInput.value = todayString();
    playersInput.value = '2';
    showToast(`Booking received for ${bookingName}.`);
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
dateInput.addEventListener('input', () => setError(dateInput, errors.date, ''));
playersInput.addEventListener('input', () => setError(playersInput, errors.players, ''));
playersInput.addEventListener('change', () => {
  const value = Number(playersInput.value);
  if (Number.isFinite(value)) playersInput.value = String(Math.min(20, Math.max(1, value)));
});

dateInput.min = todayString();
dateInput.value = todayString();
document.querySelector('#today-label').textContent = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).format(new Date());
