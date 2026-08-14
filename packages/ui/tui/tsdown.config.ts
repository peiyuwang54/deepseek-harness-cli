import { defineConfig } from 'tsdown'
import baseConfig from '../../../tsdown.config.ts'

export default defineConfig({
  ...baseConfig,
  entry: ['lib/types/index.js', 'lib/types/invariant.js', 'lib/types/prompt.js'],
})
