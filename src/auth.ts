import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js'

export type AuthSession = {
  userId: string
  email: string
  accessToken: string
  expiresAt: string
  emailVerified: boolean
}

export interface AuthAdapter {
  getSession(): Promise<AuthSession | null>
  signUp(email: string, password: string): Promise<'verification-required' | 'signed-in'>
  signIn(email: string, password: string): Promise<AuthSession>
  signOut(scope: 'current-device' | 'all-devices'): Promise<void>
  requestPasswordReset(email: string): Promise<void>
  onSessionChanged(listener: (session: AuthSession | null) => void): () => void
}

function toAuthSession(session: Session): AuthSession {
  const email = session.user.email
  if (!email) throw new Error('账号没有可用的邮箱地址。')
  return {
    userId: session.user.id,
    email,
    accessToken: session.access_token,
    expiresAt: new Date((session.expires_at ?? 0) * 1_000).toISOString(),
    emailVerified: Boolean(session.user.email_confirmed_at),
  }
}

class SupabaseAuthAdapter implements AuthAdapter {
  constructor(private readonly client: SupabaseClient) {}

  async getSession() {
    const { data, error } = await this.client.auth.getSession()
    if (error) throw error
    return data.session ? toAuthSession(data.session) : null
  }

  async signUp(email: string, password: string) {
    const { data, error } = await this.client.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: window.location.origin },
    })
    if (error) throw error
    return data.session ? 'signed-in' : 'verification-required'
  }

  async signIn(email: string, password: string) {
    const { data, error } = await this.client.auth.signInWithPassword({ email, password })
    if (error) throw error
    return toAuthSession(data.session)
  }

  async signOut(scope: 'current-device' | 'all-devices') {
    const { error } = await this.client.auth.signOut({ scope: scope === 'all-devices' ? 'global' : 'local' })
    if (error) throw error
  }

  async requestPasswordReset(email: string) {
    const { error } = await this.client.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin })
    if (error) throw error
  }

  onSessionChanged(listener: (session: AuthSession | null) => void) {
    const { data } = this.client.auth.onAuthStateChange((_event, session) => listener(session ? toAuthSession(session) : null))
    return () => data.subscription.unsubscribe()
  }
}

export type AuthConfiguration = {
  adapter: AuthAdapter | null
  client: SupabaseClient | null
  configured: boolean
}

export function createAuthConfiguration(): AuthConfiguration {
  const url = import.meta.env.VITE_SUPABASE_URL?.trim()
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()
  if (!url || !anonKey) return { adapter: null, client: null, configured: false }
  const client = createClient(url, anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  })
  return { adapter: new SupabaseAuthAdapter(client), client, configured: true }
}
