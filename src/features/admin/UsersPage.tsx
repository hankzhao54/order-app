import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { KeyRound, Trash2, UserPlus } from 'lucide-react'
import * as api from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { useI18n } from '@/lib/i18n'
import type { MessageKey } from '@/lib/i18n/en'
import { useLocations } from '@/lib/refdata'
import { useAction } from '@/lib/useAction'
import { ROLES, STORE_BOUND_ROLES, isStaffRole } from '@/lib/permissions'
import { toLoginEmail } from '@/lib/username'
import { useFeedback } from '@/ui/feedback'
import { Badge, Button, Card, Field, Input, PageHeader, Select, Skeleton } from '@/ui/primitives'
import { Sheet } from '@/ui/Sheet'
import type { Role } from '@/lib/types'

export default function UsersPage() {
  const { t } = useI18n()
  const { userId } = useAuth()
  const fb = useFeedback()
  const locations = useLocations()
  const key = ['admin', 'profiles']
  const q = useQuery({ queryKey: key, queryFn: api.listProfiles })
  const { run, isBusy } = useAction([key])
  const [f, setF] = useState({ username: '', password: '', role: 'restaurant_orderer' as Role, location_id: '' })
  const [pwFor, setPwFor] = useState<{ user_id: string; name: string } | null>(null)
  const [pw, setPw] = useState('')
  const roleLabel = (r: Role) => t(`role.${r}` as MessageKey)
  const locName = (id: string | null) => (locations.data ?? []).find(l => l.id === id)?.name_en

  async function create() {
    if (!f.username.trim() || f.password.length < 6) { fb.toast(t('users.needNamePw'), 'bad'); return }
    if (STORE_BOUND_ROLES.includes(f.role) && !f.location_id) { fb.toast(t('users.needLocation'), 'bad'); return }
    const email = toLoginEmail(f.username)
    const name = f.username.trim().split('@')[0]
    const r = await run(() => api.adminUserAction({ action: 'create', email, password: f.password, full_name: name, role: f.role, location_id: f.location_id || null }),
      { id: 'create', success: t('users.created', { name }) })
    if (r !== undefined) {
      api.logAudit('user.create', `user: ${name}`, { role: f.role })
      setF({ username: '', password: '', role: 'restaurant_orderer', location_id: '' })
    }
  }
  async function changeRole(u: { user_id: string; full_name: string | null; role: Role; location_id: string | null }, role: Role) {
    if (role === u.role) return
    let body = ''
    if (STORE_BOUND_ROLES.includes(role) && !u.location_id) body += t('users.warnNoLoc') + ' '
    if (isStaffRole(role)) body += t('users.warnSeesAll')
    if (!await fb.confirm({ title: t('users.changeRole', { name: u.full_name || '', from: roleLabel(u.role), to: roleLabel(role) }), body: body || undefined })) return
    await run(() => api.updateProfile(u.user_id, { role }), { id: u.user_id })
    api.logAudit('user.role', `user: ${u.full_name}`, { role })
  }
  async function toggle(u: { user_id: string; full_name: string | null; is_active: boolean }) {
    const next = !u.is_active
    if (!await fb.confirm({ title: next ? t('users.enableTitle', { name: u.full_name || '' }) : t('users.disableTitle', { name: u.full_name || '' }), danger: !next })) return
    const r = await run(() => api.adminUserAction({ action: 'set_active', user_id: u.user_id, is_active: next }), { id: u.user_id })
    if (r !== undefined) api.logAudit(next ? 'user.enable' : 'user.disable', `user: ${u.full_name}`)
  }
  async function remove(u: { user_id: string; full_name: string | null }) {
    if (!await fb.confirm({ title: t('users.deleteTitle', { name: u.full_name || '' }), body: t('users.deleteBody'), danger: true, confirm: t('users.delete') })) return
    const r = await run(() => api.adminUserAction({ action: 'delete', user_id: u.user_id }), { id: u.user_id, success: t('users.deleted') })
    if (r !== undefined) api.logAudit('user.delete', `user: ${u.full_name}`)
  }
  async function savePw() {
    if (!pwFor || pw.length < 6) { fb.toast(t('users.pwShort'), 'bad'); return }
    const r = await run(() => api.adminUserAction({ action: 'set_password', user_id: pwFor.user_id, password: pw }), { id: 'pw', success: t('users.pwChanged') })
    if (r !== undefined) { api.logAudit('user.password', `user: ${pwFor.name}`); setPwFor(null); setPw('') }
  }

  return (
    <div className="page">
      <PageHeader title={t('users.title')} />
      <Card className="mb-3">
        <h3 className="card-title"><UserPlus size={16} /> {t('users.add')}</h3>
        <div className="form-grid four">
          <Field label={t('login.username')} hint={t('users.usernameHint')}><Input value={f.username} autoCapitalize="none" autoCorrect="off" onChange={e => setF({ ...f, username: e.target.value })} /></Field>
          <Field label={t('login.password')} hint={t('users.pwHint')}><Input value={f.password} onChange={e => setF({ ...f, password: e.target.value })} /></Field>
          <Field label={t('users.role')}>
            <Select value={f.role} onChange={e => setF({ ...f, role: e.target.value as Role })}>{ROLES.map(r => <option key={r} value={r}>{roleLabel(r)}</option>)}</Select>
          </Field>
          <Field label={t('common.location')}>
            <Select value={f.location_id} onChange={e => setF({ ...f, location_id: e.target.value })}>
              <option value="">—</option>
              {(locations.data ?? []).map(l => <option key={l.id} value={l.id}>{l.name_en}</option>)}
            </Select>
          </Field>
        </div>
        <Button variant="primary" className="mt-2" loading={isBusy('create')} onClick={create}>{t('users.create')}</Button>
      </Card>

      {q.isPending ? <Skeleton rows={6} /> : (
        <Card className="table-wrap">
          <table className="table">
            <thead><tr><th>{t('users.name')}</th><th>{t('users.role')}</th><th>{t('common.location')}</th><th>{t('users.status')}</th><th /></tr></thead>
            <tbody>
              {(q.data ?? []).map(u => (
                <tr key={u.user_id} className={u.is_active ? '' : 'row-muted'}>
                  <td><b>{u.full_name || u.user_id.slice(0, 8)}</b>{u.user_id === userId && <span className="muted small"> · {t('users.you')}</span>}</td>
                  <td>
                    <Select value={u.role} disabled={u.user_id === userId} onChange={e => changeRole(u, e.target.value as Role)}>
                      {ROLES.map(r => <option key={r} value={r}>{roleLabel(r)}</option>)}
                    </Select>
                  </td>
                  <td>
                    <Select value={u.location_id || ''} onChange={e => run(() => api.updateProfile(u.user_id, { location_id: e.target.value || null }), { id: u.user_id })}>
                      <option value="">—</option>
                      {(locations.data ?? []).map(l => <option key={l.id} value={l.id}>{l.name_en}</option>)}
                    </Select>
                    {STORE_BOUND_ROLES.includes(u.role) && !u.location_id && <Badge tone="warn">{t('users.missingLoc')}</Badge>}
                    {u.location_id && !locName(u.location_id) && <Badge tone="warn">{t('users.inactiveLoc')}</Badge>}
                  </td>
                  <td>{u.is_active ? <Badge tone="ok">{t('users.active')}</Badge> : <Badge tone="bad">{t('users.disabled')}</Badge>}</td>
                  <td className="nowrap">
                    <Button size="sm" variant="ghost" icon={<KeyRound size={14} />} onClick={() => { setPwFor({ user_id: u.user_id, name: u.full_name || '' }); setPw('') }}>{t('users.password')}</Button>
                    {u.user_id !== userId && <>
                      <Button size="sm" variant="ghost" loading={isBusy(u.user_id)} onClick={() => toggle(u)}>{u.is_active ? t('users.disable') : t('users.enable')}</Button>
                      <Button size="sm" variant="ghost" className="text-bad" aria-label={t('users.delete')} icon={<Trash2 size={14} />} onClick={() => remove(u)} />
                    </>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Sheet open={!!pwFor} onClose={() => setPwFor(null)} size="sm" title={t('users.setPw', { name: pwFor?.name || '' })}
        footer={<><Button variant="ghost" onClick={() => setPwFor(null)}>{t('common.cancel')}</Button><Button variant="primary" loading={isBusy('pw')} onClick={savePw}>{t('common.save')}</Button></>}>
        <Field label={t('users.newPw')} hint={t('users.pwHint')}><Input autoFocus value={pw} onChange={e => setPw(e.target.value)} /></Field>
      </Sheet>
    </div>
  )
}
