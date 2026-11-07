# Contributing to Insight Generator

Thanks for helping improve this browser-based CSV analysis tool.

## Getting started

1. Fork the repository and create a branch for your change.
2. Install Node.js 18 or newer, then run `npm install` and `npm run dev`.
3. Make a focused change. Do not upload confidential or personal CSV data in issues or examples.
4. Run `npm run build` before submitting a pull request.
5. Open a pull request describing what changed, why it matters, and how you tested it.

## Useful contributions

- Reproducible bug reports with a small synthetic CSV
- Data quality edge cases, especially financial data with legitimate negative values
- Accessibility and usability improvements
- Unit tests and better CSV parsing/error handling
- Documentation and translations

## Reporting a bug

Include browser version, reproduction steps, expected behavior, actual behavior, and a synthetic CSV sample. Never include private data.

## Development principles

This project runs in the browser without an external AI API. Do not describe its statistical/rules engine as an LLM. Avoid destructive cleaning defaults and explain transformations clearly.
