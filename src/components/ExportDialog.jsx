import { useState } from 'react';
import { Download, X, FileArchive, FileJson } from 'lucide-react';
import { EXPORT_PRESETS, exportProject, downloadBlob } from '../lib/exportEngine';
import { exportAsJSON, exportAsZIP, downloadFile } from '../lib/projectPortability';

function ExportDialog({ project, onClose, audioBuffers, mediaMap }) {
  const [isExporting, setIsExporting] = useState(false);
  const [progress, setProgress] = useState('');
  const [selectedPreset, setSelectedPreset] = useState(EXPORT_PRESETS.ALL);

  const presets = [
    { id: EXPORT_PRESETS.INSTRUMENTAL, label: 'Instrumental', description: 'Instrument tracks only' },
    { id: EXPORT_PRESETS.ALL, label: 'All Tracks', description: 'All tracks (leads +3dB)' },
    { id: EXPORT_PRESETS.LEAD, label: 'Lead', description: 'Lead + instrumental' },
    { id: EXPORT_PRESETS.LEADS_SEPARATE, label: 'Leads Separate', description: 'One WAV per lead (target +6dB, others -3dB)' },
    { id: EXPORT_PRESETS.ONLY_WHOLE_CHOIR, label: 'Choir Only', description: 'Choir tracks only' },
    { id: EXPORT_PRESETS.SEPARATE_CHOIR_PARTS, label: 'Choir Parts (Practice)', description: 'Target +6dB/+30pan, others -6dB/-30pan, instrumental -3dB' },
    { id: EXPORT_PRESETS.SEPARATE_CHOIR_PARTS_OMITTED, label: 'Choir Parts (Omitted)', description: 'One file per choir part, target muted' },
  ];

  const handleExportAudio = async () => {
    setIsExporting(true);
    setProgress('Rendering audio...');

    try {
      const files = await exportProject(project, selectedPreset, audioBuffers);

      setProgress(`Downloading ${files.length} file${files.length > 1 ? 's' : ''}...`);

      for (const { filename, blob } of files) {
        downloadBlob(blob, filename);
        await new Promise(resolve => setTimeout(resolve, 500)); // Delay between downloads
      }

      setProgress('Export complete!');
      setTimeout(() => {
        onClose();
      }, 1500);

    } catch (error) {
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
      }, 1500);

    } catch (error) {
      console.error('Export project ZIP failed:', error);
      alert('Export failed: ' + error.message);
      setIsExporting(false);
      setProgress('');
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-lg max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
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

        {/* Content */}
        <div className="flex-1 overflow-auto p-6">
          {/* Audio Export */}
          <div className="mb-6">
            <h3 className="text-lg font-semibold mb-3">Export Audio (WAV)</h3>
            <div className="space-y-2">
              {presets.map(preset => (
                <label
                  key={preset.id}
                  className={`block bg-gray-900 rounded-lg p-3 cursor-pointer transition-colors ${
                    selectedPreset === preset.id
                      ? 'ring-2 ring-blue-500'
                      : 'hover:bg-gray-850'
                  }`}
                >
                  <input
                    type="radio"
                    name="preset"
                    value={preset.id}
                    checked={selectedPreset === preset.id}
                    onChange={(e) => setSelectedPreset(e.target.value)}
                    className="mr-3"
                  />
                  <span className="font-medium">{preset.label}</span>
                  <p className="text-sm text-gray-400 ml-6">{preset.description}</p>
                </label>
              ))}
            </div>

            <button
              onClick={handleExportAudio}
              disabled={isExporting}
              className="mt-4 w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white px-6 py-3 rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              <Download size={20} />
              <span>{isExporting ? progress : 'Export Audio'}</span>
            </button>
          </div>

          {/* Project Export */}
          <div className="border-t border-gray-700 pt-6">
            <h3 className="text-lg font-semibold mb-3">Export Project</h3>
            
            <div className="space-y-3">
              {/* JSON Export */}
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

              {/* ZIP Export */}
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

          {/* Format Info */}
          <div className="mt-6 p-4 bg-gray-900 rounded-lg text-sm text-gray-400">
            <p className="mb-2"><strong>Audio Export Format:</strong> WAV, 44.1kHz, 16-bit PCM</p>
            <p><strong>Processing:</strong> No limiter, no normalization, no dithering</p>
          </div>
        </div>

        {/* Footer */}
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
