import { useState } from 'react';

function HostedLogin({ onLogin, loading = false, error = '' }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    if (!username.trim() || !password) return;
    await onLogin(username.trim(), password);
  };

  return (
    <div className="h-full flex items-center justify-center bg-gray-900 text-white p-6">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-lg border border-gray-700 bg-gray-800 p-6 space-y-4"
      >
        <h1 className="text-xl font-semibold">ChoirMaster Server Login</h1>
        <div>
          <label className="block text-sm text-gray-300 mb-1">Username</label>
          <input
            className="w-full rounded bg-gray-900 border border-gray-700 px-3 py-2 text-sm focus:outline-none"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoFocus
          />
        </div>
        <div>
          <label className="block text-sm text-gray-300 mb-1">Password</label>
          <input
            type="password"
            className="w-full rounded bg-gray-900 border border-gray-700 px-3 py-2 text-sm focus:outline-none"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </div>
        {error ? <p className="text-sm text-red-300">{error}</p> : null}
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 px-3 py-2 text-sm font-medium"
        >
          {loading ? 'Signing in...' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}

export default HostedLogin;
