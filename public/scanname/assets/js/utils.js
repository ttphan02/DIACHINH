// Common Utilities & UI Helpers

function showSpinner(msg = 'Đang xử lý PDF...') {
  const spinnerOverlay = document.getElementById('spinnerOverlay');
  const spinnerText = document.getElementById('spinnerText');
  if (spinnerText) spinnerText.textContent = msg;
  if (spinnerOverlay) spinnerOverlay.classList.add('active');
}

function hideSpinner() {
  const spinnerOverlay = document.getElementById('spinnerOverlay');
  if (spinnerOverlay) spinnerOverlay.classList.remove('active');
}

let toastTimer = null;
function showToast(msg, isSuccess = true) {
  const toastMessage = document.getElementById('toastMessage');
  const toastText = document.getElementById('toastText');
  const toastIcon = document.getElementById('toastIcon');
  if (!toastMessage || !toastText) return;

  toastText.textContent = msg;
  if (toastIcon) {
    toastIcon.className = isSuccess ? 'fa-solid fa-circle-check' : 'fa-solid fa-triangle-exclamation';
    toastIcon.style.color = isSuccess ? 'var(--accent-success)' : '#ef4444';
  }

  toastMessage.classList.add('active');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastMessage.classList.remove('active');
  }, 3200);
}

function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

function cleanFilenameKey(name) {
  if (!name) return '';
  return name.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]/g, '');
}
