import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeProject() {
  return {
    masterVolume: 100,
    loop: { enabled: false, startMs: 0, endMs: 0 },
    tracks: [
      {
        id: 'track-1',
        name: 'Track 1',
        volume: 100,
        pan: 0,
        muted: false,
        soloed: false,
        clips: [
          {
            id: 'clip-1',
            blobId: 'blob-1',
            timelineStartMs: 0,
            cropStartMs: 0,
            cropEndMs: 2000,
            gainDb: 0,
            muted: false,
          },
        ],
      },
    ],
  };
}

describe('AudioManager playback requests', () => {
  let routingPlayback;
  let startedSources;

  beforeEach(() => {
    vi.resetModules();
    routingPlayback = deferred();
    startedSources = [];

    class MockAudioNode {
      constructor() {
        this.gain = { value: 1 };
        this.pan = { value: 0 };
        this.channelCount = 2;
        this.channelCountMode = 'explicit';
        this.channelInterpretation = 'speakers';
      }

      connect() {}

      disconnect() {}
    }

    class MockAudioContext {
      constructor() {
        this.currentTime = 10;
        this.state = 'running';
        this.destination = new MockAudioNode();
        this.destination.maxChannelCount = 2;
      }

      createGain() {
        return new MockAudioNode();
      }

      createStereoPanner() {
        return new MockAudioNode();
      }

      createBufferSource() {
        const source = {
          buffer: null,
          connect: vi.fn(),
          start: vi.fn(() => {
            startedSources.push(source);
          }),
          stop: vi.fn(),
          onended: null,
        };
        return source;
      }

      createMediaStreamDestination() {
        return { stream: {} };
      }

      resume() {
        return Promise.resolve();
      }

      close() {
        return Promise.resolve();
      }
    }

    class MockAudioElement {
      constructor() {
        this.autoplay = false;
        this.preload = '';
        this.srcObject = null;
      }

      setSinkId() {
        return Promise.resolve();
      }

      play() {
        return routingPlayback.promise;
      }

      pause() {}
    }

    vi.stubGlobal('AudioContext', MockAudioContext);
    vi.stubGlobal('webkitAudioContext', MockAudioContext);
    vi.stubGlobal('Audio', MockAudioElement);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('only starts the latest play request when initialization overlaps', async () => {
    const { AudioManager } = await import('../audioManager');
    const manager = new AudioManager();
    manager.mediaCache.set('blob-1', { duration: 2 });

    const firstPlay = manager.play(makeProject(), 0);
    const secondPlay = manager.play(makeProject(), 500);

    routingPlayback.resolve();
    await Promise.all([firstPlay, secondPlay]);

    expect(startedSources).toHaveLength(1);
    expect(manager.activeSources.size).toBe(1);
    expect(manager.startTime).toBeCloseTo(9.5);
  });

  it('does not start sources after a pending play request is stopped', async () => {
    const { AudioManager } = await import('../audioManager');
    const manager = new AudioManager();
    manager.mediaCache.set('blob-1', { duration: 2 });

    const playPromise = manager.play(makeProject(), 0);
    manager.stop();

    routingPlayback.resolve();
    await playPromise;

    expect(startedSources).toHaveLength(0);
    expect(manager.activeSources.size).toBe(0);
    expect(manager.isPlaying).toBe(false);
  });
});
