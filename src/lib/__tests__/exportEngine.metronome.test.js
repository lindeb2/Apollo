import { describe, expect, it } from 'vitest';
import { createEmptyProject, createTrack, TRACK_ROLES } from '../../types/project';
import { attachTrackNode, getEffectiveTrackMix } from '../../utils/trackTree';
import {
  EXPORT_PRESETS,
  PRACTICE_REALTIME_MODES,
  resolvePracticeRealtimeTrackMix,
} from '../exportEngine';

function createPracticeProject() {
  const instrument = createTrack('Piano', TRACK_ROLES.INSTRUMENT);
  instrument.pan = -24;

  const metronome = createTrack('Click', TRACK_ROLES.METRONOME);
  metronome.pan = 18;

  let project = createEmptyProject('Practice Test');
  project = { ...project, tracks: [instrument, metronome] };
  project = attachTrackNode(project, instrument.id);
  project = attachTrackNode(project, metronome.id);

  return { project, instrument, metronome };
}

describe('practice mix metronome passthrough', () => {
  it('keeps metronome gain/pan under direct mute control in realtime practice modes', () => {
    const { project, instrument, metronome } = createPracticeProject();
    const baseMix = getEffectiveTrackMix(project);
    const baseMetronomeState = baseMix.statesByTrackId.get(metronome.id);
    const presetVariantKey = `track:${instrument.id}`;

    const normalMix = resolvePracticeRealtimeTrackMix(
      project,
      EXPORT_PRESETS.INSTRUMENT_PARTS,
      presetVariantKey,
      null,
      PRACTICE_REALTIME_MODES.NORMAL
    );
    const omittedMix = resolvePracticeRealtimeTrackMix(
      project,
      EXPORT_PRESETS.INSTRUMENT_PARTS,
      presetVariantKey,
      null,
      PRACTICE_REALTIME_MODES.OMITTED
    );
    const soloMix = resolvePracticeRealtimeTrackMix(
      project,
      EXPORT_PRESETS.INSTRUMENT_PARTS,
      presetVariantKey,
      null,
      PRACTICE_REALTIME_MODES.SOLO
    );

    expect(normalMix.trackMixByTrackId[metronome.id]).toEqual({
      gain: baseMetronomeState.effectiveGain,
      pan: baseMetronomeState.effectivePan,
    });
    expect(omittedMix.trackMixByTrackId[metronome.id]).toEqual({
      gain: baseMetronomeState.effectiveGain,
      pan: baseMetronomeState.effectivePan,
    });
    expect(soloMix.trackMixByTrackId[metronome.id]).toEqual({
      gain: baseMetronomeState.effectiveGain,
      pan: baseMetronomeState.effectivePan,
    });
    expect(omittedMix.trackMixByTrackId[instrument.id].gain).toBe(0);
  });
});
