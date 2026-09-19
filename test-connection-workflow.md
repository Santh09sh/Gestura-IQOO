# Workflow: Test phone-laptop connection

**Where this goes:** save as `.agents/workflows/test-connection.md` in your project root. Trigger it in Antigravity's agent chat with `/test-connection`.

---

Verify the phone and laptop can talk to each other before debugging anything else. Run through these checks in order; stop at the first failure and report it clearly rather than continuing.

1. Confirm both devices are on the same WiFi network — ask the user to verify this if it's not already stated.
2. Get the laptop's local IP address (`ipconfig` on Windows, look for the IPv4 address under the active WiFi adapter) and confirm the server code is configured to bind to it, not just `localhost`.
3. Start the laptop server and confirm it logs that it's listening.
4. From the phone (browser or app), hit the server's `/ping` endpoint and confirm a response comes back. If it times out, check: laptop firewall blocking the port, wrong IP address entered on the phone side, or the two devices actually being on different networks (common with guest WiFi that isolates devices).
5. Once `/ping` succeeds, send one real test payload (a saved landmark sequence, not a live capture) to `/recognize` and confirm a full response comes back with a label and confidence.
6. Log the result — success or the specific failure point — in `progress.md`, so this doesn't need re-diagnosing from scratch next session.
