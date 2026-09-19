# Workflow: Push to GitHub

**Where this goes:** save as `.agents/workflows/push-to-github.md` in your project root. Trigger it in Antigravity's agent chat with `/push-to-github`.

---

Commit and push current work. Requires the GitHub MCP server to be connected (see setup notes below if not).

1. Run the project's test/verification step first if one exists (check recognition against the reference vocabulary, per the core rules). Do not push code that fails this.
2. Review what's changed — summarize it in one or two sentences, not a generic "update files" message.
3. Confirm no secrets are staged: `.env`, any API tokens, and anything under `.tmp/` must not be committed. Check `.gitignore` covers these before committing, not after.
4. Commit with a clear, specific message describing what changed and why.
5. Push to the current branch.
6. Update `progress.md` with what was pushed and the commit reference.

**Never push directly if the last test run failed or wasn't re-run after the most recent change.** Flag this and ask before proceeding instead.
