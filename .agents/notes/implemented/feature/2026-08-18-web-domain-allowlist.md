# Agent Note: HTTP fetch domain allowlist

Status: implemented

English | [中文](2026-08-18-web-domain-allowlist.zh.md)

## Problem

The local HTTP fetch provider validated schemes, credentials, redirect origin, and response limits, but a deployment could not restrict its outbound requests to an approved set of domains.

## Decision

`web-fetch-http` accepts an optional `allowedDomains` configuration. Exact host entries allow one host; `*.example.com` entries allow subdomains but not the bare suffix. The list is normalized and validated at plugin load. The provider checks the initial URL before the first request and checks every redirect target after URL and same-origin validation. An omitted list keeps the provider unrestricted for existing deployments; an empty list denies every host.

## Alternatives considered

**Apply the list only to the model-facing tool.** Rejected: direct `ctx.web.fetch()` callers would bypass the restriction.

**Treat the list as SSRF protection.** Rejected: host matching does not resolve DNS or classify private addresses, so network isolation remains responsible for that boundary.

**Silently ignore malformed entries.** Rejected: an invalid policy must fail at load rather than create an accidental broad allowlist.

## Consequences

Deployments can express a narrow HTTP egress policy without changing provider code. The policy is applied consistently to direct requests and redirects, with `WEB_DOMAIN_BLOCKED` diagnostics. The feature is an allowlist, not a replacement for private-network or DNS-aware SSRF defenses.
