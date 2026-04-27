import { describe, expect, it } from 'vitest';
import {
  ADVANCED_MIX_PRACTICE_FOCUS_SLIDER_POSITIONS,
  ADVANCED_MIX_PRACTICE_FOCUS_STEPS,
} from '../advancedMix.js';

describe('ADVANCED_MIX_PRACTICE_FOCUS_SLIDER_POSITIONS', () => {
  it('maps the configured numeric range evenly between omitted and solo', () => {
    const byStep = new Map(
      ADVANCED_MIX_PRACTICE_FOCUS_STEPS.map((step, index) => [
        step,
        ADVANCED_MIX_PRACTICE_FOCUS_SLIDER_POSITIONS[index],
      ])
    );

    expect(byStep.get('omitted')).toBe(0);
    expect(byStep.get(-15)).toBe(8);
    expect(byStep.get(0)).toBe(50);
    expect(byStep.get(15)).toBe(92);
    expect(byStep.get('solo')).toBe(100);
  });
});
