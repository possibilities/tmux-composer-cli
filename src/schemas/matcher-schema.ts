import { z } from 'zod'

export const MatcherSchema = z.object({
  name: z.string(),
  trigger: z.array(z.string()),
  wrappedTrigger: z.array(z.string()).optional(),
  response: z.string(),
  runOnce: z.boolean(),
  mode: z.enum(['act', 'plan', 'all']),
})

export type Matcher = z.infer<typeof MatcherSchema>

export const MatchersArraySchema = z.array(MatcherSchema)

export function parseMatchers(data: unknown): Matcher[] {
  try {
    return MatchersArraySchema.parse(data)
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new Error(
        `Invalid matcher configuration:\n${error.errors
          .map(e => `  - ${e.path.join('.')}: ${e.message}`)
          .join('\n')}`,
      )
    }
    throw error
  }
}
