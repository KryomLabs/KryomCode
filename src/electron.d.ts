interface KryomNode {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: KryomNode[]
}

interface KryomWorkspace {
  root: string
  tree: KryomNode[]
}

interface KryomAPI {
  platform: string

  versions: {
    electron: string
    chrome: string
    node: string
  }

  openWorkspace: () => Promise<KryomWorkspace | null>

  readFile: (filePath: string) => Promise<string>

  saveFile: (
    filePath: string,
    content: string,
  ) => Promise<{ success: boolean }>

  runCommand: (command: string) => Promise<{
    exitCode: number
    output: string
    timedOut: boolean
    outputLimited: boolean
  }>
}

interface Window {
  kryom: KryomAPI
}