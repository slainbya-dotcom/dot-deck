/* Time-zone helpers: wall-clock parts, UTC offsets, DST detection and
 * human abbreviations (BST, GMT, EST, JST...). Pure functions, no DOM. */
(function (WT) {
  'use strict';

  // Older ICU builds (e.g. macOS 10.15 Safari) may not know newer zone names.
  const LEGACY = {
    'Europe/Kyiv': 'Europe/Kiev', 'Asia/Kolkata': 'Asia/Calcutta', 'Asia/Yangon': 'Asia/Rangoon',
    'Asia/Kathmandu': 'Asia/Katmandu', 'Asia/Ho_Chi_Minh': 'Asia/Saigon', 'America/Nuuk': 'America/Godthab',
    'Atlantic/Faroe': 'Atlantic/Faeroe', 'Pacific/Kanton': 'Pacific/Enderbury', 'Pacific/Chuuk': 'Pacific/Truk',
    'Pacific/Pohnpei': 'Pacific/Ponape', 'America/Ciudad_Juarez': 'America/Denver',
  };

  const fmtCache = new Map();
  function partsFormatter(tz) {
    let f = fmtCache.get(tz);
    if (!f) {
      f = new Intl.DateTimeFormat('en-US', {
        timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
        hour: 'numeric', minute: 'numeric', second: 'numeric',
      });
      fmtCache.set(tz, f);
    }
    return f;
  }

  /** Returns a zone name this engine accepts (falling back to legacy aliases), or null. */
  function resolveZone(tz) {
    for (const z of [tz, LEGACY[tz]]) {
      if (!z) continue;
      try { partsFormatter(z); return z; } catch (e) { /* unsupported */ }
    }
    return null;
  }

  /** Canonical form used to compare zones (ICU may report Asia/Calcutta for Asia/Kolkata). */
  function canonicalZone(tz) {
    const z = resolveZone(tz);
    if (!z) return tz;
    try { return new Intl.DateTimeFormat('en-US', { timeZone: z }).resolvedOptions().timeZone; } catch (e) { return z; }
  }

  function systemZone() {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (e) { return 'UTC'; }
  }

  function systemUses24h() {
    try {
      const o = new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions();
      if (o.hourCycle) return o.hourCycle === 'h23' || o.hourCycle === 'h24';
      return o.hour12 === false;
    } catch (e) { return true; }
  }

  /** Wall-clock fields for `date` in zone `tz`. */
  function wallClock(tz, date) {
    const out = {};
    for (const p of partsFormatter(resolveZone(tz) || 'UTC').formatToParts(date)) {
      if (p.type !== 'literal') out[p.type] = parseInt(p.value, 10);
    }
    if (out.hour === 24) out.hour = 0; // some engines emit 24 at midnight
    return out;
  }

  /** UTC offset in minutes (e.g. +60 for BST). */
  function offsetMinutes(tz, date) {
    const p = wallClock(tz, date);
    const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    const t = Math.floor(date.getTime() / 1000) * 1000;
    return Math.round((asUTC - t) / 60000);
  }

  const yearCache = new Map();
  /** {std, dst|null} offsets for the zone in the given year. */
  function yearOffsets(tz, year) {
    const key = tz + '|' + year;
    let v = yearCache.get(key);
    if (!v) {
      const jan = offsetMinutes(tz, new Date(Date.UTC(year, 0, 1)));
      const jul = offsetMinutes(tz, new Date(Date.UTC(year, 6, 1)));
      v = jan === jul ? { std: jan, dst: null } : { std: Math.min(jan, jul), dst: Math.max(jan, jul) };
      yearCache.set(key, v);
    }
    return v;
  }

  function isDST(tz, date) {
    const y = wallClock(tz, date).year;
    const o = yearOffsets(tz, y);
    return o.dst !== null && offsetMinutes(tz, date) === o.dst;
  }

  // ---- Abbreviations -------------------------------------------------------
  // [standard, daylight] per zone. Zones not listed fall back to rules, then Intl, then "UTC+x".
  const GROUPS = [
    [['GMT', 'BST'], 'Europe/London Europe/Belfast Europe/Guernsey Europe/Isle_of_Man Europe/Jersey GB'],
    [['GMT', 'IST'], 'Europe/Dublin Eire'],
    [['WET', 'WEST'], 'Europe/Lisbon Atlantic/Madeira Atlantic/Canary Atlantic/Faroe Atlantic/Faeroe Portugal'],
    [['GMT'], 'Atlantic/Reykjavik Africa/Abidjan Africa/Accra Africa/Bamako Africa/Banjul Africa/Bissau Africa/Conakry ' +
      'Africa/Dakar Africa/Freetown Africa/Lome Africa/Monrovia Africa/Nouakchott Africa/Ouagadougou Africa/Sao_Tome ' +
      'Atlantic/St_Helena America/Danmarkshavn GMT Etc/GMT Greenwich'],
    [['UTC'], 'UTC Etc/UTC Etc/Universal Etc/Zulu Universal Zulu'],
    [['CET', 'CEST'], 'Africa/Ceuta Arctic/Longyearbyen'],
    [['CET'], 'Africa/Algiers Africa/Tunis'],
    [['EET', 'EEST'], 'Africa/Cairo Asia/Beirut Asia/Gaza Asia/Hebron Asia/Nicosia Asia/Famagusta Egypt'],
    [['EET'], 'Africa/Tripoli Europe/Kaliningrad Libya'],
    [['TRT'], 'Europe/Istanbul Asia/Istanbul Turkey'],
    [['IST', 'IDT'], 'Asia/Jerusalem Asia/Tel_Aviv Israel'],
    [['AST'], 'Asia/Riyadh Asia/Kuwait Asia/Bahrain Asia/Qatar Asia/Aden Asia/Baghdad'],
    [['GST'], 'Asia/Dubai Asia/Muscat'],
    [['IRST'], 'Asia/Tehran Iran'],
    [['AFT'], 'Asia/Kabul'],
    [['PKT'], 'Asia/Karachi'],
    [['IST'], 'Asia/Kolkata Asia/Calcutta'],
    [['SLST'], 'Asia/Colombo'],
    [['NPT'], 'Asia/Kathmandu Asia/Katmandu'],
    [['BTT'], 'Asia/Thimphu'],
    [['MMT'], 'Asia/Yangon Asia/Rangoon'],
    [['ICT'], 'Asia/Bangkok Asia/Ho_Chi_Minh Asia/Saigon Asia/Phnom_Penh Asia/Vientiane'],
    [['WIB'], 'Asia/Jakarta Asia/Pontianak'],
    [['WITA'], 'Asia/Makassar'],
    [['WIT'], 'Asia/Jayapura'],
    [['SGT'], 'Asia/Singapore Singapore'],
    [['MYT'], 'Asia/Kuala_Lumpur Asia/Kuching'],
    [['PHT'], 'Asia/Manila'],
    [['HKT'], 'Asia/Hong_Kong Hongkong'],
    [['CST'], 'Asia/Shanghai Asia/Chongqing Asia/Harbin Asia/Macau Asia/Taipei PRC ROC'],
    [['JST'], 'Asia/Tokyo Japan'],
    [['KST'], 'Asia/Seoul Asia/Pyongyang ROK'],
    [['AEST', 'AEDT'], 'Australia/Sydney Australia/Melbourne Australia/Hobart Australia/Canberra Australia/ACT ' +
      'Australia/NSW Australia/Victoria Australia/Tasmania Australia/Currie'],
    [['AEST'], 'Australia/Brisbane Australia/Lindeman Australia/Queensland'],
    [['ACST', 'ACDT'], 'Australia/Adelaide Australia/Broken_Hill Australia/South'],
    [['ACST'], 'Australia/Darwin Australia/North'],
    [['AWST'], 'Australia/Perth Australia/West'],
    [['NZST', 'NZDT'], 'Pacific/Auckland NZ Antarctica/McMurdo'],
    [['CHST'], 'Pacific/Guam Pacific/Saipan'],
    [['SST'], 'Pacific/Pago_Pago Pacific/Midway'],
    [['FJT'], 'Pacific/Fiji'],
    [['HST'], 'Pacific/Honolulu Pacific/Johnston US/Hawaii'],
    [['HST', 'HDT'], 'America/Adak'],
    [['AKST', 'AKDT'], 'America/Anchorage America/Juneau America/Sitka America/Nome America/Yakutat America/Metlakatla US/Alaska'],
    [['PST', 'PDT'], 'America/Los_Angeles America/Vancouver America/Tijuana US/Pacific'],
    [['MST', 'MDT'], 'America/Denver America/Boise America/Edmonton America/Cambridge_Bay America/Inuvik ' +
      'America/Yellowknife America/Ciudad_Juarez US/Mountain'],
    [['MST'], 'America/Phoenix America/Creston America/Dawson_Creek America/Fort_Nelson America/Hermosillo ' +
      'America/Mazatlan America/Whitehorse America/Dawson US/Arizona'],
    [['CST', 'CDT'], 'America/Chicago America/Winnipeg America/Indiana/Knox America/Indiana/Tell_City America/Menominee ' +
      'America/North_Dakota/Center America/North_Dakota/New_Salem America/North_Dakota/Beulah America/Matamoros ' +
      'America/Ojinaga America/Rankin_Inlet America/Resolute America/Rainy_River America/Havana Cuba US/Central'],
    [['CST'], 'America/Regina America/Swift_Current America/Mexico_City America/Monterrey America/Merida ' +
      'America/Chihuahua America/Bahia_Banderas America/Guatemala America/El_Salvador America/Tegucigalpa ' +
      'America/Managua America/Costa_Rica America/Belize'],
    [['EST', 'EDT'], 'America/New_York America/Detroit America/Toronto America/Montreal America/Nassau America/Iqaluit ' +
      'America/Nipigon America/Thunder_Bay America/Indiana/Indianapolis America/Indianapolis America/Indiana/Vincennes ' +
      'America/Indiana/Winamac America/Indiana/Marengo America/Indiana/Petersburg America/Indiana/Vevay ' +
      'America/Kentucky/Louisville America/Louisville America/Kentucky/Monticello America/Port-au-Prince ' +
      'America/Grand_Turk US/Eastern'],
    [['EST'], 'America/Panama America/Jamaica America/Cayman America/Cancun America/Atikokan America/Coral_Harbour'],
    [['AST', 'ADT'], 'America/Halifax America/Glace_Bay America/Moncton America/Goose_Bay America/Thule Atlantic/Bermuda'],
    [['AST'], 'America/Puerto_Rico America/Santo_Domingo America/Barbados America/Martinique America/Port_of_Spain ' +
      'America/Anguilla America/Antigua America/Aruba America/Curacao America/Dominica America/Grenada ' +
      'America/Guadeloupe America/Kralendijk America/Lower_Princes America/Marigot America/Montserrat ' +
      'America/St_Barthelemy America/St_Kitts America/St_Lucia America/St_Thomas America/St_Vincent ' +
      'America/Tortola America/Blanc-Sablon'],
    [['NST', 'NDT'], 'America/St_Johns'],
    [['COT'], 'America/Bogota'],
    [['PET'], 'America/Lima'],
    [['ECT'], 'America/Guayaquil'],
    [['VET'], 'America/Caracas'],
    [['BOT'], 'America/La_Paz'],
    [['CLT', 'CLST'], 'America/Santiago'],
    [['UYT'], 'America/Montevideo'],
    [['ART'], 'America/Buenos_Aires'],
    [['BRT'], 'America/Sao_Paulo America/Bahia America/Fortaleza America/Recife America/Belem America/Maceio ' +
      'America/Araguaina America/Santarem'],
    [['AMT'], 'America/Manaus America/Cuiaba America/Campo_Grande America/Porto_Velho America/Boa_Vista'],
    [['GYT'], 'America/Guyana'],
    [['SRT'], 'America/Paramaribo'],
    [['GFT'], 'America/Cayenne'],
    [['SAST'], 'Africa/Johannesburg Africa/Maseru Africa/Mbabane'],
    [['CAT'], 'Africa/Harare Africa/Maputo Africa/Lusaka Africa/Lubumbashi Africa/Gaborone Africa/Blantyre ' +
      'Africa/Bujumbura Africa/Kigali Africa/Windhoek Africa/Juba Africa/Khartoum'],
    [['EAT'], 'Africa/Nairobi Africa/Addis_Ababa Africa/Dar_es_Salaam Africa/Kampala Africa/Mogadishu ' +
      'Africa/Djibouti Africa/Asmara Indian/Antananarivo Indian/Comoro Indian/Mayotte'],
    [['WAT'], 'Africa/Lagos Africa/Kinshasa Africa/Luanda Africa/Douala Africa/Libreville Africa/Malabo ' +
      'Africa/Niamey Africa/Porto-Novo Africa/Bangui Africa/Brazzaville Africa/Ndjamena'],
    [['MUT'], 'Indian/Mauritius'],
    [['MVT'], 'Indian/Maldives'],
  ];
  const ABBR = {};
  for (const [names, zones] of GROUPS) for (const z of zones.split(' ')) ABBR[z] = names;

  // Not given a Europe-wide rule because they don't follow it.
  const NO_EURO_RULE = new Set(['Europe/Minsk', 'Europe/Samara', 'Europe/Ulyanovsk', 'Europe/Astrakhan', 'Europe/Saratov']);

  function ruleAbbr(tz, o) {
    if (tz.startsWith('America/Argentina/')) return ['ART'];
    if (!tz.startsWith('Europe/') || NO_EURO_RULE.has(tz)) return null;
    if (o.dst !== null) {
      if (o.std === 0) return ['WET', 'WEST'];
      if (o.std === 60) return ['CET', 'CEST'];
      if (o.std === 120) return ['EET', 'EEST'];
    } else if (o.std === 180) {
      return ['MSK'];
    }
    return null;
  }

  function utcLabel(min) {
    if (min === 0) return 'UTC';
    const sign = min < 0 ? '-' : '+';
    const a = Math.abs(min), h = Math.floor(a / 60), m = a % 60;
    return 'UTC' + sign + h + (m ? ':' + String(m).padStart(2, '0') : '');
  }

  const INTL_LOCALES = ['en-US', 'en-GB', 'en-AU', 'en-IN', 'en-NZ', 'en-CA'];
  const intlCache = new Map();
  /** Intl's short name, cached per zone+offset (this runs every second per clock). */
  function intlAbbr(tz, date, off) {
    const key = tz + '|' + off;
    if (intlCache.has(key)) return intlCache.get(key);
    let found = null;
    for (const loc of INTL_LOCALES) {
      try {
        const p = new Intl.DateTimeFormat(loc, { timeZone: tz, timeZoneName: 'short' })
          .formatToParts(date).find((x) => x.type === 'timeZoneName');
        if (p && /^[A-Z]{3,5}$/.test(p.value) && p.value !== 'GMT' && p.value !== 'UTC') { found = p.value; break; }
      } catch (e) { /* ignore */ }
    }
    intlCache.set(key, found);
    return found;
  }

  /** Short zone name for display, e.g. "BST", "EDT", "UTC+5:45". */
  function abbreviation(tz, date) {
    const zone = resolveZone(tz) || 'UTC';
    const year = wallClock(zone, date).year;
    const o = yearOffsets(zone, year);
    const off = offsetMinutes(zone, date);
    const dst = o.dst !== null && off === o.dst;
    const names = ABBR[tz] || ABBR[zone] || ruleAbbr(tz, o);
    if (names) {
      if (!dst) return names[0];
      if (names[1]) return names[1];
      // Zone observes DST but our table doesn't expect it (rules changed): fall through.
    }
    return intlAbbr(zone, date, off) || utcLabel(off);
  }

  function pad2(n) { return String(n).padStart(2, '0'); }

  /** "14:05", "14:05:09", "2:05 PM", "2:05:09 PM" */
  function formatTime(tz, date, use24h, seconds) {
    const p = wallClock(tz, date);
    let s;
    if (use24h) {
      s = pad2(p.hour) + ':' + pad2(p.minute);
    } else {
      s = String(p.hour % 12 || 12) + ':' + pad2(p.minute);
    }
    if (seconds) s += ':' + pad2(p.second);
    if (!use24h) s += p.hour < 12 ? ' AM' : ' PM';
    return s;
  }

  WT.time = {
    resolveZone, canonicalZone, systemZone, systemUses24h, wallClock, offsetMinutes, isDST,
    abbreviation, formatTime, utcLabel, ABBR,
  };
})(typeof window !== 'undefined' ? (window.WT = window.WT || {}) : (globalThis.WT = globalThis.WT || {}));
