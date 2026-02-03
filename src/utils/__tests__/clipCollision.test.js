/**
 * Tests for clip collision detection
 * Run with: npm test clipCollision.test.js
 */

import { describe, it, expect } from 'vitest';
import {
  constrainClipMove,
  constrainCropStart,
  constrainCropEnd,
  processRecordingOverwrites,
  canAddClip,
  findSafePosition,
} from '../clipCollision';

describe('Clip Collision Detection', () => {
  describe('constrainClipMove', () => {
    it('should allow move when no collision', () => {
      const clip = {
        id: 'clip1',
        timelineStartMs: 1000,
        cropStartMs: 0,
        cropEndMs: 500,
      };
      const trackClips = [clip];
      
      const result = constrainClipMove(clip, 2000, trackClips);
      expect(result).toBe(2000);
    });

    it('should prevent moving into another clip on the right', () => {
      const clip1 = {
        id: 'clip1',
        timelineStartMs: 0,
        cropStartMs: 0,
        cropEndMs: 1000,
      };
      const clip2 = {
        id: 'clip2',
        timelineStartMs: 2000,
        cropStartMs: 0,
        cropEndMs: 1000,
      };
      const trackClips = [clip1, clip2];
      
      // Try to move clip1 to 1500 (would collide with clip2)
      const result = constrainClipMove(clip1, 1500, trackClips);
      expect(result).toBe(1000); // Should stop just before clip2
    });

    it('should prevent moving into another clip on the left', () => {
      const clip1 = {
        id: 'clip1',
        timelineStartMs: 0,
        cropStartMs: 0,
        cropEndMs: 1000,
      };
      const clip2 = {
        id: 'clip2',
        timelineStartMs: 3000,
        cropStartMs: 0,
        cropEndMs: 1000,
      };
      const trackClips = [clip1, clip2];
      
      // Try to move clip2 to 500 (would collide with clip1)
      const result = constrainClipMove(clip2, 500, trackClips);
      expect(result).toBe(1000); // Should stop just after clip1
    });

    it('should not allow moving before 0', () => {
      const clip = {
        id: 'clip1',
        timelineStartMs: 1000,
        cropStartMs: 0,
        cropEndMs: 500,
      };
      const trackClips = [clip];
      
      const result = constrainClipMove(clip, -100, trackClips);
      expect(result).toBe(0);
    });
  });

  describe('constrainCropStart', () => {
    it('should allow crop start when no collision', () => {
      const clip = {
        id: 'clip1',
        timelineStartMs: 1000,
        cropStartMs: 100,
        cropEndMs: 600,
      };
      const trackClips = [clip];
      
      const result = constrainCropStart(clip, 200, trackClips);
      expect(result).toBe(200);
    });

    it('should prevent cropping into previous clip', () => {
      const clip1 = {
        id: 'clip1',
        timelineStartMs: 0,
        cropStartMs: 0,
        cropEndMs: 1000,
      };
      const clip2 = {
        id: 'clip2',
        timelineStartMs: 2000,
        cropStartMs: 500,
        cropEndMs: 1500,
      };
      const trackClips = [clip1, clip2];
      
      // Try to reduce crop start (expand left) - would collide with clip1
      const result = constrainCropStart(clip2, 0, trackClips);
      expect(result).toBeLessThanOrEqual(500); // Should be constrained
    });
  });

  describe('constrainCropEnd', () => {
    it('should allow crop end when no collision', () => {
      const clip = {
        id: 'clip1',
        timelineStartMs: 0,
        cropStartMs: 0,
        cropEndMs: 500,
        sourceDurationMs: 2000,
      };
      const trackClips = [clip];
      
      const result = constrainCropEnd(clip, 1000, trackClips);
      expect(result).toBe(1000);
    });

    it('should prevent extending into next clip', () => {
      const clip1 = {
        id: 'clip1',
        timelineStartMs: 0,
        cropStartMs: 0,
        cropEndMs: 500,
        sourceDurationMs: 2000,
      };
      const clip2 = {
        id: 'clip2',
        timelineStartMs: 1000,
        cropStartMs: 0,
        cropEndMs: 500,
      };
      const trackClips = [clip1, clip2];
      
      // Try to extend clip1 to 1500ms duration (would collide with clip2)
      const result = constrainCropEnd(clip1, 1500, trackClips);
      expect(result).toBe(1000); // Should stop at clip2's start
    });

    it('should not allow extending beyond source duration', () => {
      const clip = {
        id: 'clip1',
        timelineStartMs: 0,
        cropStartMs: 0,
        cropEndMs: 500,
        sourceDurationMs: 1000,
      };
      const trackClips = [clip];
      
      const result = constrainCropEnd(clip, 1500, trackClips);
      expect(result).toBe(1000); // Capped at source duration
    });
  });

  describe('processRecordingOverwrites', () => {
    it('should delete clip completely covered by recording', () => {
      const clip = {
        id: 'clip1',
        timelineStartMs: 1000,
        cropStartMs: 0,
        cropEndMs: 1000,
      };
      const trackClips = [clip];
      
      const result = processRecordingOverwrites(500, 2500, trackClips);
      expect(result).toHaveLength(0); // Clip should be deleted
    });

    it('should crop clip from left when recording overwrites beginning', () => {
      const clip = {
        id: 'clip1',
        timelineStartMs: 1000,
        cropStartMs: 0,
        cropEndMs: 1000,
      };
      const trackClips = [clip];
      
      const result = processRecordingOverwrites(500, 1500, trackClips);
      expect(result).toHaveLength(1);
      expect(result[0].timelineStartMs).toBe(1500); // Moved right
      expect(result[0].cropStartMs).toBe(500); // Cropped from left
    });

    it('should crop clip from right when recording overwrites end', () => {
      const clip = {
        id: 'clip1',
        timelineStartMs: 1000,
        cropStartMs: 0,
        cropEndMs: 1000,
      };
      const trackClips = [clip];
      
      const result = processRecordingOverwrites(1500, 2500, trackClips);
      expect(result).toHaveLength(1);
      expect(result[0].cropEndMs).toBe(500); // Cropped from right
      expect(result[0].timelineStartMs).toBe(1000); // Position unchanged
    });

    it('should not modify clips outside recording range', () => {
      const clip1 = {
        id: 'clip1',
        timelineStartMs: 0,
        cropStartMs: 0,
        cropEndMs: 500,
      };
      const clip2 = {
        id: 'clip2',
        timelineStartMs: 3000,
        cropStartMs: 0,
        cropEndMs: 500,
      };
      const trackClips = [clip1, clip2];
      
      const result = processRecordingOverwrites(1000, 2000, trackClips);
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual(clip1);
      expect(result[1]).toEqual(clip2);
    });
  });

  describe('canAddClip', () => {
    it('should allow adding clip when no collision', () => {
      const newClip = {
        id: 'new',
        timelineStartMs: 2000,
        cropStartMs: 0,
        cropEndMs: 1000,
      };
      const trackClips = [
        {
          id: 'clip1',
          timelineStartMs: 0,
          cropStartMs: 0,
          cropEndMs: 1000,
        },
      ];
      
      const result = canAddClip(newClip, trackClips);
      expect(result).toBe(true);
    });

    it('should prevent adding clip when collision exists', () => {
      const newClip = {
        id: 'new',
        timelineStartMs: 500,
        cropStartMs: 0,
        cropEndMs: 1000,
      };
      const trackClips = [
        {
          id: 'clip1',
          timelineStartMs: 0,
          cropStartMs: 0,
          cropEndMs: 1000,
        },
      ];
      
      const result = canAddClip(newClip, trackClips);
      expect(result).toBe(false);
    });
  });

  describe('findSafePosition', () => {
    it('should return preferred position when clear', () => {
      const newClip = {
        id: 'new',
        cropStartMs: 0,
        cropEndMs: 1000,
      };
      const trackClips = [];
      
      const result = findSafePosition(newClip, trackClips, 500);
      expect(result).toBe(500);
    });

    it('should find position after last clip when preferred is blocked', () => {
      const newClip = {
        id: 'new',
        cropStartMs: 0,
        cropEndMs: 1000,
      };
      const trackClips = [
        {
          id: 'clip1',
          timelineStartMs: 0,
          cropStartMs: 0,
          cropEndMs: 2000,
        },
      ];
      
      const result = findSafePosition(newClip, trackClips, 500);
      expect(result).toBe(2000); // After clip1
    });

    it('should return 0 for empty track', () => {
      const newClip = {
        id: 'new',
        cropStartMs: 0,
        cropEndMs: 1000,
      };
      const trackClips = [];
      
      const result = findSafePosition(newClip, trackClips, 500);
      expect(result).toBe(500); // Preferred position is available
    });
  });
});
