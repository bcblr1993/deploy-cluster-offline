import type { DeployApi } from './index'

declare global {
  interface Window {
    deployApi: DeployApi
  }
}

export {}
