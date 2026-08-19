# Browser validation with Playwright MCP

English | [中文](README.zh.md)

This **default-off reference configuration** connects the official [Playwright MCP server](https://github.com/microsoft/playwright-mcp) to DSH through [`@deepseek-ai/dsh-mcp-client`](../../packages/mcp/mcp-client/README.md). It gives the agent browser navigation, accessibility snapshots, form and pointer interaction, console inspection, network inspection, and screenshots without adding browser behavior to `agent-loop`.

This third-party configuration is an interoperability example only. Its inclusion does not imply endorsement, partnership, or ongoing support by DeepSeek.

## Install and enable

Install the tested server version and its browser before starting DSH:

```sh
npm install --global @playwright/mcp@0.0.79
playwright-mcp install-browser
dsh tui --patch "$PWD/examples/mcp-browser/playwright.cordis.yml"
```

The overlay is never loaded by a shipped profile unless `--patch` names it. It launches the preinstalled `playwright-mcp` executable instead of downloading a package during plugin startup.

The same server can be kept in the managed MCP catalog instead of using an overlay:

```sh
deepseek mcp add playwright -- playwright-mcp --headless --isolated --block-service-workers --image-responses omit --allowed-origins 'http://localhost:*;http://127.0.0.1:*'
deepseek doctor
deepseek
```

Use either the overlay or the managed entry, not both, because both publish the `playwright` server name. Managed MCP changes take effect after restarting the profile.

## Default safety posture

The example runs headless, uses an in-memory browser profile, blocks Service Workers, omits inline image responses, retains Playwright's workspace file restrictions, and admits direct HTTP requests only to `localhost` and `127.0.0.1` on any port. Automatically named snapshots and screenshots are written under `.playwright-mcp` in the DSH working directory; an explicit relative filename instead resolves from the working directory.

Playwright states that `--allowed-origins` is not a security boundary and does not restrict redirects. The DSH MCP trust policy decides whether the model may call this server's tools, but the stdio server and browser execute as trusted local processes outside the agent filesystem and command sandbox. Page content is untrusted input: do not expose credentials to a page or approve sensitive actions merely because page text requests them. The example does not pass `--no-sandbox`, `--allow-unrestricted-file-access`, a persistent user-data directory, stored browser state, secrets, or permission grants.

Copy the overlay before allowing remote origins, a persistent signed-in profile, headed browsing, device permissions, or unrestricted file access. Review the resulting Playwright arguments and the sites the browser can reach.

## Validate a local workflow

Start the application under test on `localhost` or `127.0.0.1`, wait for `/mcp tools playwright` to list `mcp__playwright__browser_navigate`, and ask:

> Open `http://127.0.0.1:3000`. Use the accessibility snapshot to complete the primary workflow, verify the resulting page state, report console errors and failed network requests, then take a final screenshot with the default generated filename and report its path.

Change the URL and success condition for the application. Require evidence from page state, console output, or network responses instead of accepting a model assertion. The example omits inline screenshot data, so inspect the saved file directly when visual evidence matters.

## Operational notes

Playwright owns browser installation, browser-process lifecycle, navigation, cookies, storage, downloads, screenshots, and its output directory. DSH owns MCP discovery, server-qualified tool names, permission admission, reconnects, and shutdown of the stdio child. Initial discovery is asynchronous; after a crash, the generic bridge reconnects within its configured attempt budget, and `/mcp reload playwright` requests an immediate replacement while agents are idle.

The complete Playwright tool catalog increases every model request while the server is active. Disable or remove the managed entry, or omit the overlay, when browser validation is not needed.
