[English](README.md) | [中文](Chinese.md) | [فارسی](Persian.md) | [Русский](Russian.md)

# Wikiless

![hidden_dimension](https://github.com/user-attachments/assets/4093053d-a7c4-45aa-8860-ea0f64a841e9)


**Wikiless** is a free, open-source alternative Wikipedia front-end focused on privacy. The project aims to provide users with a more private and anonymous browsing experience by minimizing data collection and tracking.

### Features
- **Privacy-Focused:** Designed to enhance user privacy by limiting data tracking.
- **Open Source:** Available for anyone to contribute and improve.
- **Alternative Front-End:** Provides a different interface to access Wikipedia content.
- **Censorship-Resistant:** Provides another way to access Wikipedia in multiple blocked countries, Browse Wikipedia without VPN or socks.

## Installation

To run Wikiless, follow these steps:

```
https://github.com/tiekoetter/Wikiless/wiki
```

# Usage

Visit ```http://localhost:8180``` in your web browser to use Wikiless locally.

## Proxy configuration

`TRUST_PROXY` configures an inbound reverse proxy such as nginx or Caddy. It is
enabled by default for compatibility and trusts only `127.0.0.1` unless
`TRUST_PROXY_ADDRESS` is set. Configure that address to match the immediate
reverse-proxy hop so Express can identify each visitor correctly for local rate
limiting. Set `TRUST_PROXY=false` when Wikiless is exposed directly.

`WIKILESS_HTTP_PROXY` configures the outbound forward proxy used when Wikiless
fetches pages and media from Wikimedia. It does not affect visitor IP detection
or Wikiless's local rate limiter.

Example for an nginx deployment using an outbound rotating proxy:

```env
TRUST_PROXY=true
TRUST_PROXY_ADDRESS=127.0.0.1
WIKILESS_HTTP_PROXY=http://proxy.example:3128
WIKILESS_CONTACT_EMAIL=maintainer@example.com
```

# Contributing

Contributions are welcome! 

# License

This project is licensed under the GNU Affero General Public License v3.0.
