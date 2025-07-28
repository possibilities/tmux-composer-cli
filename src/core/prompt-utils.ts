import * as readline from 'readline'

export async function confirmAction(prompt: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  const answer = await new Promise<string>(resolve => {
    rl.question(prompt, resolve)
  })

  rl.close()

  const normalizedAnswer = answer.toLowerCase().trim()
  return normalizedAnswer === 'y' || normalizedAnswer === 'yes'
}
