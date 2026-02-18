const shownErrorKeys = new Set();

function toErrorDetail(error) {
  if (!error) return '';
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message || String(error);
  if (typeof error === 'object' && 'message' in error) {
    return String(error.message || '');
  }
  return String(error);
}

export function reportUserError(message, error = null, options = {}) {
  const { onceKey = null } = options;
  const detail = toErrorDetail(error);
  const fullMessage = detail ? `${message}\n${detail}` : message;

  if (onceKey) {
    if (shownErrorKeys.has(onceKey)) {
      if (error) {
        console.error(message, error);
      } else {
        console.error(message);
      }
      return;
    }
    shownErrorKeys.add(onceKey);
  }

  if (error) {
    console.error(message, error);
  } else {
    console.error(message);
  }

  if (typeof window !== 'undefined' && typeof window.alert === 'function') {
    window.alert(fullMessage);
  }
}

