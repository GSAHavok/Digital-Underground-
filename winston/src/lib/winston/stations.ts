export type Station = {
  id: string;
  name: string;
  freq: string;
  city: string;
  format: string;
  url: string;
  aliases: string[];
};

/** Stations that actually reach Norfolk County, with direct streams the phone can play. */
export const STATIONS: Station[] = [
  {
    id: "giant",
    name: "Giant FM",
    freq: "101.3",
    city: "Tillsonburg",
    format: "Classic rock",
    url: "https://mybroadcasting.streamb.live/SB00444",
    aliases: ["giant", "easy 101", "easy one oh one", "tillsonburg"],
  },
  {
    id: "country104",
    name: "Country 104",
    freq: "103.9",
    city: "Woodstock",
    format: "Country",
    url: "https://live.leanstream.co/CKDKFM-MP3",
    aliases: ["country 104", "country one oh four", "woodstock"],
  },
  {
    id: "heart",
    name: "Heart FM",
    freq: "104.7",
    city: "Woodstock",
    format: "Hits",
    url: "http://cihrfm.streamon.fm:8000/CIHRFM-48k.aac",
    aliases: ["heart", "heart fm"],
  },
  {
    id: "lite",
    name: "Lite 92",
    freq: "92.1",
    city: "Brantford",
    format: "Soft hits",
    url: "https://evanov.streamb.live/SB00226",
    aliases: ["lite", "lite 92", "lite ninety two", "brantford"],
  },
  {
    id: "fm96",
    name: "FM96",
    freq: "95.9",
    city: "London",
    format: "Rock",
    url: "https://live.leanstream.co/CFPLFM-MP3",
    aliases: ["fm96", "fm 96", "f m 96"],
  },
  {
    id: "classic",
    name: "Classic Rock 98.1",
    freq: "98.1",
    city: "London",
    format: "Classic rock",
    url: "https://live.leanstream.co/CKLOFM",
    aliases: ["classic rock", "classic"],
  },
  {
    id: "cbc",
    name: "CBC Radio One",
    freq: "93.5",
    city: "London",
    format: "News",
    url: "https://17813.live.streamtheworld.com/CBCLFM_CBC_SC",
    aliases: ["cbc", "cbc radio", "cbc news", "radio one", "the news", "news", "local news"],
  },
  {
    id: "am980",
    name: "Global News 980",
    freq: "980",
    city: "London",
    format: "News talk",
    url: "https://corus.leanstream.co/CFPLAM-MP3",
    aliases: ["980", "nine eighty", "global news", "global news 980", "am 980", "london news"],
  },
  {
    id: "news680",
    name: "680 NewsRadio",
    freq: "680",
    city: "Toronto",
    format: "News",
    url: "https://rogers-hls.leanstream.co/rogers/tor680.stream/icy?environment=tunein&args=tunein_01",
    aliases: ["680", "six eighty", "680 news", "city news", "citynews", "toronto news"],
  },
  {
    id: "news640",
    name: "Global News 640",
    freq: "640",
    city: "Toronto",
    format: "News",
    url: "https://corus.leanstream.co/CFIQAM-MP3",
    aliases: ["640", "six forty", "global news 640", "news 640"],
  },
  {
    id: "cbc-toronto",
    name: "CBC Radio One Toronto",
    freq: "99.1",
    city: "Toronto",
    format: "News",
    url: "https://17813.live.streamtheworld.com/CBLAFM_CBC_SC",
    aliases: ["cbc toronto", "toronto cbc", "cbc radio one toronto"],
  },
  {
    id: "global770",
    name: "Global News 770",
    freq: "770",
    city: "Calgary",
    format: "News",
    url: "https://live.leanstream.co/CHQRAM-MP3",
    aliases: ["770", "seven seventy", "global news 770", "calgary news"],
  },
  {
    id: "npr",
    name: "NPR News",
    freq: "NPR",
    city: "United States",
    format: "News",
    url: "https://npr-ice.streamguys1.com/live.mp3",
    aliases: ["npr", "n p r", "national public radio", "us news", "u s news", "american news"],
  },
  {
    id: "cnn",
    name: "CNN",
    freq: "CNN",
    city: "United States",
    format: "News",
    url: "https://tunein.cdnstream1.com/2868_96.mp3",
    aliases: ["cnn", "c n n", "cnn news"],
  },
  {
    id: "wtop",
    name: "WTOP News",
    freq: "103.5",
    city: "Washington",
    format: "News",
    url: "https://playerservices.streamtheworld.com/api/livestream-redirect/WTOPFM.mp3",
    aliases: ["wtop", "w top", "washington news", "dc news"],
  },
  {
    id: "bloomberg",
    name: "Bloomberg Radio",
    freq: "1130",
    city: "New York",
    format: "News",
    url: "https://tunein.cdnstream1.com/3521_96.mp3",
    aliases: ["bloomberg", "bloomberg radio", "business news"],
  },
  {
    id: "msnbc",
    name: "MS NOW",
    freq: "MSNBC",
    city: "United States",
    format: "News",
    url: "https://tunein.cdnstream1.com/3511_96.mp3",
    aliases: ["msnbc", "m s n b c", "ms now", "msnbc news"],
  },
  {
    id: "thex",
    name: "The X",
    freq: "106.9",
    city: "London",
    format: "Campus",
    url: "https://ice23.securenetsystems.net/CIXXFM",
    aliases: ["the x", "fanshawe", "x"],
  },
];

const TENS: Record<string, number> = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

const ONES: Record<string, string> = {
  zero: "0",
  oh: "0",
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
};

export function spokenFreq(text: string): string | null {
  let t = text
    .toLowerCase()
    .replace(/[^\w\s.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  t = t.replace(/\b(one hundred|a hundred)\s+(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)?/g, (_, _h, rest) => {
    const extra: Record<string, number> = {
      one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
      ten: 10, eleven: 11, twelve: 12,
    };
    return String(100 + (rest ? extra[rest] ?? 0 : 0));
  });
  t = t.replace(/\b(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:\s+(one|two|three|four|five|six|seven|eight|nine|oh|zero))?/g, (_, ten, one) => {
    return String((TENS[ten] ?? 0) + (one ? Number(ONES[one] ?? 0) : 0));
  });
  t = t.replace(/\bpoint\b/g, ".");
  t = t.replace(/\b(zero|oh|one|two|three|four|five|six|seven|eight|nine)\b/g, (w) => ONES[w] ?? w);
  t = t.replace(/(\d)\s+(?=\d)/g, "$1");
  t = t.replace(/(\d)\s+\./g, "$1.");
  t = t.replace(/\.\s+(\d)/g, ".$1");
  const hit = t.match(/\b(\d{2,4}(?:\.\d{1,2})?)\b/);
  return hit?.[1] ?? null;
}

function freqKey(freq: string) {
  const n = Number(freq);
  return Number.isFinite(n) ? n : null;
}

export function matchStation(query: string): Station | null {
  const q = query.toLowerCase().replace(/[.?]/g, "").trim();
  if (!q) return null;
  const heard = spokenFreq(q);
  if (heard) {
    const target = freqKey(heard);
    const exact = STATIONS.find((s) => freqKey(s.freq) === target);
    if (exact) return exact;
  }
  const exactAlias = STATIONS.find((s) => s.aliases.some((a) => q === a));
  if (exactAlias) return exactAlias;
  const byAlias = STATIONS.find((s) =>
    s.aliases.some((a) => a.length >= 5 && q.includes(a)),
  );
  if (byAlias) return byAlias;
  const byName = STATIONS.find(
    (s) => q.includes(s.name.toLowerCase()) || s.name.toLowerCase().includes(q),
  );
  return byName ?? null;
}

export function wantsRadioOff(text: string) {
  const t = text
    .toLowerCase()
    .replace(/[?.!]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return false;
  if (
    /\b(?:close|stop|shut|kill|silence|switch off|turn off)\b/.test(t) &&
    /\b(?:radio|station|music)\b/.test(t)
  ) {
    return true;
  }
  if (/^(?:radio|music|station)\s+(?:off|stop|close)\b/.test(t)) return true;
  if (/^turn\s+(?:the\s+)?(?:radio|music|station)\s+off\b/.test(t)) return true;
  return false;
}

export function stationCommand(text: string): string | null {
  const t = text
    .toLowerCase()
    .replace(/[?.!,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!t || wantsRadioOff(t)) return null;
  const led = t.match(
    /^(?:please\s+)?(?:play|put on|tune(?:\s+to)?|start|switch(?:\s+to)?|change(?:\s+(?:the\s+station\s+)?to)?|go to)\s+(.+)$/,
  );
  const phrase = (led?.[1] ?? t).replace(/^(?:the|a|some)\s+/, "").trim();
  const words = phrase.split(/\s+/).filter(Boolean);
  const station = matchStation(phrase);
  const freq = spokenFreq(phrase);
  if (!station && !freq) return null;
  if (station && (station.aliases.some((a) => phrase === a) || phrase === station.name.toLowerCase())) {
    return phrase;
  }
  if (words.length <= 3) return phrase;
  return null;
}

export function stationLine(station: Station) {
  return `${station.freq} ${station.name}, ${station.city}.`;
}
