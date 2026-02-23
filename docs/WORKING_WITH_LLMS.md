# Working with LLMs on Apollo

This guide explains how to efficiently work with LLMs (like Claude, ChatGPT, etc.) when making changes to Apollo in **new chat sessions** without accumulating large token costs.

---

## 📋 TL;DR - Quick Start

1. **Start new chat** (don't reuse this one - expensive!)
2. **Paste `LLM_CONTEXT.md`** (gives LLM all essential context)
3. **Make your request** using prompts from `PROMPT_TEMPLATES.md`
4. **Implement changes** and test
5. **Repeat** for next feature/fix (start fresh chat each time)

---

## 📂 Important Files for LLM Work

### `LLM_CONTEXT.md` ⭐ **MOST IMPORTANT**
**What:** Complete technical context about Apollo  
**When:** Paste this at the START of EVERY new chat  
**Why:** Gives LLM architecture, patterns, constraints, file locations  
**Size:** ~400 lines - designed to be comprehensive but concise  

### `PROMPT_TEMPLATES.md`
**What:** Ready-to-use prompt templates for common tasks  
**When:** Reference when crafting your request  
**Why:** Shows effective ways to ask for specific changes  
**Size:** ~300 lines - categorized by task type  

### `IMPLEMENTATION.md`
**What:** Detailed technical documentation  
**When:** For deep dives or complex changes  
**Why:** More detailed than LLM_CONTEXT.md  
**Note:** Usually not needed for simple tasks  

### `PHASE_[0-3]_SUMMARY.md`
**What:** Feature implementation details per phase  
**When:** Understanding how specific features work  
**Why:** Shows what's implemented and how  

---

## 🎯 Recommended Workflow

### Option 1: Simple Changes (Recommended)

**Best for:** Bug fixes, small features, UI tweaks

```
Step 1: Start fresh chat
Step 2: Paste LLM_CONTEXT.md
Step 3: Add your specific request
Step 4: Implement the code changes
Step 5: Test thoroughly
```

**Example chat:**
```
[Paste entire LLM_CONTEXT.md]

I'm working on Apollo (context above). 

I need to add a "duplicate track" button in the TrackList component 
that creates a copy of the selected track with all its clips. The 
button should appear next to the mute/solo buttons.

Please provide the code changes needed.
```

**Why this works:**
- LLM has ALL necessary context from one document
- No need to explain architecture or patterns
- Can immediately write correct code
- Fresh chat = low token cost

---

### Option 2: Complex Changes

**Best for:** Major features, architectural changes, debugging complex issues

```
Step 1: Start fresh chat
Step 2: Paste LLM_CONTEXT.md
Step 3: Paste relevant section from IMPLEMENTATION.md (if needed)
Step 4: Explain your requirement in detail
Step 5: Iterate with follow-up questions
Step 6: Implement when design is clear
```

**Example chat:**
```
[Paste LLM_CONTEXT.md]

I'm working on Apollo. I need to add a "loop region" playback 
feature where users can:
1. Select a region on the timeline
2. Toggle loop mode
3. Playback repeats the selected region

This will require changes to:
- Timeline UI (region selection)
- Audio manager (loop scheduling)
- Store (loop state)
- Transport controls (loop toggle)

Please outline the implementation approach first, then we'll tackle 
each component.
```

---

### Option 3: Multiple Related Changes

**Best for:** Feature sets, refactoring, coordinated updates

```
Step 1: Start fresh chat with LLM_CONTEXT.md
Step 2: List all related changes needed
Step 3: Get implementation order recommendation
Step 4: Tackle one change at a time in same chat
Step 5: Test after each change
```

**Keep same chat when:**
- Changes are tightly coupled
- Need context from previous changes
- Working on one coherent feature

**Start fresh chat when:**
- Moving to different feature
- Chat gets too long (>50 messages)
- Need clean context

---

## 💰 Token Cost Management

### Why Fresh Chats Matter

**This chat (the one you're in now):**
- 100,000+ tokens of context
- Every message costs more
- LLM has to process entire history

**Fresh chat with LLM_CONTEXT.md:**
- ~3,000 tokens of context
- Much cheaper per message
- LLM has focused, relevant context only

### Cost Comparison Example

| Scenario | Context Tokens | Cost per Message |
|----------|----------------|------------------|
| Continue this chat | ~110,000 | 💰💰💰💰💰 |
| Fresh chat (no context) | ~500 | 💰 (but ineffective) |
| Fresh chat + LLM_CONTEXT.md | ~3,500 | 💰💰 (optimal) |

**Savings:** Using fresh chats can reduce costs by **30-50x** compared to continuing this conversation.

---

## ✅ Best Practices

### DO ✅

1. **Start fresh chat for each major task/feature**
2. **Always paste LLM_CONTEXT.md first**
3. **Be specific about files and behavior**
4. **Use PROMPT_TEMPLATES.md for guidance**
5. **Test undo/redo after every change**
6. **Verify persistence (refresh browser)**
7. **Check console for errors**
8. **Ask LLM to explain complex changes**

### DON'T ❌

1. **Don't continue this chat for new features** (too expensive)
2. **Don't forget to paste LLM_CONTEXT.md** (LLM will be lost)
3. **Don't request features that violate constraints** (cloud sync, MP3 export, etc.)
4. **Don't make large changes without understanding them**
5. **Don't skip testing undo/redo**
6. **Don't ignore autosave triggers**
7. **Don't mix milliseconds and seconds** (huge bug source!)

---

## 🎓 Learning from LLM Responses

### When LLM Provides Code

**Before implementing:**
1. Read the code carefully
2. Understand what it does
3. Check if it follows Apollo patterns
4. Verify it uses store actions (not direct mutation)
5. Confirm time units are correct (ms vs seconds)

**After implementing:**
1. Test the feature manually
2. Test undo/redo
3. Refresh page (test persistence)
4. Check DevTools console for errors
5. Verify autosave triggered (check IndexedDB)

### Ask Follow-Up Questions

```
Good follow-ups:
- "Why did you use [pattern X] instead of [pattern Y]?"
- "What should I test to ensure this doesn't break [feature]?"
- "Are there edge cases I should handle?"
- "Does this maintain undo/redo compatibility?"
```

---

## 🐛 Debugging with LLMs

### When Something Breaks

**Instead of pasting error in this chat:**

1. Start fresh chat
2. Paste LLM_CONTEXT.md
3. Describe the bug clearly:
   ```
   Bug: [describe what's wrong]
   Expected: [what should happen]
   Actual: [what actually happens]
   Error: [paste error message]
   Steps: [how to reproduce]
   Suspected file: [if known]
   ```

4. LLM will debug with full context but fresh state

---

## 📊 When to Start Fresh vs Continue

### Start Fresh Chat When:
- ✅ Moving to new feature/bug
- ✅ Chat has >30 messages
- ✅ Working on different part of codebase
- ✅ Need clean context
- ✅ Previous task is complete

### Continue Same Chat When:
- ✅ Making related changes
- ✅ Iterating on same feature
- ✅ Chat is still short (<15 messages)
- ✅ Context from previous messages is needed
- ✅ Following up on clarifications

**Rule of thumb:** When in doubt, start fresh. It's cheaper and clearer.

---

## 🔄 Workflow Example

### Scenario: Adding 3 New Features

**Bad approach (expensive):**
```
Continue this chat
Add feature 1 → 15 messages
Add feature 2 → 20 messages  
Add feature 3 → 18 messages
Total: 53 messages × huge context = 💰💰💰💰💰
```

**Good approach (cost-effective):**
```
Chat 1: LLM_CONTEXT.md + Feature 1 → 5 messages
Chat 2: LLM_CONTEXT.md + Feature 2 → 7 messages
Chat 3: LLM_CONTEXT.md + Feature 3 → 6 messages
Total: 18 messages × small context = 💰💰
```

**Savings:** ~70% reduction in costs

---

## 📝 Maintaining LLM_CONTEXT.md

### When You Make Significant Changes

**If you add:**
- New core library
- New major feature
- Change architecture pattern
- Add new file structure

**Then update `LLM_CONTEXT.md`:**
1. Add to "Critical File Map"
2. Update architecture if changed
3. Add new patterns to "Common Patterns"
4. Document new constraints

**Keep it concise:** Don't make it too long, or it defeats the purpose.

### Version Control

Consider versioning LLM_CONTEXT.md:
```
LLM_CONTEXT.md v1.0 - MVP delivery
LLM_CONTEXT.md v1.1 - After adding loop feature
LLM_CONTEXT.md v1.2 - After major refactor
```

---

## 🎯 Pro Tips

### 1. Use Specific File Paths
**Good:** "In `src/components/Timeline.jsx`, modify the zoom function..."  
**Bad:** "Make the timeline zoom better"

### 2. Reference Existing Patterns
**Good:** "Follow the same pattern as `updateTrack()` in the store"  
**Bad:** "Add a new function"

### 3. Specify Constraints
**Good:** "Add this feature without breaking undo/redo or changing the data model"  
**Bad:** "Add this feature"

### 4. Request Testing Guidance
**Good:** "What should I test to ensure this is correct?"  
**Bad:** [assumes it works without testing]

### 5. Iterate Incrementally
**Good:** Implement one component, test, then move to next  
**Bad:** Implement everything at once and debug chaos

---

## 📚 Quick Reference

| Task | Document to Use |
|------|----------------|
| Start new chat | `LLM_CONTEXT.md` (always first!) |
| Get prompt ideas | `PROMPT_TEMPLATES.md` |
| Deep technical dive | `IMPLEMENTATION.md` |
| Understand features | `PHASE_[0-3]_SUMMARY.md` |
| Check compliance | `SPEC_CHANGES.md` |
| User guide | `README.md` |

---

## ⚡ Quick Start Checklist

Starting work on a new feature/fix:

- [ ] Start fresh chat (don't continue this one)
- [ ] Paste entire `LLM_CONTEXT.md`
- [ ] Describe what you need clearly
- [ ] Reference specific files if known
- [ ] Mention constraints (undo/redo, persistence, etc.)
- [ ] Implement the changes
- [ ] Test thoroughly
- [ ] Verify undo/redo works
- [ ] Refresh page to test persistence
- [ ] Check console for errors

---

## 💡 Final Advice

**Think of `LLM_CONTEXT.md` as your "onboarding document" for any LLM.** 

Instead of spending 20 messages explaining the architecture, you give it upfront in one paste. This:
- Saves tokens
- Saves time  
- Gets better results
- Maintains consistency

**Every new feature = fresh chat + LLM_CONTEXT.md**

That's the formula for cost-effective, high-quality LLM assistance on Apollo.

---

**Questions?** Check `PROMPT_TEMPLATES.md` for examples of effective prompts.

**Good luck building awesome features! 🎵**
