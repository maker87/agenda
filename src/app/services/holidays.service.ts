
import { Injectable } from '@angular/core';

export interface HolidayEvent {
  title: string;
  date: string;  // YYYY-MM-DD
  type: 'national' | 'regional';
}

export interface RegionInfo {
  country: string;
  countryCode: string;
  regions: string[];
}

// ── Holiday data: country → { national: [...], regional: { region: [...] } }
const HOLIDAY_DB: Record<string, {
  national: { title: string; month: number; day: number }[];
  regional: Record<string, { title: string; month: number; day: number }[]>;
}> = {
  US: {
    national: [
      { title: "New Year's Day", month: 1, day: 1 },
      { title: 'Martin Luther King Jr. Day', month: 1, day: 20 },
      { title: "Presidents' Day", month: 2, day: 17 },
      { title: 'Memorial Day', month: 5, day: 26 },
      { title: 'Juneteenth', month: 6, day: 19 },
      { title: 'Independence Day', month: 7, day: 4 },
      { title: 'Labor Day', month: 9, day: 1 },
      { title: 'Columbus Day', month: 10, day: 13 },
      { title: 'Veterans Day', month: 11, day: 11 },
      { title: 'Thanksgiving', month: 11, day: 27 },
      { title: 'Christmas Day', month: 12, day: 25 },
    ],
    regional: {
      'California': [{ title: 'César Chávez Day', month: 3, day: 31 }],
      'Texas': [{ title: 'Texas Independence Day', month: 3, day: 2 }, { title: 'San Jacinto Day', month: 4, day: 21 }],
      'New York': [],
      'Florida': [],
      'Illinois': [{ title: 'Casimir Pulaski Day', month: 3, day: 3 }],
      'Pennsylvania': [],
      'Ohio': [],
      'Michigan': [],
      'Georgia': [{ title: 'Confederate Memorial Day', month: 4, day: 28 }],
      'Massachusetts': [{ title: "Patriots' Day", month: 4, day: 21 }],
      'Washington': [],
      'Colorado': [],
      'Virginia': [{ title: 'Lee-Jackson Day', month: 1, day: 17 }],
    },
  },
  CA: {
    national: [
      { title: "New Year's Day", month: 1, day: 1 },
      { title: 'Family Day', month: 2, day: 17 },
      { title: 'Good Friday', month: 4, day: 18 },
      { title: 'Easter Monday', month: 4, day: 21 },
      { title: 'Victoria Day', month: 5, day: 19 },
      { title: 'Canada Day', month: 7, day: 1 },
      { title: 'Labour Day', month: 9, day: 1 },
      { title: 'National Day for Truth and Reconciliation', month: 9, day: 30 },
      { title: 'Thanksgiving', month: 10, day: 13 },
      { title: 'Remembrance Day', month: 11, day: 11 },
      { title: 'Christmas Day', month: 12, day: 25 },
      { title: 'Boxing Day', month: 12, day: 26 },
    ],
    regional: {
      'Ontario': [{ title: 'Civic Holiday', month: 8, day: 4 }],
      'Quebec': [{ title: 'Saint-Jean-Baptiste Day', month: 6, day: 24 }, { title: 'National Patriots Day', month: 5, day: 19 }],
      'British Columbia': [{ title: 'BC Day', month: 8, day: 4 }],
      'Alberta': [{ title: 'Alberta Family Day', month: 2, day: 17 }, { title: 'Heritage Day', month: 8, day: 4 }],
      'Manitoba': [{ title: 'Louis Riel Day', month: 2, day: 17 }],
      'Saskatchewan': [{ title: 'Saskatchewan Day', month: 8, day: 4 }],
      'Nova Scotia': [{ title: 'Heritage Day', month: 2, day: 17 }],
      'New Brunswick': [{ title: 'New Brunswick Day', month: 8, day: 4 }],
      'Newfoundland and Labrador': [{ title: 'St. Patrick\'s Day', month: 3, day: 17 }],
      'Prince Edward Island': [{ title: 'Islander Day', month: 2, day: 17 }],
    },
  },
  GB: {
    national: [
      { title: "New Year's Day", month: 1, day: 1 },
      { title: 'Good Friday', month: 4, day: 18 },
      { title: 'Easter Monday', month: 4, day: 21 },
      { title: 'Early May Bank Holiday', month: 5, day: 5 },
      { title: 'Spring Bank Holiday', month: 5, day: 26 },
      { title: 'Summer Bank Holiday', month: 8, day: 25 },
      { title: 'Christmas Day', month: 12, day: 25 },
      { title: 'Boxing Day', month: 12, day: 26 },
    ],
    regional: {
      'Scotland': [{ title: "St Andrew's Day", month: 11, day: 30 }, { title: 'Burns Night', month: 1, day: 25 }],
      'Northern Ireland': [{ title: "St Patrick's Day", month: 3, day: 17 }, { title: 'Orangemen\'s Day', month: 7, day: 12 }],
      'Wales': [{ title: "St David's Day", month: 3, day: 1 }],
      'England': [],
    },
  },
  AU: {
    national: [
      { title: "New Year's Day", month: 1, day: 1 },
      { title: 'Australia Day', month: 1, day: 26 },
      { title: 'Good Friday', month: 4, day: 18 },
      { title: 'Easter Saturday', month: 4, day: 19 },
      { title: 'Easter Monday', month: 4, day: 21 },
      { title: 'Anzac Day', month: 4, day: 25 },
      { title: "Queen's Birthday", month: 6, day: 9 },
      { title: 'Christmas Day', month: 12, day: 25 },
      { title: 'Boxing Day', month: 12, day: 26 },
    ],
    regional: {
      'New South Wales': [{ title: 'Bank Holiday', month: 8, day: 4 }],
      'Victoria': [{ title: 'Melbourne Cup', month: 11, day: 4 }],
      'Queensland': [{ title: 'Royal Queensland Show', month: 8, day: 13 }],
      'Western Australia': [{ title: 'Western Australia Day', month: 6, day: 2 }],
      'South Australia': [{ title: 'Proclamation Day', month: 12, day: 24 }],
      'Tasmania': [{ title: 'Recreation Day', month: 11, day: 3 }],
    },
  },
  FR: {
    national: [
      { title: 'Jour de l\'An', month: 1, day: 1 },
      { title: 'Lundi de Pâques', month: 4, day: 21 },
      { title: 'Fête du Travail', month: 5, day: 1 },
      { title: 'Victoire 1945', month: 5, day: 8 },
      { title: 'Ascension', month: 5, day: 29 },
      { title: 'Lundi de Pentecôte', month: 6, day: 9 },
      { title: 'Fête Nationale', month: 7, day: 14 },
      { title: 'Assomption', month: 8, day: 15 },
      { title: 'Toussaint', month: 11, day: 1 },
      { title: 'Armistice', month: 11, day: 11 },
      { title: 'Noël', month: 12, day: 25 },
    ],
    regional: {
      'Alsace': [{ title: 'Vendredi Saint', month: 4, day: 18 }, { title: 'Saint-Étienne', month: 12, day: 26 }],
      'Île-de-France': [],
      'Provence-Alpes-Côte d\'Azur': [],
    },
  },
  DE: {
    national: [
      { title: 'Neujahrstag', month: 1, day: 1 },
      { title: 'Karfreitag', month: 4, day: 18 },
      { title: 'Ostermontag', month: 4, day: 21 },
      { title: 'Tag der Arbeit', month: 5, day: 1 },
      { title: 'Christi Himmelfahrt', month: 5, day: 29 },
      { title: 'Pfingstmontag', month: 6, day: 9 },
      { title: 'Tag der Deutschen Einheit', month: 10, day: 3 },
      { title: 'Weihnachten', month: 12, day: 25 },
      { title: '2. Weihnachtstag', month: 12, day: 26 },
    ],
    regional: {
      'Bavaria': [{ title: 'Heilige Drei Könige', month: 1, day: 6 }, { title: 'Fronleichnam', month: 6, day: 19 }, { title: 'Allerheiligen', month: 11, day: 1 }],
      'Berlin': [{ title: 'Internationaler Frauentag', month: 3, day: 8 }],
      'Baden-Württemberg': [{ title: 'Heilige Drei Könige', month: 1, day: 6 }, { title: 'Allerheiligen', month: 11, day: 1 }],
      'Saxony': [{ title: 'Buß- und Bettag', month: 11, day: 19 }],
    },
  },
  MX: {
    national: [
      { title: 'Año Nuevo', month: 1, day: 1 },
      { title: 'Día de la Constitución', month: 2, day: 3 },
      { title: 'Natalicio de Benito Juárez', month: 3, day: 17 },
      { title: 'Día del Trabajo', month: 5, day: 1 },
      { title: 'Día de la Independencia', month: 9, day: 16 },
      { title: 'Día de la Revolución', month: 11, day: 17 },
      { title: 'Navidad', month: 12, day: 25 },
    ],
    regional: {},
  },
  IN: {
    national: [
      { title: 'Republic Day', month: 1, day: 26 },
      { title: 'Independence Day', month: 8, day: 15 },
      { title: 'Gandhi Jayanti', month: 10, day: 2 },
      { title: 'Christmas', month: 12, day: 25 },
      { title: 'Diwali (approx)', month: 10, day: 20 },
      { title: 'Holi (approx)', month: 3, day: 14 },
    ],
    regional: {},
  },
  BR: {
    national: [
      { title: 'Ano Novo', month: 1, day: 1 },
      { title: 'Carnaval', month: 3, day: 4 },
      { title: 'Sexta-feira Santa', month: 4, day: 18 },
      { title: 'Tiradentes', month: 4, day: 21 },
      { title: 'Dia do Trabalho', month: 5, day: 1 },
      { title: 'Independência', month: 9, day: 7 },
      { title: 'Nossa Senhora Aparecida', month: 10, day: 12 },
      { title: 'Finados', month: 11, day: 2 },
      { title: 'Proclamação da República', month: 11, day: 15 },
      { title: 'Natal', month: 12, day: 25 },
    ],
    regional: {},
  },
};

@Injectable({ providedIn: 'root' })
export class HolidaysService {

  /** Get all available countries. */
  getCountries(): { code: string; name: string }[] {
    return [
      { code: 'US', name: 'United States' },
      { code: 'CA', name: 'Canada' },
      { code: 'GB', name: 'United Kingdom' },
      { code: 'AU', name: 'Australia' },
      { code: 'FR', name: 'France' },
      { code: 'DE', name: 'Germany' },
      { code: 'MX', name: 'Mexico' },
      { code: 'IN', name: 'India' },
      { code: 'BR', name: 'Brazil' },
    ];
  }

  /** Get regions/states for a country. */
  getRegions(countryCode: string): string[] {
    const db = HOLIDAY_DB[countryCode];
    if (!db) return [];
    return Object.keys(db.regional).sort();
  }

  /** Generate holiday events for a given country + optional region for the given year. */
  getHolidays(countryCode: string, region: string, year?: number): HolidayEvent[] {
    const y = year ?? new Date().getFullYear();
    const db = HOLIDAY_DB[countryCode];
    if (!db) return [];

    const events: HolidayEvent[] = [];

    // National holidays
    for (const h of db.national) {
      events.push({
        title: h.title,
        date: `${y}-${String(h.month).padStart(2, '0')}-${String(h.day).padStart(2, '0')}`,
        type: 'national',
      });
    }

    // Regional holidays
    if (region && db.regional[region]) {
      for (const h of db.regional[region]) {
        events.push({
          title: h.title,
          date: `${y}-${String(h.month).padStart(2, '0')}-${String(h.day).padStart(2, '0')}`,
          type: 'regional',
        });
      }
    }

    return events.sort((a, b) => a.date.localeCompare(b.date));
  }
}
