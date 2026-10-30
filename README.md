# BB Devin provider plugin

This plugin adds Devin as a BB provider by launching the local Devin CLI in
ACP mode (`devin acp`). BB's generic ACP bridge handles the session protocol,
streaming events, tools, and model discovery.

## Requirements

Install the Devin CLI on every host that should offer the provider, then
authenticate it:

```sh
devin auth login
```

The plugin does not store or forward Devin credentials; the CLI owns local
authentication.

## Remote hosts

When the BB server and a host daemon run on different machines, the server's
launch spec points at the server's Node binary and plugin checkout, which do
not exist on the host. The host bridge rewrites such specs to the host's own
Node binary and a copy of `lib/acp-stdio-shim.mjs` that it writes to
`$TMPDIR/bb-plugin-devin/`. After editing the shim, run
`npm run generate:shim` so the embedded copy in
`lib/acp-stdio-shim-source.ts` stays in sync (a test enforces this).

## Install locally

From this directory:

```sh
bb plugin install .
bb plugin reload devin
```

Select **Devin** in a new BB thread. If the provider is unavailable, verify
that `devin` is on the BB host's `PATH` and run `devin auth status`.

## Development

```sh
npm install
npm run typecheck
npm test
bb plugin build
```
