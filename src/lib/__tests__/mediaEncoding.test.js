import { describe, expect, it } from 'vitest';
import {
  SUPPORTED_IMPORT_ACCEPT,
  SUPPORTED_IMPORT_EXTENSIONS,
  getAudioFormatFromFile,
  getServerUploadDescriptor,
  replaceFileExtension,
} from '../mediaEncoding';

describe('mediaEncoding import policy', () => {
  it('supports wav, flac, mp3 and ogg/vorbis import types', () => {
    expect(SUPPORTED_IMPORT_EXTENSIONS).toEqual(new Set(['wav', 'mp3', 'flac', 'ogg']));
    expect(SUPPORTED_IMPORT_ACCEPT).toContain('.ogg');
    expect(SUPPORTED_IMPORT_ACCEPT).toContain('audio/ogg');
    expect(SUPPORTED_IMPORT_ACCEPT).toContain('audio/vorbis');
  });

  it('detects source formats from extension and mime type', () => {
    expect(getAudioFormatFromFile({ fileName: 'take.wav' })).toBe('wav');
    expect(getAudioFormatFromFile({ fileName: 'take.flac' })).toBe('flac');
    expect(getAudioFormatFromFile({ fileName: 'take.mp3' })).toBe('mp3');
    expect(getAudioFormatFromFile({ fileName: 'take.ogg' })).toBe('ogg');
    expect(getAudioFormatFromFile({ fileName: 'noext', mimeType: 'audio/ogg; codecs=vorbis' })).toBe('ogg');
    expect(getAudioFormatFromFile({ fileName: 'noext', mimeType: 'audio/x-flac' })).toBe('flac');
  });

  it('replaces filename extensions predictably', () => {
    expect(replaceFileExtension('demo.wav', 'flac')).toBe('demo.flac');
    expect(replaceFileExtension('demo', 'wav')).toBe('demo.wav');
    expect(replaceFileExtension(' demo.track.mp3 ', '.ogg')).toBe('demo.track.ogg');
  });

  it('maps imported wav files to flac on the server', () => {
    expect(getServerUploadDescriptor({
      sourceKind: 'import',
      sourceFileName: 'stem.wav',
      sourceMimeType: 'audio/wav',
    })).toEqual({
      sourceFormat: 'wav',
      serverFormat: 'flac',
      shouldTranscode: true,
      serverUploadMimeType: 'audio/flac',
      serverUploadFileName: 'stem.flac',
    });
  });

  it('preserves imported flac, mp3 and ogg payloads on the server', () => {
    expect(getServerUploadDescriptor({
      sourceKind: 'import',
      sourceFileName: 'stem.flac',
      sourceMimeType: 'audio/flac',
    })).toEqual({
      sourceFormat: 'flac',
      serverFormat: 'flac',
      shouldTranscode: false,
      serverUploadMimeType: 'audio/flac',
      serverUploadFileName: 'stem.flac',
    });

    expect(getServerUploadDescriptor({
      sourceKind: 'import',
      sourceFileName: 'stem.mp3',
      sourceMimeType: 'audio/mpeg',
    })).toEqual({
      sourceFormat: 'mp3',
      serverFormat: 'mp3',
      shouldTranscode: false,
      serverUploadMimeType: 'audio/mpeg',
      serverUploadFileName: 'stem.mp3',
    });

    expect(getServerUploadDescriptor({
      sourceKind: 'import',
      sourceFileName: 'stem.ogg',
      sourceMimeType: 'audio/ogg',
    })).toEqual({
      sourceFormat: 'ogg',
      serverFormat: 'ogg',
      shouldTranscode: false,
      serverUploadMimeType: 'audio/ogg',
      serverUploadFileName: 'stem.ogg',
    });
  });

  it('always stores recordings as flac on the server', () => {
    expect(getServerUploadDescriptor({
      sourceKind: 'recording',
      sourceFileName: 'recording.wav',
    })).toEqual({
      sourceFormat: 'recording',
      serverFormat: 'flac',
      shouldTranscode: true,
      serverUploadMimeType: 'audio/flac',
      serverUploadFileName: 'recording.flac',
    });
  });
});
