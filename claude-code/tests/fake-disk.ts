// A small disk for the mod's file features: the project at /work/web, a home folder, git check-ignore, and the
// shell or PowerShell call that writes a received binary file.
import type { On } from 'claude-code'

export interface Disk { files: Map<string, string>, written: Map<string, string>, binaries: Map<string, string>, ignored: Set<string> }

const SEP = '/'

export const fakeDisk = (on: On, seed: Record<string, string> = {}, options: { links?: Record<string, string> } = {}): Disk => {
  const disk: Disk = { files: new Map(Object.entries(seed)), written: new Map(), binaries: new Map(), ignored: new Set() }
  const real = (path: string) => options.links?.[path] ?? path
  on('env.get', ($, e) => ({ value: e.name === 'HOME' ? '/home/me' : undefined }))
  on('fs.stat', ($, e) => {
    if (e.path === '/work/web') return { value: { kind: 'dir', size: 0, mtimeMs: 0, isLink: false, realPath: '/work/web' } }
    const target = real(e.path)
    const body = disk.files.get(target)
    if (body === undefined) return { deny: 'ENOENT' }
    return { value: { kind: 'file', size: new TextEncoder().encode(body).length, mtimeMs: 0, isLink: target !== e.path, ...(e.resolve ? { realPath: target } : {}) } }
  })
  on('fs.exists', ($, e) => ({ value: disk.files.has(e.path) || disk.written.has(e.path) || disk.binaries.has(e.path) }))
  on('fs.read', ($, e) => {
    const body = disk.files.get(real(e.path))
    if (body === undefined) return { deny: 'ENOENT' }
    return { value: e.as === 'bytes' ? { base64: btoa(body) } : body }
  })
  on('fs.write', ($, e) => { disk.written.set(e.path, e.text); return { value: undefined } })
  on('process.run', ($, e) => {
    const [cmd] = e.argv
    if (cmd === 'git') return { value: { exitCode: disk.ignored.has(e.argv.at(-1)!) ? 0 : 1, stdout: '', stderr: '' } }
    if (cmd === 'sh') { disk.binaries.set(e.argv.at(-1)!, e.init?.stdin ?? ''); return { value: { exitCode: 0, stdout: '', stderr: '' } } }
    return { value: { exitCode: 127, stdout: '', stderr: 'not found' } }
  })
  void SEP
  return disk
}
