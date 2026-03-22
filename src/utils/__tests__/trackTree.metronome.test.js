import { describe, expect, it } from 'vitest';
import { createEmptyProject, createTrack, TRACK_ROLES } from '../../types/project';
import {
  attachTrackNode,
  createGroupNode,
  getTrackNodeByTrackId,
  moveTrackTreeNode,
  normalizeTrackTree,
} from '../trackTree';

describe('metronome track tree rules', () => {
  it('normalizes nested metronome tracks back to the root level', () => {
    const metronome = createTrack('Click', TRACK_ROLES.METRONOME);
    let project = createEmptyProject('Metronome Test');
    project = { ...project, tracks: [metronome] };
    project = createGroupNode(project, 'Band');
    const groupNode = project.trackTree.find((node) => node.kind === 'group');

    const normalized = normalizeTrackTree({
      ...project,
      trackTree: [
        ...project.trackTree,
        {
          id: 'invalid-metronome-node',
          kind: 'track',
          parentId: groupNode.id,
          order: 0,
          trackId: metronome.id,
        },
      ],
    });

    expect(getTrackNodeByTrackId(normalized, metronome.id)?.parentId ?? null).toBeNull();
  });

  it('refuses to attach metronome tracks under groups', () => {
    const metronome = createTrack('Click', TRACK_ROLES.METRONOME);
    let project = createEmptyProject('Metronome Test');
    project = { ...project, tracks: [metronome] };
    project = createGroupNode(project, 'Band');
    const groupNode = project.trackTree.find((node) => node.kind === 'group');

    const nextProject = attachTrackNode(project, metronome.id, groupNode.id);

    expect(getTrackNodeByTrackId(nextProject, metronome.id)?.parentId ?? null).toBeNull();
  });

  it('does not allow moving a metronome track inside a group', () => {
    const metronome = createTrack('Click', TRACK_ROLES.METRONOME);
    const instrument = createTrack('Piano', TRACK_ROLES.INSTRUMENT);
    let project = createEmptyProject('Metronome Test');
    project = { ...project, tracks: [metronome, instrument] };
    project = createGroupNode(project, 'Band');
    const groupNode = project.trackTree.find((node) => node.kind === 'group');
    project = attachTrackNode(project, metronome.id);
    project = attachTrackNode(project, instrument.id);

    const metronomeNodeId = getTrackNodeByTrackId(project, metronome.id)?.id;
    const movedProject = moveTrackTreeNode(project, metronomeNodeId, groupNode.id, 'inside');

    expect(getTrackNodeByTrackId(movedProject, metronome.id)?.parentId ?? null).toBeNull();
  });
});
