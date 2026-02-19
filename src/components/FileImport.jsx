import { useState } from 'react';
import { Download, FileAudio, X } from 'lucide-react';
import { TRACK_ROLES } from '../types/project';

function FileImport({ onImport, onClose, manualChoirPartsEnabled = false }) {
  const [files, setFiles] = useState([]);
  const [isDragging, setIsDragging] = useState(false);
  const [roles, setRoles] = useState({});
  const [isProcessing, setIsProcessing] = useState(false);

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);

    const droppedFiles = Array.from(e.dataTransfer.files).filter(file => {
      const ext = file.name.toLowerCase().split('.').pop();
      return ['wav', 'mp3', 'flac'].includes(ext);
    });

    handleFiles(droppedFiles);
  };

  const handleFileInput = (e) => {
    const selectedFiles = Array.from(e.target.files);
    handleFiles(selectedFiles);
  };

  const handleFiles = (newFiles) => {
    setFiles(prev => [...prev, ...newFiles]);
    
    // Initialize roles for new files
    const newRoles = { ...roles };
    for (const file of newFiles) {
      if (!newRoles[file.name]) {
        newRoles[file.name] = TRACK_ROLES.INSTRUMENT;
      }
    }
    setRoles(newRoles);
  };

  const removeFile = (fileName) => {
    setFiles(prev => prev.filter(f => f.name !== fileName));
    const newRoles = { ...roles };
    delete newRoles[fileName];
    setRoles(newRoles);
  };

  const updateRole = (fileName, role) => {
    setRoles(prev => ({ ...prev, [fileName]: role }));
  };

  const handleImport = async () => {
    if (files.length === 0) return;

    setIsProcessing(true);

    try {
      const fileData = files.map(file => ({
        file,
        role: roles[file.name],
      }));

      await onImport(fileData);
      
      // Reset state
      setFiles([]);
      setRoles({});
      onClose();
    } catch (error) {
      console.error('Import failed:', error);
      alert('Import failed: ' + error.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const choirRoleOptions = manualChoirPartsEnabled
    ? [
      { value: TRACK_ROLES.CHOIR, label: 'Choir' },
      { value: TRACK_ROLES.CHOIR_PART_1, label: 'Choir Part 1' },
      { value: TRACK_ROLES.CHOIR_PART_2, label: 'Choir Part 2' },
      { value: TRACK_ROLES.CHOIR_PART_3, label: 'Choir Part 3' },
      { value: TRACK_ROLES.CHOIR_PART_4, label: 'Choir Part 4' },
      { value: TRACK_ROLES.CHOIR_PART_5, label: 'Choir Part 5' },
    ]
    : [{ value: TRACK_ROLES.CHOIR, label: 'Choir' }];

  const roleOptions = [
    { value: TRACK_ROLES.INSTRUMENT, label: 'Instrument' },
    { value: TRACK_ROLES.LEAD, label: 'Lead' },
    ...choirRoleOptions,
    { value: TRACK_ROLES.OTHER, label: 'Other' },
  ];

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-lg max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-700 flex items-center justify-between">
          <h2 className="text-xl font-semibold">Import Audio Files</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors"
          >
            <X size={24} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-6">
          {/* Drop Zone */}
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
              isDragging
                ? 'border-blue-500 bg-blue-500 bg-opacity-10'
                : 'border-gray-600 hover:border-gray-500'
            }`}
          >
            <Download size={48} className="mx-auto mb-4 text-gray-500" />
            <p className="text-lg mb-2">Drag and drop audio files here</p>
            <p className="text-sm text-gray-400 mb-4">or</p>
            <label className="inline-block bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded cursor-pointer transition-colors">
              Choose Files
              <input
                type="file"
                multiple
                accept=".wav,.mp3,.flac,audio/wav,audio/mpeg,audio/flac"
                onChange={handleFileInput}
                className="hidden"
              />
            </label>
            <p className="text-xs text-gray-500 mt-4">Supported: WAV, MP3, FLAC</p>
          </div>

          {/* File List */}
          {files.length > 0 && (
            <div className="mt-6">
              <h3 className="text-sm font-semibold text-gray-400 mb-3">
                Files to Import ({files.length})
              </h3>
              <div className="space-y-2">
                {files.map((file) => (
                  <div
                    key={file.name}
                    className="bg-gray-900 rounded-lg p-4 flex items-center gap-4"
                  >
                    <FileAudio size={20} className="text-blue-500 flex-shrink-0" />
                    
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{file.name}</p>
                      <p className="text-xs text-gray-500">
                        {(file.size / 1024 / 1024).toFixed(2)} MB
                      </p>
                    </div>

                    <select
                      value={roles[file.name]}
                      onChange={(e) => updateRole(file.name, e.target.value)}
                      className="bg-gray-800 border border-gray-700 rounded px-3 py-1 text-sm focus:outline-none focus:border-blue-500"
                    >
                      {roleOptions.map(option => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>

                    <button
                      onClick={() => removeFile(file.name)}
                      className="text-red-500 hover:text-red-400 transition-colors flex-shrink-0"
                      title="Remove file"
                    >
                      <X size={20} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-700 flex items-center justify-between">
          <p className="text-sm text-gray-400">
            {files.length > 0
              ? `${files.length} file${files.length > 1 ? 's' : ''} ready to import`
              : 'No files selected'}
          </p>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded transition-colors"
              disabled={isProcessing}
            >
              Cancel
            </button>
            <button
              onClick={handleImport}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={files.length === 0 || isProcessing}
            >
              {isProcessing ? 'Importing...' : 'Import'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default FileImport;
