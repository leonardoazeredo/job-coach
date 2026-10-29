// Reads the rules the scripts run on from the two files that hold them: the engine
// defaults in config/rules.yaml, which upstream merges can change, and the user's
// own thresholds and search in profile/search.yaml, which upstream merges should not touch. Callers see
// one Rules; a problem names the file it came from.
import { join } from 'node:path'
import type { Problem } from './problem.ts'
import { fileProblem, readFile, yaml } from './read-file.ts'
import { EngineRulesSchema, type Rules, SearchSchema } from './schema.ts'

export const ENGINE_RULES = 'config/rules.yaml'
export const SEARCH_PROFILE = 'profile/search.yaml'

export const loadRules = (root: string): { rules: Rules | undefined; problems: Problem[] } => {
  const engine = readFile(join(root, ENGINE_RULES), yaml(EngineRulesSchema))
  const search = readFile(join(root, SEARCH_PROFILE), yaml(SearchSchema))
  const problems = [...fileProblem(ENGINE_RULES, engine), ...fileProblem(SEARCH_PROFILE, search)]
  if (!(engine.data && search.data)) return { rules: undefined, problems }
  return { rules: mergeRules(engine.data, search.data), problems }
}

// fit and discovery each have keys in both files. location_rule is prose for the skills and
// is read from profile/search.yaml, so it is not part of Rules.
const mergeRules = (
  engine: ReturnType<typeof EngineRulesSchema.parse>,
  search: ReturnType<typeof SearchSchema.parse>,
): Rules => ({
  ...engine,
  tiers: search.tiers,
  fit: { ...engine.fit, ...search.fit },
  discovery: { ...engine.discovery, ...search.discovery },
})
