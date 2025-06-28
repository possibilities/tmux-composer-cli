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
  let contentIndex = contentLines.length - 1
  let patternIndex = patternLines.length - 1

  while (patternIndex >= 0 && contentIndex >= 0) {
    while (contentIndex >= 0 && contentLines[contentIndex] === '') {
      contentIndex--
    }

    if (contentIndex < 0) {
      return false
    }

    if (contentLines[contentIndex] === patternLines[patternIndex]) {
      patternIndex--
      contentIndex--
    } else {
      contentIndex--
    }
  }

  return patternIndex < 0
}
