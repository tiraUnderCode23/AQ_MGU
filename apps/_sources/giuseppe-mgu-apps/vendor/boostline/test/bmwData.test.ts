import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { decodeMeasurement, normalizeSgbdUnit, parseSgfunktionenRow } from '../src/core/bmwdata/sgbdRow'
import { importBmwUnifiedDb } from '../src/main/bmwdata/importDb'
import { buildDmeChannelSet, measurementName, resolveDme } from '../src/core/bmwdata/channels'
import type { BmwDme, BmwMeasurement } from '../src/core/bmwdata/types'

// All DIDs, scalings and descriptions below are invented test data in the shape of
// an SGBD SG_FUNKTIONEN table; no BMW data is included in the repository.

const COLUMNS = ['ARG', 'ID', 'RESULTNAME', 'INFO', 'EINHEIT', 'LABEL', 'L/H', 'DATENTYP', 'NAME', 'MUL', 'DIV', 'ADD', 'SG_ADR', 'SERVICE', 'ARG_TABELLE', 'RES_TABELLE']

const row = (o: Partial<Record<(typeof COLUMNS)[number], string>>): Record<string, string> => ({
  ARG: 'X', ID: '0x7000', RESULTNAME: 'STAT_TEST_WERT', INFO: 'Test', EINHEIT: '-', LABEL: '-', 'L/H': '-', DATENTYP: 'unsigned int',
  NAME: '-', MUL: '-', DIV: '-', ADD: '-', SG_ADR: '-', SERVICE: '22;2C', ARG_TABELLE: '-', RES_TABELLE: '-', ...o
})

describe('parseSgfunktionenRow', () => {
  it('parses a scaled numeric measurement', () => {
    const m = parseSgfunktionenRow(row({ ID: '0x7A01', EINHEIT: 'hPa', DATENTYP: 'signed int', MUL: '0,5', DIV: '4', ADD: '-10' }))!
    expect(m).toMatchObject({ did: 0x7a01, unit: 'hPa', type: 's16', littleEndian: false, mul: 0.5, div: 4, add: -10, composable: true })
  })

  it('maps EDIABAS types (plain types are signed; int = 16 bit, long = 32 bit)', () => {
    expect(parseSgfunktionenRow(row({ DATENTYP: 'char' }))!.type).toBe('s8')
    expect(parseSgfunktionenRow(row({ DATENTYP: 'int' }))!.type).toBe('s16')
    expect(parseSgfunktionenRow(row({ DATENTYP: 'unsigned long' }))!.type).toBe('u32')
    expect(parseSgfunktionenRow(row({ DATENTYP: 'motorola float' }))!.type).toBe('f32')
  })

  it('accepts service lists with spaces and flags non-composable DIDs', () => {
    expect(parseSgfunktionenRow(row({ SERVICE: '2C; 22' }))!.composable).toBe(true)
    expect(parseSgfunktionenRow(row({ SERVICE: '22' }))!.composable).toBe(false)
  })

  it('drops routines, actuator tests, enums, flags and raw data', () => {
    expect(parseSgfunktionenRow(row({ SERVICE: '31' }))).toBeNull()
    expect(parseSgfunktionenRow(row({ SERVICE: '2F' }))).toBeNull()
    expect(parseSgfunktionenRow(row({ SERVICE: '2E' }))).toBeNull()
    expect(parseSgfunktionenRow(row({ RES_TABELLE: 'TAB_STATUS' }))).toBeNull()
    expect(parseSgfunktionenRow(row({ EINHEIT: '0/1' }))).toBeNull()
    expect(parseSgfunktionenRow(row({ DATENTYP: 'data[12]' }))).toBeNull()
    expect(parseSgfunktionenRow(row({ DATENTYP: 'BITFIELD' }))).toBeNull()
    expect(parseSgfunktionenRow(row({ ID: '-' }))).toBeNull()
  })

  it('repairs unit symbols lost in transcoding', () => {
    expect(normalizeSgbdUnit('�C')).toBe('°C')
    expect(normalizeSgbdUnit('� KW')).toBe('°CRK')
    expect(normalizeSgbdUnit('rad/s�')).toBe('rad/s²')
    expect(normalizeSgbdUnit('�s')).toBe('µs')
    expect(normalizeSgbdUnit('1/min')).toBe('rpm')
    expect(normalizeSgbdUnit('-')).toBe('')
  })

  it('unifies diesel (DDE) unit spellings', () => {
    expect(normalizeSgbdUnit('degC')).toBe('°C')
    expect(normalizeSgbdUnit('Volt')).toBe('V')
    expect(normalizeSgbdUnit('mg/hub')).toBe('mg/stroke')
    expect(normalizeSgbdUnit('cm^2')).toBe('cm²')
  })

  it('decodes big-endian records with scaling', () => {
    const m = parseSgfunktionenRow(row({ DATENTYP: 'signed int', MUL: '0.1', ADD: '-273.14' }))!
    expect(decodeMeasurement(m, Buffer.from([0x0d, 0xba]))).toBeCloseTo(3514 * 0.1 - 273.14, 6)
    expect(decodeMeasurement(m, Buffer.from([0x01]))).toBeNaN()
  })
})

describe('importBmwUnifiedDb', () => {
  let dir = ''
  let path = ''
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'boostline-bmwtest-'))
    path = join(dir, 'bmw.sqlite')
    const db = new DatabaseSync(path)
    db.exec(`
      create table ecu_variant (sgbd text, ecu_name text, comment text, chassis text, is_uds int, ecu_family text);
      create table ecu_table (sgbd text, name text, rows int, cols int, columns text);
      create table table_row (sgbd text, "table" text, idx int, cells text);
      create table routing (sgbd text, sgbd_index text, diag_address text);
      create table ecu_engine (sgbd text, engine text);
    `)
    db.prepare('insert into ecu_variant values (?,?,?,?,?,?)').run('testdme', 'Test DME', 'test', '["X99"]', 1, 'DME')
    db.prepare('insert into ecu_variant values (?,?,?,?,?,?)').run('testtcu', 'Test gearbox', '', '[]', 1, 'EGS')
    db.prepare('insert into ecu_variant values (?,?,?,?,?,?)').run('testdde', 'Test DDE', 'test', '["X31"]', 1, 'DDE')
    db.prepare('insert into ecu_table values (?,?,?,?,?)').run('testdde', 'SG_FUNKTIONEN', 1, COLUMNS.length, JSON.stringify(COLUMNS))
    const ddeRow = row({ ID: '0x7101', RESULTNAME: 'STAT_RUSSMASSE_IM_PARTIKELFILTER_WERT', EINHEIT: 'g', MUL: '0.01' })
    db.prepare('insert into table_row values (?,?,?,?)').run('testdde', 'SG_FUNKTIONEN', 0, JSON.stringify(COLUMNS.map((c) => ddeRow[c])))
    db.prepare('insert into routing values (?,?,?)').run('testdde', '0xF9998', '0x12')
    db.prepare('insert into ecu_table values (?,?,?,?,?)').run('testdme', 'SG_FUNKTIONEN', 3, COLUMNS.length, JSON.stringify(COLUMNS))
    const rows = [
      row({ ID: '0x7001', RESULTNAME: 'STAT_MOTORDREHZAHL_WERT', EINHEIT: '1/min', MUL: '0.5' }),
      row({ ID: '0x7002', SERVICE: '31' }),
      row({ ID: '0x7003', RESULTNAME: 'STAT_0x7003_WERT', INFO: 'Umgebungsdruck', EINHEIT: 'hPa', MUL: '0.1' })
    ]
    rows.forEach((r, i) => db.prepare('insert into table_row values (?,?,?,?)').run('testdme', 'SG_FUNKTIONEN', i, JSON.stringify(COLUMNS.map((c) => r[c]))))
    db.prepare('insert into routing values (?,?,?)').run('testdme', '0xF9999', '0x12')
    db.prepare('insert into ecu_engine values (?,?)').run('testdme', 'X58')
    db.close()
  })
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('extracts readable DME measurements, indexes, engines and chassis', async () => {
    const pack = await importBmwUnifiedDb(path, 'test')
    const dme = pack.dmes.find((d) => d.sgbd === 'testdme')!
    expect(dme).toMatchObject({ sgbd: 'testdme', name: 'Test DME', family: 'DME', chassis: ['X99'], engines: ['X58'], diagAddress: 0x12, sgbdIndexes: [0xf9999] })
    expect(dme.measurements.map((m) => m.did)).toEqual([0x7001, 0x7003])
  })

  it('takes diesel engine ECUs (DDE) too, and no other ECU families', async () => {
    const pack = await importBmwUnifiedDb(path, 'test')
    expect(pack.dmes.map((d) => d.sgbd)).toEqual(['testdde', 'testdme'])
    expect(pack.dmes[0]).toMatchObject({ family: 'DDE', sgbdIndexes: [0xf9998] })
    expect(pack.dmes[0].measurements.map((m) => m.did)).toEqual([0x7101])
  })

  it('rejects files that are not bmw-unified-db databases', async () => {
    const other = join(dir, 'other.sqlite')
    new DatabaseSync(other).close()
    await expect(importBmwUnifiedDb(other)).rejects.toThrow(/Not a bmw-unified-db/)
  })
})

const meas = (o: Partial<BmwMeasurement>): BmwMeasurement => ({
  did: 0x7000, arg: '', result: 'STAT_TEST_WERT', info: '', unit: '', type: 'u16', littleEndian: false, mul: 1, div: 1, add: 0, composable: true, ...o
})

const DME: BmwDme = {
  sgbd: 'testdme', name: 'Test DME', comment: '', chassis: ['X99'], engines: ['X58'], diagAddress: 0x12, sgbdIndexes: [0xf2426],
  measurements: [
    meas({ did: 0x7001, result: 'STAT_MOTORDREHZAHL_WERT', unit: 'rpm', mul: 0.25 }),
    meas({ did: 0x7002, result: 'STAT_LADEDRUCK_WERT', unit: 'hPa', mul: 0.1 }),
    meas({ did: 0x7003, result: 'STAT_UMGEBUNGSDRUCK_WERT', unit: 'hPa', mul: 0.1 }),
    meas({ did: 0x7004, result: 'STAT_0x7004_WERT', info: 'Massenstrom �ber Drosselklappe', unit: 'kg/h', mul: 0.1 }),
    meas({ did: 0x7005, result: 'STAT_ZUENDWINKEL_ZYL3_WERT', unit: '°CRK', type: 's16', mul: 0.1 }),
    meas({ did: 0x7006, result: 'STAT_LAMBDA_BANK1_SOLL_WERT', unit: '', mul: 16, div: 65536 }),
    meas({ did: 0x7007, result: 'STAT_IRGENDEIN_DRUCK_WERT', unit: 'MPa', mul: 0.002, composable: false }),
    meas({ did: 0x7008, result: 'STAT_ZAEHLER_WERT', unit: '' })
  ]
}

describe('buildDmeChannelSet', () => {
  const set = buildDmeChannelSet(DME)
  const byId = new Map(set.reads.map((r) => [r.channel.id, r]))

  it('maps curated measurements onto well-known channel ids with English names', () => {
    expect(byId.get('engine.rpm')).toMatchObject({ did: 0x7001, length: 2, composable: true })
    expect(byId.get('engine.rpm')!.channel).toMatchObject({ name: 'Engine speed', unit: 'rpm', group: 'Engine' })
    expect(byId.get('load.maf_throttle')!.did).toBe(0x7004)
    expect(byId.get('ign.cyl3')!.did).toBe(0x7005)
    expect(byId.get('fuel.lambda.target')!.channel).toMatchObject({ unit: 'λ', quantity: 'lambda' })
  })

  it('converts SGBD units to Boostline units while decoding', () => {
    const boost = byId.get('boost.charge_abs')!
    expect(boost.channel.unit).toBe('bar')
    expect(boost.decode(Buffer.from([0x4e, 0x20]))).toBeCloseTo(20000 * 0.1 * 0.001, 9) // 2000 hPa → 2 bar
    expect(byId.get('engine.rpm')!.decode(Buffer.from([0x5d, 0xc0]))).toBe(24000 * 0.25)
  })

  it('derives relative boost from absolute charge pressure and ambient pressure', () => {
    const d = set.derived.find((x) => x.channel.id === 'boost.actual')!
    expect(d.inputs).toEqual(['boost.charge_abs', 'boost.ambient'])
    expect(d.compute([2.1, 1.0])).toBeCloseTo(1.1, 9)
  })

  it('offers the remaining measurements in the DME group, skipping unscaled unitless values', () => {
    const other = byId.get('dme.7007')!
    expect(other.channel).toMatchObject({ group: 'DME', unit: 'bar', quantity: 'pressure', name: 'Irgendein Druck' })
    expect(other.composable).toBe(false)
    expect(byId.has('dme.7008')).toBe(false)
  })

  it('names results from their description, in English', () => {
    expect(measurementName(meas({ result: 'STAT_0x1234_WERT', info: 'Massenstrom über Drosselklappe' }))).toBe('Mass flow via throttle valve')
    expect(measurementName(meas({ result: 'STAT_EGRVLV_RACT_WERT', info: 'Abgasrückführsteller Hochdruck - Istposition' }))).toBe('EGR actuator high pressure - actual position')
    // a broken character stays visible
    expect(measurementName(meas({ result: 'STAT_0x1234_WERT', info: 'Massenstrom �ber Drosselklappe' }))).toBe('Mass flow ?ber throttle valve')
  })

  it('falls back to the result name without a description', () => {
    expect(measurementName(meas({ result: 'STAT_LADEDRUCK_REGELDIFFERENZ_WERT', info: '' }))).toBe('Ladedruck Regeldifferenz')
  })
})

// Invented DIDs and scalings; the result names follow the DDE 7.x / 8.x SGBD style.
const DDE: BmwDme = {
  sgbd: 'testdde', name: 'Test DDE', comment: '', chassis: ['X31'], engines: ['X47'], family: 'DDE', diagAddress: 0x12, sgbdIndexes: [0xf2427],
  measurements: [
    meas({ did: 0x7101, result: 'STAT_MOTORDREHZAHL_WERT', unit: 'rpm' }),
    meas({ did: 0x7102, result: 'STAT_RAILDRUCK_WERT', info: 'maximaler Raildruck der letzten 10ms', unit: 'bar' }),
    meas({ did: 0x7103, result: 'STAT_RAILP_PCURR_WERT', info: 'Raildruck - Istwert', unit: 'bar' }),
    meas({ did: 0x7104, result: 'STAT_LAMBDA0_WERT', unit: '', mul: 0.001 }),
    meas({ did: 0x710d, result: 'STAT_EGSSIG_RATLAMENGINEDS_WERT', unit: '', mul: 0.001 }),
    meas({ did: 0x7105, result: 'STAT_TRBHP_RACT_WERT', unit: '%', mul: 0.01 }),
    meas({ did: 0x7106, result: 'STAT_TRBHP_R_WERT', unit: '%', mul: 0.01 }),
    meas({ did: 0x7107, result: 'STAT_EGRVLV_RACT_WERT', unit: '%', mul: 0.01 }),
    meas({ did: 0x7108, result: 'STAT_DIFFERENZDRUCK_UEBER_PARTIKELFILTER_WERT', unit: 'hPa', mul: 0.1 }),
    meas({ did: 0x7109, result: 'STAT_STRECKE_SEIT_ERFOLGREICHER_REGENERATION_WERT', unit: 'm', type: 'u32' }),
    meas({ did: 0x710a, result: 'STAT_RUSSMASSE_IM_PARTIKELFILTER_WERT', unit: 'g', mul: 0.01 }),
    meas({ did: 0x710b, result: 'STAT_EINSPRITZMENGE_AKTUELL_WERT', unit: 'mg/stroke', mul: 0.01 }),
    meas({ did: 0x710c, result: 'STAT_ABGASTEMPERATUR_VOR_PARTIKELFILTER_1_WERT', unit: '°C', mul: 0.1 })
  ]
}

describe('buildDmeChannelSet on a diesel ECU (DDE)', () => {
  const set = buildDmeChannelSet(DDE)
  const byId = new Map(set.reads.map((r) => [r.channel.id, r]))

  it('maps turbo, EGR, DPF, injection and EGT measurements onto diesel channels', () => {
    expect(byId.get('turbo.vnt.actual')!.did).toBe(0x7105)
    expect(byId.get('turbo.vnt.target')!.did).toBe(0x7106)
    expect(byId.get('egr.hp.actual')!.channel).toMatchObject({ group: 'EGR', unit: '%' })
    expect(byId.get('dpf.soot_measured')!.channel).toMatchObject({ group: 'Exhaust', unit: 'g' })
    expect(byId.get('fuel.inj_qty')!.channel).toMatchObject({ unit: 'mg/stroke' })
    expect(byId.get('exhaust.egt_pre_dpf')!.channel).toMatchObject({ unit: '°C', group: 'Exhaust' })
  })

  it('prefers the actual rail pressure over the 10 ms maximum', () => {
    expect(byId.get('fuel.rail.actual')!.did).toBe(0x7103)
  })

  it('shows DPF differential pressure in mbar and distance since regeneration in km', () => {
    const dp = byId.get('dpf.diff_pressure')!
    expect(dp.channel).toMatchObject({ unit: 'mbar', quantity: 'pressure' })
    expect(dp.decode(Buffer.from([0x03, 0xe8]))).toBeCloseTo(100, 6) // 1000 * 0.1 hPa = 100 mbar
    const dist = byId.get('dpf.dist_since_regen')!
    expect(dist.channel).toMatchObject({ unit: 'km', quantity: 'distance' })
    expect(dist.decode(Buffer.from([0x00, 0x00, 0x30, 0x39]))).toBeCloseTo(12.345, 6)
  })

  it('prefers the engine-out lambda the DDE itself uses over the raw LSU value', () => {
    expect(byId.get('fuel.lambda.actual')!.did).toBe(0x710d)
  })

  it('uses a diesel graph range for lambda', () => {
    expect(byId.get('fuel.lambda.actual')!.channel).toMatchObject({ unit: 'λ', min: 1, max: 5 })
    expect(buildDmeChannelSet({ ...DDE, family: 'DME' }).reads.find((r) => r.channel.id === 'fuel.lambda.actual')!.channel.max).toBe(1.2)
  })

  it('leaves the petrol test DME without diesel channels', () => {
    const petrol = buildDmeChannelSet(DME).reads.map((r) => r.channel.id)
    expect(petrol.some((id) => /^(turbo|egr|dpf|scr|exhaust)\./.test(id))).toBe(false)
  })
})

describe('resolveDme', () => {
  const pack = { format: 1 as const, source: 't', importedAt: '', dmes: [DME, { ...DME, sgbd: 'other', sgbdIndexes: [] }] }
  it('auto-selects by the diagnostic index, honors manual choice and off', () => {
    expect(resolveDme(pack, 'auto', 0xf2426)?.sgbd).toBe('testdme')
    expect(resolveDme(pack, 'auto', 0x123)).toBeUndefined()
    expect(resolveDme(pack, 'auto', undefined)).toBeUndefined()
    expect(resolveDme(pack, 'other', undefined)?.sgbd).toBe('other')
    expect(resolveDme(pack, 'off', 0xf2426)).toBeUndefined()
    expect(resolveDme(null, 'auto', 0xf2426)).toBeUndefined()
  })
})
