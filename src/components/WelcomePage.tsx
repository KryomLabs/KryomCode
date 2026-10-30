// Discovery workspace: the minimal central home. Only the two
// heading lines plus the active Chat or Research experience, which
// reuse the existing AiChat and ResearchPanel backends directly.
// Mode switching lives in the title bar; coding tasks hand off to
// Meta AI Agent editor tabs through explicit user actions only.
import { AiChat } from './AiChat'
import { ResearchPanel } from './ResearchPanel'

export type DiscoveryMode = 'chat' | 'research'

export interface WelcomePageProps {
  mode: DiscoveryMode
  workspaceRoot: string | null
  defaultModel: string
  activeFile: string | null
  fileName: string
  fileContent: string
  fileDirty: boolean
  contextEnabled: boolean
  chatResearchId: string | null
  onDetachChatResearch: () => void
  onOpenInAgent: (text: string) => void
  onResearchImplement: (session: KryomResearchSession) => void
  onResearchAsk: (session: KryomResearchSession) => void
  onStatus: (status: string) => void
  onOpenProviderSettings: () => void
}

export function WelcomePage(props: WelcomePageProps) {
  return (
    <div className="discovery">
      <div className="discovery-head">
        <p className="discovery-brand">KRYOMCODE</p>
        <h1>What should we build?</h1>
      </div>
      <div className="discovery-body">
        {props.mode === 'chat' ? (
          <AiChat
            workspaceRoot={props.workspaceRoot}
            activeFile={props.activeFile}
            fileName={props.fileName}
            fileContent={props.fileContent}
            dirty={props.fileDirty}
            defaultModel={props.defaultModel}
            contextEnabled={props.contextEnabled}
            onStatus={props.onStatus}
            researchSessionId={props.chatResearchId}
            onDetachResearch={props.onDetachChatResearch}
            onOpenConnections={props.onOpenProviderSettings}
            onOpenInAgent={props.onOpenInAgent}
          />
        ) : (
          <ResearchPanel
            workspaceRoot={props.workspaceRoot}
            onStatus={props.onStatus}
            onImplement={props.onResearchImplement}
            onAsk={props.onResearchAsk}
          />
        )}
      </div>
    </div>
  )
}
