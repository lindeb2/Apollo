import { describe, expect, it } from 'vitest';
import {
  ACCESS_LEVEL_READ,
  ACCESS_LEVEL_WRITE,
  CAPABILITY_PLAYER_TUTTI,
  CAPABILITY_PROJECT_MANAGER,
  CAPABILITY_PROJECT_READ,
  CAPABILITY_TRACK_WRITE_SCOPE,
  SCOPE_TYPE_ALL_PROJECTS,
  SCOPE_TYPE_GROUP_NAME,
  SCOPE_TYPE_PART_NAME,
  SCOPE_TYPE_PROJECT,
  extractProjectAccessTags,
  resolveProjectAccessFromGrantRows,
  validateAndTransformProjectWrite,
} from '../rbac.js';

describe('extractProjectAccessTags', () => {
  it('collects unique normalized group tags from the track tree', () => {
    const tags = extractProjectAccessTags({
      trackTree: [
        { kind: 'group', name: 'Choir' },
        { kind: 'group', name: ' Choir ' },
        { kind: 'track', name: 'Solo' },
        { kind: 'group', name: 'Band' },
      ],
    });

    expect(tags).toEqual([
      { tagType: 'group_name', tagValue: 'band', displayName: 'Band' },
      { tagType: 'group_name', tagValue: 'choir', displayName: 'Choir' },
    ]);
  });
});

describe('resolveProjectAccessFromGrantRows', () => {
  it('lets write win over read when multiple grants apply', () => {
    const grants = [
      {
        accessLevel: ACCESS_LEVEL_READ,
        scopeType: SCOPE_TYPE_ALL_PROJECTS,
      },
      {
        accessLevel: ACCESS_LEVEL_WRITE,
        scopeType: SCOPE_TYPE_PROJECT,
        scopeProjectId: 'project-1',
      },
    ];

    expect(resolveProjectAccessFromGrantRows(grants, 'project-1')).toEqual({
      canRead: true,
      canWrite: true,
    });
    expect(resolveProjectAccessFromGrantRows(grants, 'project-2')).toEqual({
      canRead: true,
      canWrite: false,
    });
  });

  it('matches named scopes for current and future projects by normalized tag name', () => {
    const grants = [
      {
        accessLevel: ACCESS_LEVEL_WRITE,
        scopeType: SCOPE_TYPE_GROUP_NAME,
        scopeValue: 'sopran',
      },
      {
        accessLevel: ACCESS_LEVEL_READ,
        scopeType: SCOPE_TYPE_PART_NAME,
        scopeValue: 'alto 1',
      },
    ];

    const matchingProjectTags = {
      [SCOPE_TYPE_GROUP_NAME]: new Set(['sopran']),
      [SCOPE_TYPE_PART_NAME]: new Set(['alto 1']),
    };
    const futureProjectTags = {
      [SCOPE_TYPE_GROUP_NAME]: new Set(['sopran']),
      [SCOPE_TYPE_PART_NAME]: new Set(),
    };
    const unrelatedProjectTags = {
      [SCOPE_TYPE_GROUP_NAME]: new Set(['tenor']),
      [SCOPE_TYPE_PART_NAME]: new Set(['bass 2']),
    };

    expect(resolveProjectAccessFromGrantRows(grants, 'project-now', matchingProjectTags)).toEqual({
      canRead: true,
      canWrite: true,
    });
    expect(resolveProjectAccessFromGrantRows(grants, 'project-future', futureProjectTags)).toEqual({
      canRead: true,
      canWrite: true,
    });
    expect(resolveProjectAccessFromGrantRows(grants, 'project-other', unrelatedProjectTags)).toEqual({
      canRead: false,
      canWrite: false,
    });
  });

  it('treats capability grants according to the new fine-grained model', () => {
    const grants = [
      {
        capability: CAPABILITY_PLAYER_TUTTI,
        projectTargetType: SCOPE_TYPE_GROUP_NAME,
        projectTargetValue: 'choir',
      },
      {
        capability: CAPABILITY_PROJECT_READ,
        projectTargetType: SCOPE_TYPE_PROJECT,
        projectTargetProjectId: 'project-read',
      },
      {
        capability: CAPABILITY_PROJECT_MANAGER,
        projectTargetType: SCOPE_TYPE_PROJECT,
        projectTargetProjectId: 'project-manage',
      },
    ];

    expect(resolveProjectAccessFromGrantRows(grants, 'project-manage')).toEqual({
      canRead: true,
      canWrite: true,
    });
    expect(resolveProjectAccessFromGrantRows(grants, 'project-read')).toEqual({
      canRead: true,
      canWrite: false,
    });
    expect(resolveProjectAccessFromGrantRows(grants, 'project-choir', {
      [SCOPE_TYPE_GROUP_NAME]: new Set(['choir']),
      [SCOPE_TYPE_PART_NAME]: new Set(),
    })).toEqual({
      canRead: false,
      canWrite: false,
    });
  });

  it('limits capability grants to the targeted show when configured', () => {
    const grants = [
      {
        capability: CAPABILITY_PROJECT_READ,
        showTargetType: 'show',
        showTargetShowId: 'show-a',
        projectTargetType: SCOPE_TYPE_ALL_PROJECTS,
      },
    ];

    expect(resolveProjectAccessFromGrantRows(grants, { id: 'project-1', showId: 'show-a' })).toEqual({
      canRead: true,
      canWrite: false,
    });
    expect(resolveProjectAccessFromGrantRows(grants, { id: 'project-2', showId: 'show-b' })).toEqual({
      canRead: false,
      canWrite: false,
    });
  });
});

describe('validateAndTransformProjectWrite', () => {
  it('stamps scoped tracks from inferred group scope when exactly one scope matches', async () => {
    const currentSnapshot = {
      projectId: 'project-1',
      projectName: 'Test',
      musicalNumber: '1.1',
      sampleRate: 44100,
      masterVolume: 100,
      trackTree: [
        { id: 'group-1', kind: 'group', name: 'Soprano', order: 0 },
      ],
      tracks: [],
      loop: { enabled: false, startMs: 0, endMs: 0 },
    };
    const nextSnapshot = {
      ...currentSnapshot,
      tracks: [
        {
          id: 'track-1',
          name: 'Line 1',
          role: 'lead',
          icon: 'mic',
          volume: 100,
          pan: 0,
          muted: false,
          soloed: false,
          clips: [],
        },
      ],
      trackTree: [
        { id: 'group-1', kind: 'group', name: 'Soprano', order: 0 },
        { id: 'node-track-1', kind: 'track', trackId: 'track-1', parentId: 'group-1', order: 0 },
      ],
    };

    const transformed = await validateAndTransformProjectWrite({
      userId: 'user-1',
      project: { id: 'project-1', createdByUserId: 'owner-1' },
      access: {
        canWriteScopedTracks: true,
        editableTrackScopes: [{ type: 'group_name', value: 'soprano', label: 'Soprano' }],
      },
      currentSnapshot,
      nextSnapshot,
    });

    expect(transformed.tracks[0]).toMatchObject({
      createdByUserId: 'user-1',
      accessScopeType: 'group_name',
      accessScopeValue: 'soprano',
    });
  });
});
