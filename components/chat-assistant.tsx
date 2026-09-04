'use client'

import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { MessageSquare, Send, X } from 'lucide-react'

export type ChatContext = {
  defectCount: number
  overdueCount: number
  criticalCount: number
  windowCount: number
  blockCount: number
  downtimeSavedHrs: number
}

type ChatMessage = {
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}

export default function ChatAssistant({ context }: { context: ChatContext }) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function send() {
    const trimmed = input.trim()
    if (!trimmed || loading) return

    setInput('')
    setMessages((prev) => [
      ...prev,
      { role: 'user', content: trimmed, timestamp: Date.now() },
    ])
    setLoading(true)

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: trimmed, context }),
      })

      if (!response.ok) throw new Error(`Request failed (${response.status})`)

      const { reply } = await response.json()
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: reply, timestamp: Date.now() },
      ])
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: 'Sorry, I could not reach the assistant. Please try again.',
          timestamp: Date.now(),
        },
      ])
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <AnimatePresence>
        {open && (
          <motion.div
            className="fixed bottom-0 right-0 z-50 flex h-96 w-full max-w-md flex-col rounded-t-lg bg-white shadow-2xl"
            initial={{ y: 400 }}
            animate={{ y: 0 }}
            exit={{ y: 400 }}
            transition={{ type: 'spring', damping: 24 }}
          >
            <div className="flex items-center justify-between rounded-t-lg bg-[#003C71] p-4 text-white">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <MessageSquare size={17} />
                Block Planning Assistant
              </h3>
              <button
                onClick={() => setOpen(false)}
                className="rounded p-1 transition hover:bg-white/20"
                aria-label="Close assistant"
              >
                <X size={17} />
              </button>
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              {messages.length === 0 ? (
                <div className="py-8 text-center text-sm text-slate-500">
                  <MessageSquare size={30} className="mx-auto mb-2 opacity-30" />
                  <p>Ask about overdue defects, corridor windows, or the current plan.</p>
                </div>
              ) : (
                messages.map((msg, i) => (
                  <div
                    key={i}
                    className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-xs whitespace-pre-line rounded-lg px-3.5 py-2 text-sm ${
                        msg.role === 'user'
                          ? 'rounded-br-none bg-[#003C71] text-white'
                          : 'rounded-bl-none bg-slate-100 text-slate-800'
                      }`}
                    >
                      {msg.content}
                    </div>
                  </div>
                ))
              )}

              {loading && (
                <div className="flex justify-start">
                  <div className="flex gap-1 rounded-lg rounded-bl-none bg-slate-100 px-4 py-3">
                    {[0, 1, 2].map((i) => (
                      <motion.span
                        key={i}
                        className="h-1.5 w-1.5 rounded-full bg-slate-400"
                        animate={{ opacity: [0.3, 1, 0.3] }}
                        transition={{ duration: 1, repeat: Infinity, delay: i * 0.15 }}
                      />
                    ))}
                  </div>
                </div>
              )}
              <div ref={endRef} />
            </div>

            <div className="flex gap-2 border-t p-3">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void send()
                }}
                placeholder="Ask a question…"
                disabled={loading}
                className="flex-1 rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#003C71]"
              />
              <button
                onClick={() => void send()}
                disabled={loading || !input.trim()}
                className="rounded-lg bg-[#003C71] p-2 text-white transition hover:bg-[#002b56] disabled:bg-slate-300"
                aria-label="Send message"
              >
                <Send size={17} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.button
        onClick={() => setOpen((prev) => !prev)}
        className="fixed bottom-6 right-6 z-40 flex h-13 w-13 items-center justify-center rounded-full bg-[#e27625] p-4 text-white shadow-lg"
        whileHover={{ scale: 1.08 }}
        whileTap={{ scale: 0.95 }}
        aria-label="Open block planning assistant"
      >
        <MessageSquare size={22} />
      </motion.button>
    </>
  )
}
