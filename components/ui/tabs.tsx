'use client'

import { Tabs as TabsPrimitive } from '@base-ui/react/tabs'

import { cn } from '@/lib/utils'

// Built on the @base-ui/react Tabs primitive, matching this project's
// components.json style. Colours are explicit rather than shadcn theme tokens
// because the `shadcn/tailwind.css` @theme import does not resolve here — see
// SETUP.md ("Known issues").

function Tabs({ className, ...props }: TabsPrimitive.Root.Props) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cn('flex flex-col gap-4', className)}
      {...props}
    />
  )
}

function TabsList({ className, ...props }: TabsPrimitive.List.Props) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        'relative inline-flex w-full items-center gap-1 overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 p-1',
        className
      )}
      {...props}
    />
  )
}

function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      className={cn(
        'inline-flex flex-1 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-xs font-semibold text-slate-600 transition-all outline-none',
        'hover:bg-white/70 hover:text-slate-900',
        'focus-visible:ring-2 focus-visible:ring-[#003C71]/40',
        'data-[selected]:bg-white data-[selected]:text-[#003C71] data-[selected]:shadow-sm',
        'disabled:pointer-events-none disabled:opacity-50',
        className
      )}
      {...props}
    />
  )
}

function TabsContent({ className, ...props }: TabsPrimitive.Panel.Props) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-content"
      className={cn('flex-1 outline-none', className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent }
