// Discovery workspace: home hero plus the Chat and Research
// experiences. The hero collects the first prompt per mode and
// hands it to the existing AiChat / ResearchPanel backends through
// their pending-prompt props; afterwards the experience fills the
// space. Mode switching lives in the title bar and the hero.
import { useEffect, useState } from 'react'
import { ChatSessions } from './ChatSessions'
import { HomeHero } from './HomeHero'
import { ResearchPanel } from './ResearchPanel'

export type DiscoveryMode = 'chat' | 'research'

export interface WelcomePageProps {
  mode: DiscoveryMode
  onModeChange: (mode: DiscoveryMode) => void
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
  const [chatPrompt, setChatPrompt] = useState<{
    text: string
    nonce: number
  } | null>(null)
  const [researchStart, setResearchStart] = useState<{
    objective: string
    nonce: number
  } | null>(null)
  const [chatSubmitted, setChatSubmitted] = useState(false)
  const [researchSubmitted, setResearchSubmitted] = useState(false)
  const [nonce, setNonce] = useState(0)

  // The child consumes the pending prompt in its mount effect
  // (child effects run before parent effects); clearing it here
  // stops mode-switch remounts from resubmitting, and stops a
  // research handoff from firing late when a workspace opens.
  useEffect(() => {
    if (chatPrompt !== null) {
      setChatPrompt(null)
    }
  }, [chatPrompt])

  useEffect(() => {
    if (researchStart !== null) {
      setResearchStart(null)
    }
  }, [researchStart])

  function handleHeroSubmit(text: string) {
    const next = nonce + 1
    setNonce(next)

    if (props.mode === 'chat') {
      setChatSubmitted(true)
      setChatPrompt({ text, nonce: next })
      return
    }

    // Without a workspace the panel cannot start: stay on the hero
    // (keeping the typed text) and say why.
    if (!props.workspaceRoot) {
      props.onStatus('Open a workspace to run research')
      return
    }

    setResearchSubmitted(true)
    setResearchStart({ objective: text, nonce: next })
  }

  const submitted = props.mode === 'chat' ? chatSubmitted : researchSubmitted

  if (!submitted) {
    return (
      <div className="discovery">
        <div className="discovery-body">
          <HomeHero
            mode={props.mode}
            onModeChange={props.onModeChange}
            onSubmit={handleHeroSubmit}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="discovery">
      <div className="discovery-body">
        {props.mode === 'chat' ? (
          <ChatSessions
            workspaceRoot={props.workspaceRoot}
            activeFile={props.activeFile}
            fileName={props.fileName}
            fileContent={props.fileContent}
            dirty={props.fileDirty}
            defaultModel={props.defaultModel}
            contextEnabled={props.contextEnabled}
            onStatus={props.onStatus}
            pendingPrompt={chatPrompt}
            researchSessionId={props.chatResearchId}
            onDetachResearch={props.onDetachChatResearch}
            onOpenConnections={props.onOpenProviderSettings}
            onOpenInAgent={props.onOpenInAgent}
          />
        ) : (
          <ResearchPanel
            workspaceRoot={props.workspaceRoot}
            onStatus={props.onStatus}
            pendingStart={researchStart}
            onImplement={props.onResearchImplement}
            onAsk={props.onResearchAsk}
          />
        )}
      </div>
    </div>
  )
}
