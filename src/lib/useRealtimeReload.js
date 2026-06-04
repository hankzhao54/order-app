import { useEffect, useRef } from 'react'
import { supabase } from './supabase'

// Subscribe to changes on the given ordering-schema tables and call reload()
// shortly after any change. `paused` lets a page suspend auto-reload while the
// user is mid-edit, so the screen doesn't jump under their fingers.
export function useRealtimeReload(tables, reload, paused = false) {
  const reloadRef = useRef(reload)
  const pausedRef = useRef(paused)
  const pendingRef = useRef(false)
  const timerRef = useRef(null)
  reloadRef.current = reload
  pausedRef.current = paused

  // if we unpause and a change came in while paused, reload now
  useEffect(() => {
    if (!paused && pendingRef.current) {
      pendingRef.current = false
      reloadRef.current()
    }
  }, [paused])

  useEffect(() => {
    const channel = supabase.channel('rt-' + tables.join('-'))
    for (const t of tables) {
      channel.on('postgres_changes',
        { event: '*', schema: 'ordering', table: t },
        () => {
          if (pausedRef.current) { pendingRef.current = true; return }
          // debounce: batch rapid changes into one reload
          clearTimeout(timerRef.current)
          timerRef.current = setTimeout(() => reloadRef.current(), 400)
        })
    }
    channel.subscribe()
    return () => { clearTimeout(timerRef.current); supabase.removeChannel(channel) }
  }, [tables.join('-')])
}
