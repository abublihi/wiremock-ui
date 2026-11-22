import { createInterface } from 'node:readline/promises'
import { CliError, type Io } from './run'

/** Reads one line, echoing nothing (raw mode): Enter finishes, Backspace deletes, Ctrl+C cancels. */
function askHidden(question: string): Promise<string> {
  const input = process.stdin
  const output = process.stdout
  return new Promise((resolve, reject) => {
    output.write(question)
    let value: string[] = []
    const finish = (err?: Error) => {
      input.off('data', onData)
      input.setRawMode(false)
      input.pause()
      output.write('\n')
      if (err) reject(err)
      else resolve(value.join(''))
    }
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') return finish()
        if (ch === '\u0003') return finish(new CliError('Cancelled', 130))
        if (ch === '\u0004') return value.length === 0 ? finish(new CliError('Cancelled', 130)) : finish()
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1)
        else if (ch >= ' ') value.push(ch)
      }
    }
    input.setEncoding('utf8')
    input.setRawMode(true)
    input.on('data', onData)
    input.resume()
  })
}

async function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    return await rl.question(question)
  } finally {
    rl.close()
  }
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

/** The real terminal. */
export function terminalIo(): Io {
  return {
    out: (text) => process.stdout.write(`${text}\n`),
    err: (text) => process.stderr.write(`${text}\n`),
    interactive: Boolean(process.stdin.isTTY),
    ask,
    askHidden,
    readStdin,
  }
}
