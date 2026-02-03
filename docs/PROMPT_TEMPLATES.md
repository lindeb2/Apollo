# ChoirMaster - Prompt Templates for Development

Quick copy-paste prompts for common development tasks. Always start by pasting `LLM_CONTEXT.md` into your chat first.

---

## 🚀 Starting a New Chat

**Template:**
```
[Paste entire LLM_CONTEXT.md here]

I need help with ChoirMaster (context above). [Your specific request]
```

**Example:**
```
[Paste LLM_CONTEXT.md]

I need help with ChoirMaster (context above). I want to add a 
"duplicate track" feature that copies all clips to a new track.
```

---

## 🐛 Bug Fix Prompts

### General Bug
```
In ChoirMaster, I'm experiencing this bug: [describe behavior]

Expected: [what should happen]
Actual: [what actually happens]

I suspect the issue is in [file/component name]. Please help debug.
```

### Playback Issue
```
ChoirMaster playback issue: [describe problem]

- Happens when: [specific conditions]
- Affects: [which tracks/clips]
- Console errors: [paste errors if any]

Please check src/lib/audioManager.js playback scheduling.
```

### UI Bug
```
UI bug in [component name]: [describe issue]

Steps to reproduce:
1. [step 1]
2. [step 2]
3. [step 3]

Please check src/components/[Component].jsx and fix.
```

---

## ✨ Feature Addition Prompts

### New Track Feature
```
Add a new track property called [property name] that [description].

Requirements:
- Store in project data model
- Display in TrackList UI
- Persist across sessions
- Include in undo/redo

Please update:
1. src/types/project.js (data model)
2. src/components/TrackList.jsx (UI)
3. src/store/useStore.js (if needed)
```

### New Export Preset
```
Add a new export preset called "[Preset Name]" that:
- [requirement 1]
- [requirement 2]
- [requirement 3]

Gain adjustments:
- [Track type]: [+/- X dB]

Follow the pattern in src/lib/exportEngine.js and add UI in 
src/components/ExportDialog.jsx.
```

### New Keyboard Shortcut
```
Add keyboard shortcut [key combination] that [action].

Should work in: [component/global]
Should not trigger when: [typing in inputs]

Update src/utils/useKeyboardShortcuts.js and add handler in 
src/components/Editor.jsx.
```

### New UI Component
```
Create a new component called [ComponentName] that [description].

Features needed:
- [feature 1]
- [feature 2]
- [feature 3]

Should integrate with: [parent component]
Styling: Use Tailwind CSS (match existing components)

Create as src/components/[ComponentName].jsx
```

---

## 🔧 Modification Prompts

### Change Existing Behavior
```
Currently, [feature] works like [current behavior].

I want to change it to [new behavior].

Affected files: [list files if known]
Constraints: [any limitations]

Please implement this change and explain what you modified.
```

### Improve Performance
```
The [feature/component] is slow when [condition].

Profiling shows: [any measurements]

Please optimize [specific area] while maintaining functionality.
Constraints: Don't break undo/redo or persistence.
```

### Change UI/UX
```
Improve the UX of [component/feature]:

Current: [current state]
Desired: [desired state]

Keep existing functionality, just improve the interface.
File: src/components/[Component].jsx
```

---

## 📚 Documentation Prompts

### Understand Code
```
Explain how [feature/function] works in [file].

Specifically:
- What does it do?
- When is it called?
- What are the inputs/outputs?
- Are there any edge cases?
```

### Code Review
```
Review this code change for ChoirMaster:

[paste code]

Check for:
- Zustand pattern compliance
- Time unit consistency (ms vs seconds)
- Undo/redo compatibility
- Autosave triggers
- Potential bugs
```

---

## 🧪 Testing Prompts

### Create Tests
```
Write unit tests for [function/component] in ChoirMaster.

Test file should be: src/__tests__/[name].test.js
Use Vitest framework (already configured)

Cover:
- [scenario 1]
- [scenario 2]
- Edge cases

Follow pattern from src/__tests__/audio.test.js
```

### Test Strategy
```
I changed [feature/component]. What should I test to ensure:
- Undo/redo still works
- Persistence still works
- No regressions in [related feature]

Please provide a testing checklist.
```

---

## 🔍 Debugging Prompts

### Find the Cause
```
This error occurs: [error message]

Happens when: [steps to reproduce]

Stack trace:
[paste if available]

Please identify the root cause and suggest a fix.
```

### Compare Expected vs Actual
```
Feature: [feature name]

Expected behavior:
[describe what should happen]

Actual behavior:
[describe what actually happens]

Relevant code: src/[file].js lines [X-Y]

Why is this happening?
```

---

## 🎨 Styling Prompts

### Match Existing Style
```
I added a new [component/feature] but the styling doesn't match.

Component: src/components/[Name].jsx

Please update the Tailwind classes to match the style of 
[existing similar component].

Keep: Dark theme, consistent spacing, existing color scheme.
```

### Responsive Design
```
The [component] doesn't work well on [screen size].

Current issue: [describe problem]

Please make it responsive using Tailwind breakpoints (sm:, md:, lg:).
```

---

## ⚡ Quick Fixes

### Fix TypeScript/ESLint Error
```
Getting this error:
[paste error]

In file: src/[file].js
Line: [number]

Please fix while maintaining functionality.
```

### Update Dependency
```
Need to update [package name] from [old version] to [new version].

Reason: [security/feature/bug fix]

Please check for breaking changes and update code if needed.
Files likely affected: [list if known]
```

---

## 🎯 Specific Domain Prompts

### Audio Processing
```
Need to modify audio processing in [context]:

Requirement: [what you need]

Constraints:
- Must maintain 44.1 kHz sample rate
- Must work with Web Audio API
- Should not break existing playback

File: src/lib/audioManager.js
```

### Export Logic
```
Modify export preset [number] to [change]:

Current behavior: [describe]
Desired behavior: [describe]

Must follow exact gain/pan calculations per spec.
File: src/lib/exportEngine.js
```

### Timeline Behavior
```
Change timeline [feature] behavior:

Current: [behavior]
Wanted: [behavior]

Should work with:
- Zoom levels
- Multiple clips
- Undo/redo

File: src/components/Timeline.jsx
```

---

## 📋 Checklists

### Before Submitting Prompt
- [ ] Pasted LLM_CONTEXT.md at start of chat
- [ ] Described current behavior clearly
- [ ] Described desired behavior clearly
- [ ] Mentioned relevant files if known
- [ ] Listed any constraints
- [ ] Included error messages if applicable

### After Receiving Code
- [ ] Read and understand the changes
- [ ] Test undo/redo
- [ ] Test persistence (refresh page)
- [ ] Check console for errors
- [ ] Verify autosave triggers
- [ ] Test related features for regressions

---

## 💡 Tips for Better Prompts

### ✅ DO
- Be specific about what file/component
- Describe both current and desired behavior
- Mention constraints upfront
- Provide error messages verbatim
- Ask for explanation of changes
- Request testing guidance

### ❌ DON'T
- Say "make it better" without specifics
- Request features that violate architecture (cloud sync, MP3 export)
- Ask to rewrite entire files unless necessary
- Ignore constraints from LLM_CONTEXT.md
- Forget to test undo/redo after changes

---

## Example: Complete Workflow

### 1. Start Chat
```
[Paste entire LLM_CONTEXT.md]

I need help with ChoirMaster (context above).
```

### 2. Request Feature
```
Add a "mute all" button in the Editor header that mutes all tracks at once.

Requirements:
- Button should be next to master volume
- Icon: VolumeX from lucide-react
- Clicking toggles all track mutes on/off
- Should update via store action (not direct mutation)
- Include in undo/redo

Files to modify:
- src/components/Editor.jsx (add button)
- src/store/useStore.js (add action if needed)
```

### 3. Review Response
[LLM provides code]

### 4. Ask Clarifications
```
Thanks! A few questions:

1. Should this button be disabled when no tracks exist?
2. What should the tooltip say?
3. Does this trigger autosave properly?
```

### 5. Request Tests
```
What should I test to ensure this doesn't break:
- Individual track mute buttons
- Solo functionality
- Undo/redo
```

---

## Common Gotchas - Quick Reference

**Time units:** ms in storage, seconds in Web Audio  
**State updates:** Always via store actions  
**Sample rate:** Always 44.1 kHz  
**Undo/redo:** Auto-handled by store  
**Autosave:** Auto-triggered by updateProject()  
**Blobs:** Immutable in IndexedDB  
**Audio cache:** Check before loading  

---

**Use this file** as a reference for crafting effective prompts. Always start with `LLM_CONTEXT.md` to give the LLM necessary background.
