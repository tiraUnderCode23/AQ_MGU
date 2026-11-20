'use strict';
/**
 * langs.js - the language of an IPTV provider's category, read from its name ("FR | Films", "|EN| Action",
 * "AR: MBC", "PORTUGAL", "VOSTFR Series"), and whether the owner's setting keeps it. The same file is in
 * apps/amn_iptv/lib and native/amn-iptv: the app hides the categories (Live TV, Movies, Series, search results),
 * the service skips them when it indexes films and series for search.
 *
 *   langOf(name)        'en' | 'fr' | 'ar' | 'other' | null (nothing recognised)
 *   kept(name, set)     set: 'efa' (English, French, Arabic), 'ef' (English and French), 'all'
 *   is3D(name)          a 3D release (3D, SBS, HSBS): two pictures side by side on a flat screen; hidden with the filter on
 *   latin(name)         Arabic words of a category's name in English ("AR ✪ اجنبي رعب" -> "AR ✪ Foreign Horror"): the
 *                       app's fonts have no Arabic, so those names were blank. Every word the owner's provider uses.
 *
 * A category with no language recognised (Kids, 4K, Sports) is kept: hiding it could hide something wanted. A code
 * at the start of the name decides first (the providers' own convention); else a language or country word anywhere.
 * Plain Node 8.
 */
const CODES = {
    en: ['EN', 'ENG', 'US', 'USA', 'UK', 'GB', 'CA', 'CAN', 'AU', 'AUS', 'NZ', 'IE', 'IRL'],
    fr: ['FR', 'FRA', 'FRE', 'QC', 'QUE', 'VF', 'VFF', 'VFQ', 'VOSTFR', 'VOST', 'REU', 'HT'],   // Reunion, Haiti: French
    ar: ['AR', 'ARA', 'ARB', 'MA', 'MAR', 'DZ', 'TN', 'EG', 'SA', 'KSA', 'AE', 'UAE', 'LB', 'KW', 'QA', 'IQ', 'SY', 'JO', 'OM', 'BH', 'YE', 'LY', 'SD', 'PS', 'MENA'],
    other: ['PT', 'BR', 'IT', 'ES', 'SP', 'LA', 'LAT', 'MX', 'CL', 'CO', 'PE', 'VE', 'DE', 'GER', 'AT', 'NL', 'PL', 'TR', 'RU', 'UA', 'AL', 'XK',
        'IN', 'IND', 'PK', 'BD', 'LK', 'NP', 'IR', 'FA', 'AF', 'KR', 'KO', 'JP', 'CN', 'TW', 'HK', 'PH', 'GR', 'RO', 'BG', 'HU', 'CZ', 'SK', 'HR',
        'RS', 'BA', 'SI', 'MK', 'ME', 'YU', 'EXYU', 'SE', 'NO', 'DK', 'FI', 'IS', 'IL', 'KU', 'KUR', 'AM', 'AZ', 'GE', 'LT', 'LV', 'EE', 'VN', 'TH',
        'ID', 'MY', 'NG', 'GH', 'KE', 'ET', 'SO',
        // the owner's provider's own codes (its categories, 16 Nov 2026): SW Sweden, CH Switzerland and Chile, AS Asia, EX ex-Yugoslavia
        'SW', 'CH', 'ARG', 'UY', 'DO', 'HN', 'SLV', 'SR', 'MT', 'CY', 'AS', 'EX', 'PER', 'AFGH']
};
const WORDS = {
    en: ['ENGLISH', 'ANGLAIS'],
    fr: ['FRENCH', 'FRANCAIS', 'FRANCE', 'QUEBEC', 'QUEBECOIS', 'WALLONIE'],
    ar: ['ARABIC', 'ARABE', 'ARAB', 'MAROC', 'MOROCCO', 'MAGHREB', 'ALGERIE', 'ALGERIA', 'TUNISIE', 'TUNISIA', 'EGYPT', 'KHALIJI'],
    other: ['PORTUGAL', 'PORTUGUESE', 'PORTUGUES', 'BRASIL', 'BRAZIL', 'ITALIA', 'ITALY', 'ITALIAN', 'ESPANA', 'SPAIN', 'SPANISH', 'LATINO',
        'LATIN', 'MEXICO', 'GERMAN', 'GERMANY', 'DEUTSCH', 'DUTCH', 'NEDERLAND', 'POLSKA', 'POLAND', 'POLISH', 'TURK', 'TURKEY', 'TURKISH',
        'TURKIYE', 'RUSSIA', 'RUSSIAN', 'UKRAINE', 'UKRAINIAN', 'ALBANIA', 'ALBANIAN', 'SHQIP', 'INDIA', 'INDIAN', 'HINDI', 'TAMIL', 'TELUGU',
        'PUNJABI', 'MALAYALAM', 'BANGLA', 'BENGALI', 'URDU', 'PAKISTAN', 'PERSIAN', 'FARSI', 'IRAN', 'AFGHAN', 'AFGHANISTAN', 'KOREA', 'KOREAN',
        'JAPAN', 'JAPANESE', 'CHINA', 'CHINESE', 'FILIPINO', 'PINOY', 'PHILIPPINES', 'GREEK', 'GREECE', 'ROMANIA', 'ROMANIAN', 'BULGARIA',
        'HUNGARY', 'MAGYAR', 'CZECH', 'SLOVAK', 'CROATIA', 'SERBIA', 'BOSNIA', 'MACEDONIA', 'SLOVENIA', 'SWEDEN', 'SVENSKA', 'NORWAY', 'DENMARK',
        'FINLAND', 'NORDIC', 'SCANDINAVIA', 'ISRAEL', 'HEBREW', 'KURD', 'KURDISH', 'ARMENIA', 'ARMENIAN', 'VIETNAM', 'THAI', 'THAILAND',
        'INDONESIA', 'MALAYSIA', 'AFRICA', 'AFRICAN', 'SOMALI', 'ETHIOPIA', 'NIGERIA', 'VLAANDEREN'],
};
const BY_CODE = {}, BY_WORD = {};
Object.keys(CODES).forEach((l) => CODES[l].forEach((c) => { BY_CODE[c] = l; }));
Object.keys(WORDS).forEach((l) => WORDS[l].forEach((w) => { BY_WORD[w] = l; }));
const SETS = { efa: ['en', 'fr', 'ar'], ef: ['en', 'fr'] };
// phrases first, then words (the owner's provider's category names, 16 Nov 2026)
const ARABIC = [['كأس العالم', 'World Cup'], ['يعرض الآن', 'Now Showing'], ['القرآن الكريم', 'Holy Quran'],
    ['اجنبي', 'Foreign'], ['رعب', 'Horror'], ['كوميدي', 'Comedy'], ['دراما', 'Drama'], ['رومانسي', 'Romance'], ['اكشن', 'Action'],
    ['آسيوي', 'Asian'], ['هندي', 'Indian'], ['عربي', 'Arabic'], ['مغاربي', 'Maghreb'], ['كلاسيكي', 'Classics'], ['مارفل', 'Marvel'],
    ['مصري', 'Egyptian'], ['نتفليكس', 'Netflix'], ['فرجة', 'Forja'], ['ديزني', 'Disney'], ['هوليود', 'Hollywood'], ['انمي', 'Anime'],
    ['أطفال', 'Kids'], ['اطفال', 'Kids'], ['مدبلج', 'Dubbed'], ['وثائقيات', 'Documentaries'], ['وثائقي', 'Documentary'],
    ['مسرحيات', 'Plays'], ['رمضانك', 'Ramadan'], ['رمضان', 'Ramadan'], ['خليجي', 'Gulf'], ['شامي', 'Levant'], ['برامج', 'Shows'],
    ['كرتون', 'Cartoons'], ['مسلسلات', 'Series'], ['تعرض', 'Showing'], ['تركي', 'Turkish'], ['كوري', 'Korean'], ['مترجم', 'Subtitled'],
    ['ترفيه', 'Entertainment'], ['دينية', 'Religious'], ['افلام', 'Films'], ['أفلام', 'Films']];
function latin(name) {
    let s = String(name || '');
    if (!/[\u0600-\u06ff]/.test(s)) return s;
    ARABIC.forEach((p) => { s = s.split(p[0]).join(' ' + p[1] + ' '); });
    return s.replace(/\s+/g, ' ').trim();
}

function tokens(name) {
    let s = String(name || '');
    try { s = s.normalize('NFD').replace(/[̀-ͯ]/g, ''); } catch (e) { /* no normalize: kept as is */ }
    return s.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
}
function langOf(name) {
    const t = tokens(name);
    // a code first: the first two tokens ("4K | FR Films", "|EN| Action")
    for (let i = 0; i < Math.min(2, t.length); i++) if (BY_CODE[t[i]]) return BY_CODE[t[i]];
    for (let i = 0; i < t.length; i++) if (BY_WORD[t[i]]) return BY_WORD[t[i]];
    return null;
}
function is3D(name) { return tokens(name).some((t) => t === '3D' || t === 'SBS' || t === 'HSBS' || t === '3DSBS'); }
function kept(name, set) {
    const want = SETS[set];
    if (!want) return true;
    if (is3D(name)) return false;
    const l = langOf(name);
    return l === null || want.indexOf(l) >= 0;
}

module.exports = { langOf, kept, is3D, latin, SETS };
