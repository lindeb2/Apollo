import { useEffect, useState } from 'react';
import { updateMyProfile } from '../lib/serverApi';

function getCurrentArtistDisplayName(session) {
  return String(
    session?.user?.artistDisplayName
    || session?.user?.oidcDisplayName
    || session?.user?.username
    || ''
  );
}

export default function ProfileDialog({
  open = false,
  session = null,
  onClose = null,
  onSaved = null,
}) {
  const [artistDisplayName, setArtistDisplayName] = useState('');
  const [artistDescription, setArtistDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setArtistDisplayName(getCurrentArtistDisplayName(session));
    setArtistDescription(session?.user?.artistDescription || '');
    setError('');
  }, [
    open,
    session?.user?.artistDisplayName,
    session?.user?.artistDescription,
    session?.user?.oidcDisplayName,
    session?.user?.username,
  ]);

  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && !saving) {
        onClose?.();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, saving, onClose]);

  if (!open) return null;

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const nextSession = await updateMyProfile({ artistDisplayName, artistDescription }, session);
      onSaved?.(nextSession);
      onClose?.();
    } catch (saveError) {
      setError(saveError.message || 'Failed to save profile');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label="Close profile"
        onClick={() => {
          if (!saving) onClose?.();
        }}
      />
      <form
        onSubmit={handleSubmit}
        className="relative w-full max-w-md rounded-2xl border border-gray-700 bg-gray-900 p-5 text-white shadow-2xl"
      >
        <div className="mb-4">
          <h2 className="text-lg font-semibold">My Profile</h2>
        </div>

        <label className="block text-sm font-medium text-gray-200" htmlFor="artist-display-name">
          Artist Display Name
        </label>
        <input
          id="artist-display-name"
          type="text"
          value={artistDisplayName}
          maxLength={120}
          onChange={(event) => setArtistDisplayName(event.target.value)}
          className="mt-2 w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-white outline-none transition-colors placeholder:text-gray-500 focus:border-blue-500"
          placeholder="Optional artist name"
          autoFocus
        />
        <div className="mt-1 text-right text-xs text-gray-500">
          {artistDisplayName.length}/120
        </div>

        <label className="mt-4 block text-sm font-medium text-gray-200" htmlFor="artist-description">
          Artist Description
        </label>
        <textarea
          id="artist-description"
          value={artistDescription}
          maxLength={2000}
          rows={4}
          onChange={(event) => setArtistDescription(event.target.value)}
          className="mt-2 w-full resize-none rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-white outline-none transition-colors placeholder:text-gray-500 focus:border-blue-500"
          placeholder="Optional artist bio"
        />
        <div className="mt-1 text-right text-xs text-gray-500">
          {artistDescription.length}/2000
        </div>

        {error ? (
          <div className="mt-4 rounded-lg border border-red-700/50 bg-red-950/40 px-3 py-2 text-sm text-red-200">
            {error}
          </div>
        ) : null}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-200 transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-gray-700"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  );
}
