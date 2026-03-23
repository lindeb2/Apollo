import { AUTO_PAN_STRATEGIES } from '../utils/choirAutoPan';
import { PAN_LAW_OPTIONS_DB } from '../utils/audio';

export function PlaybackDevicesSettingsPanel({
  audioSettings,
  setAudioSettings,
  audioInputs,
  audioOutputs,
  monoOutputActive = false,
  onRefreshDevices,
  outputChannelCount = 2,
}) {
  const detectedStereoOutput = outputChannelCount > 1;

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-gray-700 bg-gray-900/60 p-4">
        <div className="mb-3 text-sm font-semibold text-gray-100">Input</div>
        <div className="space-y-4">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Input device</label>
            <select
              className="w-full rounded bg-gray-950 border border-gray-700 px-3 py-2 text-sm focus:outline-none"
              value={audioSettings.inputDeviceId}
              onChange={(e) =>
                setAudioSettings((prev) => ({ ...prev, inputDeviceId: e.target.value }))
              }
            >
              <option value="">Default</option>
              {audioInputs.map((device) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label || `Input ${device.deviceId.slice(0, 6)}`}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Recording offset (ms)</label>
            <input
              type="number"
              className="w-full rounded bg-gray-950 border border-gray-700 px-3 py-2 text-sm focus:outline-none"
              value={audioSettings.recordingOffsetMs}
              onChange={(e) =>
                setAudioSettings((prev) => ({
                  ...prev,
                  recordingOffsetMs: Number(e.target.value),
                }))
              }
            />
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-gray-700 bg-gray-900/60 p-4">
        <div className="mb-3 text-sm font-semibold text-gray-100">Output</div>
        <div className="space-y-4">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Output device</label>
            <select
              className="w-full rounded bg-gray-950 border border-gray-700 px-3 py-2 text-sm focus:outline-none"
              value={audioSettings.outputDeviceId}
              onChange={(e) =>
                setAudioSettings((prev) => ({ ...prev, outputDeviceId: e.target.value }))
              }
            >
              <option value="">Default</option>
              {audioOutputs.map((device) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label || `Output ${device.deviceId.slice(0, 6)}`}
                </option>
              ))}
            </select>
          </div>
          {detectedStereoOutput ? (
            <label className="flex items-center gap-2 text-sm text-gray-300 select-none">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-gray-600 bg-gray-900"
                checked={audioSettings.forceMonoOutput === true}
                onChange={(e) =>
                  setAudioSettings((prev) => ({ ...prev, forceMonoOutput: e.target.checked }))
                }
              />
              <span>Force mono</span>
            </label>
          ) : null}
          <div>
            <label className="block text-xs text-gray-400 mb-1">Panning law</label>
            <select
              className={`w-full rounded border px-3 py-2 text-sm focus:outline-none ${
                monoOutputActive
                  ? 'bg-gray-800 border-gray-700 text-gray-500 cursor-not-allowed'
                  : 'bg-gray-950 border-gray-700'
              }`}
              value={String(monoOutputActive ? 0 : audioSettings.stereoPanLawDb)}
              onChange={(e) =>
                setAudioSettings((prev) => ({ ...prev, stereoPanLawDb: Number(e.target.value) }))
              }
              disabled={monoOutputActive}
            >
              {monoOutputActive ? (
                <option value="0">0 dB</option>
              ) : (
                PAN_LAW_OPTIONS_DB.map((value) => (
                  <option key={value} value={value}>
                    {`${value} dB`}
                  </option>
                ))
              )}
            </select>
          </div>
          <button
            type="button"
            className="text-xs text-gray-400 hover:text-gray-200"
            onClick={onRefreshDevices}
          >
            Refresh device list
          </button>
        </div>
      </section>
    </div>
  );
}

export function ProjectSettingsPanel({
  project,
  onSetAutoPanStrategy,
  onToggleAutoPanInverted,
  onSetAutoPanManualChoirParts,
}) {
  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs text-gray-400 mb-1">
          Choir auto-pan
        </label>
        <select
          className="w-full rounded bg-gray-900 border border-gray-700 px-3 py-2 text-sm focus:outline-none"
          value={project?.autoPan?.enabled ? project.autoPan?.strategy : 'off'}
          onChange={(e) => onSetAutoPanStrategy(e.target.value)}
        >
          <option value="off">Off</option>
          {AUTO_PAN_STRATEGIES.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <label className="flex items-center gap-2 text-sm text-gray-300 select-none">
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-gray-600 bg-gray-900"
          checked={Boolean(project?.autoPan?.inverted)}
          onChange={(e) => onToggleAutoPanInverted(e.target.checked)}
        />
        <span>Inverted Auto Pan</span>
      </label>

      <label className="flex items-center gap-2 text-sm text-gray-300 select-none">
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-gray-600 bg-gray-900"
          checked={Boolean(project?.autoPan?.manualChoirParts)}
          onChange={(e) => onSetAutoPanManualChoirParts(e.target.checked)}
        />
        <span>Manually select choir parts</span>
      </label>
    </div>
  );
}
