export function cleanContent(content: string): string {
  const boxChars = /[╭╮╰╯│─┌┐└┘├┤┬┴┼]/g

  const lines = content
    .split('\n')
    .map(line => line.replace(boxChars, '').trimEnd())

  // Remove leading empty lines
  while (lines.length > 0 && lines[0] === '') {
    lines.shift()
  }

  // Remove trailing empty lines
  while (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop()
  }

  return lines.join('\n')
}

export function matchesPattern(
  contentLines: string[],
  patternLines: string[],
): boolean {
  // Start from the bottom of both arrays
  let contentIndex = contentLines.length - 1
  let patternIndex = patternLines.length - 1

  while (patternIndex >= 0 && contentIndex >= 0) {
    // Skip empty lines in content
    while (contentIndex >= 0 && contentLines[contentIndex] === '') {
      contentIndex--
    }

    // If we've run out of content lines but still have pattern lines, no match
    if (contentIndex < 0) {
      return false
    }

    // Check if current lines match
    if (contentLines[contentIndex] !== patternLines[patternIndex]) {
      return false
    }

    // Move to next lines
    contentIndex--
    patternIndex--
  }

  // All pattern lines matched
  return patternIndex < 0
}
