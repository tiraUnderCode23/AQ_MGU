# Contributing

Issues and pull requests are welcome for the released apps and components in
this repository. Keep unreleased apps, proprietary BMW material, vehicle
identifiers, private captures, credentials, and generated distributions out
of the repository.

Before opening a pull request, run:

```sh
npm test
```

Run the additional tests documented by every app or component you change.
Changes to an app or the shared kit require `npm run build:apps`. Changes to
a native component require its documented build command. Commit updated
audited artifact metadata with the source change.
