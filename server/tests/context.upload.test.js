const request = require('supertest')
const express = require('express')

jest.mock('fs-extra')
const fs = require('fs-extra')

jest.mock('../services/context-sync')
const { syncContextToCLAUDEMD } = require('../services/context-sync')

const contextRouter = require('../routes/context')

function buildApp({ projectDir } = {}) {
  const app = express()
  const mockIo = { emit: jest.fn() }
  app.set('pqDir', '/fake/pqdir')
  app.set('io', mockIo)
  if (projectDir) app.set('projectDir', projectDir)
  app.use('/api/context', contextRouter)
  app._mockIo = mockIo
  return app
}

beforeEach(() => {
  jest.clearAllMocks()
  fs.outputFile.mockResolvedValue(undefined)
  syncContextToCLAUDEMD.mockResolvedValue(undefined)
})

describe('POST /api/context/upload', () => {
  // ── Basic success ──────────────────────────────────────────────────────────

  test('uploads a valid .md file — returns 200 with uploaded array', async () => {
    const app = buildApp()

    const res = await request(app)
      .post('/api/context/upload')
      .attach('files', Buffer.from('# hello'), 'readme.md')

    expect(res.status).toBe(200)
    expect(res.body.uploaded).toHaveLength(1)
    expect(res.body.uploaded[0].filename).toBe('readme.md')
    expect(typeof res.body.uploaded[0].size).toBe('number')
  })

  test('uploads multiple valid files — returns all in uploaded array', async () => {
    const app = buildApp()

    const res = await request(app)
      .post('/api/context/upload')
      .attach('files', Buffer.from('# doc'), 'doc.md')
      .attach('files', Buffer.from('{}'), 'config.json')
      .attach('files', Buffer.from('note'), 'notes.txt')

    expect(res.status).toBe(200)
    expect(res.body.uploaded).toHaveLength(3)
    const names = res.body.uploaded.map(f => f.filename)
    expect(names).toContain('doc.md')
    expect(names).toContain('config.json')
    expect(names).toContain('notes.txt')
  })

  // ── Allowed extensions ─────────────────────────────────────────────────────

  test('accepts .txt files', async () => {
    const app = buildApp()
    const res = await request(app)
      .post('/api/context/upload')
      .attach('files', Buffer.from('plain text'), 'notes.txt')
    expect(res.status).toBe(200)
    expect(res.body.uploaded[0].filename).toBe('notes.txt')
  })

  test('accepts .json files', async () => {
    const app = buildApp()
    const res = await request(app)
      .post('/api/context/upload')
      .attach('files', Buffer.from('{"key":"val"}'), 'config.json')
    expect(res.status).toBe(200)
    expect(res.body.uploaded[0].filename).toBe('config.json')
  })

  test('accepts .yaml files', async () => {
    const app = buildApp()
    const res = await request(app)
      .post('/api/context/upload')
      .attach('files', Buffer.from('key: val'), 'config.yaml')
    expect(res.status).toBe(200)
    expect(res.body.uploaded[0].filename).toBe('config.yaml')
  })

  test('accepts .yml files', async () => {
    const app = buildApp()
    const res = await request(app)
      .post('/api/context/upload')
      .attach('files', Buffer.from('key: val'), 'pipeline.yml')
    expect(res.status).toBe(200)
    expect(res.body.uploaded[0].filename).toBe('pipeline.yml')
  })

  test('accepts uppercase extensions (.MD) — case-insensitive check', async () => {
    const app = buildApp()
    const res = await request(app)
      .post('/api/context/upload')
      .attach('files', Buffer.from('# upper'), 'README.MD')
    expect(res.status).toBe(200)
    expect(res.body.uploaded[0].filename).toBe('README.MD')
  })

  // ── Rejection cases ────────────────────────────────────────────────────────

  test('rejects a disallowed extension (.exe) with 400', async () => {
    const app = buildApp()

    const res = await request(app)
      .post('/api/context/upload')
      .attach('files', Buffer.from('bad'), 'virus.exe')

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/not allowed/i)
  })

  test('rejects .pdf extension with 400', async () => {
    const app = buildApp()
    const res = await request(app)
      .post('/api/context/upload')
      .attach('files', Buffer.from('%PDF'), 'report.pdf')
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/not allowed/i)
  })

  test('returns 400 when no files are attached', async () => {
    const app = buildApp()

    const res = await request(app)
      .post('/api/context/upload')

    expect(res.status).toBe(400)
    expect(res.body.error).toBeDefined()
  })

  test('rejects a file exceeding the 5 MB size limit with 400', async () => {
    const app = buildApp()
    const oversized = Buffer.alloc(5 * 1024 * 1024 + 1, 'x')

    const res = await request(app)
      .post('/api/context/upload')
      .attach('files', oversized, 'big.md')

    expect(res.status).toBe(400)
    expect(res.body.error).toBeDefined()
  })

  // ── Response shape ─────────────────────────────────────────────────────────

  test('response size field equals actual buffer byte length', async () => {
    const app = buildApp()
    const content = Buffer.from('hello world')

    const res = await request(app)
      .post('/api/context/upload')
      .attach('files', content, 'size-check.txt')

    expect(res.status).toBe(200)
    expect(res.body.uploaded[0].size).toBe(content.byteLength)
  })

  // ── File system interaction ────────────────────────────────────────────────

  test('calls fs.outputFile with the correct destination path', async () => {
    const app = buildApp()

    await request(app)
      .post('/api/context/upload')
      .attach('files', Buffer.from('content'), 'spec.yaml')

    expect(fs.outputFile).toHaveBeenCalledTimes(1)
    expect(fs.outputFile).toHaveBeenCalledWith(
      '/fake/pqdir/context/spec.yaml',
      expect.any(Buffer)
    )
  })

  test('returns 500 when fs.outputFile rejects', async () => {
    const app = buildApp()
    fs.outputFile.mockRejectedValue(new Error('disk full'))

    const res = await request(app)
      .post('/api/context/upload')
      .attach('files', Buffer.from('content'), 'fail.md')

    expect(res.status).toBe(500)
    expect(res.body.error).toBe('disk full')
  })

  // ── Socket.io events ───────────────────────────────────────────────────────

  test('emits context:updated for each uploaded file', async () => {
    const app = buildApp()

    await request(app)
      .post('/api/context/upload')
      .attach('files', Buffer.from('a'), 'a.md')
      .attach('files', Buffer.from('b'), 'b.txt')

    expect(app._mockIo.emit).toHaveBeenCalledTimes(2)
    expect(app._mockIo.emit).toHaveBeenCalledWith('context:updated', { filename: 'a.md' })
    expect(app._mockIo.emit).toHaveBeenCalledWith('context:updated', { filename: 'b.txt' })
  })

  test('does not emit context:updated when upload is rejected', async () => {
    const app = buildApp()

    await request(app)
      .post('/api/context/upload')
      .attach('files', Buffer.from('bad'), 'bad.exe')

    expect(app._mockIo.emit).not.toHaveBeenCalled()
  })

  // ── Context sync ───────────────────────────────────────────────────────────

  test('calls syncContextToCLAUDEMD after a successful upload', async () => {
    const app = buildApp({ projectDir: '/fake/project' })

    await request(app)
      .post('/api/context/upload')
      .attach('files', Buffer.from('# doc'), 'doc.md')

    expect(syncContextToCLAUDEMD).toHaveBeenCalledTimes(1)
    expect(syncContextToCLAUDEMD).toHaveBeenCalledWith('/fake/project', '/fake/pqdir')
  })

  test('still returns 200 when syncContextToCLAUDEMD throws — error is fire-and-forget', async () => {
    syncContextToCLAUDEMD.mockRejectedValue(new Error('sync failed'))
    const app = buildApp({ projectDir: '/fake/project' })

    const res = await request(app)
      .post('/api/context/upload')
      .attach('files', Buffer.from('# doc'), 'doc.md')

    expect(res.status).toBe(200)
    expect(res.body.uploaded).toHaveLength(1)
  })
})
