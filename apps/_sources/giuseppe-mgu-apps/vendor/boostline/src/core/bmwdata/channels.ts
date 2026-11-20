import type { ChannelDef, ChannelGroup, Quantity } from '@shared/types'
import { decodeMeasurement, VALUE_SIZE } from './sgbdRow'
import { translateGerman } from './translate'
import type { BmwDataPack, BmwDme, BmwMeasurement, DmeChannelRead, DmeChannelSet, DmeDerivedChannel } from './types'

// Turns a DME's imported measurements into Boostline channels.
//
// Curated rules map the measurements tuners log most (boost, wastegate, rail
// pressure, lambda, timing, VANOS, ...) onto Boostline's well-known channel ids with English
// names, so presets, the Dyno and Drag tools work on every DME family. The rules match the
// SGBD result name first, then the German description (INFO) — many MEVD17 / S55 entries
// only have generic result names like STAT_0x4206_WERT. Umlauts in INFO may have been lost
// (U+FFFD), so INFO patterns use "." where an umlaut would be.
// Every other numeric measurement is offered in the "DME" group under its SGBD name.

interface UnitMapping {
  unit: string
  quantity: Quantity
  factor: number
  offset?: number
}

/** SGBD unit → Boostline native unit (pressures to bar, millivolts to volts, ...). */
const UNIT_MAP: Readonly<Record<string, UnitMapping>> = {
  hPa: { unit: 'bar', quantity: 'pressure', factor: 0.001 },
  kPa: { unit: 'bar', quantity: 'pressure', factor: 0.01 },
  MPa: { unit: 'bar', quantity: 'pressure', factor: 10 },
  bar: { unit: 'bar', quantity: 'pressure', factor: 1 },
  rpm: { unit: 'rpm', quantity: 'rpm', factor: 1 },
  '°C': { unit: '°C', quantity: 'temperature', factor: 1 },
  '°CRK': { unit: '°CRK', quantity: 'angle', factor: 1 },
  '°': { unit: '°', quantity: 'angle', factor: 1 },
  '%': { unit: '%', quantity: 'percent', factor: 1 },
  '% DK': { unit: '%', quantity: 'percent', factor: 1 },
  'km/h': { unit: 'km/h', quantity: 'speed', factor: 1 },
  Nm: { unit: 'Nm', quantity: 'torque', factor: 1 },
  'kg/h': { unit: 'kg/h', quantity: 'massFlow', factor: 1 },
  V: { unit: 'V', quantity: 'voltage', factor: 1 },
  mV: { unit: 'V', quantity: 'voltage', factor: 0.001 },
  A: { unit: 'A', quantity: 'current', factor: 1 },
  mA: { unit: 'A', quantity: 'current', factor: 0.001 },
  ms: { unit: 'ms', quantity: 'time', factor: 1 },
  s: { unit: 's', quantity: 'time', factor: 1 },
  mm: { unit: 'mm', quantity: 'none', factor: 1 },
  m: { unit: 'm', quantity: 'distance', factor: 1 },
  km: { unit: 'km', quantity: 'distance', factor: 1 },
  'L/h': { unit: 'L/h', quantity: 'volumeFlow', factor: 1 },
  'l/h': { unit: 'L/h', quantity: 'volumeFlow', factor: 1 }
}

const unitOf = (m: BmwMeasurement): UnitMapping => UNIT_MAP[m.unit] ?? { unit: m.unit, quantity: 'none', factor: 1 }

interface Rule {
  id: string
  name: string
  group: ChannelGroup
  /** Matched against the SGBD result name. A list is tried in order: the first pattern that finds a measurement wins. */
  result?: RegExp | RegExp[]
  /** Matched against the German description when no result name matched. */
  info?: RegExp
  /** Rejects candidates whose result name or description matches. */
  exclude?: RegExp
  /** Acceptable SGBD units (normalised); any when omitted. */
  units?: string[]
  /** Overrides the native unit/quantity (e.g. unitless lambda → λ). */
  as?: { unit: string; quantity: Quantity }
  /** Applied after SGBD scaling and unit mapping. */
  transform?: (v: number) => number
  decimals: number
  min?: number
  max?: number
  /** Graph range on a diesel ECU (DDE), when it differs from the petrol one (e.g. lambda). */
  dieselRange?: [number, number]
}

const EXCLUDE_RAW = /ROH|SPANNUNG|SPG_|_SPG|ADAPT|OFFS|DIAG|ZAEHLER|FEHLER|GRENZ|SCHWELLE|MAX_|MIN_|_MAX|_MIN|FREEZE|STATUS/i

const PER_CYLINDER = [1, 2, 3, 4, 5, 6, 7, 8]

// Diesel (DDE 7.x / 8.x: N47, N57, B47, B57) measurements with no petrol counterpart. The
// DDE SGBDs use Bosch EDC17/MD1 labels (TRBHP = high-pressure turbine, TRBLP = low-pressure
// turbine, EGRVLV = EGR valve, PFlt = particulate filter). Petrol DMEs have none of these
// names, so the rules simply find nothing there.
const DIESEL_RULES: Rule[] = [
  { id: 'fuel.inj_qty', name: 'Injection quantity', group: 'Fuel', result: /^STAT_EINSPRITZMENGE_AKTUELL_WERT$/, info: /^Einspritzmenge - aktueller Wert$/i, units: ['mg/stroke'], decimals: 1, min: 0, max: 80 },
  { id: 'fuel.inj_qty_target', name: 'Injection quantity target', group: 'Fuel', result: /^STAT_EINSPRITZMENGE_SOLL_WERT$/, units: ['mg/stroke'], decimals: 1, min: 0, max: 80 },
  { id: 'load.air_per_stroke', name: 'Air mass per stroke', group: 'Load', result: /^STAT_LUFTMASSE_PRO_HUB_WERT$/, units: ['mg/stroke'], decimals: 0, min: 0, max: 2000 },
  { id: 'load.air_per_stroke_target', name: 'Air mass per stroke target', group: 'Load', result: /^STAT_LUFTMASSE_SOLL_WERT$/, units: ['mg/stroke'], decimals: 0, min: 0, max: 2000 },
  { id: 'temp.fuel', name: 'Fuel temp', group: 'Temperatures', result: /^STAT_KRAFTSTOFFTEMPERATUR_WERT$/, info: /^Kraftstofftemperatur$/i, units: ['°C'], decimals: 1, min: -20, max: 100 },
  { id: 'temp.charge_hp', name: 'Charge air temp after HP compressor', group: 'Temperatures', result: /^STAT_CMPRHP2DST_T_WERT$/, units: ['°C'], decimals: 1 },

  // Turbochargers. Single-turbo DDEs: TRBCH = VNT actuator. Two-stage (B47 TwinPower, B57):
  // TRBHP = HP turbine VNT, TRBHPBYP = HP turbine bypass, CMPRHPBYP = HP compressor bypass, TRBLP = LP turbine.
  { id: 'turbo.vnt.actual', name: 'VNT position (HP turbo)', group: 'Turbo', result: /^STAT_TRBHP_RACT_WERT$|^STAT_TRBCH_RACT_WERT$/, units: ['%'], decimals: 1, min: 0, max: 100 },
  { id: 'turbo.vnt.target', name: 'VNT target (HP turbo)', group: 'Turbo', result: /^STAT_TRBHP_R_WERT$|^STAT_TRBCH_R_WERT$/, units: ['%'], decimals: 1, min: 0, max: 100 },
  { id: 'turbo.vnt.duty', name: 'VNT actuator duty (HP turbo)', group: 'Turbo', result: /^STAT_LADEDRUCKSTELLER_ANSTEUERUNG_WERT$|^STAT_TRBCH_RDES_WERT$/, units: ['%'], decimals: 1, min: 0, max: 100 },
  { id: 'turbo.hp_bypass.actual', name: 'HP turbine bypass position', group: 'Turbo', result: /^STAT_TRBHPBYP_RACT_WERT$/, units: ['%'], decimals: 1, min: 0, max: 100 },
  { id: 'turbo.hp_bypass.target', name: 'HP turbine bypass target', group: 'Turbo', result: /^STAT_TRBHPBYP_R_WERT$/, units: ['%'], decimals: 1, min: 0, max: 100 },
  { id: 'turbo.cmpr_bypass.actual', name: 'HP compressor bypass position', group: 'Turbo', result: /^STAT_CMPRHPBYP_RACT_WERT$/, units: ['%'], decimals: 1, min: 0, max: 100 },
  { id: 'turbo.lp_vnt.actual', name: 'LP turbine actuator position', group: 'Turbo', result: /^STAT_TRBLP_RACT_WERT$/, units: ['%'], decimals: 1, min: 0, max: 100 },
  { id: 'turbo.lp_vnt.target', name: 'LP turbine actuator target', group: 'Turbo', result: /^STAT_TRBLP_R_WERT$/, units: ['%'], decimals: 1, min: 0, max: 100 },
  { id: 'turbo.lp_bypass.actual', name: 'LP turbine bypass position', group: 'Turbo', result: /^STAT_TRBLPBYP_RACT_WERT$/, units: ['%'], decimals: 1, min: 0, max: 100 },
  { id: 'boost.target_lp_abs', name: 'Boost target LP stage (absolute)', group: 'Boost', result: /^STAT_PCR_PDESVALLP_WERT$/, units: ['hPa', 'kPa'], decimals: 3, min: 0.5, max: 3.5 },
  { id: 'boost.deviation', name: 'Boost control deviation', group: 'Boost', result: /^STAT_PCR_PGOVDVT_WERT$/, units: ['hPa', 'kPa'], decimals: 3, min: -0.5, max: 0.5 },
  { id: 'exhaust.pre_turbine_abs', name: 'Exhaust pressure before turbine (absolute)', group: 'Turbo', result: /^STAT_EXH_PTRBNUS_WERT$/, info: /^Druck vor Turbine$/i, units: ['hPa', 'kPa'], decimals: 3, min: 0.8, max: 5 },

  // EGR
  { id: 'egr.hp.actual', name: 'EGR valve position (HP)', group: 'EGR', result: /^STAT_EGRVLV_RACT_WERT$/, units: ['%'], decimals: 1, min: 0, max: 100 },
  { id: 'egr.hp.target', name: 'EGR valve target (HP)', group: 'EGR', result: /^STAT_EGRVLV_RDESEGR_WERT$|^STAT_EGRVLV_R_WERT$/, exclude: /Ausgangstast/i, units: ['%'], decimals: 1, min: 0, max: 100 },
  { id: 'egr.lp.actual', name: 'EGR valve position (LP)', group: 'EGR', result: /^STAT_EGRVLVLP_RACT_WERT$/, units: ['%'], decimals: 1, min: 0, max: 100 },
  { id: 'egr.lp.target', name: 'EGR valve target (LP)', group: 'EGR', result: /^STAT_EGRVLVLP_R_WERT$/, units: ['%'], decimals: 1, min: 0, max: 100 },
  { id: 'throttle.diesel.actual', name: 'Throttle flap position', group: 'Throttle', result: /^STAT_THRVLV_RACT_WERT$/, units: ['%'], decimals: 1, min: 0, max: 100 },
  { id: 'throttle.swirl.actual', name: 'Swirl flap position', group: 'Throttle', result: /^STAT_VSWVLV_RACT_WERT$/, units: ['%'], decimals: 1, min: 0, max: 100 },

  // Exhaust gas temperatures and aftertreatment (DPF, SCR / AdBlue, NOx)
  { id: 'exhaust.egt_manifold', name: 'EGT after manifold (model)', group: 'Exhaust', result: /^STAT_ASMOD_TEXHMNFUS_WERT$/, units: ['°C'], decimals: 0, min: 0, max: 900 },
  { id: 'exhaust.egt_pre_cat', name: 'EGT before catalyst', group: 'Exhaust', result: /^STAT_ABGASTEMPERATUR_VOR_KATALYSATOR_WERT$|^STAT_TOXICATUS_T_WERT$/, units: ['°C'], decimals: 0, min: 0, max: 900 },
  { id: 'exhaust.egt_pre_dpf', name: 'EGT before DPF', group: 'Exhaust', result: /^STAT_ABGASTEMPERATUR_VOR_PARTIKELFILTER_1_WERT$|^STAT_TPFLTUS_T_WERT$/, units: ['°C'], decimals: 0, min: 0, max: 900 },
  { id: 'exhaust.egt_pre_scr', name: 'EGT before SCR', group: 'Exhaust', result: /^STAT_UCATUST_T_WERT$/, units: ['°C'], decimals: 0, min: 0, max: 900 },
  { id: 'dpf.soot_measured', name: 'DPF soot mass (measured)', group: 'Exhaust', result: /^STAT_RUSSMASSE_IM_PARTIKELFILTER_WERT$/, units: ['g'], decimals: 1, min: 0, max: 50 },
  { id: 'dpf.soot_simulated', name: 'DPF soot mass (calculated)', group: 'Exhaust', result: /^STAT_PARTIKELMASSE_SIMULIERT_WERT$/, units: ['g'], decimals: 1, min: 0, max: 50 },
  { id: 'dpf.diff_pressure', name: 'DPF differential pressure', group: 'Exhaust', result: /^STAT_DIFFERENZDRUCK_UEBER_PARTIKELFILTER_WERT$/, info: /^korrigierter Differenzdruck$/i, units: ['hPa', 'kPa'], as: { unit: 'mbar', quantity: 'pressure' }, transform: (bar) => bar * 1000, decimals: 0, min: 0, max: 400 },
  { id: 'dpf.dist_since_regen', name: 'Distance since last DPF regen', group: 'Exhaust', result: /^STAT_STRECKE_SEIT_ERFOLGREICHER_REGENERATION_WERT$/, units: ['m'], as: { unit: 'km', quantity: 'distance' }, transform: (m) => m / 1000, decimals: 1 },
  { id: 'dpf.fuel_since_regen', name: 'Fuel since last DPF regen', group: 'Exhaust', result: /^STAT_KRAFTSTOFFVERBRAUCH_SEIT_ERFOLGREICHER_REGENER_WERT$/, units: ['l'], decimals: 1 },
  { id: 'dpf.avg_regen_interval', name: 'Average DPF regen interval', group: 'Exhaust', result: /^STAT_DURCHSCHNITT_KILOMETER_ZWISCHEN_REGENERATIONEN_WERT$/, units: ['km'], decimals: 0 },
  { id: 'dpf.regen_request', name: 'DPF regeneration request', group: 'Exhaust', result: /^STAT_PFLTRGN_NUMRGN_WERT$/, decimals: 0 },
  { id: 'scr.adblue_level', name: 'AdBlue level', group: 'Exhaust', result: /^STAT_UDC_RUTNKLVLFLT_WERT$/, units: ['%'], decimals: 0, min: 0, max: 100 },
  { id: 'scr.adblue_range', name: 'AdBlue range', group: 'Exhaust', result: /^STAT_COM_LMLGRMNTNK_WERT$/, units: ['km'], decimals: 0 },
  { id: 'scr.nox_pre', name: 'NOx before SCR', group: 'Exhaust', result: /^STAT_EXH_RNOXPRESCOMPNSCDS_WERT$/, units: ['ppm'], decimals: 0, min: 0, max: 1500 },
  { id: 'scr.nox_post', name: 'NOx after SCR', group: 'Exhaust', result: /^STAT_EXH_RNOXPRESCOMPNOCAT2DS_WERT$/, units: ['ppm'], decimals: 0, min: 0, max: 500 }
]

const RULES: Rule[] = [
  { id: 'engine.rpm', name: 'Engine speed', group: 'Engine', result: /^STAT_MOTORDREHZAHL_WERT$/, info: /^Motordrehzahl$/i, units: ['rpm'], decimals: 0, min: 0, max: 7500 },
  { id: 'engine.oil_pressure', name: 'Oil pressure', group: 'Engine', result: /^STAT_OELDRUCK_WERT$/, info: /^.ldruck$/i, units: ['hPa', 'kPa', 'bar'], decimals: 2 },

  { id: 'throttle.pedal', name: 'Accelerator pedal', group: 'Throttle', result: /FAHRERWUNSCH_PEDAL|^STAT_FAHRPEDAL(WERT)?_WERT$/, info: /Fahrpedal/i, exclude: /BUS_|ROH|SPANNUNG/i, units: ['%'], decimals: 1, min: 0, max: 100 },
  { id: 'throttle.position', name: 'Throttle angle', group: 'Throttle', result: /^STAT_DROSSELKLAPPENWINKEL_WERT$/, info: /^Drosselklappenwinkel$/i, units: ['%', '% DK'], decimals: 1, min: 0, max: 100 },
  { id: 'throttle.target', name: 'Throttle angle target', group: 'Throttle', result: /^STAT_DROSSELKLAPPENWINKEL_SOLL_WERT$/, info: /Drosselklappenwinkel.*soll|Sollwert Drosselklappe/i, units: ['%', '% DK'], decimals: 1, min: 0, max: 100 },

  { id: 'load.maf', name: 'Air mass flow', group: 'Load', result: /^STAT_LUFTMASSE_WERT$|^STAT_HFM_MASSENSTROM_MITTEL_IST_WERT$/, info: /^Luftmasse(nstrom)?( gefiltert)?$/i, units: ['kg/h'], decimals: 1, min: 0, max: 1400 },
  { id: 'load.maf_throttle', name: 'Air mass through throttle', group: 'Load', result: /MASSENSTROM_DK(_BANK1)?_WERT$/, info: /Massenstrom .ber Drosselklappe/i, exclude: /BANK2|Bank 2/, units: ['kg/h'], decimals: 1, min: 0, max: 1400 },
  { id: 'load.engine', name: 'Engine load', group: 'Load', result: /^STAT_(I_)?(REL_)?FUELLUNG_WERT$|RELATIVE_LUFTFUELLUNG/, info: /relative (Luft)?f.llung( ist)?$/i, exclude: /SOLL|_S_/, units: ['%'], decimals: 1 },
  { id: 'load.engine_target', name: 'Engine load target', group: 'Load', result: /^STAT_S_FUELLUNG_WERT$|FUELLUNG_SOLL/, info: /f.llung.*soll|Sollf.llung|^Sollwert F.llung/i, units: ['%'], decimals: 1 },
  { id: 'load.torque.actual', name: 'Engine torque', group: 'Load', result: /ISTMOMENT_OHNE|^STAT_(I_)?MOTORMOMENT(_IST|_AKTUELL)?_WERT$|MOMENT_IST_WERT$/, info: /^(Motor)?(ist)?moment( ist)?$/i, exclude: /KUPPL|RAD|RESERVE|EMASCHINE|ADAPT|MSR/i, units: ['Nm'], decimals: 0 },
  { id: 'load.torque.driver', name: 'Driver torque request', group: 'Load', result: /FAHRERWUNSCHMOMENT/, info: /Fahrerwunsch(moment)?/i, exclude: /PEDAL/i, units: ['Nm'], decimals: 0 },
  { id: 'load.torque.reserve', name: 'Torque reserve target', group: 'Load', result: /MOMENT_RESERVE_SOLL|MOMENTENRESERVE/, info: /Momentenreserve/i, units: ['Nm'], decimals: 0 },

  { id: 'boost.charge_abs', name: 'Boost pressure (absolute)', group: 'Boost', result: /^STAT_LADEDRUCK_WERT$|^STAT_I_LADEDRUCK_WERT$/, info: /^Ladedruck( ist)?$/i, units: ['hPa', 'kPa'], decimals: 3, min: 0.5, max: 3.5 },
  { id: 'boost.target_abs', name: 'Boost target (absolute)', group: 'Boost', result: /^STAT_S_LADEDRUCK_WERT$|LADEDRUCK_SOLL_WERT$|SOLLLADEDRUCK/, info: /Ladedruck.*soll|Sollladedruck/i, exclude: /REGELDIFF|BEGRENZ/i, units: ['hPa', 'kPa'], decimals: 3, min: 0.5, max: 3.5 },
  { id: 'boost.map', name: 'Manifold pressure (absolute)', group: 'Boost', result: /^STAT_SAUGROHRDRUCK_WERT$|^STAT_DRUCK_ABS_SAUGROHR_WERT$/, info: /^Saugrohrdruck$/i, units: ['hPa', 'kPa'], decimals: 3, min: 0, max: 3.5 },
  { id: 'boost.ambient', name: 'Barometric pressure', group: 'Boost', result: /^STAT_UMGEBUNGSDRUCK_WERT$/, info: /^Umgebungsdruck$/i, units: ['hPa', 'kPa'], decimals: 3, min: 0.7, max: 1.1 },
  { id: 'boost.wg_actual', name: 'Wastegate position', group: 'Boost', result: /^STAT_I_EWG_POS_WERT$|EWG_POS(ITION)?_IST/, info: /Wastegate.*(ist|Position)/i, exclude: /BANK2|_2_WERT|SOLL|ROH|SPANNUNG/i, units: ['%'], decimals: 1, min: 0, max: 100 },
  { id: 'boost.wg_target', name: 'Wastegate target', group: 'Boost', result: /^STAT_SOLL_POS_EWG_WERT$|EWG_POS(ITION)?_SOLL/, info: /Wastegate.*soll/i, exclude: /BANK2|EWG2/i, decimals: 2 },

  { id: 'fuel.rail.actual', name: 'Rail pressure', group: 'Fuel', result: /^STAT_I_DRUCK_RAIL_ABS_FILT(_NEU)?_WERT$|^STAT_RAILDRUCK(_IST)?_WERT$|PRAIL_IST|^STAT_RAILP_PCURR_WERT$/, info: /Gefilterter Raildruck-?Istwert|^Raildruck-?Istwert|^Raildruck( ist| gefiltert)?$|^Raildruck - Istwert$/i, exclude: /ROH|SOLL|OFFS|KORR|SPANNUNG|ungefiltert|maximal/i, units: ['MPa', 'hPa', 'kPa', 'bar'], decimals: 1, min: 0, max: 400 },
  { id: 'fuel.rail.target', name: 'Rail pressure target', group: 'Fuel', result: /^STAT_S_RAILDRUCKREGELUNG(_NEU)?_WERT$|RAILDRUCK_SOLL|SOLL_RAILDRUCK/, info: /Raildruck.*soll|Sollwert Raildruck|Sollraildruck|Solldruck Hochdrucksystem/i, units: ['MPa', 'hPa', 'kPa', 'bar'], decimals: 1, min: 0, max: 400 },
  { id: 'fuel.lpfp', name: 'Low-side fuel pressure', group: 'Fuel', result: /NIEDERDRUCK.*WERT$|KRAFTSTOFFNIEDERDRUCK/, info: /Kraftstoffniederdruck|Niederdruck( ist)?$/i, exclude: /SPANNUNG|SPG|SOLL/i, units: ['kPa', 'hPa', 'bar', 'MPa'], decimals: 2 },
  { id: 'fuel.lambda.actual', name: 'Lambda', group: 'Fuel', result: [
    /^STAT_LAMBDA_SONDE_IST_WERT$|^STAT_LAMBDA(_BANK1)?_IST(WERT)?_WERT$|LAMBDA_ISTWERT_SENSOR1_BANK1/,
    // DDE 8: the engine-out sensor as the ECU uses it (EGSSig); the raw LSU value (LAMBDA0) is not readable on every DDE
    /^STAT_EGSSIG_RATLAMENGINEDS_WERT$/, /^STAT_UEGO_RLAMS1B1_WERT$/, /^STAT_LAMBDA0_WERT$/
  ], info: /^Lambda(wert)? ist|Lambda-?Istwert/i, exclude: /BANK2|Bank 2|OFFSET|ADAP|ABWEICH|WIDERSTAND|ZUSTAND/i, as: { unit: 'λ', quantity: 'lambda' }, decimals: 3, min: 0.7, max: 1.2, dieselRange: [1, 5] },
  { id: 'fuel.lambda.target', name: 'Lambda target', group: 'Fuel', result: /^STAT_LAMBDA_BANK1_SOLL_WERT$|^STAT_LAMBDA_SONDE_SOLL_WERT$|LAMBDA_SOLL_WERT$/, info: /Lambda.*soll|Lambdasollwert/i, exclude: /BANK2|Bank 2|KENNZAHL/i, as: { unit: 'λ', quantity: 'lambda' }, decimals: 3, min: 0.7, max: 1.2 },
  { id: 'fuel.ltft', name: 'Long-term fuel trim', group: 'Fuel', result: /ADAPTION_MULTIPLIKATIV(_BANK1|_GRUPPE1)_WERT$/, info: /multiplikative (Gemisch)?adaption.*(Bank 1|Gruppe 1)/i, as: { unit: '%', quantity: 'percent' }, transform: (v) => (v - 1) * 100, decimals: 1, min: -25, max: 25 },
  { id: 'fuel.inj_time', name: 'Injection time', group: 'Fuel', result: /EINSPRITZZEIT(_ZYL1)?_WERT$|^STAT_TI_WERT$/, info: /^Einspritzzeit/i, units: ['ms'], decimals: 2 },

  { id: 'ign.avg', name: 'Ignition timing (average)', group: 'Ignition', result: /^STAT_I_ZUENDWINKEL_WERT$|^STAT_ZW_AUSGABE_BANK1_WERT$|^STAT_ZUENDWINKEL_WERT$/, info: /^Z.ndwinkel( ist)?$/i, units: ['°CRK', '°'], decimals: 1, min: -10, max: 50 },
  ...PER_CYLINDER.map<Rule>((n) => ({
    id: `ign.cyl${n}`,
    name: `Ignition timing cyl ${n}`,
    group: 'Ignition',
    result: new RegExp(`^STAT_ZUENDWINKEL_ZYL${n}_WERT$`),
    info: new RegExp(`^Z.ndwinkel Zylinder ${n}$`, 'i'),
    units: ['°CRK', '°'],
    decimals: 1,
    min: -10,
    max: 50
  })),
  ...PER_CYLINDER.map<Rule>((n) => ({
    id: `knock.signal.cyl${n}`,
    name: `Knock signal cyl ${n}`,
    group: 'Knock',
    result: new RegExp(`^STAT_KLOPFWERT_ZYL${n}(_SPANNUNG)?_WERT$`),
    info: new RegExp(`^Klopfwert Zylinder ${n}`, 'i'),
    decimals: 3
  })),

  { id: 'temp.intake', name: 'Intake air temp', group: 'Temperatures', result: /^STAT_TEMP_ANSLUFT1?(_FILT)?_WERT$|^STAT_ANSAUGLUFTTEMPERATUR(_1)?_WERT$/, info: /^Ansauglufttemperatur( 1)?$/i, exclude: EXCLUDE_RAW, units: ['°C'], decimals: 1, min: -20, max: 90 },
  { id: 'temp.charge', name: 'Charge air temp', group: 'Temperatures', result: /LADELUFTTEMPERATUR|TEMP_LADELUFT|TEMP_NACH_LLK/, info: /Ladelufttemperatur/i, exclude: EXCLUDE_RAW, units: ['°C'], decimals: 1, min: -20, max: 90 },
  { id: 'temp.coolant', name: 'Coolant temp', group: 'Temperatures', result: /^STAT_KUEHLMITTELTEMPERATUR_WERT$|^STAT_TEMP_KUEHLMITTEL_WERT$/, info: /^K.hlmitteltemperatur$/i, units: ['°C'], decimals: 1, min: -20, max: 130 },
  { id: 'temp.oil', name: 'Oil temp', group: 'Temperatures', result: [
    /^STAT_OELTEMPERATUR_WERT$|^STAT_TEMP_OEL_SUMPF_WERT$/,
    // DDE 8: the oil temperature the ECU works with (the BMW layer's filtered value, the sump sensor); ITOEL
    // (STAT_MOTOROEL_TEMPERATUR) answers but stays at 0 on a B47 (DDE 8.03)
    /^STAT_SWSABMW_FILDOILT_WERT$/, /^STAT_OILSWMPT_T_WERT$/, /^STAT_OIL_TSWMP_WERT$/, /^STAT_MOTOROEL_TEMPERATUR_WERT$/
  ], info: /^.ltemperatur$/i, units: ['°C', '°'], as: { unit: '°C', quantity: 'temperature' }, decimals: 1, min: -20, max: 150 },
  { id: 'temp.ambient', name: 'Ambient temp', group: 'Temperatures', result: /^STAT_UMGEBUNGSTEMPERATUR_WERT$|^STAT_TEMP_UMGEBUNG_WERT$|AUSSENTEMPERATUR/, info: /^(Umgebungs|Au.en)temperatur$/i, units: ['°C'], decimals: 1, min: -30, max: 50 },
  { id: 'temp.exhaust', name: 'Exhaust temp', group: 'Temperatures', result: /ABGASTEMPERATUR(_VORKAT|_BANK1)?_WERT$/, info: /^Abgastemperatur/i, exclude: /BANK2|Bank 2|SOLL/i, units: ['°C'], decimals: 0 },
  { id: 'temp.trans', name: 'Transmission oil temp', group: 'Temperatures', result: /^STAT_TEMP_GETRIEBE_WERT$|GETRIEBEOELTEMP/, info: /Getriebe(.l)?temperatur/i, units: ['°C'], decimals: 1 },

  { id: 'vanos.intake.actual', name: 'Intake cam (VANOS)', group: 'VANOS', result: /^STAT_I_NWSE_SPREIZUNG_WERT$|^STAT_NW_EINLASSSPREIZUNG_WERT$|^STAT_POSITION_NOCKENWELLE_EINLASS_WERT$/, info: /Einlassspreizung( ist)?$|Nockenwelle Einlass( ist)?$/i, exclude: /SOLL|ADAP/i, units: ['°CRK', '°'], decimals: 1 },
  { id: 'vanos.intake.target', name: 'Intake cam target', group: 'VANOS', result: /^STAT_S_NWSE_SPREIZUNG_WERT$|SOLLWINKEL_EINLASSVANOS|EINLASSSPREIZUNG_SOLL/, info: /Einlassspreizung soll|Sollwinkel Einlass/i, units: ['°CRK', '°'], decimals: 1 },
  { id: 'vanos.exhaust.actual', name: 'Exhaust cam (VANOS)', group: 'VANOS', result: /^STAT_I_NWSA_SPREIZUNG_WERT$|^STAT_NW_AUSLASSSPREIZUNG_WERT$|^STAT_POSITION_NOCKENWELLE_AUSLASS_WERT$/, info: /Auslassspreizung( ist)?$|Nockenwelle Auslass( ist)?$/i, exclude: /SOLL|ADAP/i, units: ['°CRK', '°'], decimals: 1 },
  { id: 'vanos.exhaust.target', name: 'Exhaust cam target', group: 'VANOS', result: /^STAT_S_NWSA_SPREIZUNG_WERT$|SOLLWINKEL_AUSLASSVANOS|AUSLASSSPREIZUNG_SOLL/, info: /Auslassspreizung soll|Sollwinkel Auslass/i, units: ['°CRK', '°'], decimals: 1 },
  { id: 'vanos.valvelift', name: 'Valvetronic lift', group: 'VANOS', result: /^STAT_S_EINLASSVENTILHUB(_FILT)?_WERT$|^STAT_EINLASSVENTILHUB_WERT$/, info: /Einlassventilhub/i, exclude: /ADAP|PRAEDIK/i, units: ['mm'], decimals: 2 },

  { id: 'vehicle.speed', name: 'Vehicle speed', group: 'Vehicle', result: /^STAT_GESCHWINDIGKEIT_WERT$|^STAT_FAHRZEUGGESCHWINDIGKEIT_WERT$/, info: /^(Fahrzeug)?geschwindigkeit$/i, units: ['km/h'], decimals: 1, min: 0, max: 300 },
  { id: 'vehicle.gear', name: 'Gear', group: 'Vehicle', result: /^STAT_BERECHNETER_GANG_WERT$|^STAT_ISTGANG_WERT$|^STAT_GANG_WERT$/, info: /^(berechneter |aktueller )?Gang$/i, as: { unit: 'gear', quantity: 'gear' }, decimals: 0, min: 0, max: 8 },
  { id: 'elec.battery', name: 'Battery voltage', group: 'Electrical', result: /^STAT_UBATT(_AD_WANDLER)?_WERT$|^STAT_BATTERIESPANNUNG_WERT$|^STAT_SPG_ECU_BORDNETZ_WERT$/, info: /^Batteriespannung$|^Bordnetzspannung$/i, units: ['V', 'mV'], decimals: 2, min: 10, max: 16 },
  ...DIESEL_RULES
]

/** Picks the measurement for a rule: result-name matches first, then description matches. */
function pick(rule: Rule, measurements: readonly BmwMeasurement[], taken: Set<number>): BmwMeasurement | undefined {
  const ok = (m: BmwMeasurement): boolean =>
    !taken.has(m.did) && (!rule.units || rule.units.includes(m.unit)) && !(rule.exclude && (rule.exclude.test(m.result) || rule.exclude.test(m.info)))
  for (const re of rule.result ? (Array.isArray(rule.result) ? rule.result : [rule.result]) : []) {
    const m = measurements.find((x) => ok(x) && re.test(x.result))
    if (m) return m
  }
  return (
    (rule.info && measurements.find((m) => ok(m) && rule.info!.test(m.info))) ||
    undefined
  )
}

/**
 * The name of a measurement: its description (INFO) in English (translate.ts), e.g. "Abgasrückführsteller
 * Hochdruck - Reglerposition" → "EGR actuator high pressure - controller position"; without one, the
 * result name's words ("STAT_LADEDRUCK_REGELDIFFERENZ_WERT" → "Ladedruck Regeldifferenz").
 */
export function measurementName(m: BmwMeasurement): string {
  const info = m.info.replace(/�/g, '?').trim()
  if (info) return translateGerman(info)
  const words = m.result
    .replace(/^STAT_/, '')
    .replace(/_WERT$/, '')
    .split('_')
    .filter(Boolean)
  return words.map((w) => (w.length <= 3 && /^[A-Z0-9]+$/.test(w) ? w : w[0] + w.slice(1).toLowerCase())).join(' ') || `DID 0x${m.did.toString(16)}`
}

/** A name the DME gives more than one value gets the value's DID. */
function uniqueName(name: string, m: BmwMeasurement, count: Map<string, number>): string {
  return (count.get(name) ?? 0) > 1 ? `${name} (DID ${m.did.toString(16).toUpperCase().padStart(4, '0')})` : name
}

function decimalsFor(m: BmwMeasurement, factor: number): number {
  const step = Math.abs((m.mul / m.div) * factor)
  if (!Number.isFinite(step) || step === 0) return 2
  return Math.min(4, Math.max(0, Math.ceil(-Math.log10(step))))
}

function makeRead(m: BmwMeasurement, channel: ChannelDef, transform?: (v: number) => number): DmeChannelRead {
  const map = unitOf(m)
  return {
    channel,
    did: m.did,
    length: VALUE_SIZE[m.type],
    composable: m.composable,
    decode: (data) => {
      const v = decodeMeasurement(m, data) * map.factor + (map.offset ?? 0)
      return transform ? transform(v) : v
    }
  }
}

/** Builds the channel set for one DME: curated channels, derived boost, then all other measurements. */
export function buildDmeChannelSet(dme: BmwDme): DmeChannelSet {
  const reads: DmeChannelRead[] = []
  const taken = new Set<number>()
  const ids = new Set<string>()
  for (const rule of RULES) {
    const m = pick(rule, dme.measurements, taken)
    if (!m) continue
    const map = unitOf(m)
    taken.add(m.did)
    ids.add(rule.id)
    const unit = rule.as?.unit ?? map.unit
    const quantity = rule.as?.quantity ?? map.quantity
    const channel: ChannelDef = {
      id: rule.id,
      name: rule.name,
      group: rule.group,
      unit,
      quantity,
      decimals: rule.decimals,
      min: dme.family === 'DDE' && rule.dieselRange ? rule.dieselRange[0] : rule.min,
      max: dme.family === 'DDE' && rule.dieselRange ? rule.dieselRange[1] : rule.max,
      description: `${m.result}${m.info ? ` · ${m.info}` : ''}`
    }
    reads.push(makeRead(m, channel, rule.transform))
  }

  const derived: DmeDerivedChannel[] = []
  const relative = (id: string, name: string, abs: string): void => {
    if (!ids.has(abs) || !ids.has('boost.ambient')) return
    derived.push({
      channel: { id, name, group: 'Boost', unit: 'bar', quantity: 'pressure', decimals: 3, min: -1, max: 2.5 },
      inputs: [abs, 'boost.ambient'],
      compute: ([p, amb]) => p - amb
    })
  }
  relative('boost.actual', 'Boost pressure', ids.has('boost.charge_abs') ? 'boost.charge_abs' : 'boost.map')
  relative('boost.target', 'Boost target', 'boost.target_abs')

  // names given more than once (the same description for several DIDs) get their DID
  const names = new Map<BmwMeasurement, string>()
  const nameCount = new Map<string, number>()
  for (const m of dme.measurements) {
    if (taken.has(m.did)) continue
    const n = measurementName(m)
    names.set(m, n)
    nameCount.set(n, (nameCount.get(n) ?? 0) + 1)
  }
  for (const m of dme.measurements) {
    if (taken.has(m.did)) continue
    const map = unitOf(m)
    // Unitless values are only useful when the SGBD scales them (ratios, factors).
    if (!map.unit && m.mul === 1 && m.div === 1 && m.add === 0) continue
    const id = `dme.${m.did.toString(16).padStart(4, '0')}`
    if (ids.has(id)) continue
    ids.add(id)
    taken.add(m.did)
    reads.push(
      makeRead(m, {
        id,
        name: uniqueName(names.get(m) ?? measurementName(m), m, nameCount),
        group: 'DME',
        unit: map.unit,
        quantity: map.quantity,
        decimals: decimalsFor(m, map.factor),
        description: `${m.result}${m.info ? ` · ${m.info}` : ''} (DID 0x${m.did.toString(16).toUpperCase()})`
      })
    )
  }
  return { name: `${dme.sgbd} · ${dme.name}`, sgbd: dme.sgbd, ecuAddress: dme.diagAddress, reads, derived }
}

/**
 * Chooses the DME data for a connection: an explicit SGBD name, 'off', or 'auto'
 * (the SGBD whose diagnostic indexes contain the index the DME reported via F150).
 */
export function resolveDme(pack: BmwDataPack | null, selection: string, sgbdIndex: number | undefined): BmwDme | undefined {
  if (!pack || selection === 'off') return undefined
  if (selection && selection !== 'auto') return pack.dmes.find((d) => d.sgbd === selection)
  if (sgbdIndex === undefined) return undefined
  return pack.dmes.find((d) => d.sgbdIndexes.includes(sgbdIndex))
}
