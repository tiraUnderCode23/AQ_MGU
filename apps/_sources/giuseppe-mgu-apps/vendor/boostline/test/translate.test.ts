import { describe, expect, it } from 'vitest'
import { normalizeGerman, translateGerman, unknownWords } from '@core/bmwdata/translate'

describe('translateGerman', () => {
  it.each([
    ['Abgasrückführsteller Hochdruck - Reglerposition', 'EGR actuator high pressure - controller position'],
    ['Abgastemperatur vor Katalysator', 'Exhaust gas temperature before catalyst'],
    ['Anzahl der Zyklen', 'Number of cycles'],
    ['Temperatur des Gehaeuses des AGR Differenzdrucksensors', 'Temperature of housing of EGR differential pressure sensor'],
    ['Lufttemperatur im Saugrohr', 'Air temperature in intake manifold'],
    ['Gefilterter Strömungswiderstand des Partikelfilters', 'Filtered flow resistance of particulate filter'],
    ['Soll-Motormoment', 'Target engine torque'],
    ['Solldrehzahl Wasserpumpe 48V (EWP20)', 'Target rpm water pump 48V (EWP20)']
  ])('%s', (de, en) => {
    expect(translateGerman(de)).toBe(en)
  })

  it('splits compounds, with linking letters and endings', () => {
    expect(translateGerman('Funktionsüberwachung')).toBe('Function monitoring')
    expect(translateGerman('Kennlinienwerte')).toBe('Characteristic curve values')
    expect(translateGerman('Turbinenbypass')).toBe('Turbine bypass')
  })

  it('keeps identifiers, numbers and unknown words as they are', () => {
    expect(translateGerman('Bitmaske fuer ungueltiges Signal in Botschaft (FX_AvlRpmWhl)')).toBe('Bit mask for invalid signal in message (FX_AvlRpmWhl)')
    expect(translateGerman('Codierparameter CodVar_stPlausMsk 2')).toBe('Coding parameter CodVar_stPlausMsk 2')
    expect(translateGerman('Xyzzyquux')).toBe('Xyzzyquux')
    expect(unknownWords('Xyzzyquux Temperatur')).toEqual(['Xyzzyquux'])
  })

  it('spells umlauts the dictionary way', () => {
    expect(normalizeGerman('Größe Übersicht')).toBe('groesse uebersicht')
  })
})
