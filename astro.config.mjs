import { defineConfig } from 'astro/config'
import tailwind from '@astrojs/tailwind'

// https://astro.build/config
export default defineConfig({
  site: 'https://tylerhervey.com',
  integrations: [tailwind()],
  output: 'static',
})
