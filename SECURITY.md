# Security policy

DynamoOps runs a local API that acts with your AWS credentials, so security reports are taken seriously.

## Supported versions

Only the [latest release](https://github.com/renatoasterio/DynamoOps/releases/latest) receives security fixes.

## Reporting a vulnerability

Please **do not open a public issue**. Report it privately through
[GitHub's private vulnerability reporting](https://github.com/renatoasterio/DynamoOps/security/advisories/new).

Include a description of the problem, the steps to reproduce it, the affected version and the impact you expect. You will get an acknowledgement as soon as possible, and a fix will be released before the details are made public.

## Scope

Examples of what is in scope:

- ways for a website, another local process or another machine to reach the local API (`127.0.0.1:3457`) or act with the user's credentials,
- script injection through data read from DynamoDB,
- escaping the Electron sandbox or navigating the app window to external content.

Problems in AWS itself or in third-party dependencies should be reported to their maintainers. If a dependency issue affects DynamoOps in a specific way, you are welcome to report that here.
