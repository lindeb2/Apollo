import { useMemo, useState } from 'react';

function HostedLogin({
  authConfig = null,
  onLogin,
  onSsoLogin,
  loading = false,
  error = '',
}) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [bootstrapOpen, setBootstrapOpen] = useState(false);

  const showBootstrapLogin = useMemo(() => {
    if (!authConfig) return false;
    return Boolean(authConfig.bootstrapLocalLoginEnabled);
  }, [authConfig]);

  const submit = async (e) => {
    e.preventDefault();
    if (!username.trim() || !password) return;
    await onLogin(username.trim(), password);
  };

  return (
    <div className="h-full flex items-center justify-center bg-gray-900 text-white p-6">
      <div className="w-full max-w-sm rounded-lg border border-gray-700 bg-gray-800 p-6 space-y-4">
        <div className="space-y-2">
          <h1 className="text-xl font-semibold">Apollo Sign In</h1>
          <p className="text-sm text-gray-300">
            Sign in with your organization account. Bootstrap admin login is only for recovery and first activation.
          </p>
        </div>

        <button
          type="button"
          onClick={onSsoLogin}
          disabled={loading}
          className="w-full rounded bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 px-3 py-2 text-sm font-medium"
        >
          {loading ? 'Redirecting...' : 'Sign in with SSO'}
        </button>

        {showBootstrapLogin ? (
          <div className="rounded border border-gray-700 bg-gray-900/40">
            <button
              type="button"
              onClick={() => setBootstrapOpen((value) => !value)}
              className="w-full px-3 py-2 text-left text-sm font-medium hover:bg-gray-800"
            >
              {bootstrapOpen ? 'Hide bootstrap admin login' : 'Use bootstrap admin login'}
            </button>
            {bootstrapOpen ? (
              <form onSubmit={submit} className="border-t border-gray-700 px-3 py-3 space-y-3">
                <div>
                  <label className="block text-sm text-gray-300 mb-1">Username</label>
                  <input
                    className="w-full rounded bg-gray-950 border border-gray-700 px-3 py-2 text-sm focus:outline-none"
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
                    className="w-full rounded bg-gray-950 border border-gray-700 px-3 py-2 text-sm focus:outline-none"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full rounded bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 px-3 py-2 text-sm font-medium"
                >
                  {loading ? 'Signing in...' : 'Sign in as bootstrap admin'}
                </button>
              </form>
            ) : null}
          </div>
        ) : null}

        {error ? <p className="text-sm text-red-300">{error}</p> : null}
      </div>
    </div>
  );
}

export default HostedLogin;
