# 🎵 ChoirMaster - LLM Development Guide

**Need to make changes with an LLM? Start here!**

---

## 🚀 Quick Start (Most Important!)

### Working in a Fresh Chat

**Instead of continuing this conversation (which gets expensive), do this:**

1. **Start a new chat** with your LLM (Claude, ChatGPT, etc.)

2. **Copy and paste this file:** [`LLM_CONTEXT.md`](LLM_CONTEXT.md)
   - This gives the LLM all essential context about ChoirMaster
   - ~400 lines of focused, technical information
   - Much cheaper than carrying 100k+ tokens of chat history

3. **Add your request** using templates from [`PROMPT_TEMPLATES.md`](PROMPT_TEMPLATES.md)

4. **Implement and test** the changes

**That's it!** You now have an LLM that understands your codebase without expensive token costs.

---

## 📚 Available Documentation

### For LLM Work (New Chats)

| File | Purpose | When to Use |
|------|---------|-------------|
| **[LLM_CONTEXT.md](LLM_CONTEXT.md)** ⭐ | Essential context for LLMs | **Start of EVERY new chat** |
| **[PROMPT_TEMPLATES.md](PROMPT_TEMPLATES.md)** | Ready-to-use prompt examples | When crafting requests |
| **[WORKING_WITH_LLMS.md](WORKING_WITH_LLMS.md)** | Workflow guide & best practices | First time using these docs |

### For Development Reference

| File | Purpose |
|------|---------|
| [README.md](../README.md) | User guide, installation, features |
| [IMPLEMENTATION.md](IMPLEMENTATION.md) | Detailed technical documentation |
| [SPEC_CHANGES.md](SPEC_CHANGES.md) | Tracks deviations (currently zero) |
| [PHASE_0-3_SUMMARY.md](choirmaster-app/) | Implementation details per phase |
| [MVP_DELIVERY.md](MVP_DELIVERY.md) | Final delivery summary |

---

## 💡 Example: Making a Change

### ❌ Expensive Way (Don't Do This)
```
Continue using this chat → Every message costs more
Context keeps growing → 100k+ tokens
Responses get slower → Paying for all that history
```

### ✅ Cost-Effective Way (Do This)
```
1. Start fresh chat
2. Paste LLM_CONTEXT.md
3. "I need to add [feature]. Please help."
4. Get code, implement, test
5. Done! ~3-5k tokens total
```

**Savings: 30-50x reduction in token costs**

---

## 📖 First Time Here?

Read in this order:

1. **[WORKING_WITH_LLMS.md](WORKING_WITH_LLMS.md)** - Understand the workflow (10 min read)
2. **[LLM_CONTEXT.md](LLM_CONTEXT.md)** - Skim to know what info is included
3. **[PROMPT_TEMPLATES.md](PROMPT_TEMPLATES.md)** - See example prompts

Then you're ready to start making changes efficiently!

---

## 🎯 Common Tasks

### "I want to add a new feature"
1. New chat
2. Paste `LLM_CONTEXT.md`
3. Use "Feature Addition" template from `PROMPT_TEMPLATES.md`

### "I found a bug"
1. New chat  
2. Paste `LLM_CONTEXT.md`
3. Use "Bug Fix" template from `PROMPT_TEMPLATES.md`

### "I want to understand how X works"
1. Check `IMPLEMENTATION.md` first
2. If still unclear, new chat + `LLM_CONTEXT.md`
3. Ask "Explain how [feature] works"

---

## ⚡ Pro Tips

- **Fresh chat per feature** - Cheaper and clearer
- **Always paste LLM_CONTEXT.md first** - LLM needs context
- **Test undo/redo after changes** - Easy to break
- **Verify persistence (refresh page)** - Must survive reload
- **Check console for errors** - Catch issues early

---

## 🔍 File Locations

All documentation is in the `choirmaster-app/` folder:

```
ChoirMaster/
├── MASTER SYSTEM PROMPT v1.0.md  (Original spec - don't modify)
└── choirmaster-app/
    ├── LLM_CONTEXT.md ⭐ (Paste this in new chats)
    ├── PROMPT_TEMPLATES.md
    ├── WORKING_WITH_LLMS.md
    ├── README.md
    ├── IMPLEMENTATION.md
    ├── SPEC_CHANGES.md
    ├── MVP_DELIVERY.md
    ├── PHASE_[0-3]_SUMMARY.md
    └── src/ (source code)
```

---

## 💬 Questions?

- **How do I work with LLMs efficiently?** → Read [`WORKING_WITH_LLMS.md`](WORKING_WITH_LLMS.md)
- **What should I paste in a new chat?** → [`LLM_CONTEXT.md`](LLM_CONTEXT.md)
- **How should I phrase my request?** → See [`PROMPT_TEMPLATES.md`](PROMPT_TEMPLATES.md)
- **What's the architecture?** → Check [`IMPLEMENTATION.md`](IMPLEMENTATION.md)
- **What's implemented?** → Read phase summaries: [`PHASE_0-3_SUMMARY.md`](choirmaster-app/)

---

## 🎵 Happy Coding!

You now have everything you need to efficiently work with LLMs on ChoirMaster.

**Remember:** Fresh chat + `LLM_CONTEXT.md` = Success! 🚀
