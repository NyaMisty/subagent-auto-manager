# Publishing

## Current Package

- npm package: `subagent-auto-manager`
- GitHub repository: `NyaMisty/subagent-auto-manager`
- Current published version: `0.1.9`

## Required Release Path

All future publishes must go through GitHub Actions trusted publishing. Do not run local `npm publish`.

The active workflow is:

```text
.github/workflows/publish.yml
```

It runs:

```sh
npm ci
npm test
npm publish --provenance --access public
```

The workflow has `id-token: write` permission and is trusted by npm for this package.

## Release Steps

1. Update the package version in `package.json` and `package-lock.json`.
2. Run local verification:

   ```sh
   npm test
   npm pack --dry-run
   ```

3. Commit and push to `main`.
4. Create a GitHub release for the new version, or manually dispatch the publish workflow.
5. Confirm the GitHub Actions publish run succeeds.
6. Confirm npm points to the new version:

   ```sh
   npm view subagent-auto-manager version dist-tags.latest bin --json
   ```

## CI Behavior

Normal pushes run `.github/workflows/ci.yml`.

The publish workflow intentionally skips direct push events and publishes only on `release.published` or `workflow_dispatch`, preventing accidental duplicate npm publishes.
