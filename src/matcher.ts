export function cleanContent(content: string): string {
  const boxChars = /[╭╮╰╯│─┌┐└┘├┤┬┴┼╼╾]/g

  let lines = content.split('\n').map(line => line.replace(boxChars, ' '))
  while (lines.length > 0 && lines[0] === '') {
    lines.shift()
  }

  while (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop()
  }

  let minIndent = Infinity
  let hasIndentedLines = false

  for (const line of lines) {
    if (line.length > 0 && line[0] === ' ') {
      hasIndentedLines = true
      const leadingSpaces = line.match(/^ */)?.[0].length || 0
      if (leadingSpaces > 0) {
        minIndent = Math.min(minIndent, leadingSpaces)
      }
    }
  }

  if (hasIndentedLines && minIndent > 0 && minIndent < Infinity) {
    lines = lines.map(line => {
      if (line.length > 0 && line.startsWith(' '.repeat(minIndent))) {
        return line.slice(minIndent)
      }
      return line
    })
  }

  lines = lines.map(line => line.trimEnd())

  return lines.join('\n')
}

export function matchesPattern(
  contentLines: string[],
  patternLines: string[],
): boolean {
  console.log('[DEBUG matchesPattern] Starting pattern matching')
  console.log(`[DEBUG matchesPattern] Content has ${contentLines.length} lines`)
  console.log(`[DEBUG matchesPattern] Pattern has ${patternLines.length} lines`)

  let contentIndex = contentLines.length - 1
  let patternIndex = patternLines.length - 1

  while (patternIndex >= 0 && contentIndex >= 0) {
    while (contentIndex >= 0 && contentLines[contentIndex] === '') {
      contentIndex--
    }

    if (contentIndex < 0) {
      console.log('[DEBUG matchesPattern] Ran out of content lines, no match')
      return false
    }

    const contentLine = contentLines[contentIndex]
    const patternLine = patternLines[patternIndex]
    const matches = contentLine.includes(patternLine)

    console.log(
      `[DEBUG matchesPattern] Checking pattern[${patternIndex}]="${patternLine}" against content[${contentIndex}]="${contentLine}" - matches: ${matches}`,
    )

    if (matches) {
      patternIndex--
      contentIndex--
    } else {
      contentIndex--
    }
  }

  const result = patternIndex < 0
  console.log(`[DEBUG matchesPattern] Final result: ${result}`)
  return result
}
