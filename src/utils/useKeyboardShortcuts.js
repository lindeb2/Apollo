import { useEffect } from 'react';

/**
 * Keyboard shortcuts hook
 * Handles global keyboard shortcuts for the editor
 */
function useKeyboardShortcuts({
  enabled = false,
  onPlayPause,
  onStop,
  onRecord,
  onUndo,
  onRedo,
  onToggleLoop,
  onDeleteTrack,
  onAddTrack,
}) {
  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e) => {
      // Ignore if typing in an input field
      if (
        e.target.tagName === 'INPUT' ||
        e.target.tagName === 'TEXTAREA' ||
        e.target.isContentEditable
      ) {
        return;
      }

      // Space - Play/Pause
      if (e.code === 'Space') {
        e.preventDefault();
        onPlayPause?.();
      }

      // R - Record
      if (e.code === 'KeyR' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        onRecord?.();
      }

      // C - Toggle Loop
      if (e.code === 'KeyC' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        onToggleLoop?.();
      }

      // Ctrl/Cmd + Z - Undo
      if (e.code === 'KeyZ' && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
        e.preventDefault();
        onUndo?.();
      }

      // Ctrl/Cmd + Y or Ctrl/Cmd + Shift + Z - Redo
      if (
        (e.code === 'KeyY' && (e.ctrlKey || e.metaKey)) ||
        (e.code === 'KeyZ' && (e.ctrlKey || e.metaKey) && e.shiftKey)
      ) {
        e.preventDefault();
        onRedo?.();
      }

      // Ctrl/Cmd + Backspace - Delete selected track
      if (e.code === 'Backspace' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        onDeleteTrack?.();
      }

      // N - Create new track (from selected track position)
      if (e.code === 'KeyN' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        onAddTrack?.();
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [enabled, onPlayPause, onStop, onRecord, onUndo, onRedo, onToggleLoop, onDeleteTrack, onAddTrack]);
}

export default useKeyboardShortcuts;
