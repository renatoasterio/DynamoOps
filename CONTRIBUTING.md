# Contributing to DynamoOps

Thanks for helping make DynamoOps better. Bug reports, ideas and pull requests are all welcome.

## Reporting a bug

Open an [issue](https://github.com/renatoasterio/DynamoOps/issues/new/choose) using the bug report template. Include:

- the DynamoOps version and your operating system,
- how you connect (AWS profile, Assume Role, AWS SSO or a local endpoint such as LocalStack),
- the steps to reproduce and the exact message you saw.

**Never paste AWS credentials, account IDs you consider sensitive or real table data.** Replace them with placeholders.

Security problems should not be reported in public issues. See [SECURITY.md](SECURITY.md).

## Suggesting a feature

Open an issue with the feature request template and describe the problem you want to solve before the solution you have in mind. That makes it easier to find the best fit for the app.

## Development setup

You need Node.js 18+, npm and Git.

```bash
git clone https://github.com/renatoasterio/DynamoOps.git
cd DynamoOps
npm install
npm run electron   # desktop app
npm run dev        # browser only, at http://localhost:3457
```

To try things without an AWS account, run LocalStack or DynamoDB Local and connect with a custom endpoint such as `http://localhost:4566`.

## Pull requests

`main` is protected: nobody pushes to it directly, and every change is merged through a pull request that the maintainer has reviewed and approved.

1. Fork the repository and create a branch from `main`.
2. Keep each pull request focused on one change.
3. Run the checks; both must pass:
   ```bash
   npm test
   npm run lint
   ```
4. Describe what changed and how you verified it. Add a screenshot for UI changes.

By contributing, you agree that your contribution is distributed under the project's [license](LICENSE).

## Code conventions

- **Errors:** controllers do not use try/catch. They throw (`badRequest`, AWS errors) and the central `errorHandler` maps the error to an HTTP response.
- **HTML safety:** every value interpolated into `innerHTML` or an attribute goes through `escapeHtml`. Data from DynamoDB is untrusted.
- **API calls:** table calls use `tableApi(...)` so they carry the active tab's connection and an encoded table name. Writes are measured with `trackedWrite(...)`.
- **Storage:** `localStorage` is only accessed through `public/js/utils/storage.js`, which never throws.
- **Code generators:** every user value goes through an encoder from `public/js/codegen/expressions.js`. A new language is a new module in `public/js/codegen/languages/`, registered in `public/js/codegen/index.js`.
- **Local API:** the server only listens on `127.0.0.1` and must keep the Host/Origin checks in `src/backend/middleware/security.js`.
