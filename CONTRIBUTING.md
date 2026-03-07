# Contributing to DRT Frontend

Thank you for your interest in contributing! This document outlines the rules and guidelines for contributing to the DRT Frontend.

## Getting Started

1. Fork the repository
2. Clone your fork locally
3. Install dependencies with `npm install`
4. Create a new branch for your work (`git checkout -b feature/your-feature`)
5. Run `npm run dev` to start the development environment
6. Make your changes
7. Test thoroughly before submitting

## Rules

- When contributing to this project, you must agree that you have the necessary rights to the content and that the content is being owned by the project's creator and can be used in any way.
- AI usage and code is acceptable, but proof that you understand the changepoints and have thourghly tested it must be given.

### Cryptography

- **Never** transmit passwords or private keys to the server
- All identity operations must go through `crypto.js` — do not implement crypto logic inline
- Use the existing libsodium wrappers — do not add alternative crypto libraries
- Test key generation, signing, and encryption changes thoroughly
- Recovery key format must remain compatible (`DRT-XXXXX-...` Crockford Base32)

### Commits

- Write clear, descriptive commit messages
- Reference issue numbers where applicable (e.g., `Fix #42`)

### Pull Requests

- Provide a clear description of what the PR does and why
- Keep PRs focused — avoid combining unrelated changes
- Ensure no new errors or warnings are introduced
- Update the README if your change affects setup or component structure
- Test your changes against the backend server before submitting
- Verify the Electron build works (`npm run build` then `npm run electron`)

### Styling

- Use the existing CSS file per component pattern — no CSS-in-JS
- Follow the existing naming conventions for CSS classes
- Ensure UI changes are responsive within the Electron window
- Match the existing Discord-like visual style

### Security

- **Never** commit secrets, API keys, or private keys
- Do not weaken or bypass the identity/authentication system without discussion
- Report security vulnerabilities privately rather than in public issues
- The TOFU certificate trust model must not be bypassed silently

### Dependencies

- Minimize new dependencies — the bundle runs inside Electron so size matters
- Justify any new dependency in your PR description
- Check for known vulnerabilities before adding packages
- Prefer packages that work in both browser and Electron contexts

## Reporting Issues

- Use the issue tracker to report bugs or request features
- Include steps to reproduce for bug reports
- Include your Electron version, Node.js version, and OS
- Screenshots are helpful for UI issues

## License

By contributing, you agree that your contributions will be licensed under the license associated with this project (see [LICENSE](LICENSE) for details).
