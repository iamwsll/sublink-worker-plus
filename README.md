<div align="center">
  <img src="public/favicon.png" alt="Sublink Worker Plus" width="120" height="120"/>

  <h1><b>Sublink Worker Plus</b></h1>
  <h5><i>One Worker, All Subscriptions — Now with an Admin Panel</i></h5>

  <p><b>An enhanced fork of <a href="https://github.com/7Sageer/sublink-worker">Sublink Worker</a>: the same lightweight subscription converter for Cloudflare Workers / Vercel / Node.js / Docker, plus a unified admin panel, rule templates, and a richer API.</b></p>

  <br>

<p style="display: flex; align-items: center; gap: 10px;">
  <a href="https://deploy.workers.cloudflare.com/?url=https://github.com/iamwsll/sublink-worker-plus">
    <img src="https://deploy.workers.cloudflare.com/button" alt="Deploy to Cloudflare Workers" style="height: 32px;"/>
  </a>
  <a href="https://vercel.com/new/clone?repository-url=https://github.com/iamwsll/sublink-worker-plus&env=KV_REST_API_URL,KV_REST_API_TOKEN,ADMIN_PASSWORD&envDescription=KV%20credentials%20for%20data%20storage%20and%20an%20optional%20admin%20password%20for%20%2Fadmin&envLink=https://vercel.com/docs/storage/vercel-kv">
    <img src="https://vercel.com/button" alt="Deploy to Vercel" style="height: 32px;"/>
  </a>
</p>

  <h3>📚 Documentation</h3>
  <p>
    <a href="https://app.sublink.works"><b>⚡ Live Demo</b></a> ·
    <a href="https://sublink.works/en/"><b>Documentation</b></a> 
    <a href="https://sublink.works"><b>中文文档</b></a>·
  </p>
  <p>
    <a href="https://sublink.works/guide/quick-start/">Quick Start</a> ·
    <a href="https://sublink.works/api/">API Reference</a> ·
    <a href="https://sublink.works/guide/faq/">FAQ</a>
  </p>
</div>

## 🚀 Quick Start

### One-Click Deployment
- Choose a "deploy" button above — both point at this repository
- **Cloudflare Workers**: the button clones the repo into your account, auto-provisions the KV namespace, and deploys via Workers Builds. To enable the admin panel, add `ADMIN_PASSWORD` as a secret afterwards ( Workers → Settings → Variables ), or pre-fill it via the `.dev.vars.example` prompt during setup
- **Vercel**: fill in `KV_REST_API_URL` / `KV_REST_API_TOKEN`, and optionally `ADMIN_PASSWORD`
- See the [Document](https://sublink.works/guide/quick-start/) for more information

### Alternative Runtimes
- **Node.js**: `npm run build:node && ADMIN_PASSWORD=your-password node dist/node-server.cjs`
- **Docker Compose**: `docker compose up -d --build` (builds from source, includes Redis; uncomment `ADMIN_PASSWORD` in `docker-compose.yml` to enable `/admin`)
- **Cloudflare (manual)**: `npm run deploy` — `setup-kv` creates/reuses the KV namespace and patches `wrangler.toml` automatically


## ➕ What's Plus

Everything upstream has, plus:

- **🛠️ Unified Admin Panel** (`/admin`) — change server-side defaults without a redeploy: default rule preset, global custom rule sets, policy-group defaults, remote Clash base config, and rule templates. One `ADMIN_PASSWORD` env var turns it on
- **📋 Rule Templates** — paste subconverter INI lines (`ruleset=` / `custom_proxy_group=`) and fully own the generated Clash rules and policy groups; switch templates per request with `?template=<id>`
- **🧩 Custom Rule Groups everywhere** — point any rule group at your own remote rule lists via `customRuleGroups`, on all four builder endpoints
- **🎛️ Policy-group defaults** — decide which option each selector starts on (e.g. Bilibili → DIRECT) with `group_defaults` or the admin panel
- **🌐 Remote Clash base config** — `clash_rule_base` merges any hosted Clash YAML as the base config, cached in KV with TTL/refresh controls
- **📡 UDP override** — `?udp=true|false` forces the udp flag across all Clash proxies

## ✨ Features

### Supported Protocols
ShadowSocks • VMess • VLESS • Hysteria2 • Trojan • TUIC

### Client Support
Sing-Box • Clash • Xray/V2Ray • Surge

### Input Support
- Base64 subscriptions
- HTTP/HTTPS subscriptions
- Full configs (Sing-Box JSON, Clash YAML, Surge INI)

### Core Capabilities
- Import subscriptions from multiple sources
- Generate fixed/random short links (KV-based)
- Light/Dark theme toggle
- Flexible API for script automation
- Multi-language support (Chinese, English, Persian, Russian)
- Web interface with predefined rule sets and customizable policy groups

## 🛠️ Admin Panel

Set the `ADMIN_PASSWORD` environment variable and open `/admin` — a unified web console for everything that used to require a redeploy (disabled entirely when the variable is unset). Sessions are HMAC-SHA256 signed HttpOnly cookies (7-day expiry). All settings persist in KV under `admin:config`, with an in-memory fallback when KV is unavailable.

| Section | What it controls |
|---|---|
| General | Default rule preset used when a request carries no `selectedRules` |
| Custom rule sets | Server-side rule groups (`name` + rule-list URLs + optional default option). They appear as extra options on the home page and can be referenced by `selectedRules` |
| Group defaults | Preferred default option per policy group (e.g. `Bilibili → DIRECT`) |
| Clash base config | Remote Clash YAML used as the `/clash` base config, with adjustable cache TTL |
| Rule templates | subconverter INI lines (`ruleset=` / `custom_proxy_group=`) that fully own the Clash rules/proxy-groups/rules output; one template can be marked as default |

### Rule Templates

A template is a named, toggleable bundle of subconverter external-config lines. When a template applies, `/clash` output is built from the template's ruleset and group definitions instead of the built-in rule engine, and `/subconverter` emits the template's INI verbatim (with `clash_rule_base` / `quanx_rule_base` appended).

- **Default template** applies to bare requests; an explicit `template=<id>` query parameter forces one
- Any per-request customization (`selectedRules`, `customRules`, `customRuleGroups`, `clash_rule_base`, `configId`) opts out of the default template
- `omittedGroups` drops named groups (and references to them) from the compiled output
- `fallbackClashConfig` is an optional embedded Clash config used when the template's `clashRuleBase` URL can't be fetched

## 🔌 API Extensions

All parameters compose with the existing query API and can be persisted through short links.

| Parameter | Endpoints | Description |
|---|---|---|
| `customRuleGroups` | /singbox /clash /surge /subconverter | JSON array `[{name, urls: []}]`; creates rule groups backed by remote rule lists, or overrides same-named built-ins |
| `group_defaults` | all builder endpoints | JSON object `{groupName: option}` moving the preferred option to the front of a selector |
| `udp` | /clash | `true`/`false` forces the udp flag on every proxy |
| `clash_rule_base` | /clash | Remote Clash YAML as base config (cached in KV/memory) |
| `clash_rule_base_ttl` | /clash | Cache seconds for the remote base (0 disables, max 86400) |
| `clash_rule_base_refresh` | /clash | `true` bypasses the cache once |
| `template` | /clash /subconverter | Apply an admin-defined rule template by id |

Admin REST API (session cookie required): `GET/PUT /admin/api/config`, `POST /admin/api/reset`, plus `POST /admin/api/login` and `POST /admin/api/logout`.

## ⚙️ Environment Variables

| Variable | Default | Description |
|---|---|---|
| `ADMIN_PASSWORD` | _(unset)_ | Enables `/admin` when set |
| `CLASH_RULE_BASE_CACHE_TTL_SECONDS` | `600` | Default cache TTL for remote Clash base configs |
| `CONFIG_TTL_SECONDS` | 30 days | TTL for stored base configs |
| `SHORT_LINK_TTL_SECONDS` | _(none)_ | TTL for short links |
| `REDIS_URL` or `REDIS_HOST`+`REDIS_PORT` | _(none)_ | Redis KV backend (Node/Docker) |
| `KV_REST_API_URL` + `KV_REST_API_TOKEN` | _(none)_ | Upstash/Vercel KV backend |
| `PORT` | | Node.js listen port |


## 🤝 Contributing

Issues and Pull Requests are welcome to improve this project.

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## ⚠️ Disclaimer

This project is for learning and exchange purposes only. Please do not use it for illegal purposes. All consequences resulting from the use of this project are solely the responsibility of the user and are not related to the developer.

## ⭐ Star History

Thanks to everyone who has starred this project! 🌟

<a href="https://star-history.com/#iamwsll/sublink-worker-plus&Date">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=iamwsll/sublink-worker-plus&type=Date&theme=dark" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=iamwsll/sublink-worker-plus&type=Date" />
   <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=iamwsll/sublink-worker-plus&type=Date" />
 </picture>
</a>
