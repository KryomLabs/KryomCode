interface KryomAPI {
  platform: string
  versions: {
    electron: string
    chrome: string
    node: string
  }
}

interface Window {
  kryom: KryomAPI
}