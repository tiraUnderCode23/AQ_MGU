import { EventEmitter } from 'events'
import type { AppSettings, ChannelDef, ConnectionStatus, ConnectOptions, LiveBatch, RecordingInfo } from '@shared/types'
import { CH } from '@shared/types'
import { MAX_LIVE_CHANNELS } from '@shared/catalog'
import type { SampleFrame, StreamHandle, VehicleAdapter } from './vehicle/adapter'
import { SimulatorAdapter } from './vehicle/simulator'
import { EnetAdapter } from './vehicle/enet'
import { Recorder } from './recorder'
import { buildDmeChannelSet, resolveDme } from './bmwdata/channels'
import type { BmwDataPack, DmeDataResolver } from './bmwdata/types'

/** Always sampled when available: the Dyno, Drag and WOT tools depend on them. */
const REQUIRED = [CH.rpm, CH.speed, CH.pedal, CH.gear]
/** Hard cap on streamed channels: live tiles (40) + required + graph extras. */
const MAX_STREAM = MAX_LIVE_CHANNELS + 30
const FLUSH_MS = 50
const AUTO_RECORD_PEDAL = 85
const AUTO_RECORD_TAIL_S = 3

/** What the session needs from the app around it (settings, imported data, folders). */
export interface SessionHost {
  loadSettings(): Promise<AppSettings>
  loadBmwData(): Promise<BmwDataPack | null>
  /** Creates the folder if needed and returns its path. */
  dataPath(folder: 'Logs' | 'Definitions'): Promise<string>
  /** Extra options for network adapters (the iOS app scans the WiFi subnet). */
  enetOptions?: { scanSubnet?: boolean; identTimeoutMs?: number }
}

/**
 * Values that come from somewhere else than the adapter (the head unit's own vehicle signals,
 * values worked out from others). They are listed, streamed, shown and recorded as any channel;
 * `read` is asked for each one at every adapter sample, with that sample's adapter values.
 */
export interface ExternalChannels {
  defs: ChannelDef[]
  read(id: string, sample: (id: string) => number): number
}

export interface SessionEvents {
  status: [ConnectionStatus]
  channels: [ChannelDef[]]
  batch: [LiveBatch]
  log: [string]
}

/**
 * Owns the vehicle connection: adapter lifecycle, streaming, batching samples
 * for the renderer and writing recordings. One instance per app.
 */
export class Session extends EventEmitter<SessionEvents> {
  private adapter: VehicleAdapter | null = null
  private abort: AbortController | null = null
  private stream: StreamHandle | null = null
  private channelList: ChannelDef[] = []
  private wanted: string[] = []
  private active: string[] = []
  private pendingRestart = false
  private recorder: Recorder | null = null
  private epoch = 0
  private streamOffset = 0
  private batchT: number[] = []
  private batchRows: number[][] = []
  private flushTimer: ReturnType<typeof setInterval> | null = null
  private rateWindow: number[] = []
  private autoRecord = false
  private wotLastSeen = -Infinity
  private autoRecording = false
  private current: ConnectionStatus = { state: 'disconnected' }
  private external: ExternalChannels | null = null
  private adapterList: ChannelDef[] = []
  /** For each active id: its index in the adapter's frame, or -1 for an external channel. */
  private activeFrom: number[] = []

  constructor(private readonly host: SessionHost) {
    super()
  }

  status(): ConnectionStatus {
    return this.current
  }

  channels(): ChannelDef[] {
    return this.channelList
  }

  /**
   * Adds channels of the app's own (see ExternalChannels), or takes them away with null. Takes
   * effect at once when connected; a capture being written keeps its columns until it stops.
   */
  setExternalChannels(ext: ExternalChannels | null): void {
    this.external = ext && ext.defs.length ? ext : null
    if (!this.adapter) return
    this.publishChannels()
    if (this.stream && !sameSet(this.resolveIds(), this.active)) {
      if (this.recorder) this.pendingRestart = true
      else void this.restartStream()
    }
  }

  private publishChannels(): void {
    const own = new Set(this.adapterList.map((c) => c.id))
    const extra = this.external ? this.external.defs.filter((c) => !own.has(c.id)) : []
    this.channelList = this.adapterList.concat(extra)
    this.emit('channels', this.channelList)
  }

  private setStatus(patch: Partial<ConnectionStatus>, replace = false): void {
    this.current = replace ? (patch as ConnectionStatus) : { ...this.current, ...patch }
    this.emit('status', this.current)
  }

  async connect(opts: ConnectOptions): Promise<ConnectionStatus> {
    await this.disconnect()
    const settings = await this.host.loadSettings()
    this.autoRecord = settings.autoRecordWot
    const bmwData = await this.host.loadBmwData()
    const dmeData: DmeDataResolver = (index) => {
      const dme = resolveDme(bmwData, settings.bmwDme, index)
      return dme ? buildDmeChannelSet(dme) : undefined
    }
    const adapter: VehicleAdapter =
      opts.kind === 'simulator'
        ? new SimulatorAdapter()
        : new EnetAdapter({
            kind: opts.kind,
            host: opts.host,
            port: opts.port,
            definitionsDir: await this.host.dataPath('Definitions'),
            dmeData,
            ...this.host.enetOptions,
            log: (msg: string) => this.emit('log', msg)
          })
    this.adapter = adapter
    this.abort = new AbortController()
    this.setStatus({ state: 'connecting', adapterKind: opts.kind }, true)
    try {
      const info = await adapter.connect(this.abort.signal)
      this.adapterList = adapter.channels()
      this.publishChannels()
      this.epoch = performance.now()
      this.setStatus({
        state: 'connected',
        adapterKind: opts.kind,
        adapterLabel: info.label,
        endpoint: info.endpoint,
        vin: info.vin,
        ecu: info.ecu
      })
      await this.startLive()
    } catch (err) {
      this.adapter = null
      await adapter.disconnect().catch(() => undefined)
      this.setStatus({ state: 'error', adapterKind: opts.kind, error: errorMessage(err) }, true)
    }
    return this.current
  }

  async disconnect(): Promise<void> {
    this.abort?.abort()
    this.abort = null
    await this.stopRecording()
    await this.stopLive()
    if (this.adapter) {
      await this.adapter.disconnect().catch(() => undefined)
      this.adapter = null
    }
    this.adapterList = []
    if (this.channelList.length) {
      this.channelList = []
      this.emit('channels', [])
    }
    this.setStatus({ state: 'disconnected' }, true)
  }

  async setStreamChannels(ids: string[]): Promise<void> {
    this.wanted = ids
    if (!this.stream) return
    if (sameSet(this.resolveIds(), this.active)) return
    // The channel set of an open CSV cannot change; apply after recording.
    if (this.recorder) this.pendingRestart = true
    else await this.restartStream()
  }

  private resolveIds(): string[] {
    const available = new Set(this.channelList.map((c) => c.id))
    const ids = [...new Set([...REQUIRED, ...this.wanted])].filter((id) => available.has(id))
    // the external channels cost the adapter nothing: only the adapter's count against the limit
    const own = new Set(this.adapterList.map((c) => c.id))
    const adapter = ids.filter((id) => own.has(id)).slice(0, MAX_STREAM)
    return ids.filter((id) => !own.has(id) || adapter.indexOf(id) >= 0)
  }

  async startLive(): Promise<void> {
    if (!this.adapter || this.stream) return
    this.active = this.resolveIds()
    const own = new Set(this.adapterList.map((c) => c.id))
    const adapterIds = this.active.filter((id) => own.has(id))
    this.activeFrom = this.active.map((id) => adapterIds.indexOf(id))
    this.streamOffset = (performance.now() - this.epoch) / 1000
    this.rateWindow = []
    this.stream = await this.adapter.startStreaming(adapterIds, (f) => this.onFrame(this.withExternal(f, adapterIds)), {
      maxRateHz: 50,
      onError: (err) => this.emit('log', `Stream error: ${err.message}`)
    })
    this.flushTimer = setInterval(() => this.flush(), FLUSH_MS)
    this.setStatus({ state: 'live' })
  }

  async stopLive(): Promise<void> {
    if (this.flushTimer) clearInterval(this.flushTimer)
    this.flushTimer = null
    const stream = this.stream
    this.stream = null
    await stream?.stop()
    this.flush()
    if (this.adapter && this.current.state === 'live') this.setStatus({ state: 'connected', sampleRateHz: undefined })
  }

  private async restartStream(): Promise<void> {
    this.pendingRestart = false
    await this.stopLive()
    await this.startLive()
  }

  /** The adapter's frame laid out as `active`, the external channels read in. */
  private withExternal(frame: SampleFrame, adapterIds: string[]): SampleFrame {
    const from = this.activeFrom
    if (from.every((j, i) => j === i) && from.length === frame.values.length) return frame
    const ext = this.external
    const sample = (id: string): number => {
      const j = adapterIds.indexOf(id)
      return j >= 0 ? frame.values[j] : NaN
    }
    const values = from.map((j, i) => {
      if (j >= 0) return frame.values[j]
      if (!ext) return NaN
      try {
        const v = ext.read(this.active[i], sample)
        return typeof v === 'number' && isFinite(v) ? v : NaN
      } catch {
        return NaN
      }
    })
    return { ...frame, values }
  }

  private onFrame(frame: SampleFrame): void {
    const t = this.streamOffset + frame.t
    this.batchT.push(t)
    this.batchRows.push(frame.values)
    this.recorder?.write(t, frame.values)
    this.rateWindow.push(t)
    if (this.autoRecord) this.checkAutoRecord(t, frame.values)
  }

  private checkAutoRecord(t: number, values: number[]): void {
    const pedal = values[this.active.indexOf(CH.pedal)]
    if (pedal >= AUTO_RECORD_PEDAL) {
      this.wotLastSeen = t
      if (!this.recorder) {
        this.autoRecording = true
        void this.startRecording()
      }
    } else if (this.autoRecording && this.recorder && t - this.wotLastSeen > AUTO_RECORD_TAIL_S) {
      this.autoRecording = false
      void this.stopRecording()
    }
  }

  private flush(): void {
    if (!this.batchT.length) return
    this.emit('batch', { channelIds: this.active, t: this.batchT, rows: this.batchRows })
    this.batchT = []
    this.batchRows = []
    const last = this.rateWindow[this.rateWindow.length - 1]
    while (this.rateWindow.length && last - this.rateWindow[0] > 2) this.rateWindow.shift()
    const span = last - this.rateWindow[0]
    const rate = span > 0.5 ? (this.rateWindow.length - 1) / span : undefined
    const patch: Partial<ConnectionStatus> = { sampleRateHz: rate }
    if (this.recorder) patch.recording = this.recordingInfo()
    this.setStatus(patch)
  }

  private recordingInfo(): RecordingInfo | undefined {
    const r = this.recorder
    return r ? { file: r.file, startedAt: r.startedAt, samples: r.samples } : undefined
  }

  async startRecording(): Promise<RecordingInfo> {
    if (!this.stream) await this.startLive()
    if (!this.stream) throw new Error('Not connected')
    if (!this.recorder) {
      const byId = new Map(this.channelList.map((c) => [c.id, c]))
      const channels = this.active.map((id) => byId.get(id)!)
      const meta: Record<string, string> = { adapter: this.current.adapterLabel ?? '' }
      if (this.current.vin) meta.vin = this.current.vin
      if (this.current.ecu?.softwareVersion) meta.ecu = this.current.ecu.softwareVersion
      this.recorder = new Recorder(await this.host.dataPath('Logs'), channels, meta)
      this.setStatus({ recording: this.recordingInfo() })
    }
    return this.recordingInfo()!
  }

  async stopRecording(): Promise<string | null> {
    const r = this.recorder
    if (!r) return null
    this.recorder = null
    this.autoRecording = false
    const file = await r.close()
    this.setStatus({ recording: undefined })
    if (this.pendingRestart && this.stream) await this.restartStream()
    return file
  }
}

function sameSet(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i])
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
