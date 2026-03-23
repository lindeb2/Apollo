import { useCallback, useEffect, useRef, useState } from 'react';
import { reportUserError } from '../utils/errorReporter';
import {
  DEFAULT_PLAYBACK_DEVICE_SETTINGS,
  detectOutputChannelCount,
  isMonoOutputActive,
  normalizePlaybackDeviceSettings,
  resolvePlaybackPanLawDisplayDb,
} from '../utils/playbackOutput';

export function usePlaybackDeviceSettings(options = {}) {
  const {
    defaults = DEFAULT_PLAYBACK_DEVICE_SETTINGS,
    errorPrefix = 'settings',
    onRecordingOffsetChange = null,
  } = options;

  const [audioInputs, setAudioInputs] = useState([]);
  const [audioOutputs, setAudioOutputs] = useState([]);
  const [audioSettings, setAudioSettings] = useState(normalizePlaybackDeviceSettings(defaults));
  const [outputChannelCount, setOutputChannelCount] = useState(2);
  const hasHydratedSettingsRef = useRef(false);

  useEffect(() => {
    const saved = localStorage.getItem('apollo.settings');
    if (!saved) return;
    try {
      const parsed = JSON.parse(saved);
      setAudioSettings((prev) => normalizePlaybackDeviceSettings({
        ...prev,
        ...parsed,
      }));
    } catch (error) {
      reportUserError(
        'Failed to read app settings from local storage. Defaults will be used.',
        error,
        { onceKey: `${errorPrefix}:settings-parse` }
      );
    }
  }, [errorPrefix]);

  useEffect(() => {
    if (!hasHydratedSettingsRef.current) {
      hasHydratedSettingsRef.current = true;
    } else {
      let existing = {};
      try {
        existing = JSON.parse(localStorage.getItem('apollo.settings') || '{}');
      } catch (error) {
        reportUserError(
          'Failed to parse existing app settings from local storage. They will be replaced.',
          error,
          { onceKey: `${errorPrefix}:settings-merge-parse` }
        );
        existing = {};
      }

      localStorage.setItem('apollo.settings', JSON.stringify({
        ...existing,
        ...normalizePlaybackDeviceSettings(audioSettings),
      }));
    }

    if (typeof onRecordingOffsetChange === 'function') {
      onRecordingOffsetChange(Math.max(0, Number(audioSettings.recordingOffsetMs) || 0));
    }
  }, [audioSettings, errorPrefix, onRecordingOffsetChange]);

  const refreshAudioDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;

    let devices = await navigator.mediaDevices.enumerateDevices();
    const hasLabels = devices.some((device) => device.label);
    if (!hasLabels) {
      try {
        await navigator.mediaDevices.getUserMedia({ audio: true });
        devices = await navigator.mediaDevices.enumerateDevices();
      } catch (error) {
        reportUserError(
          'Could not access microphone permissions to read device labels.',
          error,
          { onceKey: `${errorPrefix}:device-label-permission` }
        );
      }
    }

    setAudioInputs(devices.filter((device) => device.kind === 'audioinput'));
    setAudioOutputs(devices.filter((device) => device.kind === 'audiooutput'));
  }, [errorPrefix]);

  useEffect(() => {
    let ignore = false;

    const updateOutputChannelCount = async () => {
      const nextCount = await detectOutputChannelCount(audioSettings.outputDeviceId);
      if (!ignore) {
        setOutputChannelCount(nextCount);
      }
    };

    updateOutputChannelCount();
    return () => {
      ignore = true;
    };
  }, [audioSettings.outputDeviceId]);

  const normalizedAudioSettings = normalizePlaybackDeviceSettings(audioSettings);
  const monoOutputActive = isMonoOutputActive(normalizedAudioSettings.forceMonoOutput, outputChannelCount);
  const playbackPanLawDb = resolvePlaybackPanLawDisplayDb(normalizedAudioSettings, outputChannelCount);

  return {
    audioInputs,
    audioOutputs,
    audioSettings: normalizedAudioSettings,
    monoOutputActive,
    outputChannelCount,
    playbackPanLawDb,
    refreshAudioDevices,
    setAudioSettings,
  };
}
