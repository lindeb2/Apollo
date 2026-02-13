import { useMemo, useState } from 'react';
import { Download, X, FileArchive, FileJson } from 'lucide-react';
import {
  EXPORT_PRESETS,
  EXPORT_PRESET_DEFINITIONS,
  exportProject,
} from '../lib/exportEngine';
import { exportAsJSON, exportAsZIP, downloadFile } from '../lib/projectPortability';
import { loadExportDirectoryHandle, saveExportDirectoryHandle } from '../lib/db';
import { hasInvalidExportNameChars, normalizeExportName } from '../utils/naming';

const AUDIO_EXPORT_SECTIONS = [
  {
    title: 'Root',
    presetIds: [EXPORT_PRESETS.TUTTI],
  },
  {
    title: 'Root / One Group Omitted',
    presetIds: [EXPORT_PRESETS.ACAPELLA, EXPORT_PRESETS.NO_LEAD, EXPORT_PRESETS.NO_CHOIR],
  },
  {
    title: 'Root / Separated Groups',
    presetIds: [EXPORT_PRESETS.INSTRUMENTAL, EXPORT_PRESETS.LEAD_ONLY, EXPORT_PRESETS.CHOIR_ONLY],
  },
  {
    title: 'Root / Practice / Normal',
    presetIds: [EXPORT_PRESETS.INSTRUMENT_PARTS, EXPORT_PRESETS.LEAD_PARTS, EXPORT_PRESETS.CHOIR_PARTS],
  },
  {
    title: 'Root / Practice / Omitted',
    presetIds: [EXPORT_PRESETS.INSTRUMENT_PARTS_OMITTED, EXPORT_PRESETS.LEAD_PARTS_OMITTED, EXPORT_PRESETS.CHOIR_PARTS_OMITTED],
  },
];

const PRESET_BY_ID = Object.fromEntries(
  EXPORT_PRESET_DEFINITIONS.map((preset) => [preset.id, preset])
);

async function hasWritePermission(handle) {
  if (!handle) return false;
  if (!handle.queryPermission) return true;
  try {
    const permission = await handle.queryPermission({ mode: 'readwrite' });
    if (permission === 'granted') return true;
    if (permission === 'prompt') {
      return (await handle.requestPermission({ mode: 'readwrite' })) === 'granted';
    }
    return false;
  } catch {
    return false;
  }
}

async function getExportStartHandle(projectId) {
  try {
    const projectHandle = await loadExportDirectoryHandle(`project:${projectId}`);
    if (await hasWritePermission(projectHandle)) {
      return projectHandle;
    }
    const appHandle = await loadExportDirectoryHandle('global');
    if (await hasWritePermission(appHandle)) {
      return appHandle;
    }
  } catch {
    return null;
  }
  return null;
}

async function pickExportDirectory(projectId) {
  if (!window.showDirectoryPicker) {
    throw new Error('Directory export is not supported in this browser.');
  }

  const startHandle = await getExportStartHandle(projectId);
  let directoryHandle = null;
  try {
    directoryHandle = startHandle
      ? await window.showDirectoryPicker({ mode: 'readwrite', startIn: startHandle })
      : await window.showDirectoryPicker({ mode: 'readwrite' });
  } catch (error) {
    if (startHandle && (error?.name === 'TypeError' || error?.name === 'NotFoundError')) {
      directoryHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
    } else {
      throw error;
    }
  }

  try {
    await saveExportDirectoryHandle(`project:${projectId}`, directoryHandle);
    await saveExportDirectoryHandle('global', directoryHandle);
  } catch {
    // Some environments cannot persist file handles; export still works.
  }
  return directoryHandle;
}

async function writeFileToDirectory(rootDirectoryHandle, relativePath, blob) {
  const segments = relativePath.split('/').filter(Boolean);
  const filename = segments.pop();
  let directory = rootDirectoryHandle;
  for (const segment of segments) {
    directory = await directory.getDirectoryHandle(segment, { create: true });
  }
  const fileHandle = await directory.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();
}

function ExportDialog({ project, onClose, audioBuffers, mediaMap }) {
  const [isExporting, setIsExporting] = useState(false);
  const [progress, setProgress] = useState('');
  const [selectedPresetIds, setSelectedPresetIds] = useState([EXPORT_PRESETS.TUTTI]);
  const [exportBaseName, setExportBaseName] = useState(project.projectName || 'project');

  const allPresetIds = useMemo(
    () => AUDIO_EXPORT_SECTIONS.flatMap((section) => section.presetIds),
    []
  );

  const allSelected = selectedPresetIds.length === allPresetIds.length;

  const togglePreset = (presetId) => {
    setSelectedPresetIds((prev) => (
      prev.includes(presetId)
        ? prev.filter((id) => id !== presetId)
        : [...prev, presetId]
    ));
  };

  const toggleSelectAll = () => {
    setSelectedPresetIds((prev) => (prev.length === allPresetIds.length ? [] : [...allPresetIds]));
  };

  const handleExportAudio = async () => {
    if (!selectedPresetIds.length) {
      alert('Select at least one audio export option.');
      return;
    }
    const normalizedExportName = normalizeExportName(exportBaseName);
    if (!normalizedExportName) {
      alert('Export name cannot be empty.');
      return;
    }
    if (hasInvalidExportNameChars(normalizedExportName)) {
      alert('Export name cannot contain: \\ / : * ? " < > |');
      return;
    }

    setIsExporting(true);
    setProgress('Pick export folder...');

    try {
      // Must be called directly from the click gesture (Windows requires this).
      const directoryHandle = await pickExportDirectory(project.projectId);

      setProgress('Rendering audio...');
      const files = await exportProject(
        project,
        selectedPresetIds,
        audioBuffers,
        project.exportSettings,
        normalizedExportName
      );

      if (!files.length) {
        throw new Error('No files produced by selected export options.');
      }

      let written = 0;
      for (const file of files) {
        await writeFileToDirectory(directoryHandle, file.relativePath, file.blob);
        written += 1;
        setProgress(`Exported ${written}/${files.length}`);
      }

      setProgress('Export complete!');
      setTimeout(() => {
        setIsExporting(false);
        setProgress('');
        onClose();
      }, 900);
    } catch (error) {
      if (error?.name === 'AbortError') {
        setIsExporting(false);
        setProgress('');
        return;
      }
      console.error('Export failed:', error);
      alert('Export failed: ' + error.message);
      setIsExporting(false);
      setProgress('');
    }
  };

  const handleExportProjectJSON = async () => {
    try {
      const { blob, filename } = await exportAsJSON(project);
      downloadFile(blob, filename);
    } catch (error) {
      console.error('Export project JSON failed:', error);
      alert('Export failed: ' + error.message);
    }
  };

  const handleExportProjectZIP = async () => {
    setIsExporting(true);
    setProgress('Creating ZIP archive...');

    try {
      const { blob, filename } = await exportAsZIP(project, mediaMap);
      setProgress('Downloading...');
      downloadFile(blob, filename);
      setProgress('Export complete!');
      setTimeout(() => {
        setIsExporting(false);
        setProgress('');
      }, 900);
    } catch (error) {
      console.error('Export project ZIP failed:', error);
      alert('Export failed: ' + error.message);
      setIsExporting(false);
      setProgress('');
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-lg max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        <div className="px-6 py-4 border-b border-gray-700 flex items-center justify-between">
          <h2 className="text-xl font-semibold">Export</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors"
            disabled={isExporting}
          >
            <X size={24} />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-6">
          <div className="mb-6">
            <h3 className="text-lg font-semibold mb-3">Export Audio (WAV)</h3>
            <div className="mb-3">
              <label className="block text-xs text-gray-400 mb-1">Export name</label>
              <input
                type="text"
                value={exportBaseName}
                onChange={(e) => setExportBaseName(e.target.value)}
                className="w-full rounded bg-gray-900 border border-gray-700 px-3 py-2 text-sm focus:outline-none"
                placeholder="Export base name"
                disabled={isExporting}
              />
            </div>
            <label className="flex items-center gap-2 bg-gray-900 rounded-lg p-3 mb-3">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleSelectAll}
                disabled={isExporting}
              />
              <span className="font-medium">Select all</span>
            </label>

            <div className="space-y-3">
              {AUDIO_EXPORT_SECTIONS.map((section) => (
                <div key={section.title} className="bg-gray-900 rounded-lg p-3">
                  <div className="text-sm font-semibold text-gray-300 mb-2">{section.title}</div>
                  <div className="space-y-2">
                    {section.presetIds.map((presetId) => {
                      const preset = PRESET_BY_ID[presetId];
                      if (!preset) return null;
                      return (
                        <label key={preset.id} className="flex items-start gap-2">
                          <input
                            type="checkbox"
                            checked={selectedPresetIds.includes(preset.id)}
                            onChange={() => togglePreset(preset.id)}
                            disabled={isExporting}
                          />
                          <span>
                            <span className="font-medium">{preset.label}</span>
                            <span className="text-sm text-gray-400 block">{preset.description}</span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            <button
              onClick={handleExportAudio}
              disabled={isExporting || selectedPresetIds.length === 0}
              className="mt-4 w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white px-6 py-3 rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              <Download size={20} />
              <span>
                {isExporting
                  ? progress
                  : `Export Audio (${selectedPresetIds.length} selected)`}
              </span>
            </button>
          </div>

          <div className="border-t border-gray-700 pt-6">
            <h3 className="text-lg font-semibold mb-3">Export Project</h3>

            <div className="space-y-3">
              <div className="bg-gray-900 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <FileJson size={24} className="text-blue-500 flex-shrink-0 mt-1" />
                  <div className="flex-1">
                    <h4 className="font-medium mb-1">JSON (Metadata Only)</h4>
                    <p className="text-sm text-gray-400 mb-3">
                      Export project settings and clip data. Audio files must already exist in the browser database.
                    </p>
                    <button
                      onClick={handleExportProjectJSON}
                      disabled={isExporting}
                      className="bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:cursor-not-allowed text-white px-4 py-2 rounded transition-colors text-sm"
                    >
                      Export as JSON
                    </button>
                  </div>
                </div>
              </div>

              <div className="bg-gray-900 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <FileArchive size={24} className="text-green-500 flex-shrink-0 mt-1" />
                  <div className="flex-1">
                    <h4 className="font-medium mb-1">ZIP (Complete Archive)</h4>
                    <p className="text-sm text-gray-400 mb-3">
                      Export project with all audio files included. Use this to transfer projects between machines.
                    </p>
                    <button
                      onClick={handleExportProjectZIP}
                      disabled={isExporting}
                      className="bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:cursor-not-allowed text-white px-4 py-2 rounded transition-colors text-sm"
                    >
                      Export as ZIP
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-gray-700 flex justify-end">
          <button
            onClick={onClose}
            disabled={isExporting}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:cursor-not-allowed rounded transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export default ExportDialog;
