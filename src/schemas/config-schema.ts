import { z } from 'zod'

const AgentConfigSchema = z.union([
  z.string(),
  z.object({
    act: z.string().optional(),
    plan: z.string().optional(),
  }),
])

const ContextConfigSchema = z.union([
  z.string(),
  z.object({
    act: z.string().optional(),
    plan: z.string().optional(),
  }),
])

export const TmuxComposerConfigSchema = z.object({
  agents: AgentConfigSchema.optional(),
  context: ContextConfigSchema.optional(),
})

export type TmuxComposerConfig = z.infer<typeof TmuxComposerConfigSchema>

export function parseTmuxComposerConfig(data: unknown): TmuxComposerConfig {
  try {
    return TmuxComposerConfigSchema.parse(data)
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new Error(
        `Invalid tmux-composer.yaml configuration:\n${error.errors
          .map(e => `  - ${e.path.join('.')}: ${e.message}`)
          .join('\n')}`,
      )
    }
    throw error
  }
}
