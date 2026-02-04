import { describe, it, expect } from 'vitest';
import {
  volumeToDb,
  dbToVolume,
  dbToGain,
  gainToDb,
  volumeToGain,
  panToNormalized,
  normalizedToPan,
  equalPowerPan,
  pixelsToDbChange,
  getChoirPanMatrix,
  sanitizeFilename,
  msToSeconds,
  secondsToMs,
} from '../utils/audio';

describe('Audio Utilities - Volume Conversion', () => {
  it('should convert volume slider to dB correctly', () => {
    expect(volumeToDb(0)).toBeCloseTo(-60, 5);
    expect(volumeToDb(50)).toBeCloseTo(-27, 5);
    expect(volumeToDb(100)).toBeCloseTo(6, 5);
  });

  it('should convert dB to volume slider correctly', () => {
    expect(dbToVolume(-60)).toBeCloseTo(0, 5);
    expect(dbToVolume(-27)).toBeCloseTo(50, 5);
    expect(dbToVolume(6)).toBeCloseTo(100, 5);
  });

  it('should convert dB to linear gain correctly', () => {
    expect(dbToGain(0)).toBeCloseTo(1.0, 5);
    expect(dbToGain(-6)).toBeCloseTo(0.501187, 5);
    expect(dbToGain(-60)).toBeCloseTo(0.001, 5);
  });

  it('should convert linear gain to dB correctly', () => {
    expect(gainToDb(1.0)).toBeCloseTo(0, 5);
    expect(gainToDb(0.5)).toBeCloseTo(-6.0206, 5);
    expect(gainToDb(0.001)).toBeCloseTo(-60, 5);
  });

  it('should convert volume slider directly to gain', () => {
    expect(volumeToGain(100)).toBeCloseTo(1.995262, 5);
    expect(volumeToGain(50)).toBeCloseTo(0.0446684, 5);
    expect(volumeToGain(0)).toBeCloseTo(0.001, 5);
  });
});

describe('Audio Utilities - Pan Conversion', () => {
  it('should convert pan slider to normalized values', () => {
    expect(panToNormalized(-100)).toBe(-1);
    expect(panToNormalized(0)).toBe(0);
    expect(panToNormalized(100)).toBe(1);
    expect(panToNormalized(50)).toBe(0.5);
  });

  it('should convert normalized pan to slider values', () => {
    expect(normalizedToPan(-1)).toBe(-100);
    expect(normalizedToPan(0)).toBe(0);
    expect(normalizedToPan(1)).toBe(100);
    expect(normalizedToPan(0.5)).toBe(50);
  });

  it('should apply equal-power panning law correctly', () => {
    // Center (pan = 0)
    const [centerL, centerR] = equalPowerPan(0);
    expect(centerL).toBeCloseTo(Math.SQRT1_2, 5); // √2/2
    expect(centerR).toBeCloseTo(Math.SQRT1_2, 5);
    
    // Full left (pan = -1)
    const [leftL, leftR] = equalPowerPan(-1);
    expect(leftL).toBeCloseTo(1.0, 5);
    expect(leftR).toBeCloseTo(0.0, 5);
    
    // Full right (pan = +1)
    const [rightL, rightR] = equalPowerPan(1);
    expect(rightL).toBeCloseTo(0.0, 5);
    expect(rightR).toBeCloseTo(1.0, 5);
  });

  it('should maintain constant power across pan positions', () => {
    const panPositions = [-1, -0.5, 0, 0.5, 1];
    
    for (const pan of panPositions) {
      const [left, right] = equalPowerPan(pan);
      const power = left * left + right * right;
      expect(power).toBeCloseTo(1.0, 5); // Total power = 1
    }
  });
});

describe('Audio Utilities - Gain Drag', () => {
  it('should convert vertical pixels to dB change', () => {
    // Spec: 100 px = ±6.0 dB
    expect(pixelsToDbChange(-100)).toBeCloseTo(6.0, 5); // Drag up = increase
    expect(pixelsToDbChange(100)).toBeCloseTo(-6.0, 5); // Drag down = decrease
    expect(pixelsToDbChange(0)).toBe(0);
    expect(pixelsToDbChange(-50)).toBeCloseTo(3.0, 5);
  });
});

describe('Audio Utilities - Choir Panning Matrix', () => {
  it('should return correct pan matrix for 1 part', () => {
    expect(getChoirPanMatrix(1)).toEqual([0]);
  });

  it('should return correct pan matrix for 2 parts', () => {
    expect(getChoirPanMatrix(2)).toEqual([30, -30]);
  });

  it('should return correct pan matrix for 3 parts', () => {
    expect(getChoirPanMatrix(3)).toEqual([0, 40, -40]);
  });

  it('should return correct pan matrix for 4 parts', () => {
    expect(getChoirPanMatrix(4)).toEqual([25, -65, 65, -25]);
  });

  it('should return correct pan matrix for 5 parts', () => {
    expect(getChoirPanMatrix(5)).toEqual([0, 70, -70, 35, -35]);
  });

  it('should default to center for invalid part counts', () => {
    expect(getChoirPanMatrix(0)).toEqual([0]);
    expect(getChoirPanMatrix(6)).toEqual([0]);
  });
});

describe('Audio Utilities - Time Conversion', () => {
  it('should convert milliseconds to seconds', () => {
    expect(msToSeconds(1000)).toBe(1);
    expect(msToSeconds(500)).toBe(0.5);
    expect(msToSeconds(2500)).toBe(2.5);
  });

  it('should convert seconds to milliseconds', () => {
    expect(secondsToMs(1)).toBe(1000);
    expect(secondsToMs(0.5)).toBe(500);
    expect(secondsToMs(2.5)).toBe(2500);
  });
});

describe('Audio Utilities - Filename Sanitization', () => {
  it('should sanitize filenames per spec', () => {
    // Spec: ASCII only, lowercase, spaces → '_'
    expect(sanitizeFilename('Hello World')).toBe('hello_world');
    expect(sanitizeFilename('Choir Part 1')).toBe('choir_part_1');
    expect(sanitizeFilename('Test@#$File')).toBe('test_file');
    expect(sanitizeFilename('UPPERCASE')).toBe('uppercase');
  });

  it('should handle multiple consecutive spaces/special chars', () => {
    expect(sanitizeFilename('test   multiple   spaces')).toBe('test_multiple_spaces');
    expect(sanitizeFilename('test___underscores___')).toBe('test_underscores');
  });

  it('should trim leading/trailing underscores', () => {
    expect(sanitizeFilename('_test_')).toBe('test');
    expect(sanitizeFilename('___leading')).toBe('leading');
    expect(sanitizeFilename('trailing___')).toBe('trailing');
  });
});
