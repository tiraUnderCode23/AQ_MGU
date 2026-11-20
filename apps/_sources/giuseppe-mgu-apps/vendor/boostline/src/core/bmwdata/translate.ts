// German → English for the BMW data's measurement descriptions (SGBD INFO texts such as
// "Abgasrückführsteller Hochdruck - Reglerposition"), so the DME's/DDE's own values get
// readable English names. A dictionary of the words and word stems that occur in the data
// (dictionary.ts), German compounds split into known parts ("Funktionsüberwachung" →
// Funktion + s + Überwachung → "function monitoring"), adjective / plural endings stripped,
// and articles turned into "of" where German uses the genitive ("Anzahl der Fehler" →
// "number of faults"). Word order is kept: technical German puts modifiers first, as English
// does. Words it doesn't know stay as they are.

import { DE_EN } from './dictionary'

const ARTICLE = '=ART'

let dict: Map<string, string> | null = null
function dictionary(): Map<string, string> {
  if (dict) return dict
  dict = new Map()
  for (const line of DE_EN.split('\n')) {
    const tab = line.indexOf('\t')
    if (tab <= 0 || line.startsWith('#')) continue
    dict.set(line.slice(0, tab), line.slice(tab + 1))
  }
  return dict
}

/** ä → ae, ß → ss, lower case: the dictionary's spelling (the data mixes both). */
export function normalizeGerman(word: string): string {
  return word
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
}

/** English words after which a German article is just dropped ("in der" → "in"). */
const PREPOSITIONS = new Set([
  'in', 'after', 'before', 'from', 'for', 'to', 'with', 'without', 'at', 'via', 'on', 'by', 'between', 'during', 'since',
  'up to', 'within', 'outside', 'per', 'below', 'above', 'due to', 'against', 'according to', 'of', 'and', 'or', 'as', 'than', 'into', 'over'
])

/** Inflection endings tried when a word isn't in the dictionary as it stands. */
const ENDINGS = ['', 'e', 'en', 'er', 'es', 'em', 'n', 's', 'ns', 'ern', 'nen']
/** Linking letters between the parts of a compound (Funktion-s-überwachung). */
const LINKS = ['', 's', 'es', 'n', 'en', 'e', 'er']
/** Parts shorter than this are only taken when the dictionary marks them as parts. */
const MIN_PART = 3

function lookupInflected(w: string, endings: readonly string[]): string | undefined {
  const d = dictionary()
  for (const e of endings) {
    if (e && !w.endsWith(e)) continue
    const stem = e ? w.slice(0, -e.length) : w
    if (stem.length < 2) continue
    const hit = d.get(stem)
    if (hit !== undefined) return hit
  }
  return undefined
}

const splitCache = new Map<string, string[] | null>()

/**
 * The parts of a compound, translated, or null. Fewest parts win; every part is a dictionary
 * word (MIN_PART letters or more), linked by s / n / en / es / e, the last one with any ending.
 */
function splitCompound(w: string): string[] | null {
  const cached = splitCache.get(w)
  if (cached !== undefined) return cached
  const d = dictionary()
  const n = w.length
  const best: { parts: number; prev: number; en: string }[] = new Array(n + 1)
  best[0] = { parts: 0, prev: -1, en: '' }
  for (let i = 1; i <= n; i++) {
    for (let j = 0; j < i; j++) {
      if (!best[j]) continue
      const seg = w.slice(j, i)
      if (seg.length < MIN_PART) continue
      let en: string | undefined
      if (i === n) en = lookupInflected(seg, ENDINGS)
      else {
        for (const l of LINKS) {
          if (l && !seg.endsWith(l)) continue
          const stem = l ? seg.slice(0, -l.length) : seg
          if (stem.length < MIN_PART) continue
          en = d.get(stem)
          if (en !== undefined) break
        }
      }
      if (en === undefined || en === ARTICLE) continue
      const parts = best[j].parts + 1
      if (!best[i] || parts < best[i].parts) best[i] = { parts, prev: j, en }
    }
  }
  let out: string[] | null = null
  if (best[n] && best[n].parts > 1) {
    out = []
    for (let i = n; i > 0; i = best[i].prev) out.unshift(best[i].en)
  }
  splitCache.set(w, out)
  return out
}

/** Upper-case abbreviations of the German data, in English. */
const ACRONYMS: Record<string, string> = {
  AGR: 'EGR', SG: 'ECU', STG: 'ECU', DK: 'throttle', DKS: 'throttle actuator', HFM: 'MAF sensor', LLK: 'intercooler',
  KW: 'crankshaft', NW: 'camshaft', KAT: 'catalyst', FZG: 'vehicle', ZYL: 'cyl', MSG: 'message', NOX: 'NOx', EWP: 'electric water pump',
  ELUE: 'electric fan', EKP: 'electric fuel pump', VVT: 'Valvetronic', BDU: 'ignition coil', ASMOD: 'air system model',
  SCR: 'SCR', DPF: 'DPF', OBD: 'OBD', CAN: 'CAN', LIN: 'LIN', MIL: 'MIL', NMK: 'quantity control valve', ZMS: 'dual-mass flywheel',
  DMTL: 'tank leak pump', TEV: 'purge valve', HDP: 'high-pressure pump', MSV: 'quantity control valve', DRV: 'pressure control valve',
  KS: 'knock sensor', LS: 'lambda sensor', GLF: 'glow plug', GSG: 'glow control unit', OPF: 'petrol particulate filter',
  NSC: 'NOx storage catalyst', SCRF: 'SCR-coated DPF', MSA: 'auto start-stop', EBN: 'electronic power management',
  IBS: 'battery sensor', ECU: 'ECU', RAM: 'RAM', ROM: 'ROM', EEPROM: 'EEPROM', HD: 'HP', ND: 'LP', DFH: 'diesel filter heater',
  ISG: 'starter-generator', KL: 'terminal', LL: 'idle', VL: 'full load', TL: 'part load', KWP: 'KWP'
}

/** A word as English: dictionary, then inflected, then compound parts; null if unknown. */
function translateWord(word: string): string | null {
  if (/^[A-Z0-9_]+$/.test(word) && /[A-Z]/.test(word) && word.length >= 2) {
    // an abbreviation or an identifier: only a few are words in disguise
    const a = ACRONYMS[word]
    if (a !== undefined) return a
    const asWord = dictionary().get(normalizeGerman(word))
    return asWord !== undefined && asWord !== ARTICLE && word.length > 3 ? asWord : word
  }
  const w = normalizeGerman(word)
  const hit = lookupInflected(w, ENDINGS)
  if (hit !== undefined) return hit
  const parts = splitCompound(w)
  return parts ? parts.join(' ') : null
}

/**
 * The English for a German description. Unknown words stay German; the result starts with a
 * capital. "Abgasrückführsteller Hochdruck - Reglerposition" → "EGR actuator high pressure -
 * controller position".
 */
export function translateGerman(text: string): string {
  // a hyphen inside a German word joins two words (Soll-Motormoment → target engine torque)
  const plain = text.replace(/([A-Za-zÄÖÜäöüß])-([A-Za-zÄÖÜäöüß])/g, '$1 $2')
  const tokens = plain.replace(/\s+/g, ' ').trim().match(/[A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß0-9_]*|[^A-Za-zÄÖÜäöüß]+/g) ?? []
  const out: string[] = []
  let prevWord: string | null = null // last English word emitted (null at the start or after punctuation)
  for (const tok of tokens) {
    if (!/^[A-Za-zÄÖÜäöüß]/.test(tok)) {
      out.push(tok)
      // spaces and a hyphen join words (Soll-Motormoment), other punctuation starts afresh
      if (!/^[\s-]*$/.test(tok)) prevWord = null
      continue
    }
    const en = translateWord(tok)
    if (en === ARTICLE) {
      // genitive after a noun: "of"; after a preposition or at the start: nothing
      if (prevWord && !PREPOSITIONS.has(prevWord)) {
        out.push('of')
        prevWord = 'of'
      } else if (out.length && out[out.length - 1] === ' ') out.pop()
      continue
    }
    const word = en ?? tok
    out.push(word)
    prevWord = word.toLowerCase()
  }
  let s = out
    .join('')
    .replace(/\s+/g, ' ')
    .replace(/ ([,.)])/g, '$1')
    .replace(/\( /g, '(')
    .replace(/\bof of\b/g, 'of')
    .trim()
  if (s) s = s.charAt(0).toUpperCase() + s.slice(1)
  return s
}

/** For tests and the dictionary's upkeep: the words of a text the translation doesn't know. */
export function unknownWords(text: string): string[] {
  const words = text.match(/[A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß0-9_]*/g) ?? []
  return words.filter((w) => translateWord(w) === null)
}
