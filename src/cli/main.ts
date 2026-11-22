// Entry of the `wiremock-ui` command (built to dist/cli/wiremock-ui.mjs; see vite.cli.config.ts).
// The server's JSON logs would only get in the way of the command's own messages: silent unless LOG_LEVEL is set.
process.env.LOG_LEVEL ??= 'silent'

const { run } = await import('./run')
const { terminalIo } = await import('./terminal')
process.exit(await run(process.argv.slice(2), process.env, terminalIo()))

export {}
