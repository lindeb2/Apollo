const MAX_OFFSET_MS = 500;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export const getOutputLatencyMs = (audioContext) => {
  if (!audioContext) return 0;
  const baseLatency = Number(audioContext.baseLatency) || 0;
  const outputLatency = Number(audioContext.outputLatency) || 0;
  const total = (baseLatency + outputLatency) * 1000;
  return clamp(Math.round(total), 0, MAX_OFFSET_MS);
};

export const getInputLatencyMsFromTrack = (track) => {
  if (!track?.getSettings) return 0;
  const settings = track.getSettings();
  const latency = Number(settings?.latency);
  if (!Number.isFinite(latency)) return 0;
  return clamp(Math.round(latency * 1000), 0, MAX_OFFSET_MS);
};

export const estimateRecordingOffsetMs = ({ outputLatencyMs, inputLatencyMs }) => {
  const output = Number.isFinite(outputLatencyMs) ? outputLatencyMs : 0;
  const input = Number.isFinite(inputLatencyMs) ? inputLatencyMs : 0;
  return clamp(Math.round(output + input), 0, MAX_OFFSET_MS);
};

