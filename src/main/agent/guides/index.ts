import core from './core.md?raw'
import schema from './schema.md?raw'
import webApp from './web-app.md?raw'
import landingPage from './landing-page.md?raw'
import mobileApp from './mobile-app.md?raw'
import slides from './slides.md?raw'
import dashboard from './dashboard.md?raw'
import components from './components.md?raw'
import designToCode from './design-to-code.md?raw'

export const GUIDES = {
  schema,
  'web-app': webApp,
  'landing-page': landingPage,
  'mobile-app': mobileApp,
  slides,
  dashboard,
  components,
  'design-to-code': designToCode,
} as const

export type GuideTopic = keyof typeof GUIDES

export const GUIDE_TOPICS = Object.keys(GUIDES) as [GuideTopic, ...GuideTopic[]]

export const CORE_GUIDE = core.trim()

export const SCHEMA_GUIDE = schema.trim()
