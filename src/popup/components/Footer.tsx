import { Plus, Play } from 'lucide-react'

interface FooterProps {
  totalPrompts: number
  totalUses: number
  onNewPrompt: () => void
  onChainMode: () => void
}

export default function Footer({ totalPrompts, totalUses, onNewPrompt, onChainMode }: FooterProps) {
  return (
    <footer className="border-t p-3">
      <div className="text-xs text-gray-600 dark:text-gray-400 mb-2 flex items-center gap-4">
        <span>Total prompts: <span className="font-medium">{totalPrompts}</span></span>
        <span>Total uses: <span className="font-medium">{totalUses}</span></span>
      </div>
      <div className="grid grid-cols-2 gap-2 mb-2">
        <button
          onClick={onChainMode}
          className="inline-flex items-center justify-center gap-2 text-sm px-3 py-2 rounded-xl bg-white/10 border border-white/15 backdrop-blur-md text-white shadow-lg shadow-sky-500/10 hover:bg-white/15"
        >
          <Play size={16} /> Chain Mode
        </button>
        <button
          onClick={onNewPrompt}
          className="inline-flex items-center justify-center gap-2 text-sm px-3 py-2 rounded-xl bg-white/10 border border-white/15 backdrop-blur-md text-white shadow-lg shadow-sky-500/10 hover:bg-white/15"
        >
          <Plus size={16} /> New Prompt
        </button>
      </div>
      <button className="hidden" />
    </footer>
  )
}