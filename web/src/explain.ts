import type { CheckId, Lang, Product, Thresholds } from '@spray/shared';

/**
 * Plain-language explanations behind each row on the main screen: what is measured, why it matters
 * before spraying, and how the app turns it into green / amber / red (with the limits currently in force).
 */
export interface Explanation { what: string; why: string; rule: string }

type Txt = { lv: string; en: string };
const fill = (s: string, p: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k) => String(p[k] ?? ''));

const E: Record<CheckId, { what: Txt; why: Txt; rule: Txt }> = {
  wind: {
    what: {
      lv: 'Vidējais vēja ātrums pēdējās 10 minūtēs, mērīts 10 m augstumā. Pie smidzinātāja stieņa vējš parasti ir nedaudz vājāks, bet atklātā laukā tas mainās ātri.',
      en: 'Mean wind speed over the last 10 minutes, measured at 10 m. At boom height it is usually a little weaker, but in open fields it changes quickly.',
    },
    why: {
      lv: 'Vējš nosaka noneses risku – cik daudz pilienu aiznes ārpus lauka uz kaimiņu sējumiem, ūdenstilpēm, dravām un mājām. Stiprā vējā sīkie pilieni aizlido simtiem metru, līdzeklis nenonāk uz mērķa un deva laukā samazinās. Arī pilnīgs bezvējš nav labs: tas bieži nozīmē temperatūras inversiju, kad smidzinājuma mākonis karājas gaisā un aizplūst neparedzamā virzienā. Vislabāk – viegls, vienmērīgs vējš no zināma virziena, prom no jutīgām vietām.',
      en: 'Wind decides drift – how much spray leaves the field towards neighbouring crops, water, apiaries and houses. In strong wind fine droplets travel hundreds of metres, miss the target and the dose on the field drops. Dead calm is not good either: it often means a temperature inversion, when the spray cloud hangs in the air and moves off in an unpredictable direction. Best is a light, steady wind from a known direction, away from sensitive places.',
    },
    rule: {
      lv: 'Zaļš: {calm}–{gentle} m/s. Dzeltens: zem {calm} m/s (bezvējš) vai {gentle}–{strong} m/s. Sarkans: virs {strong} m/s{productNote}.',
      en: 'Green: {calm}–{gentle} m/s. Amber: below {calm} m/s (calm) or {gentle}–{strong} m/s. Red: above {strong} m/s{productNote}.',
    },
  },
  gust: {
    what: {
      lv: 'Spēcīgākā īslaicīgā vēja brāzma (dažas sekundes) pēdējā periodā.',
      en: 'The strongest short gust (a few seconds) in the recent period.',
    },
    why: {
      lv: 'Pat ja vidējais vējš ir pieņemams, brāzmas īsā brīdī var paraut līdzi lielu daļu pilienu un aiznest tos tālu ārpus lauka. Brāzmains vējš arī šūpo stieni, tāpēc deva laukā sanāk nevienmērīga. Liela starpība starp vidējo vēju un brāzmām nozīmē nemierīgu gaisu.',
      en: 'Even when the mean wind is acceptable, gusts can carry a large share of droplets far off the field in a moment. Gusty wind also makes the boom bounce, so the dose on the field becomes uneven. A big gap between mean wind and gusts means turbulent air.',
    },
    rule: {
      lv: 'Zaļš: brāzmas līdz {gust} m/s. Sarkans: virs {gust} m/s.',
      en: 'Green: gusts up to {gust} m/s. Red: above {gust} m/s.',
    },
  },
  rain: {
    what: {
      lv: 'Vai šobrīd līst, un lietus varbūtība (%) un daudzums (mm) tuvākajās 1, 2 un 6 stundās pēc prognozes.',
      en: 'Whether it is raining now, and the forecast chance (%) and amount (mm) of rain in the next 1, 2 and 6 hours.',
    },
    why: {
      lv: 'Lielākajai daļai līdzekļu vajag laiku, lai iesūktos augā vai nožūtu uz lapām. Ja lietus nāk pārāk drīz, līdzeklis tiek nomazgāts – apstrāde nedarbojas, nauda iztērēta, un līdzeklis ar ūdeni nonāk augsnē un grāvjos. Uz slapjām lapām pilieni notek. Cik stundas bez lietus vajag, norādīts līdzekļa etiķetē; to var ievadīt sadaļā "Līdzekļi".',
      en: 'Most products need time to be absorbed by the plant or to dry on the leaves. If rain comes too soon the product is washed off – the treatment fails, money is wasted and the product ends up in soil and ditches. On wet leaves droplets run off. How many rain-free hours are needed is on the product label; enter it under "Products".',
    },
    rule: {
      lv: 'Pārbauda {h} h logu{productNote}. Sarkans: līst tagad, vai varbūtība ≥ {probRed} %, vai ≥ {mmRed} mm. Dzeltens: varbūtība ≥ {probAmber} % vai ≥ {mmAmber} mm. Citādi zaļš.',
      en: 'Checks a {h} h window{productNote}. Red: raining now, or chance ≥ {probRed} %, or ≥ {mmRed} mm. Amber: chance ≥ {probAmber} % or ≥ {mmAmber} mm. Otherwise green.',
    },
  },
  temp: {
    what: {
      lv: 'Gaisa temperatūra 2 m augstumā tuvākajā meteostacijā (vai prognozē, ja novērojums novecojis).',
      en: 'Air temperature at 2 m at the nearest station (or the forecast when the observation is stale).',
    },
    why: {
      lv: 'Aukstumā augi aug lēni un daudzi līdzekļi (īpaši herbicīdi) neuzsūcas un nedarbojas. Karstumā pilieni iztvaiko vēl pirms nokļūšanas uz auga, rodas tvaiki, kas var pārvietoties ārpus lauka, un pieaug kultūrauga bojājumu risks. Daudzu līdzekļu etiķetē ir norādīta minimālā un maksimālā temperatūra.',
      en: 'In the cold, plants grow slowly and many products (herbicides especially) are not taken up and do not work. In the heat, droplets evaporate before reaching the plant, vapour can move off the field, and the risk of crop damage rises. Many labels state a minimum and maximum temperature.',
    },
    rule: {
      lv: 'Zaļš: {gmin}–{gmax} °C.{amber} Sarkans: zem {rmin} °C vai virs {rmax} °C{productNote}.',
      en: 'Green: {gmin}–{gmax} °C.{amber} Red: below {rmin} °C or above {rmax} °C{productNote}.',
    },
  },
  humidity: {
    what: {
      lv: 'Relatīvais gaisa mitrums – cik tuvu gaiss ir piesātinājumam ar ūdens tvaiku (100 % = migla).',
      en: 'Relative humidity – how close the air is to saturation with water vapour (100 % = fog).',
    },
    why: {
      lv: 'Sausā gaisā pilieni strauji iztvaiko un kļūst sīkāki, tāpēc tie vieglāk aizlido ar vēju un mazāk līdzekļa nonāk uz auga. Lapas sausā laikā arī sliktāk uzsūc līdzekli. Mitrums kopā ar temperatūru veido Delta T rādītāju.',
      en: 'In dry air droplets evaporate fast and shrink, so they drift more easily and less product reaches the plant. Leaves also take up less product in dry weather. Humidity together with temperature makes up Delta T.',
    },
    rule: {
      lv: 'Dzeltens: zem {rh} %. Citādi zaļš.',
      en: 'Amber: below {rh} %. Otherwise green.',
    },
  },
  deltaT: {
    what: {
      lv: 'Delta T ir starpība starp parasto (sauso) gaisa temperatūru un "slapjā termometra" temperatūru. To aprēķina no temperatūras un mitruma, un tā rāda, cik ātri ūdens iztvaiko no piliena.',
      en: 'Delta T is the difference between the normal (dry) air temperature and the "wet-bulb" temperature. It is calculated from temperature and humidity and shows how fast water evaporates from a droplet.',
    },
    why: {
      lv: 'Tas ir labākais vienotais rādītājs smidzināšanas kvalitātei. Liels Delta T (sauss, silts gaiss) – pilieni iztvaiko lidojumā, kļūst sīki un aizlido. Mazs Delta T (ļoti mitrs gaiss) – pilieni ilgi nežūst, var notecēt no lapām, un sīkie pilieni ilgi uzturas gaisā; tas bieži sakrīt ar inversiju. Ieteicamais diapazons ir aptuveni 2–8.',
      en: 'It is the best single indicator of spray quality. High Delta T (dry, warm air) – droplets evaporate in flight, shrink and drift. Low Delta T (very humid air) – droplets stay wet for long, may run off leaves, and fine droplets linger in the air; it often coincides with an inversion. The recommended range is roughly 2–8.',
    },
    rule: {
      lv: 'Zaļš: {dmin}–{dmax}. Dzeltens: zem {dmin} vai {dmax}–{dred}. Sarkans: virs {dred}.',
      en: 'Green: {dmin}–{dmax}. Amber: below {dmin} or {dmax}–{dred}. Red: above {dred}.',
    },
  },
  inversion: {
    what: {
      lv: 'Temperatūras inversija ir stāvoklis, kad pie zemes gaiss ir aukstāks nekā augstāk. Parasti tā veidojas skaidrās, bezvējainās naktīs un ap saullēktu un saulrietu, kad zeme ātri atdziest.',
      en: 'A temperature inversion is when the air near the ground is colder than the air above it. It usually forms on clear, calm nights and around sunrise and sunset, when the ground cools fast.',
    },
    why: {
      lv: 'Normāli silts gaiss no zemes ceļas augšup un sīkos pilienus izkliedē un atšķaida. Inversijā aukstais gaisa slānis pie zemes darbojas kā vāks: smidzinājuma mākonis netiek izkliedēts, bet ilgi (pat stundām) karājas zemu virs zemes un ar vāju gaisa plūsmu aizslīd kilometriem tālu – uz kaimiņu laukiem, dārziem, ūdeņiem. Šāda nonese ir viens no biežākajiem bojājumu un sūdzību iemesliem, un to nevar redzēt ar aci. Pazīmes: rasa, migla vai dūmi, kas izplešas horizontāli zemu virs zemes.',
      en: 'Normally warm air rises from the ground and scatters and dilutes fine droplets. In an inversion the cold layer near the ground acts like a lid: the spray cloud is not dispersed but hangs low for a long time (even hours) and slides kilometres away with a faint airflow – onto neighbouring fields, gardens and water. Such drift is one of the most common causes of damage and complaints, and you cannot see it. Signs: dew, mist, or smoke spreading sideways low over the ground.',
    },
    rule: {
      lv: 'Lietotne inversiju nemēra tieši, bet novērtē risku. Dzeltens, ja vienlaikus: vējš zem {wind} m/s, mākoņi ≤ {cloud} % un ir nakts vai ne vairāk kā {sun} min no saullēkta/saulrieta. Citādi zaļš.',
      en: 'The app does not measure inversions directly but estimates the risk. Amber when all hold: wind below {wind} m/s, cloud ≤ {cloud} %, and it is night or within {sun} min of sunrise/sunset. Otherwise green.',
    },
  },
  frost: {
    what: {
      lv: 'Zemākā gaisa temperatūra pēdējās 12 stundās (novērojumi) un nākamajās 12 stundās (prognoze).',
      en: 'The lowest air temperature in the last 12 hours (observed) and the next 12 hours (forecast).',
    },
    why: {
      lv: 'Salnas stresā augs pārtrauc augšanu un līdzekļus neuzņem, tāpēc tie nedarbojas, bet kultūraugam var rasties bojājumi (īpaši no herbicīdiem un augšanas regulatoriem). Daudzu līdzekļu etiķetēs ir prasība nesmidzināt, ja salna bijusi iepriekšējā naktī vai gaidāma nākamajā.',
      en: 'Under frost stress plants stop growing and do not take up products, so these do not work, and the crop may be damaged (especially by herbicides and growth regulators). Many labels say not to spray when frost occurred the night before or is expected the next night.',
    },
    rule: {
      lv: 'Dzeltens, ja temperatūra ≤ {frost} °C {h} h laikā pirms vai pēc šī brīža. Citādi zaļš.',
      en: 'Amber when the temperature is ≤ {frost} °C within {h} h before or after now. Otherwise green.',
    },
  },
  dew: {
    what: {
      lv: 'Starpība starp gaisa temperatūru un rasas punktu – temperatūru, kurā uz lapām sāk veidoties rasa. Jo mazāka starpība, jo mitrākas lapas.',
      en: 'The gap between air temperature and dew point – the temperature at which dew starts to form on leaves. The smaller the gap, the wetter the leaves.',
    },
    why: {
      lv: 'Uz rasas vai lietus slapjām lapām pilieni saplūst un notek zemē, līdzeklis atšķaidās un tā efektivitāte krītas. Rasa arī liecina par vēsu, mierīgu gaisu pie zemes – iespējamu inversiju. Rīta smidzināšanu labāk sākt, kad rasa nožuvusi.',
      en: 'On leaves wet from dew or rain, droplets merge and run off to the ground, the product is diluted and works less well. Dew also signals cool, still air near the ground – a possible inversion. Morning spraying is best started once the dew has dried.',
    },
    rule: {
      lv: 'Dzeltens, ja gaisa temperatūra ir ne vairāk kā {spread} °C virs rasas punkta. Citādi zaļš.',
      en: 'Amber when the air temperature is no more than {spread} °C above the dew point. Otherwise green.',
    },
  },
  crop: {
    what: {
      lv: 'Kultūrauga attīstības stadija pēc BBCH skalas (00 – dīgšana … 99 – raža), kas norādīta laukam.',
      en: 'The crop growth stage on the BBCH scale (00 – germination … 99 – harvested) set for the field.',
    },
    why: {
      lv: 'Daudzus līdzekļus drīkst lietot tikai noteiktās stadijās – ārpus tām var bojāt kultūraugu vai pārkāpt etiķetes prasības, un atliekvielas var palikt ražā.',
      en: 'Many products may only be used at certain stages – outside them they can damage the crop or break label rules, and residues may remain in the harvest.',
    },
    rule: {
      lv: 'Ja līdzeklim norādīts BBCH diapazons: sarkans ārpus tā, dzeltens, ja stadija nav norādīta.',
      en: 'When the product has a BBCH range: red outside it, amber when the stage is not set.',
    },
  },
};

export function explain(id: CheckId, lang: Lang, t: Thresholds, product: Product | null, rainHours: number): Explanation {
  const e = E[id];
  const pn = product?.name ?? '';
  const productNote = (lv: string, en: string) => (lang === 'lv' ? lv : en);
  const strong = product?.maxWind ?? t.windStrongAbove;
  const rmin = product?.minTemp ?? t.tempRedBelow;
  const rmax = product?.maxTemp ?? t.tempRedAbove;
  const params: Record<string, string | number> = {
    calm: t.windCalmBelow, gentle: Math.min(t.windGentleMax, strong), strong, gust: t.gustRedAbove,
    h: rainHours, probRed: t.rainProbRed, probAmber: t.rainProbAmber, mmRed: t.rainMmRed, mmAmber: t.rainMmAmber,
    rmin, rmax, gmin: Math.max(t.tempGreenMin, rmin), gmax: Math.min(t.tempGreenMax, rmax),
    rh: t.humidityAmberBelow, dmin: t.deltaTGreenMin, dmax: t.deltaTGreenMax, dred: t.deltaTRedAbove,
    wind: t.inversionWindBelow, cloud: t.inversionCloudMax, sun: t.inversionSunMarginMin,
    frost: t.frostTempC, spread: t.dewSpreadAmberC,
    productNote: '',
    amber: '',
  };
  {
    const g0 = Number(params.gmin), g1 = Number(params.gmax);
    const parts = [rmin < g0 ? `${rmin}–${g0} °C` : '', g1 < rmax ? `${g1}–${rmax} °C` : ''].filter(Boolean);
    if (parts.length) params.amber = lang === 'lv' ? ` Dzeltens: ${parts.join(' vai ')}.` : ` Amber: ${parts.join(' or ')}.`;
  }
  if (id === 'frost') params.h = t.frostWindowHours;
  if (id === 'wind' && product?.maxWind != null) params.productNote = productNote(` – ${pn} robeža`, ` – ${pn} limit`);
  if (id === 'temp' && (product?.minTemp != null || product?.maxTemp != null)) params.productNote = productNote(` (sarkanās robežas no ${pn})`, ` (red limits from ${pn})`);
  if (id === 'rain' && product?.rainFreeHours != null) params.productNote = productNote(` (${pn} prasība)`, ` (${pn} requirement)`);
  return { what: e.what[lang], why: e.why[lang], rule: fill(e.rule[lang], params) };
}
