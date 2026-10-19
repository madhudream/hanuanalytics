const NAMES: Record<string, string> = {
  IN: "India", US: "United States", GB: "United Kingdom", DE: "Germany", CA: "Canada", AU: "Australia", FR: "France",
  BR: "Brazil", JP: "Japan", SG: "Singapore", AE: "United Arab Emirates", NL: "Netherlands", ES: "Spain", IT: "Italy",
  ID: "Indonesia", MX: "Mexico", PK: "Pakistan", BD: "Bangladesh", NG: "Nigeria", KR: "South Korea", SE: "Sweden",
  CH: "Switzerland", IE: "Ireland", PL: "Poland", ZA: "South Africa", PH: "Philippines", MY: "Malaysia", LK: "Sri Lanka",
  NP: "Nepal", TR: "Türkiye", RU: "Russia", CN: "China", HK: "Hong Kong", TW: "Taiwan", VN: "Vietnam", TH: "Thailand",
  AR: "Argentina", CL: "Chile", CO: "Colombia", EG: "Egypt", SA: "Saudi Arabia", IL: "Israel", NZ: "New Zealand",
  PT: "Portugal", BE: "Belgium", AT: "Austria", DK: "Denmark", NO: "Norway", FI: "Finland", CZ: "Czechia", UA: "Ukraine",
};

export function countryName(code: string): string {
  if (!code) return "Unknown";
  return NAMES[code.toUpperCase()] ?? code;
}

export function flag(code: string): string {
  if (!code || code.length !== 2) return "🌐";
  const c = code.toUpperCase();
  return String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 65, 0x1f1e6 + c.charCodeAt(1) - 65);
}
